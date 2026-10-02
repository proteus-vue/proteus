// packages/router/src/router-core.ts
// ★★路由核心（P3-1 + 2026-10-02 App 端收口）—— **不依赖 @proteus-vue/shared**
//
// 【为什么要从 index.ts 抽出来（本轮的核心动作）】
//   统一路由 API（`push/back/replace/...`）此前**只**接 Web/MP：它静态 import
//   `@proteus-vue/shared` 的 `adapter` 单例，而该单例在**无 window/wx 环境**（iOS JSC / Android
//   QuickJS）会走 web 分支并在模块求值期读 `location`——history 事故原文（#491）：
//   「mp 包执行 createWebAdapter() → 读 location.pathname → 启动即崩」。
//   ⇒ App 端过去只能**绕开统一 API**，手写 `createAppStack + executor + host ports` 胶水
//     （`hosts/shared/bridge/entry-app-stack.ts` 就是那坨胶水的现状）。
//   ⇒ 本文件把 Router 主体抽到**平台中立**模块：adapter 经 `RouterAdapter` **注入**
//     （Web/MP 注入 shared adapter；App 注入 `app-adapter.ts` 的栈适配器）。
//
// 【注入的边界（结构类型，不 import 平台包）】`RouterAdapter` 是 `PlatformAdapter` 的**结构子集**：
//   Web/MP 的 `adapter` 天然满足；App 的栈适配器按同形实现。⇒ 三端同一套导航语义，零胶水。
import type { NavigateOptions, RouteParams, RouteRecord, RouteParamsByName } from './types'
import { runBeforeEach, runAfterEach, beforeEach as registerBeforeEach, afterEach as registerAfterEach } from './guards'
import type { Guard, AfterGuard, GuardTrace } from './guards'
import { isSkyline, navigateWithCustomRoute } from './skyline'

/**
 * 路由可用的**平台适配器**（结构子集——PlatformAdapter 与 App 栈适配器都满足）
 *
 * ★字段必须与 `packages/shared/src/platform/adapter.ts` 的 `PlatformAdapter` **逐字段兼容**
 *   （同名同义；App 端实现见 `app-adapter.ts`）。不 import platform 包 = 无环境假设。
 */
export interface RouterAdapter {
  isMP: boolean
  getCurrentPages(): Array<{ route: string; query?: Record<string, string>; setData?(data: Record<string, unknown>): void }>
  navigateTo(opts: { url: string; routeType?: string }): Promise<void>
  redirectTo(opts: { url: string }): Promise<void>
  reLaunch(opts: { url: string }): Promise<void>
  switchTab(opts: { url: string }): Promise<void>
  navigateBack(opts: { delta: number }): void
  /**
   * ★★★（2026-10-02 · 依《主流框架路由调研》启示 3）**栈内定位/移除**（可选——端不实现则不暴露）：
   *   · `popTo(name)`：回退到栈中最近一个该名的屏
   *   · `removeByName(name)`：抹掉该名的屏（只它自己；上面的屏补位）
   *   · `moveToTop(name)`：把该屏提到栈顶（中间屏原位保留）
   * ★Web/MP 端受平台栈语义限制（Web 无栈概念；小程序侧只有 `navigateBack(delta)`）⇒ 可不实现；
   *   App 端（虚拟栈）**完整支持**——这是"App 端可解除 Skyline 硬限制"的又一兑现。
   */
  popTo?(name: string): void
  removeByName?(name: string): number
  moveToTop?(name: string): void
  onPageLoad?(
    cb: (
      route: string,
      query: Record<string, string>,
      routeType?: string,
      nav?: 'forward' | 'back' | 'replace' | 'reLaunch' | 'switchTab',
    ) => void,
  ): void
}

/** 从页面栈顶反查路由记录（routeMap 以 name 为键，path 回退查找）——三端共用（同一语义一处实现） */
export function currentFrom(
  routeMap: Record<string, RouteRecord>,
  pages: Array<{ route: string }>,
): RouteRecord | null {
  if (pages.length === 0) return null
  const path = pages[pages.length - 1].route
  return routeMap[path] || Object.values(routeMap).find((r) => r.path === path) || null
}

export class Router {
  /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1；App = 虚拟栈深） */
  get stackDepth(): number {
    return this.adapter.getCurrentPages().length
  }

  constructor(
    private routeMap: Record<string, RouteRecord>,
    private adapter: RouterAdapter,
    private options: RouterOptions = {},
  ) {
    // ★devtools 打通：Web 端非 push 导航（站内 <a> 链接 / 浏览器前进后退）→ TraceBus 补发 router 事件
    //   （web adapter 的 click 拦截/popstate 直接改 URL + onPageLoad 通知，绕过 push——补 trace 让 route 回溯完整）
    //   MP 端导航全走 push（小程序原生导航），无需补发；onPageLoad 为可选接口（防御）。
    //   ★App 端适配器不实现 onPageLoad（无"外部导航"来源）⇒ 本段自然跳过。
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
    trace?.(`[guard] requiresAuth → ${to.name ?? to.path} 被拦截（未登录）`)
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
    trace?.(`[guard] permissions → ${to.name ?? to.path} 被拦截（缺权限 ${denied}）`)
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
      const pages = this.adapter.getCurrentPages()
      const top = pages.length ? (pages[pages.length - 1] as { route?: string }) : undefined
      // ★web 根路径（/ → 空串）统一归一化 index（与 onPageLoad 补发侧一致，route 面板 from 可读）
      const fromPath = top?.route || 'index'
      // ★query 透传（panel route 视图 / Router Inspector 显示带参导航，如 ?id=1）
      bus.emit('router', 'start', navName, { from: { path: fromPath }, to: { path: target.path, query: options.query } }, traceId)
    }

