// packages/request/src/client.ts
// ★★★#1394：Vue 侧的**请求库装配**（provide/inject + 零配置兜底）。
//
// 【为什么需要这一层（内核已经能用了，为什么还要一个包）】
//   内核 `createRequestClient()` 是平台中立的，用起来要自己传 hooks、自己保管实例。
//   在 Vue 里这意味着：每个组件要么重复创建实例（配额/断路器各算一份 = 配额失效），
//   要么自己搞一个模块级单例（SSR 下会跨请求泄漏状态）。
//   ⇒ 本层用 Vue 的 `provide/inject` 解决"一个应用一份实例"，并给**零配置兜底**。

import { getCurrentInstance, inject, provide } from 'vue'
import { createRequestClient } from '@proteus-vue/api'
import type { RequestClient, RequestClientOptions } from '@proteus-vue/api'

/** inject 用的键（Symbol ⇒ 不会与业务自己的 provide 撞名） */
const REQUEST_CLIENT_KEY: unique symbol = Symbol.for('proteus.request.client')

/**
 * 创建并 `provide` 一个请求客户端（在 `app.use()` 或根组件 setup 里调用一次）。
 *
 * ```ts
 * // main.ts / App.vue
 * provideRequestClient({ baseURL: import.meta.env.VITE_API, bizId: 'shop' })
 * ```
 *
 * @returns 创建出的客户端（也可以直接 import 到非组件模块里用）
 */
export function provideRequestClient(options: RequestClientOptions = {}): RequestClient {
  const client = createRequestClient(options)
  provide(REQUEST_CLIENT_KEY, client)
  return client
}

/**
 * 模块级兜底实例（**只在既没 provide 也没传 client 时**用到）。
 *
 * ★为什么允许"零配置也能用"：让新工程第一天就能 `useQuery('/api/x')` 跑起来，
 *   而不是先读 500 行配置文档。默认实例 = 内核的默认行为（并发 10、无重试、无去重）。
 * ★★SSR 注意：这个兜底实例是**进程级**的。多请求共享一个实例意味着
 *   配额/断路器计数会跨请求累积。SSR 场景请显式 `provideRequestClient()`（每请求一份），
 *   或在调用处显式传 `{ client }`。
 */
let fallback: RequestClient | undefined

/** 取当前应用的请求客户端（provide 的 > 兜底单例） */
export function useRequestClient(): RequestClient {
  const injected = inject<RequestClient | undefined>(REQUEST_CLIENT_KEY, undefined)
  if (injected) return injected
  if (!fallback) fallback = createRequestClient()
  return fallback
}

/**
 * 显式拿"当前是否有 provide 的实例"（诊断/测试用）。
 * ★不提供 `inject` 的替代实现——用 `getCurrentInstance()` 判"在不在组件上下文"。
 */
export function hasProvidedClient(): boolean {
  if (!getCurrentInstance()) return false
  return inject<RequestClient | undefined>(REQUEST_CLIENT_KEY, undefined) !== undefined
}

/** 仅供测试：重置兜底单例（避免用例间互相污染） */
export function __resetFallbackClient(): void {
  fallback = undefined
}
