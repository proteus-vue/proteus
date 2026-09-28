// packages/slot-runtime/src/runtime.ts
// Vapor for Proteus IR · V3 —— **订阅表驱动的槽位运行时**（方案 §1.3 L1 层的完整形态）
//
// 【V3 补的是什么】V1 交付了槽位容器与指令通道，但槽位要**手工 setSlot**；
//   V2 交付了编译器算出的 `SubscriptionTable`（源 → 槽位 + 求值函数声明）。
//   本模块把两者接起来：**加载订阅表 → 注册订阅 → 源变化时自动求值并直写槽位**。
//   这就是方案 §1.2 的目标路径：
//
//     ref 写入 → 直写对应槽位 → UpdateProgram 发射指令 → 提交
//     （对比 Vue 默认：组件 render 重跑 → 重建 VNode → diff → patch）
//
// 【★诚实边界：本模块不依赖 Vue】
//   方案 §4.1 的措辞是「保留 Vue 运行时响应式（Proxy 依赖收集），只把**监听之后做什么**改掉」。
//   故本模块只要求调用方提供一个 `subscribe(sourceName, cb)` 钩子——
//   生产环境用 Vue 的 `watch`/`effect` 接，测试用同步桩。这样：
//     · 本模块可独立测试（不依赖 Vue 版本）
//     · 换响应式实现（如方案 §8 讨论的 alien-signals）不用改这里
import { OpCode } from './opcode'
import type { SlotKind, UpdateTier } from './opcode'
import type { ListRegistry } from './list-registry'
import { SlotRuntime, createSlot } from './slot'
import type { Slot } from './slot'
import type { EvaluatorSpec, SubscriptionTable } from './table'

/** 源订阅钩子：源值变化时回调（由宿主注入；Vue 场景 = watch / effect） */
export type SourceSubscriber = (sourceName: string, onChange: () => void) => void

/** 求值上下文（取源值用） */
export interface EvalContext {
  /** 读源当前值（Vue 场景 = `unref` 后的值；列表源 = 数组） */
  read(sourceName: string): unknown
}

/** 加载结果（供宿主对账与诊断） */
export interface LoadResult {
  /** 实际建立订阅的 L1 槽位数 */
  l1Slots: number
  /** 未建订阅的 L0 槽位数（走 Vue 渲染） */
  l0Slots: number
  /** 未知源名（订阅表引用了宿主没提供的源——**必须上报**，否则是静默不更新） */
  unknownSources: string[]
  /** 无法实例化的求值函数（形态不支持等）——同样上报 */
  unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }>
}

/**
 * 订阅表驱动的槽位运行时（方案 §1.3 的 L1 完整形态）
 *
 * 用法（宿主侧）：
 * ```ts
 * const rt = new VaporRuntime(table, { push: (op) => buffer.push(op) }, keys, strings)
 * rt.load(evaluatorCtx, (sourceName, cb) => watch(sourceName, cb))   // 注册订阅
 * rt.relink()   // 首帧：把所有 L1 槽位写入一次
 * ```
 */
export class VaporRuntime {
  private readonly slots = new Map<number, Slot>();
  private readonly slotById = new Map<number, { slot: Slot; spec: SubscriptionTable['sources'][number]['slots'][number]; evalId: number }>()
  private readonly evalImpls = new Map<number, (ctx: EvalContext) => unknown>()
  private readonly sourcesOfSlot = new Map<number, string[]>()
  /** ★行内槽位的按键值缓存（`slotId:key` → 上次值）——只发变化行 */
  private readonly itemValueCache = new Map<string, unknown>()
  private loaded = false

