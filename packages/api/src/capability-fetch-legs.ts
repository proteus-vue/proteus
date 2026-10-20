// packages/api/src/capability-fetch-legs.ts
// ★★★#1122：**Web / MP 的 fetch 腿**（从 `capability-bridges.ts` 抽出）。
//
// 【为什么单列】本轮把两条腿都从"只传 url/method/data"升级成"接上平台真实能力"，
//   各涨了几十行 ⇒ `capability-bridges.ts`（3990 行）超棘轮。更重要的是：
//   这两条腿是**同一件事的两个平台实现**（`useFetch` 的 Web/MP 后端），
//   放在一起才看得出"哪些能力是平台真有、哪些是真做不到"。
//
// 【★两端能力矩阵（如实标注，不假装一致）】
//   | 能力 | Web（fetch） | MP（wx.request） |
//   |---|---|---|
//   | timeout | ✅ AbortController 实现 | ✅ wx.request 原生支持 |
//   | signal（取消） | ✅ 原生 AbortSignal | ❌ unsupported |
//   | responseType | ✅ text/json/arraybuffer | ✅ text/arraybuffer |
//   | onChunk（流式） | ✅ ReadableStream | ❌ unsupported |
//   | savePath（落盘） | ❌ unsupported | ❌ unsupported |
//   | upload（流式上传） | ❌ unsupported | ❌ unsupported |

import type { RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'

/**
 * `params` → query 拼接（**两条腿共用这一份**）。
 *
 * ★★★#1130 真容器抓出的教训：此前这份逻辑只活在 `capability-bridges.ts` 的私有
 *   `encodedUrl` 里、由 Web 腿使用，**MP 腿整段丢弃了 `params`**（useFetch 传参在 MP 静默无效）。
 *   ⇒ 归属移到 fetch 腿模块并导出：① 两条腿不可能再分叉；② 判据能 import **真实现**
 *     而不是复制一份（假 wx 测试曾把 ctx.encodedUrl 桩成恒等函数 ⇒ 这个缺陷测不出来）。
 */
export function encodedFetchUrl(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&')
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** 错误构造器（由调用方注入 —— `capability-bridges.ts` 有自己的 CapError）。 */
export interface FetchLegCtx {
  CapError: new (code: string, message: string, cause?: unknown) => Error
  /** query 拼接到 URL；**缺省用 `encodedFetchUrl`**（想替换才传——两条腿必须同一份语义） */
  encodedUrl?: (url: string, params?: Record<string, unknown>) => string
}

/** 取本条腿要用的 URL 拼接器（注入优先，缺省共用实现）。 */
function urlJoiner(ctx: FetchLegCtx): (url: string, params?: Record<string, unknown>) => string {
  return ctx.encodedUrl ?? encodedFetchUrl
}

/** Web 腿依赖的最小全局面。 */
interface WebGlobals {
  fetch?: typeof fetch
  AbortController?: typeof AbortController
}

/**
 * **Web 腿**：用平台原生 `fetch`，并把 timeout / 取消 / responseType / 流式全部接上。
 */
export function webRequest(ctx: FetchLegCtx, g: WebGlobals, config: RequestConfig): Promise<RequestResponse<unknown>> {
  return (async () => {
    if (typeof g.fetch !== 'function') throw new ctx.CapError('fetch.unsupported', 'fetch 不支持（Node<18/SSR）')
    // ★App 专属语义：Web 明确拒绝（静默忽略比报错更糟——业务以为在落盘，实际整包回来）
    if (config.savePath) {
      throw new ctx.CapError('fetch.unsupported', 'savePath 是 App 沙箱文件语义——Web 无沙箱落盘，请改用 responseType 自己处理')
    }
    if (config.upload) {
      throw new ctx.CapError('fetch.unsupported', 'upload 是 App 沙箱流式上传语义——Web 请用 FormData + fetch')
    }
    const url = urlJoiner(ctx)(config.url, config.params)
    // ★取消：原生 AbortSignal 直接用（Web 本来就有，不需要 App 那套自实现）
    const ctl = typeof g.AbortController === 'function' ? new g.AbortController() : null
    if (ctl && config.signal) {
      const sig = config.signal as { aborted?: boolean; addEventListener?: (t: string, f: () => void) => void }
      if (sig.aborted) ctl.abort()
      else if (typeof sig.addEventListener === 'function') sig.addEventListener('abort', () => ctl!.abort())
    }
    // ★超时：`fetch` 没有 timeout 选项 ⇒ 用 AbortController 实现
    const timeoutMs = config.timeout ?? 15000
    let timer: ReturnType<typeof setTimeout> | undefined
    if (ctl) timer = setTimeout(() => ctl!.abort(), timeoutMs)
    let resp: Response
    try {
      resp = await g.fetch(url, {
        method: config.method ?? 'GET',
        headers: config.headers as Record<string, string> | undefined,
        body: config.data !== undefined ? JSON.stringify(config.data) : undefined,
        signal: ctl ? ctl.signal : undefined,
      })
    } catch (e) {
      // ★区分"用户取消"与"超时"（对业务意义完全不同：一个不该重试、一个可以）
      if ((e as { name?: string })?.name === 'AbortError') {
        const byUser = (config.signal as { aborted?: boolean } | undefined)?.aborted === true
        throw new ctx.CapError(
          byUser ? 'fetch.aborted' : 'fetch.timeout',
          byUser ? '请求已取消' : `请求超时（${timeoutMs}ms）`,
        )
      }
      throw e
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    const headers: Record<string, string> = {}
    resp.headers.forEach((v, k) => {
      headers[k] = v
    })
    // ★★★#1127 真运行挖出：**响应体读取阶段也会因取消/超时而抛 AbortError**，
    //   而此前 try/catch 只包了 `fetch()` 调用 ⇒ 流式读取时取消，抛的是**原生 DOMException**
    //   （`name === 'AbortError'`，没有 `code`）⇒ 上层 `runFetch` 只能判成 `fetch.failed`，
    //   业务失去"用户取消 vs 网络失败"的区分。
    //   ⇒ 把**体读取**也纳入同一套错误归一（同一个 `isAbort` 判定，不复制逻辑）。
    const abortAware = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') {
          const byUser = (config.signal as { aborted?: boolean } | undefined)?.aborted === true
          throw new ctx.CapError(
            byUser ? 'fetch.aborted' : 'fetch.timeout',
            byUser ? '请求已取消' : `请求超时（${timeoutMs}ms）`,
          )
        }
        throw e
      }
    }

    // ★流式：ReadableStream 逐块推给 onChunk（**拉取式**节奏，与 App 的回推式不同）
    //   ★取局部常量再判：闭包内 TS 会丢掉对 `config.onChunk` 的窄化（TS2722）。
    const onChunk = config.onChunk
    if (onChunk && resp.body && typeof resp.body.getReader === 'function') {
      const reader = resp.body.getReader()
      let seq = 0
      await abortAware(async () => {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.length) onChunk(value instanceof Uint8Array ? value : new Uint8Array(value), seq++)
        }
      })
      // ★流式模式下 `data` 为空（字节已逐块给过；要聚合请自己在 onChunk 里做）
      return { data: undefined, status: resp.status, headers, config }
    }
    if (config.responseType === 'arraybuffer') {
      const buf = await abortAware(() => resp.arrayBuffer())
      return { data: new Uint8Array(buf), status: resp.status, headers, config }
    }
    const text = await abortAware(() => resp.text())
    let data: unknown = text
    if (config.responseType !== 'text') {
      try {
        data = JSON.parse(text)
      } catch {
        /* 非 JSON 原样（与既有行为一致：不猜） */
      }
    }
    return { data, status: resp.status, headers, config }
  })()
}

