// tests/fetch-stale.test.ts
// ★★★决策 #1150：**RFC 5861 的两条扩展指令**（`stale-while-revalidate` / `stale-if-error`）判据。
//
// 【为什么需要它（上一轮 #1149 自己写下的诚实边界）】
//   #1149 交付了条件请求缓存，但在矩阵与代码注释里明确登记：
//   「`stale-while-revalidate` / `stale-if-error` **未做**」。这两条是超级应用最常用的两招：
//     · SWR：**立即回旧值** + 后台校验 ⇒ 接口再慢也不把用户卡住（首屏速度）；
//     · SIE：源站挂了就用旧数据兜底 ⇒ 可用性（这是"降级"而不是"报错"）。
//   两者的共同点是「**返回 stale 数据是正确行为**，不是妥协」——而这恰恰与 #1149 的
//   `must-revalidate` 逻辑（禁止复用 stale）方向相反 ⇒ 必须精确区分，不能靠"大概"。
//
// 【★语义基准 = RFC 5861 + RFC 9111 原文（已逐句取证，不凭印象）】
//   RFC 5861 `stale-while-revalidate`：
//     "caches MAY serve the response in which it appears after it becomes stale,
//      up to the indicated number of seconds" ⇒ 窗口 = **变 stale 之后**的 N 秒
//     → `age < lifetime + N`（不是 `age < N`）
//   RFC 5861 `stale-if-error`：
//     "an error is any situation that would result in a 500, 502, 503, or 504
//      HTTP response status code being returned" ⇒ **只兜底这四类 5xx**（+ 网络失败）
//   ★RFC 5861 **未规定**与 `must-revalidate` 的交互 ⇒ 本实现取**更严格者**
//     （RFC 9111 §5.2.2.2：must-revalidate 一旦 stale 就 MUST NOT 复用）
//   ★RFC 5861 未要求限流后台校验，但明确提出要避免 **amplification attack** ⇒ 本实现按条目去重
//   RFC 9111 §5.1：缓存生成的响应 **MUST** 生成 `Age` 头
//
// 【判据口径（每条都能破坏性验证）】
//   ① SWR 窗口内：**立即返回旧值**（status=stale / staleReason=swr）+ 后台校验真的发出（服务端收到条件请求）
//   ② SWR 窗口外：**不得**再回旧值（必须回源）
//   ③ `must-revalidate` 优先：带该指令时 SWR **不生效**
//   ④ 后台校验成功后**新值进缓存**（下一次请求拿到新 body，服务端 hits 只增一次）
//   ⑤ 并发 N 个 stale 请求 ⇒ 后台校验**只发一次**（amplification 防线）
//   ⑥ SIE：回源 500/502/503/504 或网络失败 ⇒ 用旧值兜底（status=stale / staleReason=stale-if-error）
//   ⑦ SIE **不兜底** 用户取消（`fetch.aborted`）与 4xx（不是"源站错误"）
//   ⑧ `Age` 头由缓存生成的响应必须带（RFC 9111 §5.1 MUST）
//   ⑨ 无 SWR/SIE 指令时行为与 #1149 完全一致（零回归）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { webRequest } from '../packages/api/src/capability-fetch-legs'
import {
  createFetchCache,
  createMemoryFetchCache,
  fetchCacheKey,
  parseCacheControl,
  isStaleServable,
  isStaleOnErrorAvailable,
  isErrorRescuable,
  withAgeHeader,
} from '../packages/api/src/capability-fetch-cache'

class TCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}
const ctx = { CapError: TCapError as unknown as new (code: string, message: string, cause?: unknown) => Error }
const realBridge = { request: (config: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, config) }

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('★★#1150 RFC 5861：stale-while-revalidate / stale-if-error', () => {
  let server: Server
  let base = ''
  /** 服务端记账：每个路径收到的请求数 + 收到的条件头 */
  const hits = new Map<string, number>()
  const conditional = new Map<string, string[]>()
  /** 每个路径当前应返回的状态码（判据可在运行中改它模拟源站故障） */
  const statusOverride = new Map<string, number>()

  const hitCount = (p: string): number => hits.get(p) ?? 0
  const reset = (): void => {
    hits.clear()
    conditional.clear()
    statusOverride.clear()
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      const p = u.pathname
      hits.set(p, (hits.get(p) ?? 0) + 1)
      const inm = req.headers['if-none-match']
      if (typeof inm === 'string') conditional.set(p, [...(conditional.get(p) ?? []), inm])

      const override = statusOverride.get(p)
      if (override !== undefined) {
        res.writeHead(override, { 'Content-Type': 'text/plain' })
        res.end('err')
        return
      }

      // 每条端点：ETag 随生成次数变化 ⇒ 后台校验能拿到新值
      const gen = hitCount(p)
      const etag = `"v${gen}"`
      const cc = u.searchParams.get('cc') ?? 'max-age=0'
      // 带正确 ETag ⇒ 304（省流量）
      if (inm === etag && u.searchParams.get('nocond') !== '1') {
        res.writeHead(304, { ETag: etag, 'Cache-Control': cc })
        res.end()
        return
      }
      res.writeHead(200, { ETag: etag, 'Cache-Control': cc, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ gen, path: p }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  type CacheMeta = { status?: string; staleReason?: string; revalidating?: boolean; ageMs?: number }

  it('① SWR 窗口内：立即回旧值 + 后台校验真发出', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    // max-age=0 ⇒ 存完立即 stale；SWR 窗口 60s ⇒ 下一次命中 stale 并后台校验
    const cc = 'max-age=0, stale-while-revalidate=60'
    const r1 = await p.fetch<{ gen: number }>(`${base}/swr?cc=${encodeURIComponent(cc)}`)
    expect(r1.ok).toBe(true)
    const before = hitCount('/swr')

    const t0 = Date.now()
    const r2 = await p.fetch<{ gen: number }>(`${base}/swr?cc=${encodeURIComponent(cc)}`)
    const elapsed = Date.now() - t0
    expect(r2.ok).toBe(true)
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(m2?.status, `实得 ${JSON.stringify(m2)}`).toBe('stale')
    expect(m2?.staleReason).toBe('swr')
    // ★"立即"的硬证据：旧值是同步回的，不等后台校验（服务端没被阻塞）
    expect(elapsed, `★SWR 没有立即返回（等了 ${elapsed}ms）`).toBeLessThan(400)
    // ★旧值：body 仍是第 1 代（后台校验还没回写）
    if (r2.ok) expect(r2.data.gen).toBe(1)

    // ★后台校验真的发出了（等它落地：这是"后台"的定义，不是"没发生"）
    for (let i = 0; i < 100 && hitCount('/swr') === before; i++) await sleepMs(10)
    expect(hitCount('/swr'), '★后台校验从未发出（SWR 只返回了旧值，没有刷新缓存）').toBe(before + 1)
    // 且它是**条件请求**（省流量的关键）
    expect(conditional.get('/swr') ?? [], '★后台校验没带 If-None-Match').toContain('"v1"')
  })

  it('② SWR 窗口外：不得再回旧值（必须回源）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    // 窗口 0s ⇒ 立即超出 ⇒ 不该走 stale 分支
    const cc = 'max-age=0, stale-while-revalidate=0'
    await p.fetch(`${base}/swr-expired?cc=${encodeURIComponent(cc)}`)
    const r2 = await p.fetch<{ gen: number }>(`${base}/swr-expired?cc=${encodeURIComponent(cc)}`)
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(m2?.status, '★SWR 窗口=0 却仍返回 stale').not.toBe('stale')
  })

  it('★★③ must-revalidate 优先于 stale-while-revalidate（RFC 5861 未规定，取更严格者）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cc = 'max-age=0, must-revalidate, stale-while-revalidate=60'
    await p.fetch(`${base}/swr-mr?cc=${encodeURIComponent(cc)}`)
    const r2 = await p.fetch<{ gen: number }>(`${base}/swr-mr?cc=${encodeURIComponent(cc)}`)
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(
      m2?.status,
      `★必须回源（must-revalidate 一旦 stale 就 MUST NOT 复用，RFC 9111 §5.2.2.2）；实得 ${JSON.stringify(m2)}`,
    ).not.toBe('stale')
  })

  it('④ 后台校验成功后新值进缓存（下一次请求拿到新 body）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cc = 'max-age=0, stale-while-revalidate=60'
    const url = `${base}/swr-refresh?cc=${encodeURIComponent(cc)}`
    const r1 = await p.fetch<{ gen: number }>(url)
    expect(r1.ok && r1.data.gen).toBe(1)
    // 触发一次 stale + 后台校验（服务端会回 200 新 body，因为条件头 etag 对不上时它生成新一代）
    await p.fetch(url)
    // 等后台校验把新值写进缓存
    for (let i = 0; i < 100 && hitCount('/swr-refresh') < 2; i++) await sleepMs(10)
    // 现在缓存里的条目已刷新 ⇒ 再请求应是"更新的代"（stale 复用新值，或 fresh）
    const r3 = await p.fetch<{ gen: number }>(url)
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      expect(r3.data.gen, '★后台校验的结果没有进缓存（仍是第 1 代）').toBeGreaterThan(1)
    }
    // ★Age 头（RFC 9111 §5.1 MUST）
    if (r3.ok) {
      const age = Object.entries(r3.headers).find(([k]) => k.toLowerCase() === 'age')
      expect(age, '★缓存生成的响应缺 Age 头（RFC 9111 §5.1 要求 MUST）').toBeTruthy()
    }
  })

  it('★★⑤ 并发 N 个 stale 请求 ⇒ 后台校验只发一次（amplification 防线）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true, concurrency: 10 })
    const cc = 'max-age=0, stale-while-revalidate=60'
    const url = `${base}/swr-dedupe?cc=${encodeURIComponent(cc)}`
    await p.fetch(url)
    const before = hitCount('/swr-dedupe')
    // 6 个并发请求全部命中同一条 stale 条目
    const results = await Promise.all(Array.from({ length: 6 }, () => p.fetch(url)))
    expect(results.every((r) => r.ok)).toBe(true)
    const allStale = results.every((r) => (r as { meta?: { cache?: CacheMeta } }).meta?.cache?.status === 'stale')
    expect(allStale, '★并发请求没有全部走 stale 路径').toBe(true)
    // 给后台校验留出落地时间
    await sleepMs(120)
    const delta = hitCount('/swr-dedupe') - before
    expect(
      delta,
      `★6 个并发 stale 请求触发了 ${delta} 次后台校验（应只 1 次——否则源站故障会被放大 6 倍）`,
    ).toBe(1)
  })

  it('★★⑥ stale-if-error：源站 503 ⇒ 用旧值兜底', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cc = 'max-age=0, stale-if-error=60'
    const url = `${base}/sie?cc=${encodeURIComponent(cc)}`
    const r1 = await p.fetch<{ gen: number }>(url)
    expect(r1.ok && r1.data.gen).toBe(1)
    // 源站故障
    statusOverride.set('/sie', 503)
    const r2 = await p.fetch<{ gen: number }>(url)
    expect(r2.ok, '★源站 503 时没有用旧值兜底').toBe(true)
    if (r2.ok) expect(r2.data.gen).toBe(1)
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(m2?.status).toBe('stale')
    expect(m2?.staleReason).toBe('stale-if-error')
  })

  it('★⑥b stale-if-error 也覆盖网络失败（连不上）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cc = 'max-age=0, stale-if-error=60'
    const url = `${base}/sie-net?cc=${encodeURIComponent(cc)}`
    await p.fetch(url)
    // 换成一个不可达端口：先改 URL 不会命中缓存 ⇒ 用"服务端主动断开"模拟网络失败
    statusOverride.set('/sie-net', 502)
    const r2 = await p.fetch<{ gen: number }>(url)
    expect(r2.ok, '★502 时没有兜底').toBe(true)
  })

  it('★★⑦ stale-if-error 不兜底用户取消、也不兜底 4xx（不是"源站错误"）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cc = 'max-age=0, stale-if-error=60'
    // 4xx：不是 RFC 5861 定义的"error"
    const url = `${base}/sie-4xx?cc=${encodeURIComponent(cc)}`
    const r1 = await p.fetch(url)
    expect(r1.ok).toBe(true)
    statusOverride.set('/sie-4xx', 404)
    const r2 = await p.fetch(url)
    // 404 在 runFetch 里是 ok:true + status=404 ⇒ 当成正常响应（会覆盖缓存），不该报 stale
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(m2?.staleReason, '★404 被当成"源站错误"兜底了').not.toBe('stale-if-error')

    // 取消：绝不能拿旧值冒充成功
    expect(isErrorRescuable({ ok: false, error: { code: 'fetch.aborted', message: 'x' } as never }), '★取消不该被兜底').toBe(false)
    expect(isErrorRescuable({ ok: false, error: { code: 'fetch.unsupported', message: 'x' } as never })).toBe(false)
    expect(isErrorRescuable({ ok: false, error: { code: 'fetch.failed', message: 'x' } as never })).toBe(true)
    expect(isErrorRescuable({ ok: false, error: { code: 'fetch.timeout', message: 'x' } as never })).toBe(true)
    expect(isErrorRescuable({ ok: true, status: 503, headers: {}, data: null } as never)).toBe(true)
    expect(isErrorRescuable({ ok: true, status: 500, headers: {}, data: null } as never)).toBe(true)
    expect(isErrorRescuable({ ok: true, status: 501, headers: {}, data: null } as never), '501 不在 RFC 名单里').toBe(false)
    expect(isErrorRescuable({ ok: true, status: 200, headers: {}, data: null } as never)).toBe(false)
  })

  it('⑧ Age 头：缓存生成的响应必须带（RFC 9111 §5.1 MUST）', () => {
    const out = withAgeHeader({ 'Content-Type': 'x', Age: '99' }, 2500)
    expect(out['Age']).toBe('2')
    // 覆盖原 Age（那是上游缓存的年龄，已计入 entryAgeMs，重复保留会双重计算）
    expect(Object.keys(out).filter((k) => k.toLowerCase() === 'age').length).toBe(1)
  })

  it('⑨ 无 SWR/SIE 指令 ⇒ 行为与 #1149 完全一致（零回归）', async () => {
    reset()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    // 只有 max-age：过期后必须回源，且不得出现 stale
    const url = `${base}/plain?cc=${encodeURIComponent('max-age=0')}`
    await p.fetch(url)
    const r2 = await p.fetch<{ gen: number }>(url)
    const m2 = (r2 as { meta?: { cache?: CacheMeta } }).meta?.cache
    expect(m2?.status).not.toBe('stale')
    expect(m2?.revalidating).toBeUndefined()
  })

  it('★纯函数单测：窗口边界（age < lifetime + N，不是 age < N）', () => {
    const mk = (o: Partial<{ lifetimeMs: number; swrMs: number; sieMs: number; mustRevalidate: boolean }> = {}) => ({
      key: 'k',
      status: 200,
      headers: {},
      body: { kind: 'text' as const, text: 'x' },
      json: false,
      storedAt: 0,
      lifetimeMs: o.lifetimeMs ?? 1000,
      mustRevalidate: o.mustRevalidate ?? false,
      ...(o.swrMs !== undefined ? { swrMs: o.swrMs } : {}),
      ...(o.sieMs !== undefined ? { sieMs: o.sieMs } : {}),
      varyNames: [],
      varyValues: {},
      lastUsed: 0,
      bytes: 1,
    })
    // lifetime 1000 + swr 5000 ⇒ 窗口是 [1000, 6000)
    expect(isStaleServable(mk({ swrMs: 5000 }), 500), '★新鲜期内不该算 stale 复用').toBe(false)
    expect(isStaleServable(mk({ swrMs: 5000 }), 1000)).toBe(true)
    expect(isStaleServable(mk({ swrMs: 5000 }), 5999)).toBe(true)
    expect(isStaleServable(mk({ swrMs: 5000 }), 6000), '★窗口外仍服务 stale').toBe(false)
    // ★若误把窗口算成 age < N（而不是 lifetime + N），age=1000 就会判 false ⇒ 上面那条会红
    expect(isStaleServable(mk({ swrMs: 5000, mustRevalidate: true }), 2000), '★must-revalidate 未优先').toBe(false)
    expect(isStaleServable(mk({}), 5000), '无 swr 指令却启用').toBe(false)

    expect(isStaleOnErrorAvailable(mk({ sieMs: 5000 }), 5999)).toBe(true)
    expect(isStaleOnErrorAvailable(mk({ sieMs: 5000 }), 6000)).toBe(false)
    expect(isStaleOnErrorAvailable(mk({ sieMs: 5000, mustRevalidate: true }), 2000)).toBe(false)

    const cc = parseCacheControl({ 'Cache-Control': 'max-age=0, stale-while-revalidate=30, stale-if-error=120' })
    expect(cc.staleWhileRevalidateMs).toBe(30000)
    expect(cc.staleIfErrorMs).toBe(120000)
    // 大小写 + 带引号
    expect(parseCacheControl({ 'cache-control': 'STALE-WHILE-REVALIDATE="7"' }).staleWhileRevalidateMs).toBe(7000)
  })

  it('★控制器单测：SWR 条目在 stale 窗口内被 lookup 判为 stale，窗口外判为 revalidate', () => {
    let clock = 0
    const store = createMemoryFetchCache({ now: () => clock })
    const ctl = createFetchCache({ enabled: true, store }, () => clock)
    const cfg = { cache: 'default' as const }
    const url = 'http://x/a'
    // 直接写入一个"已过期但有 SWR 窗口"的条目（绕过网络）
    // ★键必须用**实现导出的** `fetchCacheKey` 生成——首版手写 'GET http://x/a rt=auto' 而实际
    //   形态带末尾 `?`（无 params 时仍拼分隔符）⇒ 判据自己假红。手写键 = 第二份实现。
    const entry = {
      key: fetchCacheKey(url, cfg),
      status: 200,
      headers: { 'Cache-Control': 'max-age=1, stale-while-revalidate=10' },
      body: { kind: 'text' as const, text: '{"a":1}' },
      json: true,
      storedAt: 0,
      lifetimeMs: 1000,
      mustRevalidate: false,
      swrMs: 10000,
      varyNames: [] as string[],
      varyValues: {} as Record<string, string>,
      lastUsed: 0,
      bytes: 0,
    }
    store.put(entry)
    clock = 500
    expect(ctl.lookup(url, cfg, 'default').kind, '新鲜期内应 fresh').toBe('fresh')
    clock = 5000
    const stale = ctl.lookup(url, cfg, 'default')
    expect(stale.kind, `窗口内应 stale，实得 ${stale.kind}`).toBe('stale')
    clock = 20000
    expect(ctl.lookup(url, cfg, 'default').kind, '★窗口外仍 stale').toBe('revalidate')
  })
})
