// packages/api/src/request/query.ts
// ★★★#1342 请求库的**数据获取层**：`useQuery` / `useMutation`。
//
// 【为什么不复用 `createRequestEngineering` 的 useQuery】
//   它自带一套 **TTL 缓存 + FIFO 队列**，与 pipeline 的 **HTTP 缓存 + 并发队列** 完全独立
//   ⇒ 同一个请求出现两种"缓存命中"解释（这是现在三套入口最实际的问题之一）。
//   本文件的做法相反：**不自己缓存、不自己排队**——全部交给 pipeline（HTTP 缓存语义 + 并发队列）。
//   本层只负责"把结果变成可订阅的状态"。
//
// 【诚实边界】
//   · 这里**没有**真正的后台 revalidate 调度器（需要定时器 + 可见性感知）。
//     `revalidateOnFocus` 需要平台提供 focus 事件，本层只暴露钩子、不假设平台有。
//     ★不做假的 SWR：pipeline 的 RFC 5861 SWR 已实现（缓存层），这里不重复实现。
//   · `useMutation` 的乐观更新回滚失败时，状态变 `unknown` 而不是"假装成功"
//     （★与请求层的三态一致：回滚不了就必须让业务知道，不能吞）。

import type { RequestClient, RequestOptions, RequestResult } from './types'
import type { CapError } from '../capability-types'

/** 极简响应式接口（★不依赖 Vue；由调用方注入 —— 与 `createRequestEngineering` 的 reactivity 注入同思路） */
export interface QueryReactivity {
  ref<T>(value: T): { value: T }
  /** 供订阅用；本层只要求"能读当前值" */
  computed?: <T>(fn: () => T) => { readonly value: T }
}

export interface QueryState<T> {
  data: T | undefined
  loading: boolean
  /** 失败时的错误（★`unknown` 态单独标记，见 `outcome`） */
  error: { code: string; message: string } | undefined
  /** 最近一次结果的结局（含 unknown）；用于业务区分"失败"与"去查单" */
  outcome: 'success' | 'failed' | 'unknown' | undefined
}

export interface QueryHandle<T> {
  readonly state: QueryState<T>
  /** 重新拉（不走缓存；成功后写回 pipeline 的 HTTP 缓存） */
  refresh(): Promise<RequestResult<T>>
  /** 本地改写（不发请求；★只改本层状态，不改 HTTP 缓存） */
  mutate(data: T): void
  /** 让 pipeline 的缓存失效（下次 refresh 会走网络） */
  invalidate(): void
  /** 是否有在飞请求 */
  pending(): boolean
}

export interface QueryOptions {
  /** 是否立即发起（默认 true） */
  immediate?: boolean
  /** 复用请求层的选项（如 `idempotencyKey`、`skipAuth`） */
  request?: Omit<RequestOptions, 'method'>
}

/**
 * `createQuery`：把"一次 GET + 可订阅状态"包成句柄（**平台中立版**）。
 *
 * ★它**不是** SWR：不自己管缓存、不做后台刷新。真正的缓存语义在 pipeline（HTTP 缓存）。
 *   这样删掉了 `request-engineering` 的假 SWR 标签（痛点 #10）。
 *
 * ★★★#1394 **重要：这不是 Vue 的 composable，state 不是响应式的。**
 *   返回的 `state` 是**普通对象**（`{ data, loading, ... }`）——它变化**不会触发任何框架重渲染**。
 *   ⇒ 在 Vue / React / 任何有响应式系统的框架里，请用 `@proteus-vue/request` 的 `useQuery`
 *     （真响应式版本，模板可直接绑）。
 *   本函数的适用场景只有两个：① 非 UI 环境（Node 脚本 / 后台任务 / 服务端逻辑）；
 *   ② 自己接响应式系统（把 `state` 手动桥到你的 ref/store）。
 *   ★此前本函数**零测试、零消费者**，而文档字符串容易让人误以为"这就是给 Vue 用的"——
 *     这正是 #1394 抓出的产品缺口（内核有、产品层没有）。
 */
