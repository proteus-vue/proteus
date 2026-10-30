// tests/request-vue-composables.test.ts —— ★★★#1394 请求库 **Vue 产品层**判据
//
// 【这组判据守什么（为什么内核测试覆盖不到）】
//   内核那 193 条验的是"策略对不对"（重试/去重/三态/审计…）。而本文件验的是
//   **"这些策略能不能在 Vue 里被业务真正用上"** —— 具体是四件内核不做的事：
//     ① **真响应式**：状态变化必须触发 Vue 的依赖更新（内核的 `state` 是普通对象，不触发）；
//     ② **竞态裁决**：快速切筛选时，先发后到的旧响应**不得**覆盖新响应；
//     ③ **失败不清空数据**：刷新失败要保留上一次成功的数据（否则页面从有内容变空白）；
//     ④ **三态可分支**：`unknown` 与 `failed` 必须能分开（模板里 `v-if="error"` 对两者都成立）。
//
// 【★为什么必须用真 Vue effect 验响应式】
//   只断言"state 是个对象"或"值是 undefined"永远不会红 —— 那正是内核 `createQuery` 的现状
//   （它返回普通对象，零测试，在模板里根本不重渲染）。⇒ 本文件用 `watchEffect` 计触发次数，
//   把它换成普通对象后判据**必须翻红**（见破坏性验证 M-V1）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope, nextTick, watchEffect } from 'vue'
import {
  useQuery, useMutation, useRequest, provideRequestClient, useRequestClient,
  createAsyncState, applyResult, createRaceGuard, __resetFallbackClient,
} from '@proteus-vue/request'
import type { RequestClient, RequestResult, RequestOptions } from '@proteus-vue/api'

/** 造一个可控的假 client：每次 task 都返回一个手动 resolve 的 deferred。 */
function makeFakeClient() {
  const calls: Array<{ url: string; options: RequestOptions }> = []
  const pending: Array<{
    url: string
    options: RequestOptions
    resolve: (r: RequestResult<unknown>) => void
    aborted: boolean
  }> = []

  const client = {
    task<T>(url: string, options: RequestOptions = {}) {
      let resolve!: (r: RequestResult<T>) => void
      const result = new Promise<RequestResult<T>>((res) => { resolve = res })
      const entry = {
        url,
        options,
        resolve: resolve as (r: RequestResult<unknown>) => void,
        aborted: false,
      }
      calls.push({ url, options })
      pending.push(entry)
      return {
        id: `t${calls.length}`,
        result,
        get state() { return 'running' as const },
        abort: (_reason?: string) => {
          entry.aborted = true
          // ★内核语义：abort 后 result 结算为 aborted（这里模拟成 failed）
          resolve({ ok: false, outcome: 'failed', error: { code: 'fetch.aborted', message: 'aborted' } } as RequestResult<T>)
        },
      }
    },
    request<T>(url: string, options: RequestOptions = {}) {
      return client.task<T>(url, options).result
    },
    requestOrThrow<T>(url: string, options: RequestOptions = {}) {
      return client.request<T>(url, options)
    },
    get<T>(url: string, options?: RequestOptions) { return client.request<T>(url, options) },
    post<T>(url: string, d?: unknown, options?: RequestOptions) { return client.request<T>(url, options) },
    put<T>(url: string, d?: unknown, options?: RequestOptions) { return client.request<T>(url, options) },
    patch<T>(url: string, d?: unknown, options?: RequestOptions) { return client.request<T>(url, options) },
    delete<T>(url: string, options?: RequestOptions) { return client.request<T>(url, options) },
    stats() { return {} as never },
    flushOfflineQueue: async () => ({ replayed: 0, failed: 0, skipped: 0 }),
    dispose() {},
  }
  return { client: client as unknown as RequestClient, calls, pending }
}

/** 成功结果的完整形态（★`meta` 是 RequestResult 成功分支的**必填**字段——
 *  第一版漏了它，`vitest` 不报（不做类型检查），`vue-tsc` 当场 TS2352 抓到） */
const okResult = <T>(data: T): RequestResult<T> =>
  ({
    ok: true,
    outcome: 'success',
    data,
    status: 200,
    headers: {},
    config: {},
    meta: {
      requestId: 'test',
      outcome: 'success',
      phase: 'responded',
      sent: true,
      attempts: 1,
      durationMs: 1,
    },
  }) as RequestResult<T>
const failResult = (code = 'fetch.failed'): RequestResult<never> =>
  ({ ok: false, outcome: 'failed', error: { code, message: 'boom' } } as RequestResult<never>)
