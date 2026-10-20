// tests/fetch-redirect.test.ts
// ★★★决策 #1134：**重定向控制**的判据（follow / manual / error / onRedirect / 限额 / 跨域剥离凭据）。
//
// 【为什么这层必须有判据（不是"接了原钩子就行"）】
//   重定向是**框架看不见的跳转**，接错了不会报错，只会**静默地把凭据送到第三方域**——
//   这正是 open-redirect 攻击的形态：API 返回 302 到攻击者域，宿主带着 Authorization 跟过去，
//   业务侧完全无感（只看到最终响应）。判据必须锁住的是：
//     ① `manual` 真的**不跟随**（拿回 3xx + Location，而不是最终 200）；
//     ② `onRedirect` 每跳都被调、`stop` 真的停（且**不再发下一跳**）；
//     ③ **跨域自动剥离 `Authorization` / `Cookie`**（安全底线，不经业务决策）；
//     ④ 跳数上限真的拦住环（返回 `fetch.tooManyRedirects`，不是静默成功）；
//     ⑤ 方法按 RFC 改写（303 ⇒ GET + 丢 body；307 ⇒ 保持 POST）；
//     ⑥ 没声明拦截时**行为完全不变**（平台跟随，老业务零影响）。
//
// 【装置】起**真 HTTP 服务**（不是假桥）：
//   重定向语义在"真实网络往返"里才成立（Location 解析、跨域判定、方法改写都要经过真请求）。
//   ★与 #1127/#1130 的差别：那边验的是「单次请求的腿」，这边验「跳转链」。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { resolveLocation, isRedirectStatus, methodAfterRedirect, sameOrigin, nextHopConfig } from '../packages/api/src/capability-fetch-redirect'
import type { RedirectDecision, RedirectHop } from '../packages/api/src/capability-fetch-redirect'
import { webRequest } from '../packages/api/src/capability-fetch-legs'

class TCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}

/** 真 HTTP 服务：一组可预测的重定向端点。 */
function makeServer(): Server {
  return http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    const auth = req.headers.authorization ?? ''
    const cookie = req.headers.cookie ?? ''

    // ① 单跳 302 → /final（同源）
    if (u.pathname === '/one') {
      res.writeHead(302, { location: '/final' })
      res.end()
      return
    }
    // ② 两跳：/two → /one → /final
    if (u.pathname === '/two') {
      res.writeHead(301, { location: '/one' })
      res.end()
      return
    }
    // ③ 环：/loop1 → /loop2 → /loop1 …
    if (u.pathname === '/loop1') {
      res.writeHead(302, { location: '/loop2' })
      res.end()
      return
    }
    if (u.pathname === '/loop2') {
      res.writeHead(302, { location: '/loop1' })
      res.end()
      return
    }
    // ④ 跨域：302 → 另一个端口的 /final（验凭据剥离）
    if (u.pathname === '/cross') {
      const other = u.searchParams.get('to') ?? ''
      res.writeHead(302, { location: other })
      res.end()
      return
    }
    // ⑤ 303 语义：POST → /see-other（应改 GET 且不带 body）
    if (u.pathname === '/see-other') {
      res.writeHead(303, { location: '/echo-method' })
      res.end()
      return
    }
    // ⑥ 307 语义：POST → /temp-redirect（应保持 POST + body）
    if (u.pathname === '/temp-redirect') {
      res.writeHead(307, { location: '/echo-method' })
      res.end()
      return
    }
    // ⑦ 回显：方法 / body / 凭据头（判据读它）
    if (u.pathname === '/echo-method') {
      let body = ''
      req.on('data', (c) => (body += String(c)))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'x-probe': 'echo' })
        res.end(JSON.stringify({ method: req.method, body, authorization: auth, cookie }))
      })
      return
    }
    // ⑧ 终点
    if (u.pathname === '/final') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-probe': 'final' })
      res.end(JSON.stringify({ ok: true, authorization: auth, cookie }))
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
}

const ctx = { CapError: TCapError as unknown as new (code: string, message: string, cause?: unknown) => Error }
/** 用**真实 web 腿**做桥（Node 22 的 WHATWG fetch；重定向语义与浏览器一致）。 */
const realBridge = { request: (config: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, config) }

