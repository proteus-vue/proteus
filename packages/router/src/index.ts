// packages/router/src/index.ts
// 统一路由 API（P3-1 + 拆包步骤 4 工厂化 + ★2026-10-02 App 端收口）
//
// 【★2026-10-02 结构调整（App 端零胶水的关键）】Router 主体已抽到 **平台中立**的
//   `router-core.ts`（不 import @proteus-vue/shared）；本入口只做一件事：
//   **给核心注入默认 adapter（shared 的 Web/MP 单例）**，保持既有调用方式不变：
//     const router = createRouter(routes)             // Web / MP（原地不变）
//     const router = createRouter(routes, { adapter }) // 任意平台（App 用 @proteus-vue/router/app）
//   App 端入口见 `./app.ts`（`@proteus-vue/router/app`）——不引入 shared，可在 JSC/QuickJS 运行。
import type { RouteRecord } from './types'
import { adapter as sharedAdapter } from '@proteus-vue/shared'
import { createRouterCore } from './router-core'
import type { RouterAdapter, RouterOptions } from './router-core'

export { Router, createRouterCore, currentFrom } from './router-core'
export type { RouterAdapter, RouterOptions, RouterTraceBus, RouterInstance } from './router-core'

/**
 * 创建 Router 实例（拆包步骤 4 工厂化）：路由表由调用方注入
 * 用法：const router = createRouter(routes)（routes 来自 gen-routes 生成的 auto-routes）
 * ★B11：options.auth——登录检查器（requiresAuth 页面自动拦截；onAuthFail 可跳登录页/提示）
 * ★security M3：options.permissions——权限检查器（meta.permissions 页面自动拦截；onPermissionFail 可跳 forbidden/引导授权）
 * ★★App 端：传 `options.adapter`（`@proteus-vue/router/app` 的 `createAppNavigationAdapter` 产物），
 *   或直接用 `createAppNavigation`（render-backend）一步装配——开发者不写胶水。
 */
export function createRouter(
  routes: RouteRecord[],
  options: RouterOptions = {},
): ReturnType<typeof createRouterCore> {
  const adapter: RouterAdapter = options.adapter ?? (sharedAdapter as RouterAdapter)
  return createRouterCore(routes, { ...options, adapter })
}

// ★路由规划 M3/M4：三端共享转场映射 + codegen（scan/tree 管线产物消费）
export { WEB_TRANSITION_MAP, MP_ROUTE_TYPE_MAP, webTransitionName, mpRouteType, isTransition } from './transforms/transform-transition'
export type { RouteTransition } from './transforms/transform-transition'
export { generateWebRoutes, generateMpConfig, mergeAppJson, flattenNodes, toPageConfig } from './codegen'
export type { MpPageConfig } from './codegen'

// ★★路由规划 M5（App 端）：虚拟路由栈（屏 = 树内子树；无系统导航栈 / 无层数上限 / 内存预算冻结）
//   设计对齐 Flutter Navigator——栈是纯逻辑对象，不可见层树保留（display:none）或按预算冻结（重建）。
//   本层不产生平台调用：通过 ScreenCommand 命令流交给执行器（Morpheus 转场 + Host ABI）。
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
export { generateAppScreens, toScreenEntry, flattenScreenEntries, tabStacks } from './codegen'
export type { AppScreenEntry } from './codegen'

// ★★NB1/NB3/NB6（导航体系，2026-10-02）：多分支独立栈（分支 = meta.isTab 页，零新增配置源）
//   + 保活三档（none/active/all）+ 返回归属（back 只作用于活跃分支；到根交外层/系统信号）。
//   纯逻辑、零端依赖——装配与用法见 branch-navigator.ts 头注。
export { createBranchNavigator, KEEP_ALIVE_TIERS, OUTER_BRANCH } from './branch-navigator'
export type {
  BranchNavigator,
  BranchNavigatorOptions,
  BranchSpec,
  BranchCommand,
  BranchEvent,
  BranchClock,
  BranchStackSnapshot,
  KeepAliveDecision,
  BackOutcome,
} from './branch-navigator'

// ★G-32 B6（2026-09-19）：路由名推导是**跨包公开契约**——迁移工具链（compat-miniprogram 路由名表
//   `routeNameFromPath`）必须与 derivePath 模式下的真实产物同名，否则 codemod 建议的
//   `router.push({ name })` 在 routeMap 中查不到（死引用）。导出供 tests/route-table.test.ts 跨包一致性断言。
export { deriveNameFromFile } from './scan'

// ★router-plus G-32 M1：路由语义层 + 五端导航映射 + 栈 diff
//（NAVIGATION_MAP 映射语义 → 各端原生 API；computeRoutePatch 是转场事务的输入）
export {
  STACK_SEMANTICS,
  NAVIGATION_MAP,
  BACK_MAP,
  isStackSemantic,
  validateStackSemantic,
  resolveNavigation,
} from './navigation'
export type { StackSemantic, StylePlatform } from './navigation'
export { computeRoutePatch, applyRoutePatch } from './stack-diff'
export type { RoutePatch } from './stack-diff'

// ★router-plus G-32 M4：Deep Link（URL 解析 + pattern 匹配 + 白名单 + 冷启动栈）
export { parseDeepLinkUrl, matchPattern, isDeepLinkAllowed, resolveDeepLink, buildColdStartStack } from './deep-link'
export type { DeepLinkConfig, ParsedDeepLink, ResolvedRoute } from './deep-link'

// 类型契约再导出（应用侧 import type { RouteRecord } from '@proteus-vue/router' 即可，无需深路径）
export type {
  RouteRecord,
  RouteMeta,
  RouteBlock,
  RouteNode,
  GlobalRouteDefaults,
  RouteParams,
  RouteParamsByName,
  PageOnLoad,
  BaseNavigateOptions,
  NavigateOptions,
} from './types'

// ★平台变体（2026-09-13，第 2/4 层）：Web 端组件路径变体解析 + 路由平台门控
export { resolveVariantComponentKey, routeAppliesToPlatform } from './variant'
