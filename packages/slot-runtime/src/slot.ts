// packages/slot-runtime/src/slot.ts
// Vapor for Proteus IR —— ★槽位容器与发射器（方案 §3.1 / §3.3）
//
// 【槽位是更新的最小单位】每个动态绑定 = 一个槽位（编译期分配 id）。
//   写入即更新：`setSlot` → 标脏 → 帧调度 → `emit` 追加指令 → 一次提交。
//   **没有 render、没有 VNode、没有 diff**（方案 §3.3 原文）。
//
// 【与 V0 探针的关系（本方案立项依据的实测）】
//   V0 真机读数：单节点更新 plain 78ms → v-memo 等价物 9ms，而宿主侧只要 1ms；
//   瓶颈是「Vue 为找出那一个变化付出的代价」（整树 VNode 重建 + patch 遍历，
//   `patchProp` 调用 5003 次/次更新）。槽位直写把这个「找」的成本消成 O(1)。
//
// 【为什么发射器由工厂生成（而不是编译器直接内联）】
//   V2（编译期响应式转换）会为每个槽位**生成**专用发射函数体（无 switch、无字典查找）；
//   本文件的 `makeEmitter` 是它的**运行时等价物**——与 V0 探针里 `withMemo` 的角色相同
//   （同一实现，先手工调用、后由编译器展开）。这样 V1 就能独立验证指令与通道。
import { InsertPos, OpCode, PropKeyTable, SLOT_KIND_OP, StringPool } from './opcode'
import type { SlotKind, UpdateOp } from './opcode'
import { OpBuffer } from './buffer'
import type { OpSink } from './buffer'

/** 槽位（强类型值容器；携带编译期分配的发射器） */
export interface Slot<T = unknown> {
  /** 编译期分配（全局槽位表下标） */
  readonly id: number
  readonly nodeId: number
  readonly kind: SlotKind
  value: T
  dirty: boolean
  /** 值变化 → 追加指令（编译期生成；运行时不判定类型） */
  emit(next: T, buf: OpBuffer): void
}

/** 槽位规格（编译期产物里存的就是它） */
export interface SlotSpec {
  id: number
  nodeId: number
  kind: SlotKind
  /** prop / style / attrs / component-prop 用到：属性键表下标 */
  keyId?: number
  /** list-item 用到：所属列表 id（与 keyId 复用规则见 makeEmitter 注释） */
  listId?: number
  /** list-item 用到：该列表项内的槽位下标 */
  listSlotId?: number
  /**
   * list-item 用到：该项字段是**样式**还是**文本**
   *
   * 【为什么要区分】`{{ item.name }}` 是文本、`{ width: item.w }` 是样式——
   *   两者在解析成功时发的是**不同指令**（SET_TEXT vs SET_STYLE）。
   *   缺省 'style'（列表项里样式绑定更常见）。
   */
  itemKind?: 'style' | 'text'
  /** 行对象里的**取值字段**（`item.w` ⇒ 'w'）——发射器据此组 `{key, value}` 的 value */
  itemValueField?: string
  /** 行对象里的**标识字段**（`:key="item.id"` ⇒ 'id'）——组 `{key, value}` 的 key */
  itemKeyField?: string
  /** v-for 别名（行作用域求值用） */
  scope?: string
  /** 列表源表达式（嵌套时如 `group.items`） */
  sourceExpr?: string
  /** 外层列表 id（嵌套时才有） */
  parentListId?: number
}

/**
 * 构造槽位（含其发射器）
 *
 * 【keyId 的分配时机】这里调用 `keys.intern(...)` 会**分配**下表项 ⇒
 *   构造顺序影响线上字节（golden 逐字节比对会锁定这一点）。
 *   编译器产物应把 intern 结果固化进 SlotSpec（避免运行时首次构造顺序漂移）。
 */