    // 路由守卫：返回 false 取消导航（routeMap 注入，工厂化；trace 输出守卫链路 --trace-router）
    const isDebug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
    const trace = isDebug ? (msg: string) => console.log(msg) : undefined
    // ★from 在导航前后都应取"当前页"——`from` 必须在**第一次导航动作之前**解析（App 端 back 等场景亦如此）
    const from = currentFrom(this.routeMap, this.adapter.getCurrentPages())
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
    const guardResult = await runBeforeEach(target, from, trace)
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
        await this.adapter.switchTab({ url: target.path })
      }
      // 替换当前页
      else if (options.replace) {
        await this.adapter.redirectTo({ url })
      }
      // 重启
      else if (options.reLaunch) {
        await this.adapter.reLaunch({ url })
      }
      // 普通跳转（栈深保护仅 MP 生效；Web 端不受 10 层限制；App 端虚拟栈无层数上限）
      else {
        if (this.adapter.isMP && this.stackDepth >= 9) {
          // MP 栈深≥9 自动降级为 redirectTo，避免第 10 层报错（平台硬边界）
          await this.adapter.redirectTo({ url })
        } else {
          // routeType 透传：MP 由 skyline 分支消费，Web 端由 adapter 用于 CSS 转场
          await this.adapter.navigateTo({ url, routeType: options.routeType })
        }
      }
    } finally {
      this.tracePending = false
    }

    await runAfterEach(target, from, trace)
    bus?.emit('router', 'end', navName, undefined, traceId)
  }

  /** 后退 */
  back(delta = 1): void {
    this.adapter.navigateBack({ delta })
  }

  /** 替换当前页 */
  replace<N extends keyof RouteParamsByName = keyof RouteParamsByName>(options: NavigateOptions<N>): Promise<void> {
    return this.push({ ...options, replace: true })
  }

  /**
   * ★★回退到栈中最近的该名路由（启示 3 · 对齐鸿蒙 `popToName`）——**不传 delta，传名字**。
   * Web 端无栈概念 ⇒ 不支持时**明确报错**（不静默退化成 back()——那会跳错页）。
   */
  popTo(name: string): void {
    if (!this.adapter.popTo) {
      throw new Error(
        `[router] popTo("${name}")：当前端适配器不支持按名回退（${this.adapter.isMP ? '小程序' : 'Web'} 端受平台栈语义限制）` +
          '——App 端完整支持；其他端请用 back(delta)',
      )
    }
    this.adapter.popTo(name)
  }

  /** ★★抹掉栈中该名路由（启示 3 · 对齐鸿蒙 `removeByName`）；返回移除数（0 = 栈中无此屏，幂等） */
  removeByName(name: string): number {
    if (!this.adapter.removeByName) {
      throw new Error(`[router] removeByName("${name}")：当前端适配器不支持（仅 App 虚拟栈）`)
    }
    return this.adapter.removeByName(name)
  }

  /** ★★把栈内该屏提到栈顶（启示 3 · 对齐鸿蒙 `moveToTop`）；中间屏原位保留 */
  moveToTop(name: string): void {
    if (!this.adapter.moveToTop) {
      throw new Error(`[router] moveToTop("${name}")：当前端适配器不支持（仅 App 虚拟栈）`)
    }
    this.adapter.moveToTop(name)
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
  /**
   * ★★平台适配器（2026-10-02 App 端收口）：缺省由 index.ts 注入 shared 的 adapter（Web/MP）；
   *   App 端注入 `createAppNavigationAdapter` 的栈适配器（见 `@proteus-vue/router/app`）。
   */
  adapter?: RouterAdapter
}

/** 路由可观测事件总线（结构与 devtools-runtime TraceBus.emit 兼容） */
export interface RouterTraceBus {
  emit(source: 'router', phase: 'start' | 'end' | 'point' | 'error', name: string, payload?: unknown, traceId?: string): void
}

/**
 * 创建 Router 实例（**核心工厂**——adapter 必填；Web/MP 便捷入口见 index.ts 的 createRouter）。
 * 用法：`const router = createRouterCore(routes, { adapter })`
 */
export function createRouterCore(routes: RouteRecord[], options: RouterOptions & { adapter: RouterAdapter }): Router {
  const { adapter, ...rest } = options
  const routeMap = routes.reduce((m, r) => {
    m[r.name] = r
    return m
  }, {} as Record<string, RouteRecord>)
  return new Router(routeMap, adapter, rest)
}

export type RouterInstance = Router
