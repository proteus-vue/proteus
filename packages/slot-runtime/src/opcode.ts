// packages/slot-runtime/src/opcode.ts
// Vapor for Proteus IR —— ★IR 更新指令集（平台无关；方案 §2）
//
// 【设计原则（方案 §2.1 四条，逐条落到本文件）】
//   · 平台无关：同一条指令三端都能执行（App 走 JSI → Rust；Web 走 DOM；MP 走 setData）
//   · 最小完备：覆盖 Vue 模板全部更新语义——属性/内容/结构/列表/组件边界五类
//   · 数值化：节点用编译期整数 ID、属性用**枚举键**（PropKeyTable 分配），运行时无字符串解析
//     ★这是「不解析字符串」的硬约束：字符串只出现在**字符串池**里，指令体内一律是整数引用
//   · 可批处理：指令累积进 OpBuffer，一帧一次跨边界提交（方案 §2.4）
//
// 【为什么属性键要经 PropKeyTable 而不是硬编码枚举】
//   编译器面对的 propKey 是开放集合（`layout.width` / `text.color` / 业务自定义…），
//   硬编码表必然漏；而「运行时解析字符串」又正是要消除的成本（本仓实测：JSON 通道占
//   4051 节点「布局耗时」的 95%+，见 layout-core-rust/src/blob.rs 顶注）。
//   ⇒ 正解：**编译期分配**——PatchTable 里放一张 interned 表，指令只带表内下标。

/** IR 更新指令操作码（数值即线上格式的判别字节，**不得改号**） */
export enum OpCode {
  // ── 属性与内容 ──
  SET_PROP = 0x01,   // (nodeId, propKeyId, value)     普通属性
  SET_STYLE = 0x02,  // (nodeId, styleKeyId, value)    归一化样式（枚举键）
  SET_TEXT = 0x03,   // (nodeId, textRef)              文本内容（字符串池引用）
  SET_ATTRS = 0x04,  // (nodeId, *(keyId, value))      批量属性（v-bind 对象展开）
  TOGGLE_VIS = 0x05, // (nodeId, visible)              v-show / v-if
  /**
   * ★★★B3d（2026-10-10）：**字符串样式** `(nodeId, styleKeyId, strRef)`——
   *   `grid-template-columns` 等值形如 `1fr 1fr 200px`（**字符串 token 串**），f32 的 SET_STYLE 装不下
   *   ⇒ 独立 op（值走**字符串池引用**，与 SET_TEXT 同池）。解码端（Rust）逐字节等价。
   */
  SET_STYLE_STR = 0x06,

  // ── 结构 ──
  INSERT_BLOCK = 0x10, // (blockId, refNodeId, pos)    插入已编译块实例
  REMOVE_NODE = 0x11,  // (nodeId)
  MOVE_NODE = 0x12,    // (nodeId, refNodeId, pos)

  // ── 列表 ──
  LIST_SET = 0x20,    // (listId, dataRef)             整体替换数据源
  LIST_SPLICE = 0x21, // (listId, start, delCount, *itemKeyRef) 增删项
  LIST_UPDATE = 0x22, // (listId, itemKeyRef, slotId, value)   ★item 级更新（方案 §2.3）

  // ── 组件边界 ──
  CALL_COMPONENT_UPDATE = 0x30, // (componentId, slotId, value) 透传子组件
}

/** 插入/移动的位次语义（`pos` 字段取值，线上格式 u8） */
export enum InsertPos {
  BEFORE = 0,
  AFTER = 1,
}

/** 槽位种类 → 更新语义（决定生成哪种指令；方案 §3.1） */
export type SlotKind =
  | 'text'           // → SET_TEXT
  | 'prop'           // → SET_PROP
  | 'style'          // → SET_STYLE
  | 'attrs'          // → SET_ATTRS
  | 'list-data'      // → LIST_SET / LIST_SPLICE
  | 'list-item'      // → LIST_UPDATE
  | 'visibility'     // → TOGGLE_VIS
  | 'component-prop' // → CALL_COMPONENT_UPDATE

/** 槽位种类 → 默认操作码（编译期确定，运行时**无分支**） */
export const SLOT_KIND_OP: Record<SlotKind, OpCode> = {
  text: OpCode.SET_TEXT,
  prop: OpCode.SET_PROP,
  style: OpCode.SET_STYLE,
  attrs: OpCode.SET_ATTRS,
  'list-data': OpCode.LIST_SET,
  'list-item': OpCode.LIST_UPDATE,
  visibility: OpCode.TOGGLE_VIS,
  'component-prop': OpCode.CALL_COMPONENT_UPDATE,
}

/** 更新分层（方案 §5.2）：L1 = 槽位直写；L0 = VDOM 兜底（行为正确性优先） */
export type UpdateTier = 'L0' | 'L1'

