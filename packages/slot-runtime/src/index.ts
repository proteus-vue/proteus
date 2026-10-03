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

// ★RT0（2026-09-30）：动画曲线（跨语言契约的 TS 半边——与 Rust `anim.rs` 同式；
//   golden `tests/anim-curve-golden.test.ts` 以 Rust **实测值**为期望）
export { AnimCurve, curveEval, animValue } from './anim-curve'
export type { AnimCurveId, AnimKindId } from './anim-curve'

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

// ★卡 I1：版本协商（Host ABI §6 三件套；`OPS_WIRE_VERSION` 与 `OPS_VERSION` **同源**）
export {
  ABI_VERSION, IR_VERSION, OPS_WIRE_VERSION, MIN_SHELL_VERSION,
  versionInfo, checkHostVersion,
} from './version'
export type { ProteusVersionInfo, VersionCheckResult } from './version'
export type { ListHandle, ListItem } from './list'

export { L1_CONDITIONS, decideTier, explainDecision, decisionsToRows } from './tier'
export type { ConditionId, TierFacts, TierDecision, ExplainRow } from './tier'

// ★V3：订阅表契约 + 订阅表驱动的槽位运行时（方案 §1.3 L1 的完整形态）
export type { SubscriptionTable, SourceSubscription, SlotSubscription, EvaluatorSpec, MemoGroup } from './table'
// ★V6：表达式程序（含运算的表达式的标准求值路径）
export { evalExpr, PURE_CALLS, isPureCallName, PURE_METHODS, isPureMethodName, isPureCallExprName, GLOBAL_CONST_MEMBERS } from './expr'
export type { ExprProgram, ExprContext, BinOp, UnOp, LogicOp } from './expr'
// ★V4：列表项注册表（让 LIST_UPDATE 在 JS 侧可解析）
export { ListRegistry } from './list-registry'
// ★V4：LayoutTemplate 契约 + 实例化（模板 + 数据 → 引擎就绪节点树）
export type { LayoutTemplate, LayoutNode, ListTemplate, TextSegment, InstantiatedNode } from './layout-template'
export { instantiateTemplate, evalTextSegments } from './instantiate'
export type { InstantiateOptions, InstantiateResult } from './instantiate'
export { VaporRuntime, tierOf, makeScopedRead } from './runtime'
export type { SourceSubscriber, EvalContext, LoadResult } from './runtime'
// ★P2-3：手势派发语义（链序 + 事件修饰符 .stop/.self/.once）——各端宿主共用的唯一实现
export { dispatchGesture, indexEventBindings, createDispatchState } from './dispatch'
export type { EventBinding, EventIndex, DispatchState, DispatchResult } from './dispatch'
