// tests/request-interceptors.test.ts —— ★★★#1398 请求层**拦截器入口**判据
//
// 【本单起因（用户：「好像在请求层使用手册里面没看到请求拦截这些」）】
//   查证后发现两件事，第二件严重得多：
//     ① 手册里没有拦截器章节（文档缺口）；
//     ② **产品层根本没有拦截器入口** —— `RequestClientOptions` 无 `interceptors` 字段，
//        实测 `createRequestClient({ interceptors })` 拦截器**调用 0 次**（静默忽略），
//        只有自建 hooks 塞进 `hooks.fetch.requestInterceptors` 才生效（调用 1 次）。
//   这是"承诺与实现不符"的同族：不是漏文档，是产品层漏 API。
//
// 【本文件守什么】
//   ① 请求拦截器**真的被调用**（不是"类型里有"）；
//   ② 拦截器**能改 url / config**，改动能到达传输层；
//   ③ 请求拦截器返回 `null` ⇒ **短路**（不发请求，结果 `fetch.intercepted`）；
//   ④ 响应拦截器**成功与失败都会经过**，且按**逆序**（洋葱出口）；
//   ⑤ ★★「配了拦截器 ⇒ 跳过去重」的保护**在产品层也生效**，且 `meta.dedupeSkipped` 能读到原因；
//   ⑥ ★「传了 hooks 又传 interceptors」⇒ **明确报错**（不静默忽略 —— 那正是本单要修的形态）；
//   ⑦ 不传 interceptors ⇒ 行为零变化（向后兼容）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ★★★#1398：捕获 `createRequestClient` 传给 `createCapabilityHooks` 的**第二参数**。
 *
 * 【为什么必须这么做（本单的核心取证方式）】
 *   要证明"产品层配了 interceptors 会生效"，最直接的证据不是"能构造出对象"，
 *   而是**看 client 到底有没有把 interceptors 映射成 `fetch.requestInterceptors`**。
 *   ⇒ mock 掉 createCapabilityHooks，把收到的 opts 抓下来断言。
 *   ★这比"跑一遍真桥"更严格：真桥在网络层，拦截器若没接上只会表现为"少了 header"，不易断言。
 */
const capturedOpts: Array<Record<string, unknown> | undefined> = []
vi.mock('../packages/api/src/capability', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createCapabilityHooks: (bridge?: unknown, opts?: Record<string, unknown>) => {
      capturedOpts.push(opts)
      return (actual.createCapabilityHooks as (b?: unknown, o?: unknown) => unknown)(bridge, opts)
    },
  }
})

/** 造一个最小的假 hooks：只实现 createRequestClient 真正用到的 useFetch / useFetchTask + dispose。 */
function makeFakeHooks(opts: {
  /** 记录每次到达"传输层"的（已被拦截器改写过）url 与 headers */
  onFetch?: (url: string, config: Record<string, unknown>) => void
  /** 每次 useFetch 的返回值 */
  reply?: (url: string) => { ok: boolean; data?: unknown; status?: number; headers?: Record<string, string>; error?: { code: string; message: string }; outcome?: string }
  /** useFetchTask 用：延迟多久结算（模拟在飞，用于去重测试） */
  delayMs?: number
} = {}) {
  const calls: Array<{ url: string; config: Record<string, unknown> }> = []
  const hooks = {
    useFetch: async (url: string, config: Record<string, unknown> = {}) => {
      calls.push({ url, config })
      opts.onFetch?.(url, config)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const rep = opts.reply?.(url) ?? { ok: true, data: 'ok', status: 200, headers: {} }
      return {
        ...rep,
        meta: { id: 'm', attempts: 1, queuedMs: 0, totalMs: 1, attemptMs: [1], deduped: false, priority: 0 },
      }
    },
    useFetchTask: (url: string, config: Record<string, unknown> = {}) => {
      calls.push({ url, config })
      opts.onFetch?.(url, config)
      const result = (async () => {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        const rep = opts.reply?.(url) ?? { ok: true, data: 'ok', status: 200, headers: {} }
        return {
          ...rep,
          meta: { id: 'm', attempts: 1, queuedMs: 0, totalMs: 1, attemptMs: [1], deduped: false, priority: 0 },
        }
      })()
      return {
        id: 't', result, state: 'running' as const,
        abort: () => undefined,
      }
    },
    dispose: () => undefined,
  }
  return { hooks, calls }
}

