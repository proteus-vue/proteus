// packages/shared/src/index.ts —— @proteus/shared 公共入口
// 平台适配器（adapter 抽象 + mp/web 实现）+ 全局类型声明（shims：wx/Page/RouteBuilder/MpEvent 等）
export { adapter } from './platform'
export type { PlatformAdapter } from './platform/adapter'
