// packages/router/src/index.ts
// 统一路由 API（P3-1 + 拆包步骤 4 工厂化）—— 只依赖 @proteus/shared 接口，禁止直连 wx（执行规则 4）
// ★工厂化：createRouter(routes) 接收路由表（应用侧由 gen-routes 生成的 auto-routes 提供），
//   不再全局单例 import——路由表由调用方注入（对齐 docs/proteus-router-plan M2）
import type { NavigateOptions, RouteParams, RouteRecord, RouteParamsByName } from './types'
import { runBeforeEach, runAfterEach, beforeEach as registerBeforeEach, afterEach as registerAfterEach } from './guards'
import type { Guard, AfterGuard, GuardTrace } from './guards'
import { isSkyline, navigateWithCustomRoute } from './skyline'
import { adapter } from '@proteus/shared'

class Router {
  /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1） */
  get stackDepth(): number {
    return adapter.getCurrentPages().length
  }

  constructor(
    private routeMap: Record<string, RouteRecord>,
    private options: RouterOptions = {},
  ) {}

  /**
   * 注册前置守卫（M6：实例级 API，三端一致——delegate 到全局守卫注册表）
   * 用法：router.beforeEach((to, from) => { if (to.meta?.needLogin && !isLogin()) return false })
   */
  beforeEach(guard: Guard): void {
    registerBeforeEach(guard)
  }

  /** 注册后置守卫（M6：实例级 API，三端一致） */
  afterEach(guard: AfterGuard): void {
    registerAfterEach(guard)
  }

  /** ★B11（router-plan 超级应用）：requiresAuth 自动守卫——未登录拦截（auth 检查器未配置时放行） */
  private async authGuard(to: RouteRecord, trace: GuardTrace | undefined): Promise<boolean> {
    if (!to.meta?.requiresAuth || !this.options.auth) return true
    const authed = await this.options.auth()
    if (authed) return true
    trace?.(`[guard] requiresAuth → ${to.name ?? to.path} 被拦截（未登录，createRouter auth 检查器）`)
    this.options.onAuthFail?.()
    return false
  }

  /** ★security M3：meta.permissions 自动守卫——缺权限拦截（permissions 检查器未配置时放行；PermissionRegistry.hasAll 直接可传） */
  private async permissionGuard(to: RouteRecord, trace: GuardTrace | undefined): Promise<boolean> {
    const required = to.meta?.permissions
    if (!required || !required.length || !this.options.permissions) return true
    const ok = await this.options.permissions.hasAll(required)
    if (ok) return true
    const denied = required[0]
    trace?.(`[guard] permissions → ${to.name ?? to.path} 被拦截（缺权限 ${denied}，createRouter permissions 检查器）`)
    this.options.onPermissionFail?.(denied)
    return false
  }

  /** 命名路由跳转（推荐）——泛型 N 由 name 字面量推断，params 类型自动匹配（类型提示全链路） */
  async push<N extends keyof RouteParamsByName = keyof RouteParamsByName>(options: NavigateOptions<N>): Promise<void> {
    const target = this.resolve(options as NavigateOptions)
    if (!target) throw new Error(`[router] route not found: ${JSON.stringify(options)}`)

    // 路由守卫：返回 false 取消导航（routeMap 注入，工厂化；trace 输出守卫链路 --trace-router）
    const isDebug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    const trace = isDebug ? (msg: string) => console.log(msg) : undefined
    // ★B11：requiresAuth 自动守卫（先于用户守卫——框架层登录拦截）
    if (!(await this.authGuard(target, trace))) return
    // ★security M3：permissions 自动守卫（requiresAuth 之后、用户守卫之前）
    if (!(await this.permissionGuard(target, trace))) return
    const guardResult = await runBeforeEach(target, this.routeMap, trace)
    if (guardResult === false) return

    const url = this.buildUrl(target.path, { ...(options.params as RouteParams | undefined), ...options.query })

    // Skyline 自定义路由（仅 MP + Skyline 环境）
    if (options.routeType && isSkyline()) {
      await navigateWithCustomRoute(url, options.routeType)
    }
    // TabBar 页面
    else if (options.switchTab || target.meta?.isTab) {
      await adapter.switchTab({ url: target.path })
    }
    // 替换当前页
    else if (options.replace) {
      await adapter.redirectTo({ url })
    }
    // 重启
    else if (options.reLaunch) {
      await adapter.reLaunch({ url })
    }
    // 普通跳转（栈深保护仅 MP 生效；Web 端不受 10 层限制）
    else {
      if (adapter.isMP && this.stackDepth >= 9) {
        // MP 栈深≥9 自动降级为 redirectTo，避免第 10 层报错（平台硬边界）
        await adapter.redirectTo({ url })
      } else {
        // routeType 透传：MP 由 skyline 分支消费，Web 端由 adapter 用于 CSS 转场
        await adapter.navigateTo({ url, routeType: options.routeType })
      }
    }

    await runAfterEach(target, this.routeMap, trace)
  }