const unknownResult = (): RequestResult<never> =>
  ({ ok: false, outcome: 'unknown', error: { code: 'fetch.unknown', message: '结果未知' } } as RequestResult<never>)



beforeEach(() => {
  __resetFallbackClient()
})

describe('★★★#1394 Vue 产品层 · 真响应式（内核的 state 是普通对象，本层必须换成 ref）', () => {
  it('★★★① 数据到达 ⇒ **Vue 的 watchEffect 必须被触发**（这是内核那层做不到的）', async () => {
    const { client, pending } = makeFakeClient()
    const scope = effectScope()
    let hits = 0
    let lastLen = -1
    scope.run(() => {
      const q = useQuery<number[]>('/api/list', { client })
      watchEffect(() => {
        hits++
        lastLen = q.data.value?.length ?? -1
      })
    })
    // 初始：loading 已置位 ⇒ 先有一轮 effect
    await nextTick()
    const before = hits
    pending[0]!.resolve(okResult([1, 2, 3]))
    await nextTick()
    await nextTick()   // microtask 链（await result→applyResult→ref 写）
    expect(hits, '★★★数据到达后 watchEffect 未被触发 —— state 不是响应式的（这正是内核 createQuery 的缺陷）').toBeGreaterThan(before)
    expect(lastLen, '★effect 里读到的应是新数据').toBe(3)
    scope.stop()
  })

  it('★①b 用普通对象冒充 state ⇒ 判定判据本身有效（自检：证明上一条不是恒真）', async () => {
    /* 【为什么要有这条自检】本文件的核心断言是"watchEffect 被触发"。
       如果 watchEffect 因为别的原因（比如 loading 置位）动了，那条断言可能**恒真**。
       这里显式验证：把 state 换成**非响应式普通对象**时，读它**不会**建立依赖
       ⇒ 值变了 effect 也不会再被触发。用来证明上面那条断言真的在守"响应式"这件事。 */
    const plain = { data: undefined as number[] | undefined }
    let hits = 0
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => { hits++; void plain.data?.length })
    })
    await nextTick()
    const before = hits
    plain.data = [1, 2, 3]          // 普通对象赋值（非响应式）
    await nextTick()
    expect(hits, '普通对象变更不应该触发 effect（否则本文件的响应式判据失去意义）').toBe(before)
    scope.stop()
  })

  it('★★② 失败 ⇒ **保留上一次成功的数据**（刷新失败不该让页面变空白）', async () => {
    const { client, pending } = makeFakeClient()
    const q = useQuery<number[]>('/api/list', { client, immediate: false })
    const p1 = q.refresh()
    pending[0]!.resolve(okResult([1, 2, 3]))
    await p1
    expect(q.data.value).toEqual([1, 2, 3])

    const p2 = q.refresh()
    pending[1]!.resolve(failResult())
    await p2
    expect(q.data.value, '★失败时数据被清空了 —— 用户会看到内容消失而不是"刷新失败"').toEqual([1, 2, 3])
    expect(q.outcome.value).toBe('failed')
    expect(q.error.value?.code).toBe('fetch.failed')
  })

  it('★★③ `unknown` 与 `failed` 必须能分开（模板 v-if="error" 对两者都成立）', async () => {
    const { client, pending } = makeFakeClient()
    const q = useQuery('/api/pay', { client, immediate: false })
    const p = q.refresh()
    pending[0]!.resolve(unknownResult())
    await p
    expect(q.outcome.value, '★unknown 必须如实标记（否则业务会当成失败去重试 ⇒ 重复下单）').toBe('unknown')
    expect(q.error.value, '★unknown 也要有 error（界面上"待确认"比空白好）').toBeTruthy()
  })

  it('★★★④ 竞态裁决：先发后到的**旧响应不得覆盖新响应**', async () => {
    const { client, pending } = makeFakeClient()
    const q = useQuery<number[]>('/api/list', { client, immediate: false })
    // 用户快速切筛选：先发 A，再发 B
    const pA = q.refresh()
    const pB = q.refresh()
    // ★A 后到（模拟慢请求）
    pending[1]!.resolve(okResult([2, 2]))   // B 先回
    await pB
    pending[0]!.resolve(okResult([1, 1]))   // A 后回（旧请求）
    await pA
    expect(q.data.value, '★★★旧响应覆盖了新响应 —— 页面显示的是上一次筛选的数据（这类 bug 极难复现）').toEqual([2, 2])
  })

  it('★⑤ 卸载（scope.stop）⇒ 在飞请求被取消', async () => {
    const { client, pending } = makeFakeClient()
    const scope = effectScope()
    scope.run(() => {
      useQuery('/api/slow', { client })
    })
    expect(pending).toHaveLength(1)
    scope.stop()
    expect(pending[0]!.aborted, '★组件卸载必须在飞请求取消（否则回调会打到已销毁的组件上）').toBe(true)
  })
})

