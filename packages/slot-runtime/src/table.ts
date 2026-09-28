// packages/slot-runtime/src/table.ts
// Vapor for Proteus IR —— **订阅表契约**（方案 §4.4）的**归属地**
//
// 【为什么这些类型放运行时包而不是编译器包】
//   依赖方向必须单向：`compiler → slot-runtime`（编译器产出订阅表）；反过来会成环。
//   与 V1 的 `OpCode` 同理——**契约定义在消费端（运行时），生产端（编译器）import**。
//   本仓纪律：同一语义只允许一处定义（复制一份必然在两处分叉）。
import type { SlotKind, UpdateTier } from './opcode'

/** 一个槽位的订阅条目 */
export interface SlotSubscription {
  /** 槽位 id（编译期连续分配；与 component-ir 的 DynamicBinding.slotId 对齐） */
  slotId: number
  /** 目标节点 id（component-ir 分配） */
  nodeId: number
  /** 求值函数 id（指向 `evaluators`；运行时按 id 取函数，不做字符串解析） */
  evaluatorId: number
  tier: UpdateTier
  /** 槽位种类（决定发射哪种指令） */
  kind: SlotKind
  /** 目标属性键（归一化名，进 PropKeyTable） */
  propKey: string
}

/** 一个响应式源的订阅条目 */
export interface SourceSubscription {
  sourceId: number
  sourceName: string
  sourceKind: 'ref' | 'reactive' | 'computed' | 'props' | 'model' | 'unknown'
  /** ★该源变化时要直写的槽位（L1）；L0 槽位不出现在这里（走 Vue 渲染） */
  slots: SlotSubscription[]
}

/**
 * 求值函数规格（**可序列化**——不含闭包，运行时可从这份声明重建函数）
 *
 * ★形态只有三种，刻意保持极小：
 *   · `expr`   表达式文本（各端按自己的表达式能力求值）
 *   · `const`  常量（源变化不影响它 ⇒ 一般不出现，保留给静态提升）
 *   · `member` 纯成员访问（`item.name` 这类最常见形态，**免解析**直接取值 —— 热路径优化）
 */
export interface EvaluatorSpec {
  evaluatorId: number
  form: 'expr' | 'const' | 'member'
  /** form='expr' 时的表达式源码 */
  expr?: string
  /** form='member' 时的完整路径（`a.b.c`）与其根名 */
  path?: string
  root?: string
  /** 纯函数注解（来源：`@proteus-pure`） */
  pure?: boolean
}

/**
 * 订阅表（方案 §4.4 的 `SubscriptionTable`）
 *
 * ★为什么是**可序列化的表**而不是 JS 源码字符串：
 *   方案 §4.4 明确「编译期产出的不是 JS 源码字符串，而是可序列化的订阅表」——
 *   源码字符串要在运行时 eval/new Function（跨端受限，小程序端禁 eval），
 *   而表可以被 JSON 序列化随产物下发，运行时按 id 查函数。
 */
export interface SubscriptionTable {
  /** 契约版本（与 evaluator 形态同步 bump） */
  version: 1
  /** 源表（id 稳定，按声明顺序） */
  sources: SourceSubscription[]
  /** 求值函数表（id → 形态声明） */
  evaluators: EvaluatorSpec[]
  /** 未走 L1 的槽位（诊断：解释"为什么这个绑定没有加速"） */
  l0Slots: Array<{ slotId: number; nodeId: number; propKey: string; reason: string }>
  /** 统计（棘轮 / 覆盖率度量用） */
  stats: {
    l1: number
    l0: number
    /** L1 覆盖率 = l1 / (l1 + l0)（§10 验收：≥70%） */
    l1Rate: number
  }
}
