// packages/api/src/client.ts
// ★api-plan A1：createApi——统一请求客户端（拦截器 + 重试 + 快捷方法 + 错误模型）
//
// ★★★#1342 C2（2026-10-28）：**收口到请求库**
//
// 【为什么改（用户「请求库这层就是针对当前主流请求库痛点提供我们自己的答案」）】
//   本仓曾经有**三套并行请求栈**：`createApi`（本文件）· `useFetch` + pipeline ·
//   `createRequestEngineering`。同一 App 换个入口，配额/缓存/重试/trace 各算各的
//   —— 这是"两套缓存命中解释""两套重试语义"的实际病根（决策 #1342 §痛点 8/9）。
//   ⇒ 现在 `createApi` **内部委托** `createRequestClient`（请求库），自己只保留：
//     ① 公有 API 形状（`get/post/...` + `RequestConfig` + `RequestResponse`）
//     ② **抛出式错误模型**（`ApiError`）——这是本入口的历史契约，G-58.4「API 只增不改」要求保留
//     ③ 独有的 `IRequestAdapter` 注入（wx/web 两套原生腿）
//
// 【诚实的语义变化（业务能感知到的，必须记）】
//   · 重试策略更严格：**非幂等请求默认不重试**（此前 `retry: 3` 会把 POST 下单重复发）。
//     要恢复旧行为 ⇒ 传 `retryNonIdempotent: true` 或给 `idempotencyKey`。
//   · 超时结果的错误码变了：以前是 `ApiError('TIMEOUT')`，现在适配器腿的超时会先被判成
//     `unknown` 态，再被翻回 `ApiError('TIMEOUT')`（**对外 code 不变**，但内部有了三态）。
//   · `RETRY_FAILED` 语义保留：重试耗尽仍抛它。
import type { ApiOptions, ApiTraceBus, HttpMethod, IRequestAdapter, RequestConfig, RequestResponse } from './types'
import { ApiError } from './types'
import { createRequestAdapter, ALL_METHODS } from './adapters'
import { adapterToHooks, createRequestClient } from './request/client'
import type { RequestClient, RequestOptions, RequestRetryPolicy } from './request/types'

export interface ApiClient {
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
  get<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  post<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  put<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  patch<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  /**
   * ★#1342 C2 新增：直接拿到底层请求库（要三态/租户/审计/任务句柄时用它）。
   *   `request/get/post/...` 保持旧契约（抛 `ApiError`）；`library` 是新契约（不抛 + 三态）。
   */
  readonly library: RequestClient
}

/** `RequestConfig` → 请求库 `RequestOptions`（只搬能力字段；策略字段由库自己管） */
function toRequestOptions(config: RequestConfig): RequestOptions {
  return {
    method: config.method,
    headers: config.headers,
    data: config.data,
    params: config.params,
    timeout: config.timeout,
    responseType: config.responseType,
    savePath: config.savePath,
    onChunk: config.onChunk,
    upload: config.upload as RequestOptions['upload'],
    signal: config.signal as RequestOptions['signal'],
    redirect: config.redirect,
    maxRedirects: config.maxRedirects,
    onRedirect: config.onRedirect as RequestOptions['onRedirect'],
    bypassPlatformCache: config.bypassPlatformCache,
    // ★保留旧的 `skipAuth` 语义（跳过 beforeRequest / 不注入 Authorization）
    skipAuth: config.skipAuth,
    // ★旧 `retry: number` 映射成门面策略（默认**不**允许重试非幂等——见文件头的语义变化说明）
    ...(config.retry !== undefined && config.retry > 0
      ? { retry: { attempts: config.retry, delayMs: config.retryDelay ?? 300 } satisfies RequestRetryPolicy }
      : {}),
  }
}

/**
 * 把请求库的**失败结果**翻成 `ApiError`（★本入口的历史错误模型，G-58.4 只增不改）。
 *
 * 【错误码映射（业务能感知，必须稳定）】
 *   unknown 态        → `TIMEOUT`（历史契约；细节看 `err.outcome`）
 *   建连/网络失败      → `NETWORK_ERROR`
 *   取消              → `ABORT`
 *   白名单拒绝         → `FORBIDDEN`（新增码，旧业务不会命中）
 *   断路器打开         → `CIRCUIT_OPEN`（新增码，旧业务不会命中）
 *   其它（含 4xx/5xx） → `HTTP`
 */
