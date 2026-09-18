// packages/api/src/types.ts
// ★类型收口（10-type-consolidation）：网络请求契约纯类型已收口到 @proteus-vue/types/api-types
// 本文件保留 re-export + runtime 值（ApiError class）与 ApiOptions（依赖内部 AuthManager）
import type { RequestConfig, RequestResponse, IRequestAdapter } from '@proteus-vue/types/api-types'
import type { AuthManager } from './auth'

export type { HttpMethod, RequestConfig, RequestResponse, IRequestAdapter } from '@proteus-vue/types/api-types'
// ★B9：跨端统一契约（类型层在 @proteus-vue/types/platform-api；本包为运行时实现方，re-export 供消费方一处取用）
export type { PlatformAPI, RouterAPI, StorageAPI, UIAPI } from '@proteus-vue/types/platform-api'

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
  /**
   * ★devtools 打通：请求可观测事件总线（结构类型注入，零硬依赖——devtools-runtime createTraceBus 实例直接可传；缺省不发射）。
   * 协议（面板 timeline / network 插件消费）：
   *   start `GET <url>` → end（成功）/ error（重试耗尽）  traceId 每请求自增配对
   */
  traceBus?: ApiTraceBus
}

/** 请求可观测事件总线（结构与 devtools-runtime TraceBus.emit 兼容） */
export interface ApiTraceBus {
  emit(source: 'api', phase: 'start' | 'end' | 'error', name: string, payload?: unknown, traceId?: string): void
}
