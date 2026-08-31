// packages/types/src/index.ts
// @proteus-vue/types —— 框架级共享类型单一来源（types-plan B3 + 类型收口 10-type-consolidation）
// 零运行时依赖（纯类型 + schema 数据 + 品牌/迁移）；各实现包从本包引用公共类型 + re-export 兼容
// ★MP 产物安全（决策 #32/#36）：共享模块 _proteus/types 进 MP（Platform 常量等为纯数据）

// ============ 框架级共享契约 ============
export type { Platform, PlatformTarget, LocaleDir, RouteTransition } from './index-shared'
// ============ 各实现域公共类型（收口自实现包 types.ts） ============
export type {
  TransformPhase,
  TransformTraceEvent,
  TransformTrace,
  TransformRuleOverrides,
  StyleTransformOptions,
  TemplateTransformOptions,
  TemplateTransformResult,
  ScriptTransformOptions,
  ScriptTransformResult,
  CompileOptions,
  CompileResult,
} from './compiler-types'
export type {
  CapabilityPlatform,
  CapabilityTier,
  CapabilityMeta,
  CapabilityAPI,
  CapabilityErrorCode,
  CapabilityAdapter,
  CapabilityDefinition,
  Capability,
} from './capabilities'
export type {
  RouteRecord,
  RouteMeta,
  RouteParamsByName,
  RouteBlock,
  RouteNode,
  GlobalRouteDefaults,
  RouteParams,
  PageOnLoad,
  BaseNavigateOptions,
  NavigateOptions,
} from './router-types'
export type { HttpMethod, RequestConfig, RequestResponse, IRequestAdapter } from './api-types'

// ============ B9 跨端 API 统一契约（platform-api.ts） ============
export type { PlatformAPI, StorageAPI, RouterAPI, UIAPI } from './platform-api'
// ★运行时实现归 @proteus-vue/api（createApi + 三端 adapter）；本文件仅类型契约（规划 M9）
export type { ProteusConfig } from './config'

// ============ B8 小程序端类型（mp/ 子目录：组件 schema + 版本对齐） ============
export type { MpComponentProp, MpComponentSchema, MpComponentRegistry } from './mp/component-schema'
export { mpComponentRegistry, getComponentSchema, registerComponentSchema } from './mp/component-schema'
export type { MpSdkVersion } from './mp/sdk-version'
export { DEFAULT_TYPINGS_VERSION, MP_SDK_VERSION_MAP, resolveTypingsVersion, validateMpSdkVersion } from './mp/sdk-version'
// ★官方类型桥（WechatMiniprogram 命名空间）为 opt-in：单独经 '@proteus-vue/types/mp/official-typings' 引用

// ============ lifecycle / utils / ir-guards（types-plus B1 §3/§6 + B5 §2） ============
export type { AppPhase, LaunchType, LifecycleContext, PhaseHook, FallbackStrategy } from './lifecycle-types'
export type { IfPlatform, ExtractByPlatform, RequiredBy } from './utils'
export { IR_GUARD_ERROR_CODES, isRouteIR, isStoreIR, isSFCIR, assertRouteIR, assertStoreIR, assertSFCIR } from './ir-guards'
export type { IRGuardErrorCode } from './ir-guards'

// ============ 品牌 / 迁移 / Schema（B6/B3 既有） ============
export type { Brand } from './brand'
export type { StoreId, ModuleDomain, RouteName, CapabilityId } from './brand'
export { asStoreId, asModuleDomain, asRouteName, asCapabilityId } from './brand'
export { CONFIG_VERSION, configMigrations, migrateConfig, configNeedsMigration } from './migration'
export type { Migration } from './migration'
export { proteusConfigSchema, proteusConfigSchemaJson, extendConfigSchema, getConfigSchema } from './config-schema'
export type { ProteusConfigSchema } from './config-schema'

// ============ config-layers（B2 §4 字段归属 + B5 §3 跨层检测） ============
export type { ConfigLayer, CrossLayerPattern, ConfigLayerViolation, ConfigAuditRule } from './config-layers'
export { CONFIG_FIELD_LAYERS, CROSS_LAYER_PATTERNS, CONFIG_AUDIT_RULES, checkConfigLayerViolations, getFieldLayer } from './config-layers'

// ============ define-proteus（cli-plus G-33 M1：五端统一配置入口） ============
export { defineProteus } from './define-proteus'
export type {
  DefineProteusConfig,
  DefineProteusTargets,
  DefineProteusFeatures,
  DefineProteusTheme,
  DefineProteusFontScale,
  DefineProteusCache,
} from './define-proteus'
