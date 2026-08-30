// packages/api/src/index.ts —— @proteus-vue/api 公共入口（api-plan A1/A8 + B3 auth）
export { createApi, ALL_METHODS, createRequestAdapter } from './client'
export type { ApiClient } from './client'
export { ApiError, buildUrl, getDeviceInfo } from './adapters'
export type { DeviceInfo } from './adapters'
export { createAuth } from './auth'
export type { AuthManager, AuthStorage } from './auth'
export type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse, ApiOptions } from './types'
