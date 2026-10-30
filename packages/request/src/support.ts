// packages/request/src/support.ts
// ★★★#1394：Vue 产品层的共享小工具（**不重实现策略**——策略全在内核）。
//
// 【本包与内核的分工（一句话）】
//   内核 `@proteus-vue/api` 的 `request/` = 三态 · 幂等 · 断路器 · 离线队列 · 审计 · 脱敏（**平台中立、零 vue**）。
//   本包 = 把这些能力**变成 Vue 的响应式状态**，让模板能直接绑。
//   ⇒ 这里只做三件内核不做的事：① 响应式容器；② 竞态裁决；③ 生命周期（卸载取消）。

import { onScopeDispose, shallowRef } from 'vue'
import type { ShallowRef } from 'vue'
import type { RequestResult } from '@proteus-vue/api'

/** 三态结果 + 便于模板直接判断的派生布尔（`failed` 与 `unknown` 必须能分开）。 */
export interface AsyncState<T> {
  /** 最近一次成功的数据（失败时**保留旧值**——列表刷新失败不该把已有数据清空） */
  data: T | undefined
  /** 是否有请求在飞 */
  loading: boolean
  /** 失败信息（成功时清空） */
  error: { code: string; message: string } | undefined
  /**
   * 最近一次结果的结局。**这是本库相对"有没有 error"的核心差异**：
   *   `failed` = 确定失败（可重试）· `unknown` = 结果未知（**去查单，不要重试**）。
   * `undefined` = 还没跑过。
   */
  outcome: 'success' | 'failed' | 'unknown' | undefined
}

/**
 * 创建一套响应式异步状态。
 *
 * ★用 `shallowRef` 而不是 `ref`：数据可能是大列表/大对象，
 *   `ref` 的深层响应式代理会在每次渲染时递归遍历（大列表上是可观的成本），
 *   而业务对"接口返回的整块数据"本来就只会**整体替换**、不会原地改字段
 *   ⇒ `shallowRef` 语义刚好匹配，且省掉整棵代理树。
 *   ★如果你的业务确实要原地改返回对象的字段并期望重渲染，用 `refresh()` 拿新数据，别依赖深响应。
 */
export function createAsyncState<T>(): {
  state: AsyncState<T>
  data: ShallowRef<T | undefined>
  loading: ShallowRef<boolean>
  error: ShallowRef<{ code: string; message: string } | undefined>
  outcome: ShallowRef<AsyncState<T>['outcome']>
} {
  const data: ShallowRef<T | undefined> = shallowRef<T | undefined>(undefined)
  const loading: ShallowRef<boolean> = shallowRef<boolean>(false)
  const error: ShallowRef<{ code: string; message: string } | undefined> = shallowRef<{ code: string; message: string } | undefined>(undefined)
  const outcome: ShallowRef<AsyncState<T>['outcome']> = shallowRef<AsyncState<T>['outcome']>(undefined)
  // `state` 是给"想整体传下去"的场景用的**只读快照式视图**（每次读都基于当前 ref 值拼）
  const state: AsyncState<T> = {
    get data() { return data.value },
    get loading() { return loading.value },
    get error() { return error.value },
    get outcome() { return outcome.value },
  }
  return { state, data, loading, error, outcome }
}

/**
 * 把 `RequestResult` 落到响应式状态上。
 *
 * ★★两条容易做错的语义（都来自内核的三态设计）：
 *   ① **成功才覆盖 data**：失败时保留上一次成功的数据 —— 否则"刷新失败"会让页面从有数据变成空白，
 *      用户看到的是"内容消失了"，而不是"刷新失败"。
 *   ② **`unknown` 与 `failed` 都算 error，但 outcome 必须分开**：
 *      模板里 `v-if="error"` 会同时对两者生效，而处置方式完全不同
 *      （`unknown` 要去查单，`failed` 可以重试）⇒ 必须暴露 `outcome` 让业务分支。
 */
export function applyResult<T>(
  st: ReturnType<typeof createAsyncState<T>>,
  r: RequestResult<T>,
): void {
  st.loading.value = false
  st.outcome.value = r.outcome
  if (r.ok) {
    st.data.value = r.data as T
    st.error.value = undefined
    return
  }
  // ★data 保持上一次成功的值（见上 ①）
  st.error.value = {
    code: (r.error as { code?: string } | undefined)?.code ?? 'request.failed',
    message: (r.error as { message?: string } | undefined)?.message ?? '请求失败',
  }
}

/**
 * 竞态裁决器。
 *
 * 【为什么必须有（这是手写请求状态最常翻的车）】
 *   用户快速切 tab / 连点刷新 ⇒ 多个请求在飞 ⇒ **先发后到的旧响应会覆盖新响应**。
 *   页面显示的是上一次筛选条件的数据，而筛选器看起来已经是新的 —— 这种 bug 极难复现。
 *   ⇒ 每次发起自增 `seq`，只有"最新那次"的结算被采纳，旧的一律丢弃。
 *
 * ★注意这**不是**去重（去重是"同一请求合并"，在内核里）；这里是"不同请求的结算顺序裁决"。
 */
export function createRaceGuard(): {
  next(): number
  isLatest(seq: number): boolean
} {
  let seq = 0
  return {
    next: () => ++seq,
    isLatest: (n: number) => n === seq,
  }
}

/**
 * 在组件/作用域销毁时执行清理（不在作用域内则**什么都不做**，不报错）。
 *
 * ★为什么必须清理：`useQuery(..., { immediate: true })` 发起的请求若在组件卸载后回来，
 *   业务回调可能已经失效（甚至已经销毁了别的组件）⇒ 卸载时必须取消在飞请求。
 *   ★同时它也让"路由快速切换"不会堆积一串无用请求（每个页面各取消自己的）。
 */
export function onCleanup(fn: () => void): void {
  try {
    onScopeDispose(fn)
  } catch {
    // 不在 setup/effectScope 内（例如在普通函数里调用 composable）⇒ 没有生命周期，接受
  }
}

/**
 * 归一化"业务可读的错误文案"。
 * ★不把服务端原始 message 直接抛给用户界面（可能含内部细节/堆栈），
 *   但也**不吞掉**——`error.code` 保留机器码供业务分支。
 */
export function describeError(e: unknown): { code: string; message: string } {
  const anyE = e as { code?: unknown; message?: unknown }
  const code = typeof anyE?.code === 'string' ? anyE.code : 'request.failed'
  const message = typeof anyE?.message === 'string' ? anyE.message : String(e)
  return { code, message }
}