export function createSlot<T>(
  spec: SlotSpec,
  keys: PropKeyTable,
  strings: StringPool,
  initial: T,
  /**
   * ★列表项注册表（可选）：提供它 ⇒ `list-item` 槽位在**发指令前解析出具体 nodeId**，
   *   从而发出普通 SET_STYLE/SET_TEXT（核心无需懂列表）；不提供或解析不到 ⇒ 回退 LIST_UPDATE。
   */
  registry?: import('./list-registry').ListRegistry,
): Slot<T> {
  const nodeId = spec.nodeId
  const keyId = spec.keyId ?? 0
  const listId = spec.listId ?? 0
  const listSlotId = spec.listSlotId ?? spec.id

  const slot: Slot<T> = {
    id: spec.id,
    nodeId,
    kind: spec.kind,
    value: initial,
    dirty: false,
    emit(next: T, buf: OpBuffer): void {
      switch (spec.kind) {
        case 'text':
          // 文本进字符串池（指令体只带整数引用 ⇒ 运行时无字符串解析）
          buf.push({ op: OpCode.SET_TEXT, nodeId, textRef: strings.intern(String(next)) })
          return
        case 'prop':
          buf.push({ op: OpCode.SET_PROP, nodeId, keyId, value: toF32(next) })
          return
        case 'style':
          buf.push({ op: OpCode.SET_STYLE, nodeId, keyId, value: toF32(next) })
          return
        case 'visibility':
          buf.push({ op: OpCode.TOGGLE_VIS, nodeId, visible: Boolean(next) })
          return
        case 'list-item': {
          // ★★item 级更新：一条指令定位到「列表内某一项」的槽位（方案 §2.3）
          //
          // 【两条路径（本仓实测后定的分工）】
          //   · **解析成功**（常见）：注册表给出该 itemKey 的 nodeId ⇒ 发普通指令。
          //     `LIST_SET/SET_STYLE/SET_TEXT` 的核心**完全不需要懂列表语义**——
          //     这是本设计的要点：列表知识留在 JS 侧（它本来就知道）。
          //   · 解析不到（宿主自持映射 / 复用池场景）：发 `LIST_UPDATE` 由宿主解析
          //     （V1 已定义该指令与线上格式，Rust 侧遇它会上报 unsupported 而非静默丢弃）。
          const item = next as unknown as ListItemValue
          const nodeId = registry?.resolveNode(listId, item.key, listSlotId)
          if (nodeId !== undefined) {
            if ((spec.itemKind ?? 'style') === 'text') {
              buf.push({ op: OpCode.SET_TEXT, nodeId, textRef: strings.intern(String(item.value)) })
            } else {
              buf.push({ op: OpCode.SET_STYLE, nodeId, keyId, value: toF32(item.value) })
            }
            return
          }
          buf.push({
            op: OpCode.LIST_UPDATE,
            listId,
            itemKeyRef: strings.intern(item.key),
            slotId: listSlotId,
            value: toF32(item.value),
          })
          return
        }
        case 'list-data':
          // 整体替换数据源（`next` = 编译期分配的数据源引用号）；结构增删走 list.ts 的 splice
          buf.push({ op: OpCode.LIST_SET, listId, dataRef: toF32(next) })
          return
        case 'attrs': {
          // `next` 必须是**已经 intern 过的**键值对（见 attrsValue）——
          // ★不能在这里 intern：发射器在热路径上，intern 会引入 Map 查找与首次分配顺序漂移。
          const attrs = next as unknown as Array<{ keyId: number; value: number }>
          buf.push({ op: OpCode.SET_ATTRS, nodeId, attrs })
          return
        }
        case 'component-prop':
          buf.push({ op: OpCode.CALL_COMPONENT_UPDATE, componentId: nodeId, slotId: listSlotId, value: toF32(next) })
          return
        default: {
          const never: never = spec.kind
          throw new Error(`未知槽位种类：${String(never)}`)
        }
      }
    },
  }
  return slot
}

/** list-item 槽位的值形状（key 定位 + 新值） */
export interface ListItemValue {
  key: string
  value: number
}

/** attrs 槽位的值形状（**已 intern** 的键值对；经 `attrsValue()` 构造） */
export type AttrsValue = Array<{ keyId: number; value: number }>

