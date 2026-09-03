/**
 * @proteus-vue/dev-host —— G-45 调试基座即宿主（Install-Once Host）
 *
 * 基座是常驻宿主，不是构建产物——装一次，换插件，永不重打
 * （渲染与原生能力走可插拔后端，不是 WebView 套壳）。
 */

export type {
  BackendManifest,
  BackendRecord,
  CapabilityRecord,
  ConformanceCase,
  ConformanceResult,
  DevHostEventRecord,
  DevHostEventType,
  DynamicBackendModule,
  FallbackImpl,
  HostMetrics,
  LoadReport,
  LoadRejectReason,
  ModuleEntry,
  NativeBackendLike,
  PendingEntry,
  ProteusDevHost,
} from './types'

export {
  DevHost,
  ForwardingStub,
  createDevHost,
} from './dev-host'

export {
  shapeOf,
  shapeEquals,
  checkResultShape,
} from './shape'

export {
  BuildCache,
  planBuild,
  fnv1a,
} from './build-planner'
export type { BuildState, BuildPlan, BuildLayer, LayerPlan, PluginLayerPlan } from './build-planner'

export {
  checkAbiCompat,
  stableLayerCacheKey,
} from './abi'
export type {
  AbiVersion,
  AbiContract,
  AbiRejectReason,
  AbiCompatReport,
  DevHostMode,
  FeatureFlag,
  AbiCacheKeyInput,
} from './abi'
