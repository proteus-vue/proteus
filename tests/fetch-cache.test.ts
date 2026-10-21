// tests/fetch-cache.test.ts
// ★★★决策 #1149：**HTTP 条件请求缓存**（矩阵 P2）的判据——真实 HTTP 服务，不滥用 mock。
//
// 【为什么需要它（矩阵 §3 P2 的原话）】
//   「浏览器/小程序会自动做 HTTP 缓存，但 App 三个宿主不会（我们的字节腿是裸 HTTP）」
//   ⇒ App 端的缓存语义**必须框架层实现**，否则"同一份源码三端一致"就不成立。
//   ★取证：Android `HttpCapability.perform` 是裸 `HttpURLConnection`（未启用 `ResponseCache`）；
//     iOS 用 `URLSessionConfiguration.default`（系统 `URLCache` 行为不透明）；
//     Web 走浏览器 fetch（自带缓存）。三端因此天然分叉。
//
// 【判据口径（每条都能破坏性验证）】
//   ① 首次回源 ⇒ `meta.cache.status='miss'` 且 `stored=true`；第二次在新鲜期内 ⇒
//      `status='hit'` 且**服务端没收到第二个请求**（这是"真的没发"的唯一硬证据）；
//   ② 过期后回源必须带 `If-None-Match`（服务端收到才作数），304 ⇒ `status='revalidated'` +
//      **业务拿到的仍是缓存体**（内容与首次一致）+ 状态码 200（不是 304 泄漏给业务）；
//   ③ `Cache-Control: no-store` ⇒ 不写缓存（第二次仍然回源，服务端计数=2）；
//   ④ `cache:'reload'` ⇒ 即使新鲜也回源；`cache:'no-cache'` ⇒ 带校验器回源；
//      `cache:'only-if-cached'` 且无条目 ⇒ `fetch.cacheMiss` 且**服务端零请求**；
//   ⑤ `Vary` 分桶：同一 URL 不同 `Accept-Language` 不能互相命中；
//   ⑥ 非 GET（POST）不进缓存；
//   ⑦ 管线未开缓存 ⇒ 行为与从前完全一致（`meta.cache` 不出现，请求每次都发）；
//   ⑧ 只缓存 200/203：500 不缓存（第二次仍然回源）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { webRequest } from '../packages/api/src/capability-fetch-legs'
import { createMemoryFetchCache, fetchCacheKey, parseCacheControl, isFresh } from '../packages/api/src/capability-fetch-cache'

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

/** 服务端计数（每条用例前重置）。 */
interface Counter {
  /** 收到的请求数（按 path） */
  hits: Map<string, number>
  /** 收到的条件请求头（按 path） */
  ifNoneMatch: Map<string, string[]>
}

