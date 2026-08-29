// packages/types/src/index.ts
// @proteus/types —— 框架级共享类型单一来源（types-plan B3 + 类型收口 10-type-consolidation）
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
export type { ProteusConfig } from './config'

// ============ 品牌 / 迁移 / Schema（B6/B3 既有） ============
export { Brand } from './brand'
export type { StoreId, ModuleDomain, RouteName, CapabilityId } from './brand'
export { asStoreId, asModuleDomain, asRouteName, asCapabilityId } from './brand'
export { CONFIG_VERSION, configMigrations, migrateConfig, configNeedsMigration } from './migration'
export type { Migration } from './migration'
export { proteusConfigSchema, proteusConfigSchemaJson, extendConfigSchema, getConfigSchema } from './config-schema'
export type { ProteusConfigSchema } from './config-schema'