/** 小程序 `wx.request` 依赖的最小面（只取本文件用到的部分）。 */
export interface WxRequestLike {
  request?: (opts: Record<string, unknown>) => void
}

/**
 * **MP 腿**：`wx.request` 原生支持 `timeout` 与 `responseType`（本轮接上）；
 * 其余 S3 语义**明确拒绝**（该端确实做不到）。
 */
export function mpRequest(
  ctx: FetchLegCtx,
  wx: WxRequestLike,
  config: RequestConfig,
): Promise<RequestResponse<unknown>> {
  return new Promise((resolve, reject) => {
    if (!wx.request) return reject(new ctx.CapError('fetch.unsupported', 'wx.request 缺失'))
    // ★明确拒绝本端做不到的 S3 语义——静默忽略比报错更糟
    if (config.savePath) {
      return reject(new ctx.CapError('fetch.unsupported', 'savePath（沙箱落盘）是 App 专有语义——MP 请用 wx.downloadFile + FileSystemManager'))
    }
    if (config.onChunk) {
      return reject(new ctx.CapError('fetch.unsupported', 'onChunk（流式）是 App/Web 语义——wx.request 无分块推送'))
    }
    if (config.upload) {
      return reject(new ctx.CapError('fetch.unsupported', 'upload（流式上传）是 App 专有语义——MP 请用 wx.uploadFile'))
    }
    if (config.signal) {
      return reject(new ctx.CapError('fetch.unsupported', '取消是 App/Web 语义——wx.request 返回的 RequestTask 才有 abort'))
    }
    wx.request({
      // ★★★#1130 真容器抓出：`params` 此前**整段丢弃**（只有 Web 腿用了 `encodedUrl`）——
      //   useFetch 传 `{ params }` 在 MP 端静默无效（服务端收到的 query 是空的）。
      //   假 wx 测不出来（它不复原 URL 语义），真容器回显 query 才暴露。
      url: urlJoiner(ctx)(config.url, config.params),
      method: config.method,
      data: config.data,
      header: config.headers,
      // ★`timeout` 此前被丢弃（wx.request 支持它）
      timeout: config.timeout,
      // ★`responseType` 映射（wx 只认 text/arraybuffer）
      responseType: config.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      success: (r: unknown) => {
        const rr = r as { data?: unknown; statusCode?: number; header?: Record<string, string> }
        resolve({ data: rr.data, status: rr.statusCode ?? 0, headers: rr.header ?? {}, config })
      },
      fail: (e: unknown) => {
        // ★超时与普通失败分开（业务要能判断"重试有用"）
        const msg = String((e as { errMsg?: string })?.errMsg ?? '')
        const isTimeout = /timeout/i.test(msg)
        reject(new ctx.CapError(isTimeout ? 'fetch.timeout' : 'fetch.failed', isTimeout ? '请求超时' : 'wx.request 失败', e))
      },
    })
  })
}