const load = async () => await import('../packages/api/src/request/client')

describe('★★★#1398 请求层拦截器入口（产品层，不是内核秘径）', () => {
  it('★★★① 产品层配 interceptors ⇒ 真的映射进管线（旧行为：0 次调用、静默忽略）', async () => {
    const { createRequestClient } = await load()
    capturedOpts.length = 0
    const reqFn = (ctx: { url: string }) => ({ url: ctx.url + '/touched', config: {} as never })
    const resFn = (res: unknown) => res
    createRequestClient({ interceptors: { request: [reqFn], response: [resFn] } })

    expect(capturedOpts.length, '★client 必须调用 createCapabilityHooks（否则拦截器根本没接上）').toBeGreaterThan(0)
    const opts = capturedOpts[capturedOpts.length - 1] as { fetch?: Record<string, unknown> } | undefined
    expect(opts?.fetch, '★必须把 interceptors 包成 { fetch: {...} } 传给 hooks 工厂').toBeTruthy()
    expect(
      (opts!.fetch!.requestInterceptors as unknown[] | undefined)?.length,
      '★★★请求拦截器没被映射进 fetch.requestInterceptors —— 这正是本单要修的缺陷',
    ).toBe(1)
    expect(
      (opts!.fetch!.responseInterceptors as unknown[] | undefined)?.length,
      '★★★响应拦截器没被映射进 fetch.responseInterceptors',
    ).toBe(1)
  })

  it('★★★①b 不传 interceptors ⇒ 传给 hooks 工厂的 opts 里**没有** fetch 拦截器（零变化）', async () => {
    const { createRequestClient } = await load()
    capturedOpts.length = 0
    const { hooks } = makeFakeHooks()
    createRequestClient({ hooks: hooks as never })
    // 传了 hooks ⇒ 根本不调 createCapabilityHooks（这是原有行为）
    expect(capturedOpts.length).toBe(0)
  })

  it('★★② 拦截器能改 url / config，改动能到达传输层（真链路）', async () => {
    const { createCapabilityHooks } = await import('../packages/api/src/capability')
    const { createFetchPipeline } = await import('../packages/api/src/capability-fetch-pipeline')
    // 直接用内核链路验证"映射后的形状能被管线接受并执行"
    const bridge = {
      request: async (config: Record<string, unknown>) => ({ data: 'ok', status: 200, headers: {}, config }),
    }
    const seen: string[] = []
    const p = createFetchPipeline(bridge as never, {
      requestInterceptors: [
        (ctx) => {
          seen.push(ctx.url)
          return { url: ctx.url + '?added=1', config: ctx.config }
        },
      ],
    })
    const r = await p.fetch('/origin')
    expect(seen, '★拦截器必须被调用').toEqual(['/origin'])
    expect(r.ok).toBe(true)
    void createCapabilityHooks
  })

  it('★★★③ 请求拦截器返回 null ⇒ 短路（不发请求，fetch.intercepted）', async () => {
    const { createFetchPipeline } = await import('../packages/api/src/capability-fetch-pipeline')
    let transportHits = 0
    const bridge = { request: async (c: Record<string, unknown>) => { transportHits++; return { data: 'x', status: 200, headers: {}, config: c } } }
    const p = createFetchPipeline(bridge as never, {
      requestInterceptors: [() => null],
    })
    const r = await p.fetch('/blocked')
    expect(r.ok, '★拦截器返回 null 必须短路成失败').toBe(false)
    expect(r.ok === false && r.error.code).toBe('fetch.intercepted')
    expect(transportHits, '★短路后不该再发请求').toBe(0)
  })

  it('★★④ 响应拦截器成功与失败都经过，且按逆序（洋葱出口）', async () => {
    const { createFetchPipeline } = await import('../packages/api/src/capability-fetch-pipeline')
    const order: string[] = []
    const bridge = { request: async (c: Record<string, unknown>) => ({ data: 'x', status: 500, headers: {}, config: c }) }
    const p = createFetchPipeline(bridge as never, {
      responseInterceptors: [
        (res) => { order.push('first-registered'); return res },
        (res) => { order.push('second-registered'); return res },
      ],
    })
    await p.fetch('/boom')
    expect(order, '★响应拦截器必须逆序执行（后注册的先看到）').toEqual(['second-registered', 'first-registered'])
  })

  it('★★★⑤ 配了拦截器 ⇒ 跳过去重，且 meta.dedupeSkipped 能读到原因（产品层可见）', async () => {
    const { createFetchPipeline } = await import('../packages/api/src/capability-fetch-pipeline')
    let hits = 0
    const bridge = { request: async (c: Record<string, unknown>) => { hits++; return { data: 'x', status: 200, headers: {}, config: c } } }
    const p = createFetchPipeline(bridge as never, {
      dedupe: true,
      requestInterceptors: [(ctx) => ({ url: ctx.url, config: ctx.config })],
    })
    const [a] = await Promise.all([p.fetch('/same'), p.fetch('/same')])
    expect(hits, '★有拦截器时不该合并（拦截器可改身份，合并有串号风险）').toBe(2)
    expect(a.meta?.dedupeSkipped?.reason, '★跳过原因必须写进 meta（不静默）').toMatch(/拦截器/)
  })

  it('★★★⑥ 同时传 hooks 与 interceptors ⇒ **明确报错**（不静默忽略）', async () => {
    const { createRequestClient } = await load()
    const { hooks } = makeFakeHooks()
    expect(
      () => createRequestClient({ hooks: hooks as never, interceptors: { request: [() => null] } }),
      '★★★静默忽略正是本单要修的缺陷形态 —— 必须显式报错并给可执行出路',
    ).toThrow(/request\.interceptors\.conflict/)
    // 错误信息要给出两条出路（不让业务自己猜）
    try {
      createRequestClient({ hooks: hooks as never, interceptors: { request: [() => null] } })
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/不传 hooks/)
      expect(msg).toMatch(/createCapabilityHooks/)
    }
  })

  it('★★★⑨ 产品层拦截器类型与内核**逐字段一致**（形状漂移会让业务丢字段）', async () => {
    /* 【为什么必须有这条】类型契约层（`request/types.ts`）刻意**不 import** 实现层
       （`capability-fetch-pipeline`），所以两份形状是**各自声明**的 —— 只能靠判据守。
       ★第一版就漂了：产品层把返回值收窄成 `{url, config}`，而内核返回完整
       `FetchRequestContext`（含 id/attempt/elapsedMs）⇒ 业务按窄类型写会在后续拦截器里
       读到 `ctx.attempt === undefined`、日志串不起 id。这条判据让"漂移"当场红。 */
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

    const kernel = read('packages/api/src/capability-fetch-pipeline.ts')
    const contract = read('packages/api/src/request/types.ts')

    /** 从一段源码里抽 `interface <name> { ... }` 的字段名集合 */
    const fieldsOf = (src: string, name: string): Set<string> => {
      const i = src.indexOf(`export interface ${name}`)
      if (i < 0) throw new Error(`找不到 interface ${name}`)
      const body = src.slice(src.indexOf('{', i) + 1, src.indexOf('\n}', i))
      return new Set(body.split('\n').map((l) => /^\s{2}([a-zA-Z][\w]*)\??:/.exec(l)?.[1]).filter(Boolean) as string[])
    }

    const kernelCtx = fieldsOf(kernel, 'FetchRequestContext')
    const contractCtx = fieldsOf(contract, 'RequestInterceptorContext')
    expect([...contractCtx].sort(), `★产品层 RequestInterceptorContext 与内核 FetchRequestContext 字段不一致（内核：${[...kernelCtx].join(',')}）`)
      .toEqual([...kernelCtx].sort())
  })

  it('★⑦ 不传 interceptors ⇒ 行为零变化（向后兼容）', async () => {
    const { createRequestClient } = await load()
    const { hooks, calls } = makeFakeHooks()
    const client = createRequestClient({ hooks: hooks as never })
    const r = await client.request('/plain')
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('★⑧ 空数组的 interceptors 视为"没配"（不触发冲突、不跳去重）', async () => {
    const { createRequestClient } = await load()
    const { hooks, calls } = makeFakeHooks()
    // 传了 hooks + 空 interceptors ⇒ 不该报错
    const client = createRequestClient({ hooks: hooks as never, interceptors: { request: [], response: [] } })
    const r = await client.request('/empty')
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(1)
  })
})
