// packages/api/src/index.ts —— @proteus-vue/api 公共入口（api-plan A1/A8 + B3 auth + B9 PlatformAPI）
export { createApi, ALL_METHODS, createRequestAdapter } from './client'
export type { ApiTraceBus } from './client'
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
// ★#1133：请求管线（拦截器 / 重试 / 去重 / 并发 / 任务句柄）——超级应用级 `useFetch` 策略层
export { createFetchPipeline } from './capability-fetch-pipeline'
export type {
  FetchPipelineOptions,
  FetchPipelineConfigExt,
  FetchRequestContext,
  FetchTask,
  FetchTaskState,
  RequestInterceptor,
  ResponseInterceptor,
  PipelineBridge,
} from './capability-fetch-pipeline'
// ★★★#1386：去重身份计算（拆出的纯函数；`DEDUPE_IDENTITY_HEADERS` 可被业务审计/扩展）
export { dedupeKey, DEDUPE_IDENTITY_HEADERS } from './capability-fetch-dedupe'
// ★★★#1149：HTTP 条件请求缓存（P2）——store 契约 + 语义函数（业务可注入自定义持久层）
export { createFetchCache, createMemoryFetchCache, parseCacheControl, freshnessLifetimeMs, isFresh, fetchCacheKey } from './capability-fetch-cache'
// ★★★#1151：缓存持久层（L2）——持久化 store + KV/文件后端 + 按端探测（业务只需 `cache: { persist: true }`）
export {
  createPersistentFetchCache,
  createKvFetchCacheStorage,
  createFileFetchCacheStorage,
  utf8DecodeBytes,
  utf8EncodeString,
} from './capability-fetch-cache-persist'
export { choosePersistBackend } from './capability-fetch-cache-runtime'
export type { PersistBackendChoice } from './capability-fetch-cache-runtime'
export type { CachePersistBackend } from './capability-fetch-cache-persist'
export type { FetchCachePersistOptions } from './capability-fetch-cache'
export type {
  FetchCacheMode,
  FetchCacheStatus,
  FetchCacheMeta,
  FetchCacheEntry,
  FetchCacheStore,
  FetchCacheOptions,
} from './capability-fetch-cache'
// ★决策 #1071：能力实例的订阅回收接线（注入式，零 vue 依赖）
export { createSubscriptionScope, installCapabilityDisposeHook } from './capability-hooks-scope'
// ★#1094：能力层边界资源账本（G-43 治理在能力侧的落点）
export { createCapabilityResourceRegistry } from './capability-resources'
export type { CapabilityResource, CapabilityResourceRegistry, CapabilityResourceRegistryOptions, CapabilityOwnershipGraph, ResourceState } from './capability-resources'
export { getSharedCapabilityBridge, resetSharedCapabilityBridge, hasSharedCapabilityBridge } from './capability-bridge-shared'
// ★T-app-fetch（决策 #1064）：能力通道的**诊断读数**（真机判据读它们证明「走字节腿 / 超时形态」）
export { lastInvokeWire, hostCallTimerMode } from './capability-invoke'
// ★★应用与生命周期能力开放（App 宿主腿，2026-09-30）：总线 + 三能力 + 虚拟栈页面事件翻译器
export {
  createHostLifecycleBus,
  getHostLifecycleBus,
  detectAppHost,
  createAppLifecycleCapabilities,
  createStackPageSource,
  HOST_LIFECYCLE_BUS_KEY,
  HOST_ID_KEY,
} from './capability-app'
export type {
  HostLifecycleBus,
  HostLifecycleEvent,
  HostLifecycleTopic,
  HostLifecycleBus as HostLifecycleBusType,
  AppLifecyclePhase,
  PageLifecyclePhase,
  AppLifecycleHandle,
  PageLifecycleHandle,
  BackgroundHandle,
  AppLifecycleCapabilities,
  StackScreenCommandLike,
} from './capability-app'
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
// ★G-32 B6 前置：请求数据层语义面（injectable——R1 request 策略请求 / R2 useQuery SWR / R3 enqueue 队列 / R4 dedupe 去重）+ G-31 B7 收口适配器
export { createRequestEngineering, defaultCacheKey, createCapabilityRequestClient } from './request-engineering'
export type { RequestEngineering, RequestEngineeringOptions, RequestExecutor, RequestCacheEntry, QueryState, QueryHandle, QueryOptions, RequestStrategyOptions } from './request-engineering'
// ★★★#1342 请求库（useFetch 之上的**高级封装**：实例配置 · 幂等/熔断/离线/**未知态** · 签名防重放脱敏 · bizId 隔离 · 审计）
//   ★定位：不做"又一个 axios"，做**平台方的请求治理层**（几十个业务团队共用一套网络且管得住）。
//   ★底座仍是 useFetch/pipeline（不重写传输与 HTTP 语义）；策略字段不下传线格式（四层链纪律）。
export * from './request'
export { createOwnershipEngineering } from './ownership-engineering'
export type { OwnershipEngineering, OwnershipEngineeringOptions, OwnershipReactivity, OwnedStateLike, OwnedLike, BorrowLike, OwnedView } from './ownership-engineering'
// ★WebMCP 接入（E30 engineering.mcp）：把能力面暴露为 agent 可调用工具（能力派生 + CapResult 归一）
export { useMCP, capabilityToTool, toToolResponse, toErrorResponse } from './mcp'
export type { UseMCPOptions, UseMCPReturn, McpToolDescriptor, McpToolResponse, McpToolArgs, McpCapabilityToolSpec, McpModelContextLike, McpDocumentLike } from './mcp'
export type {
  CapResult,
  CapabilityHooks,
  CapabilityBridge,
  CapabilityProbe,
  CompatStorage,
  ReactiveStorage,
  ReactiveFactory,
  FetchConfig,

  FetchResult,
  FetchOk,
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
