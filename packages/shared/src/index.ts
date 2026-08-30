// packages/shared/src/index.ts —— @proteus-vue/shared 公共入口
// 平台适配器（adapter 抽象 + mp/web 实现）+ 存储层（StorageAdapter 工厂/序列化/追踪）+ 全局类型声明（shims）
export { adapter } from './platform'
export type { PlatformAdapter } from './platform/adapter'
export * from './storage'