describe('★★#1149 HTTP 条件请求缓存（P2）', () => {
  let server: Server
  let base = ''
  const counter: Counter = { hits: new Map(), ifNoneMatch: new Map() }

  const hitCount = (path: string): number => counter.hits.get(path) ?? 0
  const resetCounter = (): void => {
    counter.hits.clear()
    counter.ifNoneMatch.clear()
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      const p = u.pathname
      counter.hits.set(p, (counter.hits.get(p) ?? 0) + 1)
      const inm = req.headers['if-none-match']
      if (typeof inm === 'string') {
        const list = counter.ifNoneMatch.get(p) ?? []
        list.push(inm)
        counter.ifNoneMatch.set(p, list)
      }

      switch (p) {
        // ① / ②：max-age=0 + ETag ⇒ 每次都要校验；带 if-none-match 时回 304
        case '/etag': {
          if (inm === '"v1"') {
            res.writeHead(304, { ETag: '"v1"', 'Cache-Control': 'max-age=0' })
            res.end()
            return
          }
          res.writeHead(200, { ETag: '"v1"', 'Cache-Control': 'max-age=0', 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ v: 1, path: p }))
          return
        }
        // 新鲜期足够长：第二次必须命中缓存（服务端不该再收到请求）
        case '/fresh': {
          res.writeHead(200, { ETag: '"fresh-1"', 'Cache-Control': 'max-age=60', 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ v: 'fresh' }))
          return
        }
        // no-store：明确不许缓存
        case '/no-store': {
          res.writeHead(200, { 'Cache-Control': 'no-store', ETag: '"ns"' })
          res.end('no-store-body')
          return
        }
        // 带 Vary：按 Accept-Language 分桶
        case '/vary': {
          res.writeHead(200, {
            'Cache-Control': 'max-age=60',
            Vary: 'Accept-Language',
            ETag: `"lang-${req.headers['accept-language'] ?? 'none'}"`,
            'Content-Type': 'text/plain',
          })
          res.end(`lang=${req.headers['accept-language'] ?? 'none'}`)
          return
        }
        // Last-Modified 校验器（无 ETag）
        case '/last-modified': {
          const lastMod = 'Wed, 21 Oct 2015 07:28:00 GMT'
          if (req.headers['if-modified-since'] === lastMod) {
            res.writeHead(304, { 'Last-Modified': lastMod, 'Cache-Control': 'max-age=0' })
            res.end()
            return
          }
          res.writeHead(200, { 'Last-Modified': lastMod, 'Cache-Control': 'max-age=0', 'Content-Type': 'text/plain' })
          res.end('lm-body')
          return
        }
        // 5xx 不可缓存
        case '/error': {
          res.writeHead(500, { 'Cache-Control': 'max-age=60', ETag: '"err"' })
          res.end('boom')
          return
        }
        // POST 可响应但不可缓存
        case '/post': {
          res.writeHead(200, { 'Cache-Control': 'max-age=60', 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ method: req.method }))
          return
        }
        default: {
          res.writeHead(404)
          res.end('nope')
        }
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  it('① 首次回源写缓存；新鲜期内第二次**不发请求**（服务端计数证明）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const r1 = await p.fetch<{ v: string }>(`${base}/fresh`)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.data.v).toBe('fresh')
      expect((r1 as { meta?: { cache?: { status?: string; stored?: boolean } } }).meta?.cache?.status).toBe('miss')
      expect((r1 as { meta?: { cache?: { stored?: boolean } } }).meta?.cache?.stored).toBe(true)
    }
    const r2 = await p.fetch<{ v: string }>(`${base}/fresh`)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.v).toBe('fresh')
    expect((r2 as { meta?: { cache?: { status?: string; ageMs?: number } } }).meta?.cache?.status).toBe('hit')
    // ★核心：服务端只应该收到 1 次（第二次真的没发）
    expect(hitCount('/fresh'), '★第二次仍然打了服务器（缓存没生效）').toBe(1)
  })

  it('★★过期后带 If-None-Match 回源；304 ⇒ 业务仍拿到缓存体且 status=200', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const r1 = await p.fetch<{ v: number }>(`${base}/etag`)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data.v).toBe(1)

    const r2 = await p.fetch<{ v: number }>(`${base}/etag`)
    expect(r2.ok, '★304 未被合成成功响应（业务会看到 304 空体）').toBe(true)
    if (r2.ok) {
      expect(r2.status, '★304 直接泄漏给业务（应为 200 + 缓存体）').toBe(200)
      expect(r2.data.v, '★304 分支没有用缓存体').toBe(1)
    }
    const meta = (r2 as { meta?: { cache?: { status?: string } } }).meta
    expect(meta?.cache?.status).toBe('revalidated')
    // ★服务端确实收到了条件请求头（这是"真的在校验"的硬证据）
    expect(counter.ifNoneMatch.get('/etag'), '★没发 If-None-Match（无法 304 复用）').toEqual(['"v1"'])
    expect(hitCount('/etag')).toBe(2)
  })

  it('★Last-Modified 也能做校验（无 ETag 的服务端）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const r1 = await p.fetch(`${base}/last-modified`, { responseType: 'text' })
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data).toBe('lm-body')
    const r2 = await p.fetch(`${base}/last-modified`, { responseType: 'text' })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.data).toBe('lm-body')
      expect(r2.status).toBe(200)
    }
    expect((r2 as { meta?: { cache?: { status?: string } } }).meta?.cache?.status).toBe('revalidated')
  })

  it('② `Cache-Control: no-store` ⇒ 不写缓存（第二次照样回源）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    await p.fetch(`${base}/no-store`, { responseType: 'text' })
    await p.fetch(`${base}/no-store`, { responseType: 'text' })
    expect(hitCount('/no-store'), '★no-store 的响应被缓存了').toBe(2)
  })

  it('③ `cache:reload` 即使新鲜也回源；`cache:no-cache` 带校验器回源', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    await p.fetch(`${base}/fresh`)
    expect(hitCount('/fresh')).toBe(1)
    const r = await p.fetch(`${base}/fresh`, { cache: 'reload' })
    expect((r as { meta?: { cache?: { status?: string } } }).meta?.cache?.status).not.toBe('hit')
    expect(hitCount('/fresh'), '★reload 没有回源').toBe(2)

    await p.fetch(`${base}/etag`)
    const before = hitCount('/etag')
    await p.fetch(`${base}/etag`, { cache: 'no-cache' })
    expect(hitCount('/etag')).toBe(before + 1)
  })

  it('★★`only-if-cached` 落空 ⇒ fetch.cacheMiss 且**服务端零请求**', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const r = await p.fetch(`${base}/etag?never=1`, { cache: 'only-if-cached' })
    expect(r.ok, '★only-if-cached 落空却成功了（伪造了空响应）').toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.cacheMiss')
    expect(hitCount('/etag'), '★only-if-cached 仍然打了网络').toBe(0)
    // `only-if-cached` 命中时正常返回
    await p.fetch(`${base}/fresh`)
    const hit = await p.fetch(`${base}/fresh`, { cache: 'only-if-cached' })
    expect(hit.ok).toBe(true)
  })

  it('④ `Vary` 分桶：同 URL 不同 Accept-Language 不互相命中', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const en = await p.fetch(`${base}/vary`, { responseType: 'text', headers: { 'Accept-Language': 'en' } })
    const zh = await p.fetch(`${base}/vary`, { responseType: 'text', headers: { 'Accept-Language': 'zh' } })
    expect(en.ok && en.data).toBe('lang=en')
    expect(zh.ok && zh.data, '★Vary 没分桶：中文请求命中了英文缓存').toBe('lang=zh')
    expect(hitCount('/vary')).toBe(2)
    // 再来一次应当命中各自桶（服务端计数不变）
    const en2 = await p.fetch(`${base}/vary`, { responseType: 'text', headers: { 'Accept-Language': 'en' } })
    expect(en2.ok && en2.data).toBe('lang=en')
    expect(hitCount('/vary')).toBe(2)
  })

  it('⑤ 非 GET（POST）不进缓存', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    await p.fetch(`${base}/post`, { method: 'POST', data: { a: 1 } })
    await p.fetch(`${base}/post`, { method: 'POST', data: { a: 1 } })
    expect(hitCount('/post')).toBe(2)
    const meta = (await p.fetch(`${base}/post`, { method: 'POST', data: { a: 1 } }) as { meta?: { cache?: { status?: string } } }).meta
    expect(meta?.cache?.status).toBe('bypass')
  })

  it('⑥ 5xx 不缓存（第二次仍然回源）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    await p.fetch(`${base}/error`)
    await p.fetch(`${base}/error`)
    expect(hitCount('/error')).toBe(2)
  })

  it('★管线未开缓存 ⇒ 零回归：meta.cache 不出现，每次请求都发', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, {})
    const r1 = await p.fetch(`${base}/fresh`)
    const r2 = await p.fetch(`${base}/fresh`)
    expect((r1 as { meta?: Record<string, unknown> }).meta).not.toHaveProperty('cache')
    expect((r2 as { meta?: Record<string, unknown> }).meta).not.toHaveProperty('cache')
    expect(hitCount('/fresh'), '★没开缓存却在去重/缓存（改变了既有行为）').toBe(2)
  })

  it('★带 Authorization 的响应默认不入共享缓存（RFC 7234 保守口径）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true })
    const cfg = { headers: { Authorization: 'Bearer T' }, responseType: 'text' as const }
    await p.fetch(`${base}/fresh`, cfg)
    await p.fetch(`${base}/fresh`, cfg)
    // /fresh 没有 public/must-revalidate/s-maxage ⇒ 不许存（两次都回源）
    expect(hitCount('/fresh')).toBe(2)
    // 但显式 public 时允许（这里复用 no-store 之外的一条：用 max-age 的 /vary? 不含 public）
    // ⇒ 只断言"没存"，不虚构"存了"的用例（服务端没有 public 端点）
  })

  it('★内存 store：LRU 按字节预算淘汰最久未用（不按插入序）', () => {
    let clock = 1000
    const store = createMemoryFetchCache({ maxBytes: 100, maxEntries: 2, now: () => clock })
    const mk = (key: string, size: number) => ({
      key,
      status: 200,
      headers: {},
      body: { kind: 'text' as const, text: 'x'.repeat(size / 2) },
      json: false,
      storedAt: clock,
      lifetimeMs: 60000,
      mustRevalidate: false,
      varyNames: [],
      varyValues: {},
      lastUsed: clock,
      bytes: 0,
    })
    store.put(mk('a', 40))
    clock += 10
    store.put(mk('b', 40))
    clock += 10
    // 访问 a ⇒ a 变成最近使用（b 变成最久未用）
    expect(store.match('a', {}, clock)).toBeTruthy()
    clock += 10
    store.put(mk('c', 40)) // 40+40+40=120 > 100 ⇒ 淘汰最久未用（b）
    expect(store.match('b', {}, clock), '★淘汰了最近使用的条目（不是 LRU）').toBeUndefined()
    expect(store.match('a', {}, clock)).toBeTruthy()
    expect(store.stats().bytes).toBeLessThanOrEqual(100)
  })

  it('★`parseCacheControl` / `isFresh` / `fetchCacheKey` 的语义单测', () => {
    const cc = parseCacheControl({ 'Cache-Control': 'public, max-age=60, must-revalidate' })
    expect(cc.maxAgeMs).toBe(60000)
    expect(cc.isPublic).toBe(true)
    expect(cc.mustRevalidate).toBe(true)
    expect(parseCacheControl({ 'cache-control': 'no-store' }).noStore).toBe(true)
    expect(parseCacheControl({ 'Cache-Control': 'max-age="30"' }).maxAgeMs).toBe(30000)
    expect(parseCacheControl(undefined).maxAgeMs).toBeUndefined()

    const entry = {
      key: 'k', status: 200, headers: { 'Cache-Control': 'max-age=1' },
      body: { kind: 'text' as const, text: 'x' }, json: false, storedAt: 0, lifetimeMs: 1000,
      mustRevalidate: false, varyNames: [], varyValues: {}, lastUsed: 0, bytes: 1,
    }
    expect(isFresh(entry, 500)).toBe(true)
    expect(isFresh(entry, 1500)).toBe(false)
    expect(isFresh({ ...entry, mustRevalidate: true }, 500), '★must-revalidate 条目被当新鲜直接用了').toBe(false)
    // Age 头计入年龄
    expect(isFresh({ ...entry, headers: { Age: '2' } }, 500)).toBe(false)

    // 键：params 顺序无关、responseType 分开
    const k1 = fetchCacheKey('http://a/x', { params: { b: 2, a: 1 } })
    const k2 = fetchCacheKey('http://a/x', { params: { a: 1, b: 2 } })
    expect(k1).toBe(k2)
    expect(fetchCacheKey('http://a/x', { responseType: 'text' })).not.toBe(fetchCacheKey('http://a/x', { responseType: 'json' }))
  })

  it('★并发去重与缓存不互相干扰（同一时刻两个相同请求只发一次网络）', async () => {
    resetCounter()
    const p = createFetchPipeline(realBridge as never, { cache: true, dedupe: true })
    const [a, b] = await Promise.all([p.fetch(`${base}/fresh`), p.fetch(`${base}/fresh`)])
    expect(a.ok && b.ok).toBe(true)
    expect(hitCount('/fresh'), '★去重失效（两个在飞请求各发了一次）').toBe(1)
  })
})
