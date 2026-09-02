// tests/request-engineering.test.ts
// ★G-32 B6 前置（请求数据层语义面）：createRequestEngineering——注入式 R1-R4
//   R1 request（策略请求：缓存 + 去重 + 可选排队）· R2 useQuery（SWR 响应式数据获取）
//   R3 enqueue（并发队列：FIFO + 上限 + 失败隔离）· R4 dedupe（并发合并）
//   验证点：缓存命中/TTL 过期 · in-flight 去重 · 队列顺序/并发上限 · SWR 状态机 · 注入式可测
import { describe, it, expect, vi } from 'vitest'
import { createRequestEngineering, defaultCacheKey } from '@proteus-vue/api'
import type { CompatStorage, Reactivity, RequestConfig, RequestExecutor, RequestResponse } from '@proteus-vue/api'

/** 简单 reactivity mock（ref：{value} 可写；computed/watch 静态）——既有测试同构 */
function mockReactivity(): Reactivity {
  return {
    ref: <T>(initial: T) => {
      let v = initial
      return {
        get value() {
          return v
        },
        set value(nv: T) {
          v = nv
        },
      }
    },
    computed: <T>(getter: () => T) => ({ value: getter() }),
    watch: <T>(getter: () => T, cb: (v: T, o: T) => void) => {
      void getter
      void cb
      return () => undefined
    },
  }
}

/** 记录调用的 mock client。默认立即 resolve；defer=true 时受控（queue/dedupe 时序断言用） */
function mockClient(options: { defer?: boolean } = {}) {
  const defer = options.defer === true
  const calls: Array<RequestConfig> = []
  let active = 0
  let maxActive = 0
  const deferreds: Array<{ resolve: (v: RequestResponse<unknown>) => void }> = []
  let response: RequestResponse<unknown> = { data: 'ok', status: 200, headers: {}, config: { url: '' } }
  const client: RequestExecutor = {
    request: (config) => {
      calls.push(config)
      if (defer) active += 1
      if (defer && active > maxActive) maxActive = active
      return new Promise((resolve) => {
        const done = (v: RequestResponse<unknown>) => {
          if (defer) active -= 1
          resolve({ ...v, config })
        }
        if (defer) deferreds.push({ resolve: done })
        else done(response)
      })
    },
  }
  return {
    client,
    calls,
    get maxActive() {
      return maxActive
    },
    setResponse(r: RequestResponse<unknown>) {
      response = r
    },
    /** 全部 pending 请求按序 resolve */
    resolveAll() {
      const d = deferreds.splice(0)
      d.forEach((x) => x.resolve(response))
    },
    /** resolve 前 N 个 */
    resolveN(n: number) {
      const d = deferreds.splice(0, n)
      d.forEach((x) => x.resolve(response))
    },
  }
}

/** 内存缓存底座（CompatStorage 形态）；seed 注入条目（模拟过期） */
function memoryCache() {
  const mem = new Map<string, unknown>()
  const cache: CompatStorage = {
    get: (key) => mem.get(key) as unknown,
    set: (key, value) => {
      mem.set(key, value)
    },
    remove: (key) => {
      mem.delete(key)
    },
    clear: () => {
      mem.clear()
    },
  }
  return {
    cache,
    seed: (key: string, entry: unknown) => {
      mem.set(key, entry)
    },
    size: () => mem.size,
  }
}

