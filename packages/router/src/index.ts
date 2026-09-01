// packages/router/src/index.ts
// 统一路由 API（P3-1 + 拆包步骤 4 工厂化）—— 只依赖 @proteus-vue/shared 接口，禁止直连 wx（执行规则 4）
// ★工厂化：createRouter(routes) 接收路由表（应用侧由 gen-routes 生成的 auto-routes 提供），
//   不再全局单例 import——路由表由调用方注入（对齐 docs/proteus-router-plan M2）
import type { NavigateOptions, RouteParams, RouteRecord, RouteParamsByName } from './types'
import { runBeforeEach, runAfterEach, beforeEach as registerBeforeEach, afterEach as registerAfterEach } from './guards'
import type { Guard, AfterGuard, GuardTrace } from './guards'
import { isSkyline, navigateWithCustomRoute } from './skyline'
import { adapter } from '@proteus-vue/shared'

class Router {
  /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1） */
  get stackDepth(): number {
    return adapter.getCurrentPages().length
  }

  constructor(
    private routeMap: Record<string, RouteRecord>,
    private options: RouterOptions = {},
  ) {
    // ★devtools 打通：Web 端非 push 导航（站内 <a> 链接 / 浏览器前进后退）→ TraceBus 补发 router 事件
    //   （web adapter 的 click 拦截/popstate 直接改 URL + onPageLoad 通知，绕过 push——补 trace 让 route 回溯完整）
    //   MP 端导航全走 push（小程序原生导航），无需补发；onPageLoad 为可选接口（防御）
    if (!adapter.isMP && typeof adapter.onPageLoad === 'function') {
      const pages = adapter.getCurrentPages()
      this.lastRoute = (pages.length ? (pages[pages.length - 1] as { route?: string }).route ?? '?' : '?') || 'index'
      adapter.onPageLoad((route, _query, _routeType, _nav) => {
        // ★web adapter 把根路径（/）归一化为空串——统一回 'index'（RouterView 侧 fallback 约定），trace 可读
        const normalized = route || 'index'
        if (this.tracePending) {
          // push 内部导航：跳过补发（push 已发完整链路），仅同步当前路由
          this.tracePending = false
          this.lastRoute = normalized
          return
        }
        const bus = this.options.traceBus
        const from = this.lastRoute
        this.lastRoute = normalized
        if (!bus) return
        // 非 push 导航：补发简化链路（start/end，无守卫链）
        const name = 'navigate ' + normalized
        const traceId = 'nav-' + ++this.traceSeq
        bus.emit('router', 'start', name, { from: { path: from }, to: { path: normalized } }, traceId)
        bus.emit('router', 'end', name, undefined, traceId)
      })
    }
  }

  /** 导航 traceId 自增（start/end 配对） */
  private traceSeq = 0
  /** ★Web 端非 push 导航（站内 <a> 链接 / 浏览器前进后退）补发 trace 的去重标志：push 内部导航时置位，onPageLoad 消费 */
  private tracePending = false
  /** 当前路由（onPageLoad 维护——非 push 导航的 from 基准） */
  private lastRoute = '?'

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

    // ★devtools 打通：路由事件 → traceBus（面板 route 回溯；bus 门控生产零开销）
    const bus = this.options.traceBus
    const navName = 'navigate ' + (target.name ?? target.path)
    const traceId = 'nav-' + ++this.traceSeq
    if (bus) {
      const pages = adapter.getCurrentPages()
      const top = pages.length ? (pages[pages.length - 1] as { route?: string }) : undefined
      // ★web 根路径（/ → 空串）统一归一化 index（与 onPageLoad 补发侧一致，route 面板 from 可读）
      const fromPath = top?.route || 'index'
      bus.emit('router', 'start', navName, { from: { path: fromPath }, to: { path: target.path } }, traceId)
    }

    // 路由守卫：返回 false 取消导航（routeMap 注入，工厂化；trace 输出守卫链路 --trace-router）
    const isDebug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    const trace = isDebug ? (msg: string) => console.log(msg) : undefined
    // ★B11：requiresAuth 自动守卫（先于用户守卫——框架层登录拦截）
    if (!(await this.authGuard(target, trace))) {
      bus?.emit('router', 'point', 'guard requiresAuth:cancel', undefined, traceId)
      bus?.emit('router', 'end', navName, undefined, traceId)
      return
    }
    // ★security M3：permissions 自动守卫（requiresAuth 之后、用户守卫之前）
    if (!(await this.permissionGuard(target, trace))) {
      bus?.emit('router', 'point', 'guard permissions:cancel', undefined, traceId)
      bus?.emit('router', 'end', navName, undefined, traceId)
      return
    }
    const guardResult = await runBeforeEach(target, this.routeMap, trace)
    if (guardResult === false) {
      bus?.emit('router', 'point', 'guard beforeEach:cancel', undefined, traceId)
      bus?.emit('router', 'end', navName, undefined, traceId)
      return
    }
    bus?.emit('router', 'point', 'guard beforeEach:next', undefined, traceId)

    const url = this.buildUrl(target.path, { ...(options.params as RouteParams | undefined), ...options.query })

    // ★devtools：push 内部导航标记（onPageLoad 回调消费跳过补发，避免重复 trace）；finally 防残留
    this.tracePending = true
    try {
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
    } finally {
      this.tracePending = false
    }

    await runAfterEach(target, this.routeMap, trace)
    bus?.emit('router', 'end', navName, undefined, traceId)
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
  /**
   * ★devtools 打通：路由可观测事件总线（结构类型注入，零硬依赖——@proteus-vue/devtools-runtime 的
   * createTraceBus 实例直接可传；缺省不发射）。协议（面板 route 回溯消费）：
   *   start  `navigate <name|path>`  payload { from: { path }, to: { path } }  traceId 配对
   *   point  `guard <name>:next|cancel`  守卫徽章（面板按 name 推断 result）
   *   end    `navigate <name|path>`      关闭进行中导航（含被拦截导航——route 回溯展示守卫拦截）
   * bus 自带 enabled 门控（生产关闭 → emit noop，零开销）
   */
  traceBus?: RouterTraceBus
}

/** 路由可观测事件总线（结构与 devtools-runtime TraceBus.emit 兼容） */
export interface RouterTraceBus {
  emit(source: 'router', phase: 'start' | 'end' | 'point' | 'error', name: string, payload?: unknown, traceId?: string): void
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
