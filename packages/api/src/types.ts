// packages/api/src/types.ts
// ★api-plan A1：网络请求统一契约（业务零平台分支——平台差异收敛在 adapter）
import type { AuthManager } from './auth'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface RequestConfig {
  url: string
  method?: HttpMethod
  /** 来自 createApi({ baseURL }) */
  baseURL?: string
  /** query 参数（→ query string） */
  params?: Record<string, unknown>
  /** body */
  data?: unknown
  headers?: Record<string, string>
  /** ms，默认 15000 */
  timeout?: number
  /** 自动重试次数，默认 0 */
  retry?: number
  /** 重试间隔 ms，默认 300 */
  retryDelay?: number
  /** 跳过 beforeRequest 拦截器（refresh token 防循环） */
  skipAuth?: boolean
}

export interface RequestResponse<T> {
  data: T
  status: number
  headers: Record<string, string>
  config: RequestConfig
}

/** ★透明化错误模型（含状态码 + 配置可定位） */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly config?: RequestConfig,
  ) {
    super(`[proteus-api] ${code}${status !== undefined ? `（HTTP ${status}）` : ''}: ${message}`)
    this.name = 'ApiError'
  }
}

/** 请求适配器（L2：唯一允许出现平台 API 的位置） */
export interface IRequestAdapter {
  readonly name: 'wx' | 'web' | 'app'
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
}

export interface ApiOptions {
  baseURL?: string
  /** 默认请求头 */
  headers?: Record<string, string>
  /** 请求前拦截器（可改 config / 抛错中断；skipAuth 跳过） */
  beforeRequest?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>
  /** 响应后拦截器（可改 response / 抛错） */
  afterResponse?: <T>(response: RequestResponse<T>) => RequestResponse<T> | Promise<RequestResponse<T>>
  /** 是否静默重试（默认 false——重试失败抛 ApiError RETRY_FAILED） */
  adapter?: IRequestAdapter
  /** ★api-plan B3：凭证托管（beforeRequest 后自动加 Authorization；skipAuth 跳过） */
  auth?: AuthManager
}
