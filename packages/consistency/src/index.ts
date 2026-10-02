// packages/consistency/src/index.ts
// @proteus-vue/consistency —— VC3/VC4/VC5/VC6：多端一致性**统一快照格式 + 探针 + 分级容差 + 比对引擎**
// 消费方：各端探针（Web / 小程序 / App 宿主）· 比对与门禁脚本 · 失败报告（VC8-b）
export * from './snapshot'
export * from './probes/web'
export * from './tolerance'
export * from './compare'
