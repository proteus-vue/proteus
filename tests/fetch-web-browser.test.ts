// tests/fetch-web-browser.test.ts
// ★★★#1130：**真浏览器**（Chromium）里跑 `useFetch` 的 Web 腿 —— #1127 诚实边界②收口
//
// 【与 #1127 的差别（这是本单的全部意义）】
//   `fetch-web-leg-live.test.ts` 跑的是 **Node 22 的 WHATWG fetch**：
//   标准语义对，但**浏览器层没验**——CORS / 真实 AbortSignal 时序 / 真实 ReadableStream 分块。
//   本文件用 **Playwright + Chromium** 加载一个真页面，页面里跑的是
//   **真实 `webBridge`**（esbuild 打包），走 `createCapabilityHooks(webBridge(window)).useFetch`
//   ——即业务真正走的那条链（#1122 的教训：**底层验过 ≠ 门面验过**）。
//
// 【为什么夹具要打包真桥，而不是在页面里手写一个"像浏览器"的桥】
//   手搓的桥验的是**测试自己的假设**，与 #1127 的静态判据是同一类错误（只是换了层）。
//   ⇒ 必须 import 真实的 `capability-bridges.ts`。
//
// 【覆盖（四条，都是 Node 里验不到的）】
//   ① **CORS 真约束**：跨源（不同端口）且服务端不给 `Access-Control-Allow-Origin`
//      ⇒ 浏览器**必须**拒绝，且 `useFetch` 报 `fetch.failed`（不是静默成功）。
//      ★这条 Node 永远测不出（Node 的 fetch 不做 CORS）。
//   ② **同源正常路径**在浏览器里也对（data/status/headers）。
//   ③ **真 AbortSignal**：`abort()` 后浏览器内 `fetch` reject ⇒ 归一成 `fetch.aborted`。
//   ④ **真 ReadableStream 流式**：`onChunk` 逐块、seq 连续、总字节正确。
//
// 【诚实边界】
//   ① 只覆盖 Chromium（Firefox/WebKit 未装，未验）；
//   ② 只验**我们这层的归一逻辑**，不验浏览器自身的 CORS 实现（那是标准，不是我们的代码）；
//   ③ 混合内容（HTTPS 页面请求 HTTP）无法在 localhost 上验（localhost 豁免）⇒ 未覆盖。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface ProbeResult {
  ok?: boolean
  status?: number
  headers?: Record<string, string>
  dataKind?: string
  dataPreview?: string
  chunks?: number
  seqs?: number[]
  totalBytes?: number
  errorCode?: string
  errorMessage?: string
  elapsedMs?: number
}

let browser: Browser
let page: Page
/** 主服务（页面 + 同源 API） */
let server: http.Server
/** 另一个端口的服务：用于造**跨源**（CORS）场景 */
let crossServer: http.Server
let base = ''
let crossBase = ''
let tmpDir = ''

function makeServer(opts: { allowCors?: boolean }): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const cors: Record<string, string> = opts.allowCors ? { 'access-control-allow-origin': '*' } : {}
    if (url.pathname === '/api/hello') {
      const body = Buffer.from(JSON.stringify({ ok: 1, msg: 'hi' }))
      res.writeHead(200, { 'content-type': 'application/json', 'x-trace': 'T-1', ...cors })
      res.end(body)
      return
    }
    if (url.pathname === '/api/blob') {
      const body = Buffer.alloc(2048)
      for (let i = 0; i < body.length; i++) body[i] = i % 256
      res.writeHead(200, { 'content-type': 'application/octet-stream', ...cors })
      res.end(body)
      return
    }
    if (url.pathname === '/api/slow') {
      const t = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain', ...cors })
        res.end('too late')
      }, 3000)
      req.on('close', () => clearTimeout(t))
      return
    }
    if (url.pathname === '/api/endless') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', ...cors })
      let i = 0
      const timer = setInterval(() => { i++; res.write(Buffer.alloc(1024, i & 0xff)) }, 20)
      req.on('close', () => clearInterval(timer))
      return
    }
    if (url.pathname === '/api/big') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', ...cors })
      let i = 0
      const pump = (): void => {
        if (i >= 6) { res.end(); return }
        res.write(Buffer.alloc(16 * 1024, i & 0xff))
        i++
        setTimeout(pump, 5)
      }
      pump()
      return
    }
    // 页面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const js = fs.existsSync(path.join(tmpDir, 'probe.js')) ? fs.readFileSync(path.join(tmpDir, 'probe.js')) : Buffer.from('')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>probe</title>