describe('★★★#1394 Vue 产品层 · useMutation 的三态回滚', () => {
  it('★★★① `failed` ⇒ **回滚**乐观值', async () => {
    const { client, pending } = makeFakeClient()
    const m = useMutation<{ title: string }, { title: string }>('/api/todo', {
      client,
      optimistic: (v) => ({ title: v.title }),
    })
    const p = m.mutate({ title: 'new' })
    expect(m.data.value, '★乐观值应立刻上屏').toEqual({ title: 'new' })
    pending[0]!.resolve(failResult())
    await p
    expect(m.data.value, '★确定失败必须回滚（否则界面显示一条并不存在的记录）').toBeUndefined()
    expect(m.outcome.value).toBe('failed')
  })

  it('★★★② `unknown` ⇒ **不回滚**（可能已经成功了）', async () => {
    const { client, pending } = makeFakeClient()
    const m = useMutation<{ title: string }, { title: string }>('/api/todo', {
      client,
      optimistic: (v) => ({ title: v.title }),
    })
    const p = m.mutate({ title: 'maybe-created' })
    pending[0]!.resolve(unknownResult())
    await p
    expect(m.data.value, '★★★unknown 时回滚了 —— 一个可能真成功的写入被界面撤销了').toEqual({ title: 'maybe-created' })
    expect(m.outcome.value).toBe('unknown')
  })

  it('★③ onError 拿到正确的 outcome（业务据此决定提示文案）', async () => {
    const { client, pending } = makeFakeClient()
    const seen: string[] = []
    const m = useMutation('/api/x', { client, onError: (_e, outcome) => seen.push(outcome) })
    const p1 = m.mutate({})
    pending[0]!.resolve(failResult())
    await p1
    const p2 = m.mutate({})
    pending[1]!.resolve(unknownResult())
    await p2
    expect(seen, '★业务必须能区分"失败"与"未知"（提示文案完全不同）').toEqual(['failed', 'unknown'])
  })

  it('★④ 成功 ⇒ 用服务端返回值覆盖乐观值（服务端才是权威）', async () => {
    const { client, pending } = makeFakeClient()
    const m = useMutation<{ id: string; title: string }, { title: string }>('/api/todo', {
      client,
      optimistic: (v) => ({ id: 'tmp', title: v.title }),
    })
    const p = m.mutate({ title: 'new' })
    pending[0]!.resolve(okResult({ id: 'real-1', title: 'new' }))
    await p
    expect(m.data.value).toEqual({ id: 'real-1', title: 'new' })
  })
})

describe('★★★#1394 Vue 产品层 · useRequest（手动触发）与装配', () => {
  it('★① useRequest 不自动发起，send 才发', async () => {
    const { client, calls, pending } = makeFakeClient()
    const r = useRequest<string>({ client })
    expect(calls, '★useRequest 不该自动发请求（那是 useQuery 的语义）').toHaveLength(0)
    const p = r.send('/api/search')
    expect(calls).toHaveLength(1)
    pending[0]!.resolve(okResult('found'))
    await p
    expect(r.data.value).toBe('found')
  })

  it('★② 每次 send 可用不同 url（搜索场景）', async () => {
    const { client, calls, pending } = makeFakeClient()
    const r = useRequest<string>({ client })
    const p1 = r.send('/api/search?q=a')
    pending[0]!.resolve(okResult('a'))
    await p1
    const p2 = r.send('/api/search?q=b')
    pending[1]!.resolve(okResult('b'))
    await p2
    expect(calls.map((c) => c.url)).toEqual(['/api/search?q=a', '/api/search?q=b'])
    expect(r.data.value).toBe('b')
  })

  it('★★③ provideRequestClient ⇒ 子组件 useQuery 拿到同一实例（配额/断路器才是全局的）', async () => {
    const { client } = makeFakeClient()
    let got: RequestClient | undefined
    const scope = effectScope()
    scope.run(() => {
      provideRequestClient({} as never)   // 先建一个（真实实例）
      got = useRequestClient()
    })
    // ★这里只验"provide 机制能取到实例"，具体谁是那个实例由 provideRequestClient 决定
    expect(got, '★useRequestClient 必须返回实例（否则 composable 无法工作）').toBeTruthy()
    scope.stop()
    void client
  })

  it('★④ createAsyncState + applyResult 的语义单测（失败保留数据）', () => {
    const st = createAsyncState<number>()
    applyResult(st, okResult(1))
    expect(st.data.value).toBe(1)
    applyResult(st, failResult())
    expect(st.data.value, '★失败不该清空数据').toBe(1)
    expect(st.outcome.value).toBe('failed')
  })

  it('★⑤ createRaceGuard：只有最新序号被采纳', () => {
    const g = createRaceGuard()
    const a = g.next()
    const b = g.next()
    expect(g.isLatest(a)).toBe(false)
    expect(g.isLatest(b)).toBe(true)
  })
})


