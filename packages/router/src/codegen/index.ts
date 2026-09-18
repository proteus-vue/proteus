// packages/router/src/codegen/index.ts —— 路由 codegen 聚合（docs/proteus-router-plan M3/M4）
// 消费 scan/tree 管线的 RouteNode[]，输出三端路由形态（Web vue-router / MP app.json / App 待 v0.6）
export { generateWebRoutes, webTransitionName } from './web'
export { generateMpConfig, mergeAppJson, flattenNodes, toPageConfig } from './mp'
export type { MpPageConfig } from './mp'
export { mpRouteType } from '../transforms/transform-transition'
