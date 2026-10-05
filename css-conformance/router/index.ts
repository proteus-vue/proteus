// css-conformance/router/index.ts —— 应用侧路由单例
import { createRouter } from '@proteus-vue/router'
import { routes } from './auto-routes'

export const router = createRouter(routes)

export type { RouteRecord, RouteParams, PageOnLoad } from '@proteus-vue/router'