<script src="/probe.js"></script>`)
      void js
      return
    }
    if (url.pathname === '/probe.js') {
      const p = path.join(tmpDir, 'probe.js')
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('no bundle'); return }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(fs.readFileSync(p))
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
}

beforeAll(async () => {
  // ① 打包**真实 webBridge**（不是手搓的假桥）
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-browser-'))
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'tests/browser-fixture/entry-fetch.ts')],
    bundle: true,
    outfile: path.join(tmpDir, 'probe.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  // ② 两个端口的服务（同源 + 跨源）
  server = makeServer({ allowCors: false })
  crossServer = makeServer({ allowCors: false })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  await new Promise<void>((r) => crossServer.listen(0, '127.0.0.1', () => r()))
  const a1 = server.address()
  const a2 = crossServer.address()
  base = `http://127.0.0.1:${typeof a1 === 'object' && a1 ? a1.port : 0}`
  crossBase = `http://127.0.0.1:${typeof a2 === 'object' && a2 ? a2.port : 0}`

  // ③ 真浏览器
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => (window as unknown as { __proteusReady?: boolean }).__proteusReady === true)
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((r) => server?.close(() => r()))
  await new Promise<void>((r) => crossServer?.close(() => r()))
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** 在页面里跑一次探针。 */
async function probe(opts: Record<string, unknown>): Promise<ProbeResult> {
  return page.evaluate(
    (o) => (window as unknown as { __proteusFetchProbe: (x: Record<string, unknown>) => Promise<ProbeResult> }).__proteusFetchProbe(o),
    opts,
  ) as Promise<ProbeResult>
}

describe('★#1130 真浏览器 · 同源正常路径', () => {
  it('★data / status / headers 都对（走 useFetch 门面）', async () => {
    const r = await probe({ url: `${base}/api/hello` })
    expect(r.ok, `失败：${r.errorCode} ${r.errorMessage}`).toBe(true)
    expect(r.status).toBe(200)
    expect(r.headers?.['x-trace']).toBe('T-1')
    expect(r.dataPreview).toContain('"msg":"hi"')
  })

  it('★responseType: arraybuffer ⇒ 裸字节', async () => {
    const r = await probe({ url: `${base}/api/blob`, arraybuffer: true })
    expect(r.ok).toBe(true)
    expect(r.dataKind, '★浏览器里 arraybuffer 没生效').toBe('uint8array')
    expect(r.dataPreview, '首 8 字节应是 0,1,2,3,4,5,6,7').toBe('0,1,2,3,4,5,6,7')
  })
})

describe('★★#1130 真浏览器 · CORS（Node 里永远测不出的一条）', () => {
  it('★★跨源且服务端不给 CORS 头 ⇒ 浏览器拒绝，useFetch 报 fetch.failed', async () => {
    const r = await probe({ url: `${crossBase}/api/hello` })
    expect(r.ok, '★跨源请求竟然成功了 —— 浏览器 CORS 没生效？').toBe(false)
    expect(r.errorCode, `★错误码应是 fetch.failed，实得 ${r.errorCode}`).toBe('fetch.failed')
    // 浏览器会给出 CORS 相关的错误消息（不同版本措辞不同，只断言非空）
    expect(String(r.errorMessage ?? '').length).toBeGreaterThan(0)
  })

  it('★跨源但服务端给 `access-control-allow-origin: *` ⇒ 允许（对照，证明上一条不是"所有跨源都失败"）', async () => {
    // 起一个允许 CORS 的临时服务（避免污染主 served 目录）
    const okServer = makeServer({ allowCors: true })
    await new Promise<void>((r) => okServer.listen(0, '127.0.0.1', () => r()))
    const a = okServer.address()
    const okBase = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
    try {
      const r = await probe({ url: `${okBase}/api/hello` })
      expect(r.ok, `★允许 CORS 的跨源仍失败：${r.errorCode} ${r.errorMessage}`).toBe(true)
      expect(r.status).toBe(200)
    } finally {
      await new Promise<void>((rr) => okServer.close(() => rr()))
    }
  })
})

describe('★★#1130 真浏览器 · 真 AbortSignal 与真 ReadableStream', () => {
  it('★★abort ⇒ fetch.aborted（真浏览器 AbortSignal 时序）', async () => {
    const r = await probe({ url: `${base}/api/endless`, abortAfterMs: 150, timeout: 30000 })
    expect(r.ok, '★取消后竟然成功返回').toBe(false)
    expect(r.errorCode, `★取消的错误码应是 fetch.aborted，实得 ${r.errorCode}（${r.errorMessage ?? ''}）`).toBe('fetch.aborted')
  })

  it('★timeout ⇒ fetch.timeout（且与 aborted 可区分）', async () => {
    const r = await probe({ url: `${base}/api/slow`, timeout: 300 })
    expect(r.ok).toBe(false)
    expect(r.errorCode, `★超时错误码应是 fetch.timeout，实得 ${r.errorCode}`).toBe('fetch.timeout')
    expect(Number(r.elapsedMs), `★超时未生效（耗时 ${r.elapsedMs}ms，服务器要 3000ms）`).toBeLessThan(1500)
  })

  it('★流式：onChunk 逐块 · seq 连续 · 总字节正确（真 ReadableStream）', async () => {
    const r = await probe({ url: `${base}/api/big`, chunked: true })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(Number(r.totalBytes), `总字节应为 ${6 * 16384}`).toBe(6 * 16 * 1024)
    expect(Number(r.chunks)).toBeGreaterThan(0)
    const seqs = r.seqs ?? []
    seqs.forEach((s, i) => expect(s, `★seq 不连续：位置 ${i} 是 ${s}`).toBe(i))
  })
})
