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
  /** 自动重试次数 */
  retry?: number
  /** 重试间隔 ms */
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

/** 请求适配器（L2：唯一允许出现平台 API 的位置） */
export interface IRequestAdapter {
  readonly name: 'wx' | 'web' | 'app'
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
}
