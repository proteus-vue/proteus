// packages/request/src/use-mutation.ts
// ★★★#1394：`useMutation` —— 写操作 + 乐观更新 + 回滚（Vue 版，真响应式）。
//
// 【为什么乐观更新必须内建（而不是让业务手写）】
//   手写乐观更新的标准翻车姿势：改了本地状态 → 请求失败 → **忘了回滚**（或回滚错值）。
//   更隐蔽的一种：`unknown` 时也回滚 —— 而 `unknown` 意味着**可能已经成功了**，
//   回滚等于把一个真成功的写操作在界面上撤销掉（用户看到"失败了"，实际数据库里已经改了）。
//
// 【本文件的裁决口径（与内核三态一致）】
//   · `success`  ⇒ 用服务端返回值覆盖乐观值（服务端才是权威）
//   · `failed`   ⇒ **回滚**乐观值（确定没生效）
//   · `unknown`  ⇒ **不回滚**，并把 outcome 置 unknown ⇒ 界面必须让用户"去确认"，
//                  而不是显示成功或失败中的任何一个（会骗人）

import type { RequestClient, RequestOptions, RequestResult } from '@proteus-vue/api'
import type { ShallowRef } from 'vue'
import { useRequestClient } from './client'
import { applyResult, createAsyncState, describeError, onCleanup } from './support'
import type { AsyncState } from './support'

/** `useMutation` 的选项 */
export interface UseMutationOptions<TData = unknown, TVars = unknown> {
  /** HTTP 方法（默认 POST） */
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /**
   * 乐观更新：给定入参，先算出一个"看起来会成功"的结果并立刻显示。
   * ★返回 `undefined` = 这次不做乐观更新（例如依赖服务端生成 id 的创建操作）。
   */
  optimistic?: (vars: TVars) => TData | undefined
  /**
   * 回滚：把乐观值换回旧值。**只在 `failed` 时调用**（见文件头）。
   * 不传 ⇒ 回滚到 mutate 之前的快照。
   */
  rollback?: (previous: TData | undefined, vars: TVars) => TData | undefined
  /** 成功回调（如刷新列表 / 关闭弹窗） */
  onSuccess?: (data: TData, vars: TVars) => void
  /**
   * 失败/未知回调。★`outcome === 'unknown'` 时**不要提示"失败"**——
   *   那是"不确定"，界面应引导用户去确认（查单/刷新详情），否则会误导。
   */
  onError?: (err: { code: string; message: string }, outcome: 'failed' | 'unknown', vars: TVars) => void
  /** 指定客户端（默认注入/兜底） */
  client?: RequestClient
}

/** `useMutation` 返回的句柄 */
export interface UseMutationHandle<TData, TVars> {
  readonly state: AsyncState<TData>
  readonly data: ShallowRef<TData | undefined>
  readonly loading: ShallowRef<boolean>
  readonly error: ShallowRef<{ code: string; message: string } | undefined>
  readonly outcome: ShallowRef<AsyncState<TData>['outcome']>
  /** 执行一次写操作（结果永不抛；用 `outcome` 分支） */
  mutate(vars: TVars): Promise<RequestResult<TData>>
  /** 清空状态（如关闭弹窗时） */
  reset(): void
}

/**
 * `useMutation`：写操作 + 乐观更新 + 三态回滚。
 *
 * ```ts
 * const createTodo = useMutation<Todo, { title: string }>('/api/todos', {
 *   optimistic: (v) => ({ id: 'tmp', title: v.title, done: false }),
 *   onError: (_e, outcome) => {
 *     if (outcome === 'unknown') toast('结果未知，请刷新列表确认')  // ★不要写"创建失败"
 *     else toast('创建失败')
 *   },
 * })
 * ```
 */
export function useMutation<TData = unknown, TVars = unknown>(
  url: string | ((vars: TVars) => string),
  options: UseMutationOptions<TData, TVars> = {},
): UseMutationHandle<TData, TVars> {
  const client = options.client ?? useRequestClient()
  const st = createAsyncState<TData>()

  /** 在飞任务的 abort（多个 mutate 并发时只保留最后一个——写操作通常应当串行，见文件尾注释） */
  let inflightAbort: ((reason?: string) => void) | null = null

  const mutate = async (vars: TVars): Promise<RequestResult<TData>> => {
    const target = typeof url === 'function' ? url(vars) : url
    // ★快照：回滚用（在有乐观更新之前取，否则快照就是乐观值本身）
    const previous = st.data.value
    st.loading.value = true
    st.error.value = undefined

    // ① 乐观更新（立刻让 UI 有反应）
    if (options.optimistic) {
      const optimistic = options.optimistic(vars)
      if (optimistic !== undefined) st.data.value = optimistic
    }

    const method = options.method ?? 'POST'
    const reqOpts = { ...(options as { request?: Omit<RequestOptions, 'method'> }).request, method } as RequestOptions

    let task: { result: Promise<RequestResult<TData>>; abort: (reason?: string) => void }
    try {
      task = client.task<TData>(target, reqOpts)
    } catch (e) {
      const err = describeError(e)
      st.loading.value = false
      st.error.value = err
      st.outcome.value = 'failed'
      // ★同步异常也要回滚（乐观值已经上屏了）
      st.data.value = previous
      return { ok: false, outcome: 'failed', error: { code: err.code, message: err.message } } as RequestResult<TData>
    }
    inflightAbort = task.abort

    let r: RequestResult<TData>
    try {
      r = await task.result
    } catch (e) {
      const err = describeError(e)
      st.loading.value = false
      st.error.value = err
      st.outcome.value = 'failed'
      st.data.value = previous
      return { ok: false, outcome: 'failed', error: { code: err.code, message: err.message } } as RequestResult<TData>
    }
    inflightAbort = null
    applyResult(st, r)

    if (r.ok) {
      options.onSuccess?.(r.data as TData, vars)
      return r
    }

    // ②★★回滚裁决（本文件的核心）
    if (r.outcome === 'failed') {
      // 确定失败 ⇒ 回滚
      const restored = options.rollback ? options.rollback(previous, vars) : previous
      st.data.value = restored
    }
    // ★`unknown` ⇒ **不回滚**（可能已经成功了）。`applyResult` 已把 outcome 置为 unknown
    //   ⇒ 界面据此显示"结果待确认"，而不是成功或失败。
    if (r.outcome === 'failed' || r.outcome === 'unknown') {
      options.onError?.(st.error.value!, r.outcome, vars)
    }
    return r
  }

  onCleanup(() => inflightAbort?.('组件卸载'))

  return {
    state: st.state,
    data: st.data,
    loading: st.loading,
    error: st.error,
    outcome: st.outcome,
    mutate,
    reset() {
      st.data.value = undefined
      st.loading.value = false
      st.error.value = undefined
      st.outcome.value = undefined
    },
  }
}

/**
 * ★并发写操作的边界（写在这里，因为它是最容易被误用的地方）
 *   本 composable **不**阻止并发 mutate：连点两次"提交"会发两次请求。
 *   防重复提交需要的是**幂等键**（内核 `idempotency: 'auto'` + 同一逻辑请求复用同一 key），
 *   而不是在 UI 层加一个 `if (loading) return` —— 后者在快速网络下会漏（第一次已返回但用户又点了）。
 *   ⇒ 业务侧应当：`useMutation(..., { request: { idempotencyKey } })`，或按钮用 `:disabled="m.loading.value"`。
 */
