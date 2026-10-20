// tests/fetch-web-leg-live.test.ts
// ★★★#1127：**Web fetch 腿的真实运行**判据（#1122 诚实边界②的最后一块）
//
// 【为什么静态判据不够】
//   #1122 给 Web/MP 两条腿补了 timeout / 取消 / arraybuffer / 流式，但只有**源码文本断言**
//   （"里面有 `g.AbortController`"、"里面有 `getReader`"）。文本在 ≠ 逻辑对：
//     · `setTimeout(() => ctl.abort(), ms)` 写反了（比如忘了 clearTimeout）文本也一样存在；
//     · 三元里 `byUser ? 'fetch.aborted' : 'fetch.timeout'` 判反了，静态断言查不出；
//     · 流式的 `seq` 递增、`done` 终止条件，只有真跑才知道对不对。
//   ⇒ 本文件**起真 HTTP 服务器 + 用 Node 的 WHATWG fetch 真跑 `webRequest`**。
//
// 【★诚实边界（重要，别当成"浏览器已验证"）】
//   跑的是 **Node 22 内置 fetch**（WHATWG 标准实现），不是真浏览器。
//   两者在 fetch/AbortSignal/ReadableStream 的**语义**上一致（都是同一标准），
//   但浏览器还有 CORS / 混合内容 / 缓存策略等 Node 没有的层 —— 那些不在本判据覆盖内。
//   ★要覆盖浏览器层，必须走 `test:e2e:web`（真页面），那是另一条装置。
//
// 【覆盖什么（每条都是真行为）】
//   ① 正常响应：data / status / headers 都对；
//   ② `responseType: 'arraybuffer'`：拿到的是**裸字节**且逐字节正确；
//   ③ **timeout 真的生效**：服务器故意慢响应 ⇒ `fetch.timeout`（不是 failed、不是挂住）；
//   ④ **取消真的生效**：abort 之后 ⇒ `fetch.aborted`，且**能在服务端观测到连接被掐断**；
//   ⑤ **流式真的逐块**：大响应被切成多块，seq 连续、总字节正确；
//   ⑥ `savePath` / `upload` 明确 unsupported（不静默忽略）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { webRequest } from '../packages/api/src/capability-fetch-legs'

/** 与真实 `CapError` 形状一致的最小错误类（webRequest 通过注入拿它）。 */
class TestCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}

const ctx = {
  CapError: TestCapError as unknown as new (code: string, message: string, cause?: unknown) => Error,
  encodedUrl: (url: string, params?: Record<string, unknown>) => {
    if (!params || !Object.keys(params).length) return url
    const u = new URL(url)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    return u.toString()
  },
}

/** 被服务端观测到的事件（用于证明"取消真的掐断了连接"）。 */
const serverEvents: Array<{ kind: string; at: number }> = []
let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/hello') {
      const body = Buffer.from(JSON.stringify({ ok: 1, msg: 'hi' }))
      res.writeHead(200, { 'content-type': 'application/json', 'x-trace': 'T-1', 'content-length': String(body.length) })
      res.end(body)
      return
    }
    if (url.pathname === '/blob') {
      const body = Buffer.alloc(4096)
      for (let i = 0; i < body.length; i++) body[i] = i % 256
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
      res.end(body)
      return
    }
    if (url.pathname === '/slow') {
      // ★故意慢：2.5s 后才响应（测试里 timeout 设 300ms）
      const t = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('too late')
      }, 2500)
      req.on('close', () => clearTimeout(t))
      return
    }
    if (url.pathname === '/endless') {
      // ★永不结束的流：每 20ms 推一块，直到客户端断开
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      let i = 0
      const timer = setInterval(() => {
        i++
        res.write(Buffer.alloc(1024, i & 0xff))
      }, 20)
      req.on('close', () => {
        clearInterval(timer)
        // ★这条事件是"客户端真的掐断连接"的**服务端侧证据**
        serverEvents.push({ kind: 'client-aborted', at: Date.now() })
      })
      return
    }
    if (url.pathname === '/big') {
      // 分块推送（不声明 content-length）⇒ 触发 ReadableStream 多块
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      let i = 0
      const pump = (): void => {
        if (i >= 8) { res.end(); return }
        res.write(Buffer.alloc(16 * 1024, i & 0xff))
        i++
        setTimeout(pump, 5)
      }
      pump()
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('★#1127 Web 腿真运行 · 正常路径', () => {
  it('data / status / headers 都对', async () => {
    const r = await webRequest(ctx, { fetch, AbortController }, { url: `${base}/hello` })
    expect(r.status).toBe(200)
    expect(r.headers['x-trace']).toBe('T-1')
    expect(r.data).toEqual({ ok: 1, msg: 'hi' })
  })

  it('★`responseType: arraybuffer` ⇒ 裸字节且逐字节正确（不是文本）', async () => {
    const r = await webRequest(ctx, { fetch, AbortController }, {
      url: `${base}/blob`,
      responseType: 'arraybuffer',
    })
    const bytes = r.data as Uint8Array
    expect(bytes, 'arraybuffer 应回 Uint8Array').toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(4096)
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== i % 256) throw new Error(`字节 ${i} 不符：${bytes[i]} != ${i % 256}`)
    }
  })

  it('`responseType: text` ⇒ data 是原始文本（不尝试 JSON）', async () => {
    const r = await webRequest(ctx, { fetch, AbortController }, { url: `${base}/hello`, responseType: 'text' })
    expect(typeof r.data).toBe('string')
  })
})