  constructor(
    readonly table: SubscriptionTable,
    readonly rt: SlotRuntime,
    /** 求值函数的**实现**（由 evaluator 声明重建；id → 函数） */
    private readonly evaluators: Map<number, (ctx: EvalContext) => unknown>,
    /**
     * ★V4：列表项注册表（可选）
     *
     * 提供它 ⇒ `list-item` 槽位在发指令前解析出**具体行的节点**，从而发普通 SET_STYLE/SET_TEXT
     *（核心无需懂列表）；不提供或未登记 ⇒ 回退 `LIST_UPDATE`（宿主自持映射的场景）。
     */
    private readonly registry?: ListRegistry,
  ) {}

  /**
   * 从订阅表重建求值函数（把**可序列化的声明**变成可执行函数）
   *
   * 【为什么单独一步（而不是直接吃函数）】方案 §4.4 要求产物可序列化
   *   （跨端禁 eval）⇒ 声明与实现分离：声明随产物下发，实现在各端本地重建。
   *   本方法就是「本地重建」的参考实现：
   *     · `member` —— 纯路径访问，**免解析**（热路径主力）
   *     · `const`  —— 常量
   *     · `expr`   —— 表达式文本（各端按自己的能力求值；本实现给出最简单的成员回退）
   */
  static buildEvaluators(specs: EvaluatorSpec[]): Map<number, (ctx: EvalContext) => unknown> {
    const out = new Map<number, (ctx: EvalContext) => unknown>()
    for (const s of specs) {
      switch (s.form) {
        case 'member': {
          const segs = (s.path ?? '').split('.').filter(Boolean)
          const [root, ...rest] = segs
          out.set(s.evaluatorId, (ctx) => {
            let v = ctx.read(root!)
            for (const seg of rest) {
              if (v == null || typeof v !== 'object') return undefined
              v = (v as Record<string, unknown>)[seg]
            }
            return v
          })
          break
        }
        case 'const': {
          const text = (s.expr ?? '').trim()
          const parsed: unknown = /^-?\d+(\.\d+)?$/.test(text)
            ? Number(text)
            : text === 'true'
              ? true
              : text === 'false'
                ? false
                : text.replace(/^['"]|['"]$/g, '')
          out.set(s.evaluatorId, () => parsed)
          break
        }
        case 'expr': {
          // ★诚实边界：本参考实现只支持**单一路径/值引用**的表达式形态。
          //   完整表达式求值（`n + 1`、三元、模板串）需要目标端的表达式执行器——
          //   方案 §6 的三端执行层各有一份（App 端可用 Hermes 的 function 构造，
          //   Web 端直接 new Function，小程序端需走 WXS/Worklet）。
          //   ⇒ 不在本层猜：标为不支持并上报（由调用方决定降级或补实现）。
          const expr = (s.expr ?? '').trim()
          if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) {
            const segs = expr.split('.')
            const [root, ...rest] = segs
            out.set(s.evaluatorId, (ctx) => {
              let v = ctx.read(root!)
              for (const seg of rest) {
                if (v == null || typeof v !== 'object') return undefined
                v = (v as Record<string, unknown>)[seg]
              }
              return v
            })
          }
          break
        }
        default:
          break
      }
    }
    return out
  }

  /** 注册订阅（方案 §4.3 Step 5：源变化 → 求值 → 直写槽位） */
  load(ctx: EvalContext, subscribe: SourceSubscriber): LoadResult {
    const unknownSources: string[] = []
    const unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }> = []
    let l1Slots = 0

    for (const src of this.table.sources) {
      for (const spec of src.slots) {
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!impl) {
          unsupportedEvaluators.push({ evaluatorId: spec.evaluatorId, reason: '求值函数未实例化（形态不支持）' })
          continue
        }
        // 每个槽位只建一次（一个源可能出现在多个 slot 里；同一槽位也可能被多个源引用）
        let slot = this.slots.get(spec.slotId)
        if (!slot) {
          // ★V4：列表行内槽位用**编译器产出的真实** listId/itemSlotId（V3 时是占位值）
          //   —— 配合 `ListRegistry` 把 (listId, itemKey, itemSlotId) 解析成具体行的节点。
          slot = createSlot(
            {
              id: spec.slotId,
              nodeId: spec.nodeId,
              kind: spec.kind as SlotKind,
              keyId: this.rt.keys.intern(spec.propKey),
              listId: spec.listId ?? spec.slotId,
              listSlotId: spec.itemSlotId ?? spec.slotId,
              itemKind: spec.itemKind,
              itemValueField: spec.itemValueField,
              itemKeyField: spec.itemKeyField,
              scope: spec.scope,
            },
            this.rt.keys,
            this.rt.strings,
            undefined as unknown,
            this.registry, // ★传入注册表（缺省 ⇒ list-item 回退 LIST_UPDATE，保持 V3 行为）
          )
          this.slots.set(spec.slotId, slot)
        }
        this.slotById.set(spec.slotId, { slot, spec, evalId: spec.evaluatorId })
        // 记录该槽位被哪些源驱动（多源依赖时任一变化都要重算）
        const deps = this.sourcesOfSlot.get(spec.slotId) ?? []
        deps.push(src.sourceName)
        this.sourcesOfSlot.set(spec.slotId, deps)
        l1Slots++
      }
    }

