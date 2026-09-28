// packages/component-ir/src/index.ts —— @proteus-vue/component-ir 公共入口
// ★G-31（component-semantics-plan B1）：组件与 API 语义化——C-IR schema + 属性约束校验 + semantic 映射
//   组件=语义、属性=约束、Backend 消费 semantic 而非 tag（零依赖纯逻辑；map.ts 依赖 render-backend 类型）
export { COMPONENT_IR_SCHEMA, SEMANTIC_ENUM, TAG_SEMANTIC_MAP, FRAMEWORK_INTERNAL_TAGS, TAG_SEMANTIC_ALIASES } from './schema'
export type { ComponentIR, TagAliasDecl } from './schema'
export { validateComponentIR, validateGridConstraints, validateComponentTree, DEFAULT_DESIGN_WIDTH } from './validate'
export type { CIRDiagnostic } from './validate'
export { SEMANTIC_BACKEND_MAP, mapSemanticToBackend } from './map'
// ★G-31 B2：模板标签 → C-IR 转换器（G-29 生产端前置纯函数）
export { toComponentIR, toComponentTree } from './to-ir'
// ★G-31 B5：组件渲染 conformance（快照 vs 参考表 + 语义树 + 覆盖门禁）
export { checkComponentSnapshot, extractSemanticTree, checkSemanticCoverage } from './conformance'
export type { ComponentConformanceResult, ControlMismatch, SemanticTree, CoverageGap } from './conformance'
// ★G-32 B1：完整语义原语清单 SSOT（128——it 唯一事实源）
export { PRIMITIVE_CATALOG, componentPrimitives, implementedPrimitives, primitiveById, primitiveBySemantic, primitiveByTag, checkPrimitiveCatalog } from './primitives'
export type { PrimitiveDef, PrimitiveKind, PrimitiveStatus } from './primitives'
// ★G-32 B1：audit:coverage 工具 + 闭环一致性门禁（G-32.1 小程序能力 100%）
export { MP_MAPPING_MATRIX, auditMiniprogramCoverage, auditMatrixReferences, auditCatalogConsistency, formatCoverageReport } from './audit'
export type { MatrixRefIssue } from './audit'
export type { CoverageReport, MpCoverageStatus, MpMatrixItem, ConsistencyIssue } from './audit'
// ★权威标尺（2026-09-12）：小程序官方清单分类 + spec 驱动覆盖度门禁（修「手写矩阵自证」）
export { classifySpecApi, classifySpecComponent, auditSpecCoverage, auditSpecOverrideRefs, GESTURE_HANDLER_EXPECTED, SPEC_COVERED, SPEC_PLANNED, SPEC_PRIVATE, SPEC_NA, SPEC_COMPONENT_OVERRIDE, SPEC_RATCHET } from './mp-spec-coverage'
export type { MpSpecStatus, MpSpecClass, MpOfficialSpec, SpecCoverageReport } from './mp-spec-coverage'
// ★批次 4（M6）：属性降级声明（EA-5/G-31.2）+ 编译期 PROP_NO_DEGRADATION 门禁
export {
  DEGRADATION_TABLE,
  MP_UNSUPPORTED_PROPS,
  degradeProp,
  degradationOf,
  auditDegradation,
  formatDegradationReport,
  checkPropDegradation,
  collectPropDiagnostics,
  RULE_REGISTERED_PROPS,
  HOST_FALLBACK_TAGS,
  PROP_NO_DEGRADATION,
} from './degradation'
export type {
  DegradationEnd,
  DegradationTier,
  DegradationEntry,
  DegradationMap,
  DegradationIssue,
  DegradationReport,
  PropDiagnostic,
} from './degradation'

/* ─────────────────── ★★M0：渲染 IR（PNode）——App 端高性能渲染的编译期产物 ───────────────────
   定位：`ComponentIR`（语义层「是什么」）与 `IRNode`（后端运行时节点）之间的**渲染层**
   （「怎么画」：样式已归一化 + 单位已折叠 + 携带编译期判定的 flags）。
   ★ 本层是**新增**的，不修改既有形状 —— 既有五后端零影响（计划 §11.3）。
   ★ 承载已实测的绘制策略：拍平（−91% 内存）· 单色紧凑格式（−39%）· 纯背景不进绘制。
   见 docs/Proteus_CSS_Profile规格.md §3–§4 与 docs/proteus-performance-plan/10-ios-memory.md。 */
export type {
  PKind,
  ResolvedLength,
  Edges,
  LayoutProps,
  PaintProps,
  TextProps,
  PaintHint,
  PProps,
  PFlags,
  PNode,
  PTree,
  DynamicBinding,
  UpdateKind,
  PDiagnostic,
} from './pnode'
export { resolveLength, parseStyleString, normalizeStyleDecls, normalizeStyleString, expandEdges, parseTransform, camel, splitTopLevel } from './pnode-style'
export type { LengthContext, NormalizeOptions, NormalizeResult } from './pnode-style'
export { analyzePTree, flattenRate, groupBindingsByNode } from './pnode-analyze'
export type { AnalyzeOptions, AnalyzeResult, NodeFacts } from './pnode-analyze'
export { buildPTree, buildPTreeFromComponentIR, rawFromComponentIR, kindFromSemantic, inferUpdateKind, inferOpCode } from './pnode-build'
export type { PRawNode, BuildOptions } from './pnode-build'
/* ★M0 出口条件：渲染 IR 决策 trace（`proteus explain --ir`）——拍平资格/静态子树/PaintHint */
export { formatPTrace, formatPNodeLine, decisionOf, walkPTree } from './pnode-trace'
export type { PTraceOptions } from './pnode-trace'
