// packages/api/src/index.ts —— @proteus/api 公共入口（api-plan A1/A8）
export { createApi, ALL_METHODS, createRequestAdapter } from './client'
export type { ApiClient } from './client'
export { ApiError, buildUrl, getDeviceInfo } from './adapters'
export type { DeviceInfo } from './adapters'
export type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse, ApiOptions } from './types'
