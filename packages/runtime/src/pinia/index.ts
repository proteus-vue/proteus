// packages/runtime/src/pinia/index.ts
// Pinia 多端适配统一入口（docs/proteus-pinia-plan M3）
// 业务代码只 import useStore，不感知平台；Pinia 实例由平台入口工厂创建并注入
export { createWebPinia } from './web'
export { createMpPinia } from './mp'
export { createAppPinia } from './app'
export { createSsrPinia } from './ssr'
export { createPersistedStatePlugin } from './persistence/plugin'
export { persisted, createPersistence } from './persistence/lightweight'
export type { PersistOptions } from './persistence/plugin'
export type { PersistenceOptions } from './persistence/lightweight'
