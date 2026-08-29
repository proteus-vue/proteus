// src/router/types.ts
// ★类型收口（10-type-consolidation）：路由类型契约已统一收口到 @proteus/types/router-types
// 本文件保留为 re-export 兼容层（auto-routes.ts 的 declare module '@proteus/router/types' 模块扩充继续生效）
export type {
  RouteRecord,
  RouteMeta,
  RouteTransition,
  RouteParamsByName,
  RouteBlock,
  RouteNode,
  GlobalRouteDefaults,
  RouteParams,
  PageOnLoad,
  BaseNavigateOptions,
  NavigateOptions,
} from '@proteus/types/router-types'
