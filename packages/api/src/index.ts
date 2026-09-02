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
// ★G-32 B5 续：路由语义化（injectable——E10 useRoute/E11 push/E12 replace/E13 back/E14 switchTab/E15 reLaunch/E16 beforeEach/E17 afterEach）
export { createRouterEngineering } from './router-engineering'
export type { RouterEngineering, RouterEngineeringOptions, RouterLike, RouterTargetOptions, CurrentRoute } from './router-engineering'
// ★G-32 B5 续二：动画语义（injectable——E21 useAnimation/E22 useGestureAnimation/E23 useScrollAnimation；组件形态 E19/E20 在 src/components）
export { createAnimationEngineering, interpolateAnimationProps } from './animation-engineering'
export type { AnimationEngineering, AnimationEngineeringOptions, AnimationDriver, AnimationRun, AnimationController, AnimationDescriptor, AnimationKeyframe, AnimationProps, AnimationState, AnimationStepOptions, GestureAnimationHandle, ScrollAnimationHandle, ScrollAnimationRange } from './animation-engineering'
// ★G-32 B5 续三：工程化语义（injectable——E24 useDevTools/E25 useInspector/E26 usePerformance/E27 defineComponent/E28 defineCapability）
export { createToolingEngineering, defineComponent, defineCapability, resolveCapabilityChain, validateComponentMeta, validateCapabilityContract } from './tooling-engineering'
export type { ToolingEngineering, ToolingEngineeringOptions, DevToolsHandle, DevToolsEvent, UseDevToolsOptions, InspectorHandle, InspectorNode, PerformanceHandle, PerformanceMetricRecord, UsePerformanceOptions, ComponentPropDef, ComponentMeta, CapabilityContract, CapabilityAvailability, CapabilityDefinition, DefineCapabilityOptions } from './tooling-engineering'
// ★G-32 B6 前置：请求数据层语义面（injectable——R1 request 策略请求 / R2 useQuery SWR / R3 enqueue 队列 / R4 dedupe 去重）
export { createRequestEngineering, defaultCacheKey } from './request-engineering'
export type { RequestEngineering, RequestEngineeringOptions, RequestExecutor, RequestCacheEntry, QueryState, QueryHandle, QueryOptions, RequestStrategyOptions } from './request-engineering'
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
  // ★G-32 B3 七期/八期：剩余能力类型（Capability 50/50）
  MapRegion,
  MapContextBridge,
  MapController,
  BackgroundEvent,
  BackgroundAPI,
  SocketTaskBridge,
  SocketTaskHandle,
  DataChannelOptions,
  DataChannelBridge,
  DataChannelHandle,
  CookieJar,
  IAPReceipt,
  MiniProgramNavOptions,
  MiniProgramAPI,
  HostContext,
  LiveRoomOptions,
  LiveRoomBridge,
  LiveRoomHandle,
} from './capability'