/** 宏任务 flush：排空全部微任务链（promise 链多 hop 时一个 await 只跳 N-1 个） */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('G-32 B6 前置 请求数据层语义面（R1-R4）', () => {
  it('R1 request：无策略 → 直接执行返回（不缓存不排队）', async () => {
    const m = mockClient()
    m.setResponse({ data: { name: 'proteus' }, status: 200, headers: {}, config: { url: '/api' } })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity() })
    const r1 = await eng.request({ url: '/api' })
    expect(r1.status).toBe(200)
    expect((r1.data as { name: string }).name).toBe('proteus')
    await eng.request({ url: '/api' })
    // 无 ttl → 每次真正执行（无缓存）
    expect(m.calls.length).toBe(2)
  })

  it('R1 request：ttl>0 → 命中缓存不重发；TTL 过期 → 重发', async () => {
    const m = mockClient()
    m.setResponse({ data: 'v1', status: 200, headers: {}, config: { url: '/cache' } })
    const mem = memoryCache()
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity(), cache: mem.cache })
    const a = await eng.request({ url: '/cache' }, { ttl: 10000 })
    expect(a.data).toBe('v1')
    const b = await eng.request({ url: '/cache' }, { ttl: 10000 })
    expect(b.data).toBe('v1')
    expect(m.calls.length).toBe(1) // 缓存命中——未重发
    // 过期：预先 seed 过期条目 → 重发并覆盖
    const mem2 = memoryCache()
    mem2.seed('GET /cache', { data: 'stale', createdAt: Date.now() - 20000, staleAt: Date.now() - 10000 })
    const m2 = mockClient()
    m2.setResponse({ data: 'v2', status: 200, headers: {}, config: { url: '/cache' } })
    const eng2 = createRequestEngineering({ client: m2.client, reactivity: mockReactivity(), cache: mem2.cache })
    const c = await eng2.request({ url: '/cache' }, { ttl: 10000 })
    expect(c.data).toBe('v2')
    expect(m2.calls.length).toBe(1) // 过期条目被忽略 → 重新请求
    expect(mem2.size()).toBe(1) // 覆盖写回新条目
  })

  it('R1 request：并发同 key → dedupe 合并单次执行（R4）', async () => {
    const m = mockClient({ defer: true })
    m.setResponse({ data: 'shared', status: 200, headers: {}, config: { url: '/dup' } })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity() })
    const p1 = eng.request({ url: '/dup' })
    const p2 = eng.request({ url: '/dup' })
    m.resolveAll()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.data).toBe('shared')
    expect(r2.data).toBe('shared')
    expect(m.calls.length).toBe(1) // 去重——只发一次
  })

  it('R3 enqueue：concurrency=1 严格串行（FIFO 顺序）', async () => {
    const order: string[] = []
    const mk = (name: string, delay: number) => () => {
      order.push('start:' + name)
      return new Promise<void>((r) =>
        setTimeout(() => {
          order.push('end:' + name)
          r()
        }, delay),
      )
    }
    const eng = createRequestEngineering({ client: mockClient().client, reactivity: mockReactivity(), concurrency: 1 })
    await Promise.all([eng.enqueue(mk('a', 8)), eng.enqueue(mk('b', 2)), eng.enqueue(mk('c', 4))])
    // 严格串行：a 完整结束后 b 才开始
    expect(order[0]).toBe('start:a')
    expect(order.indexOf('end:a')).toBeLessThan(order.indexOf('start:b'))
    expect(order.indexOf('end:b')).toBeLessThan(order.indexOf('start:c'))
    expect(order[order.length - 1]).toBe('end:c')
  })

  it('R3 enqueue：concurrency=2 → 并发 ≤2、空位即补', async () => {
    const m = mockClient({ defer: true })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity(), concurrency: 2 })
    const tasks = [
      eng.enqueue(() => m.client.request({ url: '/1' })),
      eng.enqueue(() => m.client.request({ url: '/2' })),
      eng.enqueue(() => m.client.request({ url: '/3' })),
    ]
    // 同步创建后：enqueue 的 Promise.resolve().then(task) 是微任务——宏任务 flush 排空
    await flush()
    expect(m.calls.length).toBe(2) // 1、2 已启动，3 排队
    m.resolveN(1)
    await flush()
    expect(m.calls.length).toBe(3) // 腾出 1 个槽 → 3 启动
    m.resolveAll()
    await Promise.all(tasks)
    expect(m.maxActive).toBeLessThanOrEqual(2)
  })

  it('R3 enqueue：失败隔离（一个 reject 不影响后续）', async () => {
    const eng = createRequestEngineering({ client: mockClient().client, reactivity: mockReactivity(), concurrency: 1 })
    const results = await Promise.allSettled([
      eng.enqueue(() => Promise.reject(new Error('boom'))),
      eng.enqueue(() => Promise.resolve('ok-1')),
      eng.enqueue(() => Promise.resolve('ok-2')),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 'ok-1' })
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: 'ok-2' })
  })

  it('R2 useQuery：初始 fetch → state 流转（loading → data）', async () => {
    const m = mockClient({ defer: true })
    m.setResponse({ data: { count: 1 }, status: 200, headers: {}, config: { url: '/q' } })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity() })
    const fetcher = () => m.client.request({ url: '/q' }).then((r) => r.data as { count: number })
    const q = eng.useQuery('q1', fetcher)
    expect(q.state.value.loading).toBe(true)
    expect(q.pending()).toBe(true)
    m.resolveAll()
    await flush()
    expect(q.state.value.loading).toBe(false)
    expect(q.pending()).toBe(false)
    if (q.state.value.data !== undefined) expect((q.state.value.data as { count: number }).count).toBe(1)
    expect(q.state.value.error).toBeUndefined()
  })

  it('R2 useQuery：真正并发去重（两个实例同时创建 → 单次 fetch）', async () => {
    const m = mockClient({ defer: true })
    m.setResponse({ data: 'dup-ok', status: 200, headers: {}, config: { url: '/dup-q' } })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity() })
    const fetcher = () => m.client.request({ url: '/dup-q' }).then((r) => r.data as string)
    const a = eng.useQuery('k', fetcher)
    const b = eng.useQuery('k', fetcher)
    expect(m.calls.length).toBe(1) // 同 key 并发 → 单次
    expect(a.pending()).toBe(true)
    expect(b.pending()).toBe(true)
    m.resolveAll()
    await flush()
    expect(a.state.value.data).toBe('dup-ok')
    expect(b.state.value.data).toBe('dup-ok')
    expect(m.calls.length).toBe(1)
  })

  it('R2 useQuery：缓存命中（ttl）→ 直接 data 不重发；refresh/mutate/invalidate', async () => {
    const m = mockClient()
    m.setResponse({ data: 'fresh', status: 200, headers: {}, config: { url: '/swr' } })
    const mem = memoryCache()
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity(), cache: mem.cache })
    const fetcher = () => m.client.request({ url: '/swr' }).then((r) => r.data as string)
    // 第一次：发起 + 写缓存
    const q1 = eng.useQuery('swr', fetcher, { ttl: 10000 })
    await flush()
    expect(q1.state.value.data).toBe('fresh')
    // 第二次（新实例）：命中缓存 → 直接 data、零请求
    const q2 = eng.useQuery('swr', fetcher, { ttl: 10000 })
    expect(q2.state.value.data).toBe('fresh')
    expect(q2.state.value.loading).toBe(false)
    expect(m.calls.length).toBe(1)
    // refresh：强制刷新（重发）
    m.setResponse({ data: 'fresh-2', status: 200, headers: {}, config: { url: '/swr' } })
    const refreshed = q2.refresh()
    expect(q2.state.value.loading).toBe(true)
    await refreshed
    expect(q2.state.value.data).toBe('fresh-2')
    expect(m.calls.length).toBe(2)
    // mutate：乐观写（不发请求）
    q2.mutate('optimistic')
    expect(q2.state.value.data).toBe('optimistic')
    expect(m.calls.length).toBe(2)
    // invalidate：清缓存 → 下次读取重发
    q2.invalidate()
    const q3 = eng.useQuery('swr', fetcher, { ttl: 10000 })
    expect(q3.state.value.loading).toBe(true)
    await flush()
    expect(m.calls.length).toBe(3)
  })

  it('R4 runOnce：同 key 并发共享 in-flight（结果一致、仅执行一次）', async () => {
    const m = mockClient({ defer: true })
    m.setResponse({ data: 'once', status: 200, headers: {}, config: { url: '/once' } })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity() })
    let runs = 0
    const task = async () => {
      runs += 1
      return m.client.request({ url: '/once' }).then((r) => r.data as string)
    }
    const p1 = eng.runOnce('x', task)
    const p2 = eng.runOnce('x', task)
    m.resolveAll()
    const [v1, v2] = await Promise.all([p1, p2])
    expect(v1).toBe('once')
    expect(v2).toBe('once') // 共享同一次结果
    expect(runs).toBe(1)
  })

  it('R1 request：queue=true → 排队串行（并发 1 下 FIFO）', async () => {
    const m = mockClient({ defer: true })
    const eng = createRequestEngineering({ client: m.client, reactivity: mockReactivity(), concurrency: 1 })
    const p1 = eng.request({ url: '/a' }, { queue: true })
    const p2 = eng.request({ url: '/b' }, { queue: true })
    const p3 = eng.request({ url: '/c' }, { queue: true })
    // 同步创建后：enqueue 微任务等一拍——仅第 1 个发出的（其余排队）
    await flush()
    expect(m.calls.length).toBe(1)
    expect(m.calls[0].url).toBe('/a')
    // 依次 resolve → 每次腾出槽位，下一个任务才起步（FIFO 顺序）
    m.resolveN(1)
    await flush()
    expect(m.calls.length).toBe(2)
    expect(m.calls[1].url).toBe('/b')
    m.resolveN(1)
    await flush()
    expect(m.calls.length).toBe(3)
    expect(m.calls[2].url).toBe('/c')
    m.resolveAll()
    await Promise.all([p1, p2, p3])
    expect(m.calls.length).toBe(3)
  })

  it('useQuery fetch 失败 → state.error（不抛入业务）；refresh 抛给显式 await 方', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network-down')
    })
    const eng = createRequestEngineering({ client: mockClient().client, reactivity: mockReactivity() })
    const q = eng.useQuery('fail', failing)
    // init 路径内部 catch → state.error 不 throw
    await flush()
    expect(q.state.value.loading).toBe(false)
    expect(q.state.value.error).toBeInstanceOf(Error)
    // refresh 抛错（调用方显式 await 可 catch）
    await expect(q.refresh()).rejects.toThrow('network-down')
  })
})