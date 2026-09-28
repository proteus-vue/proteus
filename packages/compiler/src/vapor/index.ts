// packages/compiler/src/vapor/index.ts
// Vapor for Proteus IR · V2 —— 编译期响应式转换（方案 §4）的公开出口
export { scanReactiveSources } from './sources'
export type { ReactiveSource, SourceKind, SourceScanResult } from './sources'
export { analyzeExprDeps, analyzeAstDeps, collectTemplateBindings, normalizePropKey } from './deps'
export type { ExprDeps, TemplateBindingRef } from './deps'
export { buildVaporSubscriptions, slotKindOf } from './build'
export type {
  SubscriptionTable,
  SourceSubscription,
  SlotSubscription,
  EvaluatorSpec,
  VaporBuildOptions,
  VaporBuildResult,
} from './build'
