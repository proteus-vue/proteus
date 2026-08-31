// packages/app-config/src/index.ts
// @proteus-vue/app-config —— 应用全局配置（G-35 M1：合并 + 校验，纯 TS 零依赖）
export type { AppConfig, Env, Platform, DeepPartial, RemoteConfigConfig, ConfigLayer } from './types'
export { deepMerge, mergeAppConfig, extractPlatformOverride } from './merge'
export { validateAppConfig, validateAndApply } from './validate'
export type { ConfigError, ValidateResult } from './validate'
