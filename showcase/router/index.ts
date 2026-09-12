// showcase/router/index.ts —— 应用侧路由单例
import { createRouter } from '@proteus-vue/router'
import { routes } from './auto-routes'
// ★devtools 打通：路由事件 → TraceBus（与官网/examples 同一约定）
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'

export const router = createRouter(routes, { traceBus: getProteusTraceBus() })

export type {
  RouteRecord,
  RouteMeta,
  RouteParams,
  RouteParamsByName,
  PageOnLoad,
  NavigateOptions,
  RouterInstance,
} from '@proteus-vue/router'