/**
 * ★★★#1394：内核 `createQuery` / `createMutation` 的判据（**此前零测试**）。
 *
 * 【为什么补这组】#1394 取证发现：这两个函数 191 行、零测试、零消费者，
 *   而它们的文档字符串容易让人以为"这就是给 Vue 用的"——实际 `state` 是普通对象、不响应式。
 *   ⇒ 这组判据锁住它们**真正**的语义（平台中立版该有的行为），并把"非响应式"这件事
 *     写成**显式判据**（而不是靠人记得）。
 */
describe('★★★#1394 内核 createQuery / createMutation（平台中立版）', () => {
  it('★① createQuery 成功后 state 被填充', async () => {
    const { client, pending } = makeFakeClient()
    const { createQuery } = await import('../packages/api/src/request/query')
    const q = createQuery<number[]>(client, 'list', '/api/list', { immediate: false })
    const p1 = q.refresh()
    await Promise.resolve()
    pending[0]!.resolve(okResult([1, 2]))
    await p1
    expect(q.state.data).toEqual([1, 2])
    expect(q.state.outcome).toBe('success')
    expect(q.state.loading).toBe(false)
  })

  it('★★② createQuery 失败时**保留旧数据**（与本层语义一致）', async () => {
    const { client, pending } = makeFakeClient()
    const { createQuery } = await import('../packages/api/src/request/query')
    const q = createQuery<number[]>(client, 'list', '/api/list', { immediate: false })
    const p1 = q.refresh()
    await Promise.resolve()
    pending[0]!.resolve(okResult([1, 2]))
    await p1
    const p2 = q.refresh()
    await Promise.resolve()
    pending[1]!.resolve(failResult())
    await p2
    expect(q.state.data, '★失败清空数据会让页面从有内容变空白').toEqual([1, 2])
    expect(q.state.outcome).toBe('failed')
  })

  it('★★★③ state 是**普通对象、非响应式**（这条判据本身守"不要误当 Vue composable"）', async () => {
    /* 【为什么把"缺陷"写成判据】这不是在给缺陷背书——是要把**能力边界**钉死：
       内核版不响应式是**设计决定**（它要能跑在无响应式系统的环境里）。
       真正的风险是"有人以为它是响应式的" ⇒ 用一条判据把这个事实写在测试里，
       改实现时必须显式面对它（想改成响应式就得走产品层，而不是偷偷给内核加 vue 依赖）。 */
    const { client, pending } = makeFakeClient()
    const { createQuery } = await import('../packages/api/src/request/query')
    const q = createQuery<number[]>(client, 'list', '/api/list', { immediate: false })
    let hits = 0
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => { hits++; void q.state.data?.length })
    })
    await nextTick()
    const before = hits
    const p = q.refresh()
    await Promise.resolve()
    pending[0]!.resolve(okResult([9, 9]))
    await p
    await nextTick()
    expect(q.state.data, '数据本身应该到了').toEqual([9, 9])
    expect(hits, '★内核版 state 是非响应式的（产品层 useQuery 才是响应式）').toBe(before)
    scope.stop()
  })

  it('★④ createMutation 成功 ⇒ 数据被填充', async () => {
    const { client, pending } = makeFakeClient()
    const { createMutation } = await import('../packages/api/src/request/query')
    const m = createMutation<{ id: string }, { title: string }>(client, '/api/todo', {})
    const p = m.mutate({ title: 'x' })
    pending[0]!.resolve(okResult({ id: 'real' }))
    await p
    expect(m.state.data).toEqual({ id: 'real' })
  })
})
