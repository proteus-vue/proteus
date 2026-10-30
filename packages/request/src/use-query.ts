// packages/request/src/use-query.ts
// ★★★#1394：`useQuery` —— Vue 版数据获取（**真响应式**，模板可直接绑）。
//
// 【与内核 `createQuery` 的区别（这是本文件存在的唯一理由）】
//   内核的 `createQuery` 返回 `state` 是个**普通对象字面量**（`{ data, loading, ... }`），
//   在 Vue 模板里 `{{ q.state.data }}` 数据到了也**不会重渲染** ——
//   它在 Vue 这个最主要的目标环境里是不工作的（且它零测试，所以一直没被发现）。
//   本文件用 `shallowRef` 重做状态容器，其余**全部委托内核**（不重实现策略）。
//
// 【本文件只负责三件内核不做的事】
//   ① 响应式容器（`shallowRef`；大列表不做深层代理）
//   ② 竞态裁决（快速切筛选时，先发后到的旧响应不得覆盖新响应）
//   ③ 生命周期（组件卸载 ⇒ 取消在飞请求）

import type { RequestClient, RequestOptions, RequestResult } from '@proteus-vue/api'
import type { ShallowRef } from 'vue'
import { useRequestClient } from './client'
import { applyResult, createAsyncState, createRaceGuard, describeError, onCleanup } from './support'
import type { AsyncState } from './support'

/** `useQuery` 的选项 */
export interface UseQueryOptions<T = unknown> {
  /**
   * 是否立即发起（默认 `true`）。
   * ★`false` 时得到一个"待命"句柄 —— 适合"点了搜索才查"、或依赖前面数据才能确定的请求。
   */
  immediate?: boolean
  /** 透传给内层的请求选项（`idempotencyKey` / `skipAuth` / `headers` / `params` 等） */
  request?: Omit<RequestOptions, 'method'>
  /**
   * 成功后的回调（写缓存/派生状态用）。
   * ★失败与 `unknown` **不会触发它**（它们在 `onError` 里）。
   */
  onSuccess?: (data: T) => void
  /**
   * 失败/未知后回调。★`outcome` 会告诉你是 `failed`（可重试）还是 `unknown`（去查单）。
   */
  onError?: (err: { code: string; message: string }, outcome: 'failed' | 'unknown') => void
  /**
   * 指定客户端（默认从 `provideRequestClient()` 注入；两者都没有时用零配置兜底实例）。
   */
  client?: RequestClient
}

/** `useQuery` 返回的句柄 */
export interface UseQueryHandle<T> {
  /** 只读状态视图（模板可直接用 `q.state.data`；各字段是 getter，跟着响应式变） */
  readonly state: AsyncState<T>
  /** 直接取响应式 ref（`const q = useQuery(...)` 后读 `q.data.value`；模板里自动解包） */
  readonly data: ShallowRef<T | undefined>
  readonly loading: ShallowRef<boolean>
  readonly error: ShallowRef<{ code: string; message: string } | undefined>
  readonly outcome: ShallowRef<AsyncState<T>['outcome']>
  /** 重新拉（走网络；成功会写回内核的 HTTP 缓存） */
  refresh(): Promise<RequestResult<T>>
  /** 本地改写（**不发请求**；只改本层状态） */
  mutate(data: T): void
  /** 取消在飞请求（已结算的不会受影响） */
  abort(reason?: string): void
}

/**
 * `useQuery`：把一个 GET 变成可订阅状态。
 *
 * ```ts
 * const users = useQuery<User[]>('/api/users')
 * // 模板：<div v-if="users.loading">…</div><ul><li v-for="u in users.data.value" :key="u.id">{{ u.name }}</li></ul>
 * ```
 *
 * ★为什么参数是 `(url, options)` 而不是"一个 key + fetcher"：
 *   本库的缓存语义在**内层的 HTTP 缓存**（RFC 9111 + 5861），不需要业务再维护一份 key→缓存 的映射。
 *   业务给 key 的旧范式来自"库自己搞一层 TTL 缓存"，那正是本库要消除的第二套缓存。
 */
export function useQuery<T = unknown>(url: string, options: UseQueryOptions<T> = {}): UseQueryHandle<T> {
  const client = options.client ?? useRequestClient()
  const st = createAsyncState<T>()
  const race = createRaceGuard()

  /** 在飞任务的 abort（只留最后一个；旧的已被竞态裁决丢弃） */
  let inflightAbort: ((reason?: string) => void) | null = null

  const run = async (): Promise<RequestResult<T>> => {
    const mySeq = race.next()
    st.loading.value = true
    st.error.value = undefined

    // ★内核的 task() 提供 abort（不阻塞、且 result 永不抛）
    let task: { result: Promise<RequestResult<T>>; abort: (reason?: string) => void }
    try {
      task = client.task<T>(url, { ...(options.request ?? {}), method: 'GET' })
    } catch (e) {
      // client.task 理论上不抛（结果永不抛），但兜底：同步异常也不能让 composable 崩
      const err = describeError(e)
      st.loading.value = false
      st.error.value = err
      st.outcome.value = 'failed'
      return { ok: false, outcome: 'failed', error: { code: err.code, message: err.message } } as RequestResult<T>
    }
    inflightAbort = task.abort

    let r: RequestResult<T>
    try {
      r = await task.result
    } catch (e) {
      // ★内核承诺"结果永不抛"，这里是**纵深防御**：万一将来退化成抛，不能让页面白屏
      const err = describeError(e)
      if (race.isLatest(mySeq)) {
        st.loading.value = false
        st.error.value = err
        st.outcome.value = 'failed'
      }
      return { ok: false, outcome: 'failed', error: { code: err.code, message: err.message } } as RequestResult<T>
    }

    // ★★★竞态裁决：只有"最新那次"的结算被采纳
    if (!race.isLatest(mySeq)) return r

    inflightAbort = null
    applyResult(st, r)

    if (r.ok) options.onSuccess?.(r.data as T)
    else if (r.outcome === 'failed' || r.outcome === 'unknown') {
      options.onError?.(st.error.value!, r.outcome)
    }
    return r
  }

  // ★卸载时取消在飞请求（否则回调可能在已销毁的组件上跑）
  onCleanup(() => inflightAbort?.('组件卸载'))

  if (options.immediate !== false) void run()

  return {
    state: st.state,
    data: st.data,
    loading: st.loading,
    error: st.error,
    outcome: st.outcome,
    refresh: run,
    mutate(data: T) {
      st.data.value = data
      st.error.value = undefined
      st.outcome.value = 'success'
    },
    abort(reason?: string) {
      inflightAbort?.(reason)
    },
  }
}
