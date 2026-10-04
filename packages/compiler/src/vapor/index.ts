// packages/compiler/src/vapor/index.ts
// Vapor for Proteus IR · V2 —— 编译期响应式转换（方案 §4）的公开出口
export { scanReactiveSources } from './sources'
export type { ReactiveSource, SourceKind, SourceScanResult, VueCompatDeps } from './sources'
export { analyzeExprDeps, analyzeAstDeps, collectTemplateBindings, normalizePropKey } from './deps'
export type { ExprDeps, TemplateBindingRef } from './deps'
export { buildVaporSubscriptions, slotKindOf } from './build'
export type {
  VaporDiagnostic,
  SubscriptionTable,
  SourceSubscription,
  SlotSubscription,
  EvaluatorSpec,
  VaporBuildOptions,
  VaporBuildResult,
} from './build'
// ★V4：LayoutTemplate（模板 → 初始节点树）—— 「全量 SFC → 端上渲染」的静态结构产物
export { buildLayoutTemplate, parseStaticStyle, parseClassStyles, parseClassRules, resolveClassStyles, stripScopeSuffix } from './template'
export type { ClassStyleRule } from './template'
// ★App 端 CSS 支持面 SSOT（2026-10-04：对照矩阵 / check:app-css-surface 消费）
export {
  APP_LAYOUT_FIELDS,
  APP_PAINT_FIELDS,
  APP_EDGE_FIELDS,
  APP_DERIVED_FIELDS,
  APP_SPECIAL_FIELDS,
  APP_ENUM_VALUES,
} from './template'
export { compileEvents } from './events'
export { parsePaintDeclAttr, isPaintDeclAttr } from './template'
export type { EventBinding, HandlerAction, EventHandlers, EventCompileResult } from './events'
export type { LayoutTemplate, LayoutNode, ListTemplate } from './template'