    // 注册订阅：源变化 → 求值其全部槽位 → 直写
    for (const src of this.table.sources) {
      subscribe(src.sourceName, () => {
        this.writeSlotsOfSource(src.sourceName, ctx)
      })
    }

    this.loaded = true
    return {
      l1Slots,
      l0Slots: this.table.l0Slots.length,
      unknownSources,
      unsupportedEvaluators,
    }
  }

  /** 写入某源驱动的全部槽位（源变化时由订阅回调触发） */
  writeSlotsOfSource(sourceName: string, ctx: EvalContext): void {
    for (const src of this.table.sources) {
      if (src.sourceName !== sourceName) continue
      // ★★列表行内槽位走**独立通道**（本仓实测的设计纠正，我为此试错三轮）
      //
      // 【为什么不能走"脏槽位"】`LIST_UPDATE` 的语义是「(listId, itemKey, slotId, value)」
      //   ——**每行一条指令**；而"一个槽位持有一个值"的模型**装不下 N 行**
      //   （写 N 次只剩最后一次；且 `Object.is` 短路会误判成"没变"）。
      //   ⇒ 正解：**按行迭代** + 用**按键缓存的上一轮值**做 diff + 只发变化行的指令。
      //     这保住 O(1)（只改 1 行 ⇒ 只发 1 条），且不误用槽位模型。
      this.writeListItems(src, ctx)

      for (const spec of src.slots) {
        if (spec.kind === 'list-item') continue // 已由上方通道处理
        // ★`list-data` 也**不走标量写值**（本仓实测：它是报错源，不是 list-item）
        //
        // 【为什么】`LIST_SET` 的载荷是**编译期分配的「数据源引用号」**（数字），
        //   不是数组本身——「整体换数据源」是结构性操作，不是"把数组写进一个槽位"。
        //   把它当标量写 ⇒ 求值器返回数组 ⇒ `toF32(数组)` 抛错（本仓实测就是这个）。
        //   ⇒ 结构性的 LIST_SET/LIST_SPLICE 属独立课题（需数据源引用协议），当前显式跳过。
        if (spec.kind === 'list-data') continue
        const entry = this.slotById.get(spec.slotId)
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!entry || !impl) continue
        this.rt.setSlot(entry.slot, impl(ctx) as never)
      }
    }
  }

  /**
   * ★列表行内槽位通道：按行求值 → 与上一轮**按 key 缓存**的值 diff → 只发变化行
   *
   * 【关键：行作用域求值】`item.w` 的求值需要**当前行**绑定到 v-for 作用域。
   *   故每行构造一个 `rowCtx`：`read(scope)` 返回该行，其余名透传原 ctx。
   *   （编译器在槽位上给了 `scope` 才能这么做——见 SlotSubscription.scope）
   */
  private writeListItems(src: SubscriptionTable['sources'][number], ctx: EvalContext): void {
    const itemSlots = src.slots.filter((x) => x.kind === 'list-item')
    if (itemSlots.length === 0) return
    const rows = ctx.read(src.sourceName)
    if (!Array.isArray(rows)) return

    for (const spec of itemSlots) {
      const impl = this.evaluators.get(spec.evaluatorId)
      if (!impl) continue
      const scope = spec.scope ?? ''
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>
        // ★行作用域上下文：v-for 别名 → 当前行
        const rowCtx: EvalContext = scope
          ? { read: (n) => (n === scope ? row : ctx.read(n)) }
          : ctx
        const value = impl(rowCtx)
        // ★行标识：优先 `:key` 字段；无 `:key` 用下标（不稳定——构表时已产出诊断）
        const key = spec.itemKeyField && row && row[spec.itemKeyField] !== undefined ? String(row[spec.itemKeyField]) : String(i)
        // ★按键 diff：只发**真的变了**的行（保住「改 1 行 = 1 条指令」）
        const cacheKey = `${spec.slotId}:${key}`
        if (this.itemValueCache.get(cacheKey) === value) continue
        this.itemValueCache.set(cacheKey, value)
        this.emitListItem(spec, key, value)
      }
    }
  }

  /** 发一条行内更新指令：解析得到 nodeId 就发普通指令，否则回退 LIST_UPDATE */
  private emitListItem(spec: SubscriptionTable['sources'][number]['slots'][number], key: string, value: unknown): void {
    const nodeId = this.registry?.resolveNode(spec.listId ?? -1, key, spec.itemSlotId ?? -1)
    if (nodeId !== undefined) {
      if ((spec.itemKind ?? 'style') === 'text') {
        this.rt.buffer.push({ op: OpCode.SET_TEXT, nodeId, textRef: this.rt.strings.intern(String(value)) })
      } else {
        this.rt.buffer.push({
          op: OpCode.SET_STYLE,
          nodeId,
          keyId: this.rt.keys.intern(spec.propKey),
          value: typeof value === 'number' ? value : Number(value) || 0,
        })
      }
    } else {
      this.rt.buffer.push({
        op: OpCode.LIST_UPDATE,
        listId: spec.listId ?? -1,
        itemKeyRef: this.rt.strings.intern(key),
        slotId: spec.itemSlotId ?? -1,
        value: typeof value === 'number' ? value : Number(value) || 0,
      })
    }
  }

  /** ★首帧同步：把所有 L1 槽位按当前源值写一遍（否则首屏不会出现这些值） */
  relink(ctx: EvalContext): void {
    for (const src of this.table.sources) {
      this.writeSlotsOfSource(src.sourceName, ctx)
    }
  }

  /** 取某源的行数组（列表源 ⇒ 数组；非数组返回空）——仅供「无 :key 时用下标兜底」 */
  private rowsOfSource(sourceName: string, ctx: EvalContext): unknown[] {
    const v = ctx.read(sourceName)
    return Array.isArray(v) ? v : []
  }

  /** 某槽位是否已建立订阅（诊断：确认"这个槽位真的被接管了"） */
  hasSlot(slotId: number): boolean {
    return this.slots.has(slotId)
  }

  get loaded_(): boolean {
    return this.loaded
  }

  /** 该槽位由哪些源驱动（诊断 / explain） */
  depsOf(slotId: number): string[] {
    return this.sourcesOfSlot.get(slotId) ?? []
  }

  /** L1 槽位表（供宿主对账：哪些槽位由 L1 接管） */
  slotIds(): number[] {
    return [...this.slots.keys()].sort((a, b) => a - b)
  }
}

/** 槽位分层（诊断输出用） */
export function tierOf(table: SubscriptionTable, slotId: number): UpdateTier {
  for (const s of table.sources) {
    for (const sl of s.slots) if (sl.slotId === slotId) return sl.tier
  }
  return 'L0'
}
