// packages/api/src/types.ts
// ★类型收口（10-type-consolidation）：网络请求契约纯类型已收口到 @proteus/types/api-types
// 本文件保留 re-export + runtime 值（ApiError class）与 ApiOptions（依赖内部 AuthManager）
import type { RequestConfig, RequestResponse, IRequestAdapter } from '@proteus/types/api-types'
import type { AuthManager } from './auth'

export type { HttpMethod, RequestConfig, RequestResponse, IRequestAdapter } from '@proteus/types/api-types'

/** ★透明化错误模型（含状态码 + 配置可定位）——runtime class，留实现包 */
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

export interface ApiOptions {
  baseURL?: string
  headers?: Record<string, string>
  beforeRequest?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>
  afterResponse?: <T>(response: RequestResponse<T>) => RequestResponse<T> | Promise<RequestResponse<T>>
  adapter?: IRequestAdapter
  /** ★api-plan B3：凭证托管（beforeRequest 后自动加 Authorization；skipAuth 跳过） */
  auth?: AuthManager
}