function buildError(
  r: Extract<Awaited<ReturnType<RequestClient['request']>>, { ok: false }>,
  config: RequestConfig,
): ApiError {
  const code =
    r.outcome === 'unknown'
      ? 'TIMEOUT'
      : r.error.code === 'network.unreachable' || r.error.code === 'network.connectFailed'
        ? 'NETWORK_ERROR'
        : r.error.code === 'fetch.aborted'
          ? 'ABORT'
          : r.error.code === 'request.forbidden'
            ? 'FORBIDDEN'
            : r.error.code === 'request.circuitOpen'
              ? 'CIRCUIT_OPEN'
              : 'HTTP'
  const err = new ApiError(code, r.error.message, r.status, config)
  // ★把三态与 meta 挂到错误上：旧业务不受影响，需要区分"未知态"的业务可以读
  ;(err as unknown as { outcome?: string }).outcome = r.outcome
  ;(err as unknown as { meta?: unknown }).meta = r.meta
  return err
}

/** 创建 API 客户端（业务入口：const api = createApi({ baseURL })） */
export function createApi(options: ApiOptions = {}): ApiClient {
  const adapter = options.adapter ?? createRequestAdapter()
  const bus: ApiTraceBus | undefined = options.traceBus

  // ★拦截器：`beforeRequest` 只有"一个"（本入口的历史形状），在 capability 的洋葱链之外
  //   —— 用请求库的 trace 钩子做不到"改 config"，所以保留在调用前应用。
  async function applyBeforeRequest(config: RequestConfig): Promise<RequestConfig> {
    if (!config.skipAuth && options.beforeRequest) return options.beforeRequest(config)
    return config
  }

  // ★适配器腿：`IRequestAdapter.request` 会抛 `ApiError`，请求库只认 `FetchResult` ⇒ 翻译一次
  const hooks = adapterToHooks((cfg) =>
    adapter.request({
      ...cfg,
      method: cfg.method as HttpMethod | undefined,
    } as RequestConfig),
  )

  const library = createRequestClient({
    hooks,
    baseURL: options.baseURL,
    headers: options.headers,
    auth: options.auth,
    // ★devtools trace 继续可用（旧 traceBus 协议 → 新 trace 回调）
    trace: bus
      ? (e) => {
          const name = `${e.method} ${e.url}`
          if (e.phase === 'start') bus.emit('api', 'start', name, { url: e.url, method: e.method }, e.requestId)
          else if (e.phase === 'end') bus.emit('api', 'end', name, { status: e.status }, e.requestId)
          else if (e.phase === 'error') bus.emit('api', 'error', name, { message: e.errorCode }, e.requestId)
        }
      : undefined,
  })

  async function request<T>(input: RequestConfig): Promise<RequestResponse<T>> {
    const config = await applyBeforeRequest(input)
    const r = await library.request<T>(config.url, toRequestOptions(config))
    if (!r.ok) {
      // ★旧契约保留：配了 retry 且最终失败 ⇒ 抛 RETRY_FAILED（否则抛映射后的具体码）
      const err = buildError(r, config)
      if (config.retry !== undefined && config.retry > 0) {
        const wrapped = new ApiError('RETRY_FAILED', `${err.message}（重试 ${config.retry} 次失败）`, err.status, config)
        ;(wrapped as unknown as { outcome?: string }).outcome = r.outcome
        ;(wrapped as unknown as { meta?: unknown }).meta = r.meta
        throw wrapped
      }
      throw err
    }
    return { data: r.data as T, status: r.status, headers: r.headers, config }
  }

  const client: ApiClient = {
    request,
    get: (url, config) => request({ url, method: 'GET', ...config }),
    post: (url, data, config) => request({ url, method: 'POST', data, ...config }),
    put: (url, data, config) => request({ url, method: 'PUT', data, ...config }),
    delete: (url, config) => request({ url, method: 'DELETE', ...config }),
    patch: (url, data, config) => request({ url, method: 'PATCH', data, ...config }),
    library,
  }
  return client
}

export { ALL_METHODS, createRequestAdapter }
export type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse, ApiOptions, ApiTraceBus }
export { ApiError }
