// packages/contracts/src/index.ts
// @proteus-vue/contracts —— 跨层共享 DTO 契约（架构规约 L0 + types-plan §07）
// 定位：RouteRecord/RouteMeta/RouteTransition/ApiResponse/StoreSnapshot/CapabilityDescriptor
//       单一来源，消除 Router/Module 各自定义 DTO（铁律 #9 同名必同义）；零运行时依赖纯类型。
// 消费：types 包 re-export 兼容（types → contracts 单向）；各实现包经 types 或直接 import 本包。

export * from './route'
export * from './api'
export * from './store'
export * from './capability'
export * from './style'
