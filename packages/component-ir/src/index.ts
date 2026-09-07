// packages/component-ir/src/index.ts —— @proteus-vue/component-ir 公共入口
// ★G-31（component-semantics-plan B1）：组件与 API 语义化——C-IR schema + 属性约束校验 + semantic 映射
//   组件=语义、属性=约束、Backend 消费 semantic 而非 tag（零依赖纯逻辑；map.ts 依赖 render-backend 类型）
export { COMPONENT_IR_SCHEMA, SEMANTIC_ENUM, TAG_SEMANTIC_MAP } from './schema'
export type { ComponentIR } from './schema'
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
export { MP_MAPPING_MATRIX, auditMiniprogramCoverage, auditCatalogConsistency, formatCoverageReport } from './audit'
export type { CoverageReport, MpCoverageStatus, MpMatrixItem, ConsistencyIssue } from './audit'
