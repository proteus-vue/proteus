// packages/router/src/app.ts
// ★★App 端路由入口（`@proteus-vue/router/app-route`）—— **不引入 @proteus-vue/shared**
//
// 【为什么单独一个入口（而不是直接导出主入口）】主入口 `index.ts` 顶部 import shared 的
//   `adapter` 单例；该单例在无 window/wx 环境（iOS JSC / Android QuickJS）会走 web 分支并在
//   模块求值期读 location ⇒ **App 端 import 主入口会崩**（本仓 #491 事故同源）。
//   ⇒ App 工程从这里取：Router 核心（`createRouterCore`）+ App 适配器（栈 → RouterAdapter）。
//
// 用法（配合 render-backend 的 `createAppNavigation` 一步装齐）：
// ```ts
// import { createAppNavigation } from '@proteus-vue/render-backend/app-navigation'
// import { createRouter, screensFromRoutes } from '@proteus-vue/router/app-route'
// const nav = createAppNavigation({ invoke: (m, a) => proteusHost.invoke(m, a), routes })
// const router = createRouter(routes, { adapter: nav.adapter })
// router.push({ name: 'detail' })     // ← 与 Web/MP 完全同形
// ```
// ★注意：用 `router-core.ts` 的 `createRouterCore`（**adapter 必填**）——本入口的 `createRouter`
//   是它的薄包装（避免与主入口同名同义的函数在同一工程里出现两套签名）。
import { createRouterCore } from './router-core'
import type { RouterOptions, RouterAdapter } from './router-core'
import type { RouteRecord } from './types'

// ★app-route 入口的 `createRouter` 薄包装（adapter **必填**——App 端没有"默认 shared adapter"；
//   与主入口同名但签名收紧了 adapter 必填，避免"忘了注入 ⇒ 静默用错端适配器"）。
export function createRouter(
  routes: RouteRecord[],
  options: RouterOptions & { adapter: RouterAdapter },
): ReturnType<typeof createRouterCore> {
  return createRouterCore(routes, options)
}

export { Router, createRouterCore, currentFrom } from './router-core'
export type { RouterAdapter, RouterOptions, RouterTraceBus, RouterInstance } from './router-core'

// App 端适配器（栈 → RouterAdapter）+ 屏注册表推导
export { createAppNavigationAdapter, screensFromRoutes, parseRouterUrl } from './app-adapter'
export type { AppNavigationAdapterOptions } from './app-adapter'

// 虚拟路由栈（App 端栈语义；与 `createAppNavigation` 内部同一实现）
export { createAppStack } from './app-stack'
export type {
  AppStack,
  AppStackPolicy,
  AppStackStats,
  AppStackEvent,
  AppScreen,
  AppScreenSpec,
  AppScreenState,
  ScreenFrame,
  ScreenCommand,
} from './app-stack'

// 转场映射（App 腿：枚举 → Morpheus 规格在 @proteus-vue/animation 的 appTransition；
//   本入口只带**枚举与校验**——枚举收口 contracts，路由表与三端同源）
export { isTransition } from './transforms/transform-transition'
export type { RouteTransition } from './transforms/transform-transition'

// 类型契约（应用侧 import type 即可）
export type { RouteRecord, RouteMeta, RouteNode, RouteParams, NavigateOptions } from './types'
