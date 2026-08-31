// packages/app-config/src/index.ts
// @proteus-vue/app-config —— 应用全局配置（G-35：合并 + 校验 + 响应式运行时 API）
export type { AppConfig, Env, Platform, DeepPartial, RemoteConfigConfig, ConfigLayer } from './types'
export { deepMerge, mergeAppConfig, extractPlatformOverride } from './merge'
export { validateAppConfig, validateAndApply } from './validate'
export type { ConfigError, ValidateResult } from './validate'

// ★G-35 M2：运行时 API（02-runtime-api.md）
export { initAppConfig, getConfig, setConfig, useAppConfig, useFeatureFlag, getFeatureFlag } from './store'
export type { SetConfigInput, FeatureFlagResult } from './store'
export { defineAppConfig } from './define'

// 配置入口标记（defineAppConfig 附加）
export const APP_CONFIG_MARK = '__isAppConfig'