/* ────────────────────────── 指令（判别联合，字段即线上语义） ────────────────────────── */

export interface OpSetProp {
  op: OpCode.SET_PROP | OpCode.SET_STYLE
  nodeId: number
  /** PropKeyTable 内下标（编译期分配） */
  keyId: number
  value: number
}

export interface OpSetText {
  op: OpCode.SET_TEXT
  nodeId: number
  /** 字符串池下标（文本内容） */
  textRef: number
}

export interface OpSetAttrs {
  op: OpCode.SET_ATTRS
  nodeId: number
  /** 键值对（顺序即写入顺序，保证双端可复现） */
  attrs: Array<{ keyId: number; value: number }>
}

export interface OpToggleVis {
  op: OpCode.TOGGLE_VIS
  nodeId: number
  visible: boolean
}

/** ★B3d：字符串样式（值走字符串池引用——f32 装不下 `1fr 1fr` 这类 token 串） */
export interface OpSetStyleStr {
  op: OpCode.SET_STYLE_STR
  nodeId: number
  keyId: number
  /** 字符串池下标（样式字符串值，如 `1fr 1fr 200px`） */
  valueRef: number
}

export interface OpInsertBlock {
  op: OpCode.INSERT_BLOCK
  blockId: number
  refNodeId: number
  pos: InsertPos
}

export interface OpRemoveNode {
  op: OpCode.REMOVE_NODE
  nodeId: number
}

export interface OpMoveNode {
  op: OpCode.MOVE_NODE
  nodeId: number
  refNodeId: number
  pos: InsertPos
}

export interface OpListSet {
  op: OpCode.LIST_SET
  listId: number
  /** 数据源引用（编译期分配；语义由宿主解释） */
  dataRef: number
}

export interface OpListSplice {
  op: OpCode.LIST_SPLICE
  listId: number
  start: number
  delCount: number
  /** 新增项的 key（字符串池引用） */
  itemKeyRefs: number[]
}

export interface OpListUpdate {
  op: OpCode.LIST_UPDATE
  listId: number
  /** 目标项 key（字符串池引用）——★item 级定位，避免重建整个列表 */
  itemKeyRef: number
  /** 该项内的槽位 id（编译期分配） */
  slotId: number
  value: number
}

export interface OpCallComponentUpdate {
  op: OpCode.CALL_COMPONENT_UPDATE
  componentId: number
  slotId: number
  value: number
}

export type UpdateOp =
  | OpSetProp
  | OpSetStyleStr
  | OpSetText
  | OpSetAttrs
  | OpToggleVis
  | OpInsertBlock
  | OpRemoveNode
  | OpMoveNode
  | OpListSet
  | OpListSplice
  | OpListUpdate
  | OpCallComponentUpdate

/* ────────────────────────── 编译期属性键表（PatchTable 的一部分） ────────────────────────── */

/**
 * 属性键表：编译期 intern 字符串 → 稳定整数下标（**首次出现即分配**，顺序确定 ⇒ 双端一致）
 *
 * ★为什么下标从 0 开始且按 intern 顺序（而不是哈希）：
 *   产物要能被**逐字节复现**（Golden 门禁比对 bytes，见 tests/update-ops-golden.test.ts）。
 *   哈希表遍历顺序不可控 ⇒ 换成确定性顺序。
 */
export class PropKeyTable {
  private readonly keys: string[] = []
  private readonly index = new Map<string, number>()

  /** 分配（已存在则返回原下标——**幂等**） */
  intern(key: string): number {
    const hit = this.index.get(key)
    if (hit !== undefined) return hit
    const id = this.keys.length
    this.keys.push(key)
    this.index.set(key, id)
    return id
  }

  /** 反查（诊断 / explain 用；运行时不走这条路径） */
  keyOf(id: number): string | undefined {
    return this.keys[id]
  }

  get size(): number {
    return this.keys.length
  }

  /** 导出（进 PatchTable 产物） */
  toArray(): string[] {
    return [...this.keys]
  }

  /** 导入（消费方重建） */
  static fromArray(keys: string[]): PropKeyTable {
    const t = new PropKeyTable()
    for (const k of keys) t.intern(k)
    return t
  }
}

/** 字符串池（文本内容 / 列表 key；同样按 intern 顺序分配） */
export class StringPool {
  private readonly values: string[] = []
  private readonly index = new Map<string, number>()

  intern(s: string): number {
    const hit = this.index.get(s)
    if (hit !== undefined) return hit
    const id = this.values.length
    this.values.push(s)
    this.index.set(s, id)
    return id
  }

  valueOf(id: number): string | undefined {
    return this.values[id]
  }

  get size(): number {
    return this.values.length
  }

  toArray(): string[] {
    return [...this.values]
  }

  static fromArray(values: string[]): StringPool {
    const p = new StringPool()
    for (const v of values) p.intern(v)
    return p
  }
}