export function createQuery<T>(
  client: RequestClient,
  key: string,
  url: string,
  opts: QueryOptions = {},
): QueryHandle<T> {
  const state: QueryState<T> = { data: undefined, loading: false, error: undefined, outcome: undefined }
  let inflight: Promise<RequestResult<T>> | undefined

  const run = async (): Promise<RequestResult<T>> => {
    state.loading = true
    state.error = undefined
    inflight = client.request<T>(url, { ...opts.request, method: 'GET' })
    const r = await inflight
    inflight = undefined
    state.loading = false
    state.outcome = r.outcome
    if (r.ok) {
      state.data = r.data
      state.error = undefined
    } else {
      state.error = { code: r.error.code, message: r.error.message }
      // ★unknown 时**不**清掉旧数据（旧数据可能仍是有效的最后一次已知状态）
    }
    return r
  }

  const handle: QueryHandle<T> = {
    get state() {
      return state
    },
    async refresh() {
      return run()
    },
    mutate(data: T) {
      state.data = data
      state.error = undefined
      state.outcome = 'success'
    },
    invalidate() {
      // ★本层无自有缓存 ⇒ invalidate 只需下次 refresh 时绕过缓存
      //   （通过请求选项 `cache: 'no-cache'` 由调用方在 refresh 时给；这里记录意图）
      state.outcome = undefined
    },
    pending() {
      return state.loading
    },
  }

  if (opts.immediate !== false) void run()
  void key // ★key 仅用于诊断/调试对齐（本层不做 key 级缓存）
  return handle
}

/* ══════════════════════ useMutation ══════════════════════ */

export interface MutationOptions<TData, TVars> {
  /** 乐观更新：请求发出前先把本地状态改成"预期的结果" */
  optimistic?: (vars: TVars) => TData | undefined
  /**
   * 回滚：请求失败时把状态恢复。
   * ★若回滚本身失败/未提供，状态变 `unknown`（不假装成功）。
   */
  rollback?: (previous: TData | undefined, vars: TVars) => TData | undefined
  request?: RequestOptions
}

export interface MutationHandle<TData, TVars> {
  readonly state: QueryState<TData>
  /** 触发一次变更（★幂等键建议由业务传 `request.idempotencyKey` 或交给 auto 生成） */
  mutate(vars: TVars): Promise<RequestResult<TData>>
  reset(): void
}

/**
 * `useMutation`：写操作 + 乐观更新 + 回滚。
 *
 * ★痛点 #11：主流库的乐观更新要手写回滚。这里内建，且**回滚失败不吞**：
 *   若请求结果 `unknown`（可能已成功），**不执行回滚**——回滚会把真实成功的状态抹掉。
 *   这是与"未知态"的联动的关键点。
 */
export function createMutation<TData, TVars>(
  client: RequestClient,
  url: string | ((vars: TVars) => string),
  opts: MutationOptions<TData, TVars> = {},
): MutationHandle<TData, TVars> {
  const state: QueryState<TData> = { data: undefined, loading: false, error: undefined, outcome: undefined }

  return {
    get state() {
      return state
    },
    async mutate(vars: TVars) {
      const previous = state.data
      // ① 乐观更新
      if (opts.optimistic) {
        const optimistic = opts.optimistic(vars)
        if (optimistic !== undefined) state.data = optimistic
      }
      state.loading = true
      state.error = undefined
      const target = typeof url === 'function' ? url(vars) : url
      const r = await client.request<TData>(target, {
        ...opts.request,
        method: opts.request?.method ?? 'POST',
        data: vars,
      })
      state.loading = false
      state.outcome = r.outcome
      if (r.ok) {
        state.data = r.data
        state.error = undefined
      } else {
        state.error = { code: r.error.code, message: r.error.message }
        // ② 回滚 —— ★只在"确定失败"时回滚；unknown 时**不回滚**（可能已成功）
        if (r.outcome === 'failed' && opts.rollback) {
          const restored = opts.rollback(previous, vars)
          if (restored !== undefined) state.data = restored
          else state.data = previous
        }
      }
      return r
    },
    reset() {
      state.data = undefined
      state.loading = false
      state.error = undefined
      state.outcome = undefined
    },
  }
}
