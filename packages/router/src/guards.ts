// src/router/guards.ts
// 全局路由守卫（P3-2 + 拆包步骤 4 工厂化）—— 支持 beforeEach / afterEach
// ★工厂化：routeMap 不再 import 自 auto-routes，由 Router.push 调用时注入（对齐 createRouter 设计）
// ★★2026-10-02（App 端收口）：本模块**不再 import 平台包**（原 `adapter` from @proteus-vue/shared）——
//   "当前路由"由**调用方（Router 核心）**经注入的 RouterAdapter 解析后传入 `from`。
//   理由：shared 的 adapter 单例在无 window/wx 环境会走 web 分支并在求值期读 location
//   ⇒ App（JSC/QuickJS）无法 import 本模块（详见 router-core.ts 头注）。
import type { RouteRecord } from './types'

export type Guard = (to: RouteRecord, from: RouteRecord | null) => boolean | Promise<boolean> | void | Promise<void>
export type AfterGuard = (to: RouteRecord, from: RouteRecord | null) => void

export interface GuardTrace {
  /** 守卫决策输出（--trace-router：beforeEach 链路可观察） */
  (msg: string): void
}

const beforeGuards: Guard[] = []
const afterGuards: AfterGuard[] = []

/** 注册全局前置守卫 */
export function beforeEach(guard: Guard): void {
  beforeGuards.push(guard)
}

/** 注册全局后置守卫 */
export function afterEach(guard: AfterGuard): void {
  afterGuards.push(guard)
}

/** 清空守卫注册表（测试隔离 / 热重载用；生产不需要） */
export function clearGuards(): void {
  beforeGuards.length = 0
  afterGuards.length = 0
}

/** 执行全部前置守卫（内部使用，由 router.push 调用；routeMap 用于反查当前页路由） */
export async function runBeforeEach(
  to: RouteRecord,
  from: RouteRecord | null,
  trace?: GuardTrace,
): Promise<boolean> {
  for (const g of beforeGuards) {
    const result = await g(to, from)
    if (result === false) {
      trace?.(`[guard] beforeEach → ${to.name ?? to.path} 被拦截（守卫返回 false，导航取消）`)
      return false
    }
  }
  trace?.(`[guard] beforeEach → ${to.name ?? to.path} 放行（${beforeGuards.length} 个守卫）`)
  return true
}

/** 执行全部后置守卫（内部使用，由 router.push 调用；routeMap 用于反查当前页路由） */
export async function runAfterEach(
  to: RouteRecord,
  from: RouteRecord | null,
  trace?: GuardTrace,
): Promise<void> {
  for (const g of afterGuards) g(to, from)
  trace?.(`[guard] afterEach → ${to.name ?? to.path}（${afterGuards.length} 个守卫）`)
}

// ★`getCurrentFrom` 已上移到 `router-core.ts`（`currentFrom`）——核心经**注入的 adapter** 取页面栈，
//   本模块保持平台中立（同一语义一处实现）。