describe('★#1134 重定向 · 纯规则（URL 解析 / RFC 判定）', () => {
  it('★Location 相对解析（App 精简引擎**没有 URL 构造器**，必须自己解析）', () => {
    const base = 'https://api.example.cn/v1/login'
    expect(resolveLocation(base, '/v2/x')).toBe('https://api.example.cn/v2/x')
    expect(resolveLocation(base, 'https://other.cn/x')).toBe('https://other.cn/x')
    expect(resolveLocation(base, '//cdn.cn/a')).toBe('https://cdn.cn/a')
    expect(resolveLocation(base, '?x=1')).toBe('https://api.example.cn/v1/login?x=1')
    expect(resolveLocation(base, '../a/b')).toBe('https://api.example.cn/a/b')
    expect(resolveLocation(base, './c')).toBe('https://api.example.cn/v1/c')
    expect(resolveLocation(base, 'd')).toBe('https://api.example.cn/v1/d')
  })

  it('★缺 Location ⇒ 抛错（不静默拼一个错 URL）', () => {
    expect(() => resolveLocation('https://a.cn/x', '')).toThrow(/缺少 Location/)
  })

  it('★3xx 判定：304 Not Modified **不算**重定向（缓存语义，不该跳）', () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirectStatus(s), `status ${s}`).toBe(true)
    for (const s of [200, 204, 300, 304, 400, 500]) expect(isRedirectStatus(s), `status ${s}`).toBe(false)
  })

  it('★方法改写按 RFC 9110 + 浏览器惯例', () => {
    expect(methodAfterRedirect(303, 'POST')).toEqual({ method: 'GET', changed: true })
    expect(methodAfterRedirect(303, 'GET')).toEqual({ method: 'GET', changed: false })
    expect(methodAfterRedirect(302, 'POST')).toEqual({ method: 'GET', changed: true })
    // 301/302 只有 POST 改 GET（PUT/PATCH 保持）
    expect(methodAfterRedirect(302, 'PUT')).toEqual({ method: 'PUT', changed: false })
    // 307/308 显式保持方法与 body
    expect(methodAfterRedirect(307, 'POST')).toEqual({ method: 'POST', changed: false })
    expect(methodAfterRedirect(308, 'PUT')).toEqual({ method: 'PUT', changed: false })
  })

  it('★★跨域判定 + 跨域剥离凭据（open-redirect 的核心防线）', () => {
    expect(sameOrigin('https://a.cn:443/x', 'https://a.cn/y')).toBe(true) // 默认端口归一
    expect(sameOrigin('https://a.cn/x', 'http://a.cn/y')).toBe(false) // 协议不同
    expect(sameOrigin('https://a.cn/x', 'https://b.cn/y')).toBe(false)

    const cfg = { headers: { Authorization: 'Bearer SECRET', Cookie: 'sid=1', 'X-Trace': 'keep-me' } }
    const hop: RedirectHop = { status: 302, from: 'https://a.cn/x', to: 'https://evil.cn/y', methodChanged: false }
    const next = nextHopConfig(cfg, hop, hop.to)
    // ★三个凭据头都必须消失，其它头保留
    expect(next.headers?.Authorization, '★Authorization 被带到第三方域 ⇒ 凭据泄露').toBeUndefined()
    expect(next.headers?.Cookie, '★Cookie 被带到第三方域').toBeUndefined()
    expect(next.headers?.['X-Trace']).toBe('keep-me')
  })

  it('同源跳转**不剥离**凭据（正常业务不该掉登录态）', () => {
    const cfg = { headers: { Authorization: 'Bearer T', Cookie: 'sid=1' } }
    const hop: RedirectHop = { status: 302, from: 'https://a.cn/x', to: 'https://a.cn/y', methodChanged: false }
    const next = nextHopConfig(cfg, hop, hop.to)
    expect(next.headers?.Authorization).toBe('Bearer T')
    expect(next.headers?.Cookie).toBe('sid=1')
  })

  it('★方法改成 GET 时 body 与 upload 必须丢掉（GET 带 body 各端行为不一致）', () => {
    const cfg = { method: 'POST' as const, data: { a: 1 }, headers: {} }
    const hop: RedirectHop = { status: 303, from: 'https://a.cn/x', to: 'https://a.cn/y', methodChanged: true }
    const next = nextHopConfig(cfg, hop, hop.to)
    expect(next.data, '★303 改 GET 后 body 仍在（请求体被发到新地址）').toBeUndefined()
    expect(next.method).toBe('GET')
  })
})

