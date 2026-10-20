// tests/browser-fixture/entry-fetch.ts
// ★★★#1130：**真浏览器 e2e 的页面入口**（esbuild 打包进页面，暴露到 window）。
//
// 【为什么需要这个夹具】
//   `tests/fetch-web-leg-live.test.ts`（#1127）跑的是 **Node 22 的 WHATWG fetch**，
//   浏览器层（CORS / 混合内容 / 真实 AbortSignal 时序）**没验**。
//   要在真浏览器里跑，就得把 **真实的 webBridge** 打进页面——
//   而不是在测试里手搓一个“像浏览器”的桥（那样验的还是测试自己的假设）。
//
// 【暴露什么】`window.__proteusFetchProbe`：与 `useFetch` 走**同一条链**
//   （`createCapabilityHooks(webBridge(window))` → `capability.request` → `webRequest`）。
//   ★刻意不直接调 `webRequest`：要验的是**用户真正走的那条路**（#1122 的教训：
//     "底层验过 ≠ 门面验过"）。
//
// 【诚实边界】打包产物只在 e2e 里用，不进任何发布物。
import { webBridge } from '../../packages/api/src/capability-bridges'
import { createCapabilityHooks } from '../../packages/api/src/capability'

interface ProbeResult {
  ok?: boolean
  status?: number
  headers?: Record<string, string>
  dataKind?: string
  data?: unknown
  dataPreview?: string
  chunks?: number
  seqs?: number[]
  totalBytes?: number
  errorCode?: string
  errorMessage?: string
  elapsedMs?: number
}

declare global {
  interface Window {
    __proteusFetchProbe: (opts: Record<string, unknown>) => Promise<ProbeResult>
    __proteusReady: boolean
  }
}

const hooks = createCapabilityHooks(webBridge(window as never), {})

/**
 * 页面内探针：跑一次 `useFetch` 并返回**结构化读数**（不抛异常，错误走 errorCode）。
 *
 * @param opts.url     目标 URL
 * @param opts.timeout 超时 ms
 * @param opts.raw     是否用 `capability.request`（拿 status/headers 原件）
 * @param opts.chunked 是否挂 onChunk（流式）
 * @param opts.abortAfterMs 若给定：到点后 abort（取消路径）
 * @param opts.arraybuffer 是否要裸字节
 */
window.__proteusFetchProbe = async (opts) => {
  const out: ProbeResult = {}
  const t0 = Date.now()
  const ctl = opts.abortAfterMs ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined
  if (ctl && typeof opts.abortAfterMs === 'number') {
    timer = setTimeout(() => ctl.abort(), opts.abortAfterMs)
  }
  const seqs: number[] = []
  let totalBytes = 0
  const config: Record<string, unknown> = {}
  if (opts.timeout !== undefined) config.timeout = opts.timeout
  if (ctl) config.signal = ctl.signal
  if (opts.arraybuffer) config.responseType = 'arraybuffer'
  if (opts.chunked) {
    config.onChunk = (chunk: Uint8Array, seq: number) => {
      seqs.push(seq)
      totalBytes += chunk.length
    }
  }
  try {
    // ★走**门面**（useFetch），与业务同一条链
    const r = (await hooks.useFetch(String(opts.url), config as never)) as {
      ok?: boolean
      data?: unknown
      status?: number
      headers?: Record<string, string>
      error?: { code?: string; message?: string }
    }
    if (r.ok) {
      out.ok = true
      out.status = r.status
      out.headers = r.headers
      out.dataKind = r.data instanceof Uint8Array ? 'uint8array' : typeof r.data
      if (r.data instanceof Uint8Array) {
        out.dataPreview = Array.from(r.data.slice(0, 8)).join(',')
      } else if (typeof r.data === 'string') {
        out.dataPreview = r.data.slice(0, 120)
      } else if (r.data === undefined) {
        // ★流式模式下 `data` 是 undefined（字节已由 onChunk 交付）——夹具不能对它 slice
        out.dataPreview = '(undefined — 流式模式)'
      } else {
        out.dataPreview = JSON.stringify(r.data)?.slice(0, 120) ?? String(r.data)
      }
    } else {
      out.ok = false
      out.errorCode = r.error?.code
      out.errorMessage = r.error?.message
    }
    out.chunks = seqs.length
    out.seqs = seqs
    out.totalBytes = totalBytes
  } catch (e) {
    out.ok = false
    out.errorCode = 'THREW'
    out.errorMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    out.elapsedMs = Date.now() - t0
  }
  return out
}

window.__proteusReady = true
