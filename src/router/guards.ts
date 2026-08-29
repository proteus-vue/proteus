// src/router/guards.ts
// 全局路由守卫（P3-2）—— 支持 beforeEach / afterEach，经 adapter 获取当前路由
import type { RouteRecord } from './types'
import { routeMap } from './auto-routes'
import { adapter } from '@proteus/shared'

type Guard = (to: RouteRecord, from: RouteRecord | null) => boolean | Promise<boolean> | void | Promise<void>
type AfterGuard = (to: RouteRecord, from: RouteRecord | null) => void

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

/** 执行全部前置守卫（内部使用，由 router.push 调用） */
export async function runBeforeEach(to: RouteRecord): Promise<boolean> {
  const from = getCurrentFrom()
  for (const g of beforeGuards) {
    const result = await g(to, from)
    if (result === false) return false
  }
  return true
}

/** 执行全部后置守卫（内部使用，由 router.push 调用） */
export async function runAfterEach(to: RouteRecord): Promise<void> {
  const from = getCurrentFrom()
  for (const g of afterGuards) g(to, from)
}

/** 从页面栈顶反查路由记录 */
function getCurrentFrom(): RouteRecord | null {
  const stack = adapter.getCurrentPages()
  if (stack.length === 0) return null
  const path = stack[stack.length - 1].route
  return routeMap[path] || Object.values(routeMap).find(r => r.path === path) || null
}
