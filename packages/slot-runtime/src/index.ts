// packages/slot-runtime/src/index.ts
// @proteus-vue/slot-runtime —— Vapor for Proteus IR 的 **L1 层**（方案 §1.3）
//
// 【这一层是什么】「槽位容器 / 响应式订阅 / UpdateProgram 执行 / 指令发射」的运行时。
//   方案 §1.2 的目标路径：`dep 变化 → 直写槽位 → UpdateProgram 生成指令 → JSI → Rust 核心`
//   （O(1) 槽位写入 + 极短指令生成 + 1ms 宿主），对比现状的 69ms Vue 侧开销。
//
// 【V1 范围内的诚实边界】
//   · 本包实现**指令集 + 槽位 + 通道**（V1 里程碑）；**编译期响应式转换**属 V2——
//     即：目前槽位由调用方手工 `setSlot`（V2 会由编译器生成同样的调用）。
//     这与 V0 探针用 `withMemo` 手工替代 `v-memo` 是同一手法：先用手工调用验证机制。
//   · UpdateProgram 的**编译器生成**同样属 V2；本包的 `emit` 是它的运行时等价物。
//   · 三端执行层（§6）中，App 端 JSI 消费指令属 V3；本包只负责产出平台无关指令与二进制字节。
export { OpCode, InsertPos, SLOT_KIND_OP, PropKeyTable, StringPool } from './opcode'
export type { SlotKind, UpdateTier, UpdateOp } from './opcode'

export {
  OpBuffer,
  encodeOps,
  decodeOps,
  canonicalOps,
  opSize,
  OPS_MAGIC,
  OPS_VERSION,
  OPS_HEADER_BYTES,
} from './buffer'
export type { OpSink, DecodedOps } from './buffer'

export { SlotRuntime, createSlot, attrsValue, opcodeFor, microtaskScheduler } from './slot'
export type { Slot, SlotSpec, SlotRuntimeStats, FrameScheduler, ListItemValue, AttrsValue } from './slot'

export { createList, emitItemUpdate, emitItemUpdates, emitSplice, emitListSet } from './list'
export type { ListHandle, ListItem } from './list'

export { L1_CONDITIONS, decideTier, explainDecision, decisionsToRows } from './tier'
export type { ConditionId, TierFacts, TierDecision, ExplainRow } from './tier'

// ★V3：订阅表契约 + 订阅表驱动的槽位运行时（方案 §1.3 L1 的完整形态）
export type { SubscriptionTable, SourceSubscription, SlotSubscription, EvaluatorSpec } from './table'
// ★V6：表达式程序（含运算的表达式的标准求值路径）
export { evalExpr } from './expr'
export type { ExprProgram, ExprContext, BinOp, UnOp, LogicOp } from './expr'
// ★V4：列表项注册表（让 LIST_UPDATE 在 JS 侧可解析）
export { ListRegistry } from './list-registry'
export { VaporRuntime, tierOf } from './runtime'
export type { SourceSubscriber, EvalContext, LoadResult } from './runtime'