  /** 后退 */
  back(delta = 1): void {
    adapter.navigateBack({ delta })
  }

  /** 替换当前页 */
  replace<N extends keyof RouteParamsByName = keyof RouteParamsByName>(options: NavigateOptions<N>): Promise<void> {
    return this.push({ ...options, replace: true })
  }

  /** 根据命名路由/路径解析目标 */
  private resolve(options: NavigateOptions): RouteRecord | null {
    if (options.name && this.routeMap[options.name]) return this.routeMap[options.name]
    if (options.path) {
      const found = Object.values(this.routeMap).find((r) => r.path === options.path || r.name === options.path)
      return found ?? null
    }
    return null
  }

  /** 拼接 URL（params + query → query string，自动 encode） */
  private buildUrl(path: string, params?: RouteParams): string {
    if (!params) return `/${path}`
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `/${path}?${qs}` : `/${path}`
  }
}

export interface RouterOptions {
  /** ★B11：登录检查器（requiresAuth 页面自动拦截；onAuthFail 可跳登录页/提示） */
  auth?: () => boolean | Promise<boolean>
  onAuthFail?: () => void
  /** ★security M3：权限检查器（meta.permissions 页面自动拦截；PermissionRegistry.hasAll 签名兼容可直接传） */
  permissions?: { hasAll: (perms: string[]) => boolean | Promise<boolean> }
  onPermissionFail?: (permission: string) => void
}

/**
 * 创建 Router 实例（拆包步骤 4 工厂化）：路由表由调用方注入
 * 用法：const router = createRouter(routes)（routes 来自 gen-routes 生成的 auto-routes）
 * ★B11：options.auth——登录检查器（requiresAuth 页面自动拦截；onAuthFail 可跳登录页/提示）
 * ★security M3：options.permissions——权限检查器（meta.permissions 页面自动拦截；onPermissionFail 可跳 forbidden/引导授权）
 */
export function createRouter(
  routes: RouteRecord[],
  options: RouterOptions = {},
): Router {
  const routeMap = routes.reduce((m, r) => {
    m[r.name] = r
    return m
  }, {} as Record<string, RouteRecord>)
  return new Router(routeMap, options)
}

export type RouterInstance = Router

// ★路由规划 M3/M4：三端共享转场映射 + codegen（scan/tree 管线产物消费）
export { WEB_TRANSITION_MAP, MP_ROUTE_TYPE_MAP, webTransitionName, mpRouteType, isTransition } from './transforms/transform-transition'
export type { RouteTransition } from './transforms/transform-transition'
export { generateWebRoutes, generateMpConfig, mergeAppJson, flattenNodes, toPageConfig } from './codegen'
export type { MpPageConfig } from './codegen'

// 类型契约再导出（应用侧 import type { RouteRecord } from '@proteus/router' 即可，无需深路径）
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