function toF32(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  throw new Error(`槽位值必须是 number/boolean，收到 ${typeof v}（文本请用 kind='text'）`)
}

/* ────────────────────────── 帧调度（方案 §2.4 / §3.3） ────────────────────────── */

/** 帧调度器接口：App 端绑定 vsync / Choreographer；测试用同步实现 */
export interface FrameScheduler {
  schedule(cb: () => void): void
}

/** 默认调度器：微任务（桌面/测试）。★App 端必须替换为 vsync 对齐的调度器。 */
export const microtaskScheduler: FrameScheduler = {
  schedule(cb) {
    void Promise.resolve().then(cb)
  },
}

export interface SlotRuntimeStats {
  /** flush 次数（验收指标：每帧 flush 次数 = 1，方案 §10） */
  flushes: number
  /** 累计发射指令数 */
  opsEmitted: number
  /** 累计提交字节数 */
  bytesSent: number
  /** `setSlot` 因值相等而短路的次数（O(1) 生效的直接读数） */
  shortCircuits: number
}

/**
 * 槽位运行时（方案 §1.3 的 L1 层）
 *
 * 【每帧一次 flush】`scheduleFlush()` 在已排队时不重复排队（`pending` 标志）——
 *   这正是验收指标「每帧 flush 次数 = 1」的实现方式：同帧内 N 个槽位变化只提交一次。
 */
export class SlotRuntime {
  readonly buffer = new OpBuffer()
  private readonly dirty: Slot[] = []
  private pending = false
  private readonly stats: SlotRuntimeStats = { flushes: 0, opsEmitted: 0, bytesSent: 0, shortCircuits: 0 }

  constructor(
    readonly keys: PropKeyTable,
    readonly strings: StringPool,
    readonly sink: OpSink,
    readonly scheduler: FrameScheduler = microtaskScheduler,
  ) {}

  /** 槽位写入（方案 §3.3）：相等即短路；否则标脏 + 排帧 */
  setSlot<T>(slot: Slot<T>, next: T): void {
    if (Object.is(slot.value, next)) {
      this.stats.shortCircuits++
      return
    }
    slot.value = next
    if (!slot.dirty) {
      slot.dirty = true
      this.dirty.push(slot)
    }
    this.scheduleFlush()
  }

  /** 排帧（幂等——同帧多次调用只排一次） */
  scheduleFlush(): void {
    if (this.pending) return
    this.pending = true
    this.scheduler.schedule(() => this.flush())
  }

  /**
   * 立即 flush（测试 / 确定性驱动用）
   *
   * 【为什么单独暴露】真机上「Vsync 何时来」不可控；测量装置纪律要求用例能**确定性地**
   *   驱动一次提交（本仓四次踩过"测量装置污染读数"）。
   */
  flush(): void {
    this.pending = false
    for (const slot of this.dirty) {
      slot.emit(slot.value, this.buffer)
      slot.dirty = false
    }
    this.dirty.length = 0
    if (this.buffer.count === 0) return
    this.stats.opsEmitted += this.buffer.count
    this.stats.bytesSent += this.buffer.flush(this.keys, this.strings, this.sink)
    this.stats.flushes++
  }

  getStats(): Readonly<SlotRuntimeStats> {
    return { ...this.stats }
  }

  /** 待发射的脏槽位数（诊断） */
  get dirtyCount(): number {
    return this.dirty.length
  }
}

/** 便捷构造 attrs 槽位的值（键名经 PropKeyTable 分配 ⇒ 指令体只带整数） */
export function attrsValue(rt: SlotRuntime, pairs: Record<string, number>): AttrsValue {
  const out: AttrsValue = []
  for (const k of Object.keys(pairs)) out.push({ keyId: rt.keys.intern(k), value: pairs[k] })
  return out
}

/** 槽位种类的默认操作码（编译期判定的一致性检查用） */
export function opcodeFor(kind: SlotKind): number {
  return SLOT_KIND_OP[kind]
}

export { InsertPos }
export type { UpdateOp }
