// packages/types/src/mp/index.ts
// mp 子目录聚合出口：组件 schema + 版本对齐（纯 Proteus 类型，零官方依赖，随处可用）
// ★official-typings 单独走 '@proteus-vue/types/mp/official-typings' 子路径（opt-in，避免全局命名空间意外激活）

export * from './component-schema'
export * from './sdk-version'
