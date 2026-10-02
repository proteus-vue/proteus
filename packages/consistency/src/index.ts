// packages/consistency/src/index.ts
// @proteus-vue/consistency —— 多端一致性：**快照格式 + 探针 + 分级容差 + 比对引擎 + 像素观察 + 失败报告**
// 消费方：各端探针（Web / 小程序 / App 宿主）· 比对与门禁脚本 · 失败报告（VC8-b）· L4 观察（VC7）
export * from './snapshot'
export * from './probes/web'
export * from './tolerance'
export * from './compare'
export * from './pixel'
export * from './png'
export * from './report'
