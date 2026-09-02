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
export { createCapabilityHooks, createCapabilityBridge, createReactiveStorage, capOk, capErr, CapError } from './capability'
// ★G-32 B5：工程原语（injectable——E1 useState/E2 useComputed/E3 useWatch/E6 useLifecycle/E7 useReady/E9 usePageParam）
export { createEngineering } from './engineering'
export type { Engineering, EngineeringOptions, Reactivity, LifecycleHandle, LifecycleEvent, ParamSource } from './engineering'
export type {
  CapResult,
  CapabilityHooks,
  CapabilityBridge,
  CapabilityProbe,
  CompatStorage,
  ReactiveStorage,
  ReactiveFactory,
  FetchConfig,
  Coords,
  NetworkType,
  BatteryInfo,
  CapDeviceInfo,
  ScreenInfo,
  ShareOptions,
  PermissionState,
  OrientationInfo,
  SensorKind,
  SensorSample,
  PaymentConfig,
  PaymentReceipt,
  LoginResult,
  AuthState,
  BiometricOptions,
  WebSocketConnection,
  UploadOptions,
  UploadResult,
  DownloadOptions,
  DownloadResult,
  ProgressCallback,
  TrackAPI,
  LogLevel,
  Logger,
  FileSystemBridge,
  FSAdapter,
  MessageSubscription,
  Contact,
  CalendarEvent,
  AppLifecycle,
  ArchiveOptions,
  PageLifecycle,
  MediaAccess,
  BluetoothInfo,
  NfcInfo,
  KeyboardInfo,
  KeyboardLifecycle,
} from './capability'
