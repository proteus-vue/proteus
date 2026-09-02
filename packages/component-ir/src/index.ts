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
