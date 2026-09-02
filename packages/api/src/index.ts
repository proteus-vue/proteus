// packages/api/src/index.ts —— @proteus-vue/api 公共入口（api-plan A1/A8 + B3 auth + B9 PlatformAPI）
export { createApi, ALL_METHODS, createRequestAdapter } from './client'
export type { ApiClient } from './client'
export { ApiError, buildUrl, getDeviceInfo } from './adapters'
export type { DeviceInfo } from './adapters'
export { createAuth } from './auth'
export type { AuthManager, AuthStorage } from './auth'
export { createPlatformAPI } from './platform'
export type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse, ApiOptions } from './types'
export type { PlatformAPI, RouterAPI, StorageAPI, UIAPI } from './types'
// ★G-32 B3：useXxx 能力 Hook 层（无回调/无全局对象/全类型/Result<T>）
export { createCapabilityHooks, createCapabilityBridge, capOk, capErr, CapError } from './capability'
export type { CapResult, CapabilityHooks, CapabilityBridge, CapabilityProbe, Coords, NetworkType, BatteryInfo, CapDeviceInfo, ScreenInfo, ShareOptions, PermissionState, OrientationInfo } from './capability'
