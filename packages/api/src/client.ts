// packages/api/src/client.ts
// ★api-plan A1：createApi——统一请求客户端（拦截器 + 重试 + 快捷方法 + 错误模型）
import type { ApiOptions, HttpMethod, IRequestAdapter, RequestConfig, RequestResponse } from './types'
import { ApiError } from './types'
import { createRequestAdapter, ALL_METHODS } from './adapters'

export interface ApiClient {
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
  get<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  post<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  put<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
  patch<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<RequestResponse<T>>
}

/** 创建 API 客户端（业务入口：const api = createApi({ baseURL })） */
export function createApi(options: ApiOptions = {}): ApiClient {
  const adapter = options.adapter ?? createRequestAdapter()

  async function request<T>(input: RequestConfig): Promise<RequestResponse<T>> {
    const merged: RequestConfig = {
      ...input,
      baseURL: input.baseURL ?? options.baseURL,
      headers: { ...(options.headers ?? {}), ...(input.headers ?? {}) },
      method: input.method ?? 'GET',
      timeout: input.timeout ?? 15000,
      retry: input.retry ?? 0,
      retryDelay: input.retryDelay ?? 300,
    }
    // ★拦截器（skipAuth 跳过 beforeRequest——refresh token 防循环）
    let config = merged
    if (!config.skipAuth && options.beforeRequest) {
      config = await options.beforeRequest(config)
    }
    const attempt = async (n: number): Promise<RequestResponse<T>> => {
      try {
        let response = await adapter.request<T>(config)
        if (options.afterResponse) response = await options.afterResponse<T>(response)
        return response
      } catch (err) {
        if (n < (config.retry ?? 0)) {
          await new Promise((r) => setTimeout(r, (config.retryDelay ?? 300) * (n + 1)))
          return attempt(n + 1)
        }
        throw err
      }
    }
    try {
      return await attempt(0)
    } catch (err) {
      // 重试耗尽：包装为可定位错误（保留原始 code）
      if (err instanceof ApiError && (config.retry ?? 0) > 0) {
        throw new ApiError('RETRY_FAILED', `${err.message}（重试 ${config.retry} 次失败）`, err.status, config)
      }
      throw err
    }
  }

  const client: ApiClient = {
    request,
    get: (url, config) => request({ url, method: 'GET', ...config }),
    post: (url, data, config) => request({ url, method: 'POST', data, ...config }),
    put: (url, data, config) => request({ url, method: 'PUT', data, ...config }),
    delete: (url, config) => request({ url, method: 'DELETE', ...config }),
    patch: (url, data, config) => request({ url, method: 'PATCH', data, ...config }),
  }
  return client
}

export { ALL_METHODS, createRequestAdapter }
export type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse, ApiOptions }
export { ApiError }
