// packages/types/src/api-types.ts
// ★类型收口（10-type-consolidation）：网络请求统一契约（原 @proteus-vue/api/types.ts 纯类型部分）
// runtime 值（ApiError class）留 @proteus-vue/api；ApiOptions（依赖内部 AuthManager）留 @proteus-vue/api

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface RequestConfig {
  url: string
  method?: HttpMethod
  baseURL?: string
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  /** ms，默认 15000 */
  timeout?: number
  /** 自动重试次数（★#1133：策略对象由 fetch 管线消费，**不下传到桥**） */
  retry?: number
  /** 重试间隔 ms */
  retryDelay?: number
  /** 跳过 beforeRequest 拦截器（refresh token 防循环） */
  skipAuth?: boolean
  // ── ★★★#1122：S3 能力字段（此前只在 App 内部 `AppRequestConfig` 里有，桥层看不到 ⇒ 门面传不下来）──
  /** 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节） */
  responseType?: 'text' | 'json' | 'arraybuffer'
  /** ★仅 App：宿主把响应体**直接写进沙箱文件**（JS 不碰字节） */
  savePath?: string
  /** ★App：流式消费（每块回调）；Web：ReadableStream 分块；MP：不支持 */
  onChunk?: (chunk: Uint8Array, seq: number) => void
  /** ★仅 App：宿主自读文件、自拼 multipart、边读边发 */
  upload?: {
    path: string
    fieldName: string
    filename: string
    boundary: string
    formData?: Record<string, string>
  }
  /** 取消信号（兼容原生 `AbortSignal` 与 App 侧 `createAbortController()` 的产物） */
  signal?: { readonly aborted: boolean }
  // ── ★★★#1134：重定向控制（宿主只执行"不跟随"；跟随/拦截策略在 fetch 管线）──
  /**
   * 重定向策略：`follow`（缺省，平台跟随）/ `manual`（不跟随，3xx 原样返回）/ `error`（遇 3xx 失败）。
   * ★MP 端 `wx.request` 隐式跟随且不可关 ⇒ `manual`/`error`/`onRedirect` 一律 `fetch.unsupported`。
   */
  redirect?: 'follow' | 'manual' | 'error'
  /** 最多跟随几跳（缺省 5）。超过 ⇒ `fetch.tooManyRedirects`。 */
  maxRedirects?: number
  /** 逐跳拦截（每遇一次重定向调一次；可拒绝或改写目标）。★跨域时框架自动剥离凭据头。 */
  onRedirect?: (hop: { status: number; from: string; to: string; methodChanged: boolean }) => unknown
  /** 宿主级开关：true ⇒ 宿主不跟随（由管线在 manual / 有 onRedirect 时自动置位）。 */
  redirectManual?: boolean
  /**
   * ★★★#1149：true ⇒ Web 腿对本次请求传 `cache: 'no-store'`，关掉浏览器自带的 HTTP 缓存。
   * 【为什么】框架层缓存启用后，浏览器缓存会抢先回 200（看不到 304）⇒ `meta.cache` 与实际不符。
   * ★App/MP 腿忽略本字段（它们的字节腿本就没有自动缓存）。
   */
  bypassPlatformCache?: boolean
}

export interface RequestResponse<T> {
  data: T
  status: number
  headers: Record<string, string>
  config: RequestConfig
}

/** 请求适配器（L2：唯一允许出现平台 API 的位置） */
export interface IRequestAdapter {
  readonly name: 'wx' | 'web' | 'app'
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
}