describe('★#1134 重定向 · 真 HTTP 服务（管线行为）', () => {
  let server: Server
  let base = ''
  let otherBase = ''
  let other: Server

  beforeAll(async () => {
    server = makeServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // 第二个服务（不同端口 ⇒ 不同 origin）用于跨域跳转
    other = makeServer()
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()))
    otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (other) await new Promise<void>((r) => other.close(() => r()))
  })

  it('★基线：没声明拦截 ⇒ 平台跟随（老业务零影响）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ ok: boolean }>(`${base}/two`)
    expect(r.ok, `老行为应跟随到终点：${JSON.stringify(r)}`).toBe(true)
    if (r.ok) expect(r.data.ok).toBe(true)
    // ★没声明拦截 ⇒ 不该有 redirects 轨迹（宿主跟完了，框架看不见）
    expect((r as { meta?: { redirects?: unknown } }).meta?.redirects).toBeUndefined()
  })

  it('★★redirect:manual ⇒ **不跟随**，拿回 302 + Location', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch(`${base}/one`, { redirect: 'manual' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status, '★manual 竟然跟到了终点（凭据就会被带过去）').toBe(302)
      const loc = Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'location')?.[1]
      expect(loc).toBe('/final')
    }
  })

  it('★★onRedirect：每跳都被调到，且能拿到 from/to/status', async () => {
    const hops: RedirectHop[] = []
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ ok: boolean }>(`${base}/two`, {
      onRedirect: (h) => {
        hops.push(h)
        return { action: 'follow' }
      },
    })
    expect(r.ok).toBe(true)
    // /two → /one → /final：两次重定向 ⇒ 两次回调
    expect(hops.length, `★跳数应为 2（实得 ${hops.length}：${hops.map((h) => h.status).join(',')}）`).toBe(2)
    expect(hops[0]!.status).toBe(301)
    expect(hops[0]!.from).toContain('/two')
    expect(hops[0]!.to).toContain('/one')
  })

  it('★★onRedirect 返回 stop ⇒ 立即失败且**不再发下一跳**', async () => {
    let calls = 0
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch(`${base}/two`, {
      onRedirect: (): RedirectDecision => {
        calls++
        return { action: 'stop', reason: '策略不许跳' }
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('fetch.redirectStopped')
      expect(r.error.message).toContain('策略不许跳')
    }
    expect(calls, '★stop 后仍继续调 onRedirect').toBe(1)
    const meta = (r as { meta?: { redirects?: { stopped: boolean; hops: RedirectHop[] } } }).meta
    expect(meta?.redirects?.stopped).toBe(true)
    // stop 发生在**记入 hop 之前**⇒ trace 里可能没有该跳，但 stopped 必须为真
    expect(meta?.redirects?.hops.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('★★跳数上限真的拦住环（返回 tooManyRedirects，不静默成功）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch(`${base}/loop1`, {
      onRedirect: () => ({ action: 'follow' }),
      maxRedirects: 3,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.tooManyRedirects')
    const meta = (r as { meta?: { redirects?: { exceeded: boolean; hops: RedirectHop[] } } }).meta
    expect(meta?.redirects?.exceeded).toBe(true)
    expect(meta?.redirects?.hops.length).toBe(4) // 3 跳允许 + 第 4 跳触发超限
  })

  it('★★跨域跳转时 **Authorization 不被带过去**', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ authorization: string }>(
      `${base}/cross?to=${encodeURIComponent(`${otherBase}/final`)}`,
      {
        headers: { Authorization: 'Bearer SECRET', 'X-Trace': 'T1' },
        onRedirect: () => ({ action: 'follow' }),
      },
    )
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (r.ok) {
      expect(r.data.authorization, '★Authorization 跨域泄露到第三方域').toBe('')
    }
  })

  it('★同源跳转保留 Authorization（正常业务不该掉登录态）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ authorization: string }>(`${base}/one`, {
      headers: { Authorization: 'Bearer KEEP' },
      onRedirect: () => ({ action: 'follow' }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.authorization).toBe('Bearer KEEP')
  })

  it('★303 ⇒ 改 GET 且 body 丢掉', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ method: string; body: string }>(`${base}/see-other`, {
      method: 'POST',
      data: { hello: 'world' },
      onRedirect: () => ({ action: 'follow' }),
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (r.ok) {
      expect(r.data.method, '★303 后仍是 POST').toBe('GET')
      expect(r.data.body, '★303 改 GET 后 body 没丢').toBe('')
    }
  })

  it('★307 ⇒ 保持 POST（且 body 仍在）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch<{ method: string; body: string }>(`${base}/temp-redirect`, {
      method: 'POST',
      data: { hello: 'world' },
      onRedirect: () => ({ action: 'follow' }),
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (r.ok) {
      expect(r.data.method, '★307 后方法被改了（RFC 要求保持）').toBe('POST')
      expect(r.data.body).toContain('hello')
    }
  })
})
