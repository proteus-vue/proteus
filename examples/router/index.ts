// examples/router/index.ts —— 应用侧路由单例（拆包步骤 4 工厂化）
// ★工厂化：路由表不再藏在框架里，由本文件从 gen-routes 生成的 ./auto-routes 注入 createRouter
// 应用开发者视角：只需这一行单例；换应用换路由表，框架零改动
import { createRouter } from '@proteus/router'
import { routes } from './auto-routes'

export const router = createRouter(routes)

// 类型契约透传（应用页面可直接 import type { PageOnLoad } from './router'，无需深路径）
export type {
  RouteRecord,
  RouteMeta,
  RouteParams,
  RouteParamsByName,
  PageOnLoad,
  NavigateOptions,
  RouterInstance,
} from '@proteus/router'
