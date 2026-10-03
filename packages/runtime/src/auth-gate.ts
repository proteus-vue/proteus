// src/runtime/auth-gate.ts —— ★★★GP4-c（2026-10-03）：**登录失效拦截**（401 → 不可取消弹窗）
//
// 【这张卡要解决什么（任务卡 GP4-c）】"在任意页面任何请求返回 401 均可弹出"——
//   场景：用户停在一个页面上，后台 token 过期，任意一次接口调用返回 401。
//   此时**没有路由跳转**（用户没点链接）⇒ 既有的 `router.options.auth` 守卫（只在导航时跑）
//   覆盖不到这条路径。
//
// 【★★硬约束："不得新建独立的全局拦截机制，必须复用路由守卫"（任务卡）——本模块如何遵守】
//   **它不是一个平行机制，而是既有守卫的"信号源 + 收口"**：
//     · **信号源**：`notifyAuthExpired()` 把"登录已失效"变成**持久状态**（`expired`）；
//       而既有的 `router.options.auth` = `() => !isAuthExpired()` ——**同一判据**同时作用于
//       ① 导航时（既有 authGuard 自动拦截 requiresAuth 页）② 401 时（本模块弹窗）
//       ⇒ 两条路径**共用一个事实**（"当前未认证"），不是两套判断。
//     · **收口**：`onAuthRestored(...)` 回归登录态时调 `router.replace(登录页→原页)`——
//       走**既有导航**（不是自己 reLaunch 造栈），保证栈不异常（任务卡验收第 2 条）。
//   ⇒ 换一种说法：GP4-c = 给既有守卫**补上"非导航触发的失效"这一路输入** + 一个不可取消的弹窗。
//
// 【为什么用模块级单例（而非组件内状态）】401 可能来自**任意**请求拦截器/任意页面——
//   登录失效是**全局事实**，且弹窗宿主每页一份（MP）⇒ 必须"状态一份、实例 N 份"（同 GP4-a/b）。
//
// 【★诚实边界（与 GP3-b1/GP4-a/GP4-b 同一条 §1.2-bis）】MP 端弹窗宿主每页一份实例；
//   本模块状态是模块级单例 ⇒ 跨页一致靠状态（不是实例存活）。

/** 登录失效的**持久状态**（与既有守卫共用的唯一事实） */
let expired = false
/** 失效时的提示文案（可由业务覆盖——如"登录已过期，请重新登录"） */
let expiredMessage = '登录已过期，请重新登录'
/** 回归登录态后的回调（业务注入"去哪"——通常 router.replace 到登录页或原页） */
let onRestored: (() => void) | null = null
/** 触发次数（可观测：同一会话反复 401 说明 token 刷新链路有问题） */
let expiredCount = 0

const listeners = new Set<(state: AuthGateState) => void>()

export interface AuthGateState {
  /** 是否处于登录失效态（**唯一事实**——守卫与弹窗都读它） */
  expired: boolean
  /** 提示文案 */
  message: string
  /** 会话内累计失效次数（可观测） */
  count: number
}

export interface AuthGateOptions {
  /** 失效文案（缺省"登录已过期，请重新登录"） */
  message?: string
  /**
   * 回归登录态后的去向（业务注入——通常 `() => router.replace({ name: 'login' })`）。
   * ★**必须走既有导航**（router.replace）——不自己 reLaunch 造栈（任务卡验收：栈不异常）。
   */
  onRestored?: () => void
}

function snapshot(): AuthGateState {
  return { expired, message: expiredMessage, count: expiredCount }
}

function notify(): void {
  const st = snapshot()
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as Record<string, unknown>
    // ★真机可观测性（同 GP4-a/b 的做法）：最近一次状态——排障第一手证据
    g.__PROTEUS_AUTH_GATE__ = { ...st, at: Date.now() }
  }
  for (const fn of [...listeners]) {
    try {
      fn(st)
    } catch {
      /* 订阅者异常吞掉（宿主渲染失败不该拖垮逻辑层——同 GP4-a/b 的裁定） */
    }
  }
}

/* ─────────────────────────── 公开 API ─────────────────────────── */

/**
 * ★**401 → 登录失效**（业务在请求拦截器里调；也可由 `createAuthFetch` 包装自动调）。
 *
 * 幂等：已处于失效态时**不重复触发**（只记 count）——避免并发请求各弹一次。
 * @returns 是否**本次**触发了状态翻转（false = 已在失效态，只是又收到一次 401）
 */
export function notifyAuthExpired(message?: string): boolean {
  expiredCount++
  if (expired) {
    notify()
    return false
  }
  expired = true
  if (message !== undefined) expiredMessage = message
  notify()
  return true
}

/**
 * 回归登录态（登录成功后调）。
 * · 清 `expired`（**紧接着**守卫的 `auth()` 立即返回 true ⇒ 后续导航放行——同一事实）
 * · 触发注入的 `onRestored()`（业务据此走**既有导航**回原页/首页——不自己造栈）
 * @returns 是否**本次**真的从失效态恢复（false = 本来就没失效）
 */
export function markAuthRestored(): boolean {
  const was = expired
  expired = false
  notify()
  if (was) {
    try {
      onRestored?.()
    } catch {
      /* 恢复回调异常不影响状态（业务自己的收口逻辑） */
    }
  }
  return was
}

/** 当前是否登录失效（**唯一事实**：守卫与弹窗都读它） */
export function isAuthExpired(): boolean {
  return expired
}

/** 当前状态快照（宿主首帧/测试断言用） */
export function authGateState(): AuthGateState {
  return snapshot()
}

/** 订阅状态变化（弹窗宿主用；返回退订函数） */
export function subscribeAuthGate(fn: (state: AuthGateState) => void): () => void {
  listeners.add(fn)
  const trace = (): void => {
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as unknown as Record<string, unknown>
      g.__PROTEUS_AUTH_GATE_SUBSCRIBERS__ = listeners.size
    }
  }
  trace()
  return () => {
    listeners.delete(fn)
    // ★退订也要更新落痕（GP4-a 的教训：只在 add 侧写 ⇒ 读数恒定 ⇒ 排障误判）
    trace()
  }
}

/**
 * ★**交给路由的登录检查器**（既有 `options.auth` 契约的现成实现）。
 *
 * 用法：
 * ```ts
 * const router = createRouter(routes, {
 *   auth: createAuthChecker(),          // ← 本函数（同一事实）
 *   onAuthFail: () => notifyAuthExpired(), // ← 守卫拦截时也进入失效态（导航路径与 401 路径合流）
 * })
 * ```
 * ★这样"导航时未登录"与"401 失效"**汇入同一个状态**——守卫与弹窗不会各说各话。
 */
export function createAuthChecker(): () => boolean {
  return () => !expired
}

/** 配置（在装配处调一次：文案 + 恢复去向） */
export function configureAuthGate(opts: AuthGateOptions): void {
  if (opts.message !== undefined) expiredMessage = opts.message
  if (opts.onRestored !== undefined) onRestored = opts.onRestored
  notify()
}

/**
 * ★测试/收尾专用：重置全部状态（含计数、订阅者、恢复回调、落痕）。
 * 【为什么必须有】模块级单例在测试进程里跨用例存活——没有它，用例相互污染。
 */
export function __resetAuthGateForTest(): void {
  expired = false
  expiredMessage = '登录已过期，请重新登录'
  onRestored = null
  expiredCount = 0
  listeners.clear()
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as Record<string, unknown>
    delete g.__PROTEUS_AUTH_GATE__
    delete g.__PROTEUS_AUTH_GATE_SUBSCRIBERS__
  }
}
