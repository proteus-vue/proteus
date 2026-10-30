// packages/request/src/use-request.ts
// ★★★#1394：`useRequest` —— 手动触发的单次请求（**不是 useQuery 的别名**）。
//
// 【三者什么时候用哪个（很多人在这里选错）】
//   · `useQuery(url)`     —— **进页面就该拉**的读请求（列表/详情）。自动发起、有竞态裁决。
//   · `useMutation(url)`  —— **用户动作触发**的写请求（提交/删除），带乐观更新与三态回滚。
//   · `useRequest()`      —— **用户动作触发的读请求**（点"搜索"才查），无乐观更新、无自动发起。
//
// 【为什么需要它而不是直接用 client】
//   `client.request()` 已经能用了，但在组件里手写就要自己管：
//   `loading` 的置位/复位、卸载时取消、错误归一化。这三件事每次都会漏一件。
//   本文件把它们收成 20 行，且**不引入任何策略**（策略全在内核）。

import type { RequestClient, RequestOptions, RequestResult } from '@proteus-vue/api'
import type { ShallowRef } from 'vue'
import { useRequestClient } from './client'
import { applyResult, createAsyncState, describeError, onCleanup } from './support'
import type { AsyncState } from './support'

export interface UseRequestOptions {
  /** 指定客户端（默认注入/兜底） */
  client?: RequestClient
}

export interface UseRequestHandle<T> {
  readonly state: AsyncState<T>
  readonly data: ShallowRef<T | undefined>
  readonly loading: ShallowRef<boolean>
  readonly error: ShallowRef<{ code: string; message: string } | undefined>
  readonly outcome: ShallowRef<AsyncState<T>['outcome']>
  /**
   * 发一次请求。★结果永不抛：用 `outcome` 分支（`success` / `failed` / `unknown`）。
   * @param url 目标地址（可每次不同 —— 这正是它与 useQuery 的根本差别）
   */
  send(url: string, options?: RequestOptions): Promise<RequestResult<T>>
  /** 取消在飞请求 */
  abort(reason?: string): void
  /** 清空状态 */
  reset(): void
}

/** 手动触发的单次请求（无自动发起、无乐观更新）。 */
export function useRequest<T = unknown>(options: UseRequestOptions = {}): UseRequestHandle<T> {
  const client = options.client ?? useRequestClient()
  const st = createAsyncState<T>()
  let inflightAbort: ((reason?: string) => void) | null = null

  const send = async (url: string, reqOptions: RequestOptions = {}): Promise<RequestResult<T>> => {
    st.loading.value = true
    st.error.value = undefined
    let task: { result: Promise<RequestResult<T>>; abort: (reason?: string) => void }
    try {
      task = client.task<T>(url, reqOptions)
    } catch (e) {
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
      const err = describeError(e)
      st.loading.value = false
      st.error.value = err
      st.outcome.value = 'failed'
      return { ok: false, outcome: 'failed', error: { code: err.code, message: err.message } } as RequestResult<T>
    }
    inflightAbort = null
    applyResult(st, r)
    return r
  }

  onCleanup(() => inflightAbort?.('组件卸载'))

  return {
    state: st.state,
    data: st.data,
    loading: st.loading,
    error: st.error,
    outcome: st.outcome,
    send,
    abort(reason?: string) {
      inflightAbort?.(reason)
    },
    reset() {
      st.data.value = undefined
      st.loading.value = false
      st.error.value = undefined
      st.outcome.value = undefined
    },
  }
}