describe('★#1127 Web 腿真运行 · timeout 真的生效', () => {
  it('★★慢响应 ⇒ `fetch.timeout`（不是 failed、不是挂住）', async () => {
    const t0 = Date.now()
    await expect(
      webRequest(ctx, { fetch, AbortController }, { url: `${base}/slow`, timeout: 300 }),
    ).rejects.toMatchObject({ code: 'fetch.timeout' })
    const elapsed = Date.now() - t0
    // ★必须在 timeout 附近返回，而不是等服务器 2.5s
    expect(elapsed, `超时未生效（耗时 ${elapsed}ms，服务器要 2500ms）`).toBeLessThan(1500)
  })
})

describe('★#1127 Web 腿真运行 · 取消真的生效', () => {
  it('★★abort ⇒ `fetch.aborted`，且**服务端观测到连接被掐断**', async () => {
    serverEvents.length = 0
    const ctl = new AbortController()
    const p = webRequest(ctx, { fetch, AbortController }, {
      url: `${base}/endless`,
      signal: ctl.signal,
      timeout: 30000,
    })
    // 给流一点时间跑起来，再取消
    await new Promise((r) => setTimeout(r, 120))
    ctl.abort()
    await expect(p).rejects.toMatchObject({ code: 'fetch.aborted' })
    // ★关键：服务端必须观测到 close —— 证明是"真掐断"而不是"JS 侧不管了"
    await new Promise((r) => setTimeout(r, 150))
    expect(
      serverEvents.some((e) => e.kind === 'client-aborted'),
      '★服务端没观测到连接断开 ⇒ 取消只停了 JS 侧，底层连接还在',
    ).toBe(true)
  })

  it('★超时与取消的错误码**可区分**（业务据此决定是否重试）', async () => {
    // 取消
    const ctl = new AbortController()
    ctl.abort()
    await expect(
      webRequest(ctx, { fetch, AbortController }, { url: `${base}/hello`, signal: ctl.signal }),
    ).rejects.toMatchObject({ code: 'fetch.aborted' })
    // 超时
    await expect(
      webRequest(ctx, { fetch, AbortController }, { url: `${base}/slow`, timeout: 200 }),
    ).rejects.toMatchObject({ code: 'fetch.timeout' })
  })
})

describe('★#1127 Web 腿真运行 · 流式真的逐块', () => {
  it('★★onChunk 逐块到达 · seq 连续 · 总字节正确', async () => {
    const seqs: number[] = []
    let total = 0
    const r = await webRequest(ctx, { fetch, AbortController }, {
      url: `${base}/big`,
      onChunk: (chunk, seq) => {
        seqs.push(seq)
        total += chunk.length
      },
    })
    expect(r.status).toBe(200)
    // 服务端推 8 块 × 16 KiB；TCP 可能合并/拆分，但**总字节必须对**
    expect(total).toBe(8 * 16 * 1024)
    // ★seq 必须从 0 起严格连续
    expect(seqs.length, 'onChunk 一次都没被调').toBeGreaterThan(0)
    seqs.forEach((s, i) => expect(s, `seq 不连续：位置 ${i} 是 ${s}`).toBe(i))
    // ★流式模式下 data 为空（字节已由 onChunk 交付）
    expect(r.data, '流式模式不该再回整包 data').toBeUndefined()
  })
})

describe('★#1127 Web 腿真运行 · 做不到的语义明确拒绝', () => {
  it('`savePath` ⇒ unsupported（不静默忽略）', async () => {
    await expect(
      webRequest(ctx, { fetch, AbortController }, { url: `${base}/hello`, savePath: 'download/a' }),
    ).rejects.toMatchObject({ code: 'fetch.unsupported' })
  })

  it('`upload` ⇒ unsupported', async () => {
    await expect(
      webRequest(ctx, { fetch, AbortController }, {
        url: `${base}/hello`,
        upload: { path: 'a', fieldName: 'f', filename: 'a', boundary: 'B' },
      }),
    ).rejects.toMatchObject({ code: 'fetch.unsupported' })
  })

  it('非 2xx 也要正常返回（不抛）——状态码交给业务判断', async () => {
    const r = await webRequest(ctx, { fetch, AbortController }, { url: `${base}/nope` })
    expect(r.status).toBe(404)
  })
})
