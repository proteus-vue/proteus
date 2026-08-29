// src/router/guards.ts
// 全局路由守卫（P3-2 + 拆包步骤 4 工厂化）—— 支持 beforeEach / afterEach，经 adapter 获取当前路由
// ★工厂化：routeMap 不再 import 自 auto-routes，由 Router.push 调用时注入（对齐 createRouter 设计）
import type { RouteRecord } from './types'
import { adapter } from '@proteus/shared'

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
  routeMap: Record<string, RouteRecord>,
  trace?: GuardTrace,
): Promise<boolean> {
  const from = getCurrentFrom(routeMap)
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
  routeMap: Record<string, RouteRecord>,
  trace?: GuardTrace,
): Promise<void> {
  const from = getCurrentFrom(routeMap)
  for (const g of afterGuards) g(to, from)
  trace?.(`[guard] afterEach → ${to.name ?? to.path}（${afterGuards.length} 个守卫）`)
}

/** 从页面栈顶反查路由记录（routeMap 以 name 为键，path 回退查找） */
function getCurrentFrom(routeMap: Record<string, RouteRecord>): RouteRecord | null {
  const stack = adapter.getCurrentPages()
  if (stack.length === 0) return null
  const path = stack[stack.length - 1].route
  return routeMap[path] || Object.values(routeMap).find(r => r.path === path) || null
}
