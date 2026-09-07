// packages/app-config/src/load.ts
// ★app-config G-35 M3：多环境加载 + 平台覆盖（01-app-config.md §2.1 层级落地）
// app.config.ts（默认） + app.config.{env}.ts（环境覆盖） + platform 覆盖 + remote → 最终运行时配置
import type { AppConfig, DeepPartial, Env, Platform } from './types'
import { mergeAppConfig, extractPlatformOverride } from './merge'

export interface LoadAppConfigLayers {
  /** 默认配置（app.config.ts，必填） */
  defaults: AppConfig
  /** 环境配置（app.config.{env}.ts；键 = Env） */
  envConfigs?: Partial<Record<Env, DeepPartial<AppConfig>>>
  /** 当前环境 */
  env: Env
  /** 当前平台（从 defaults.platform[platform] 提取覆盖层） */
  platform?: Platform
  /** 远端配置层（运行时下发，最高优先级） */
  remote?: DeepPartial<AppConfig>
}

/** 解析环境配置层（envConfigs[env]；缺失 → undefined 不覆盖） */
export function resolveEnvConfig(envConfigs: Partial<Record<Env, DeepPartial<AppConfig>>> | undefined, env: Env): DeepPartial<AppConfig> | undefined {
  return envConfigs?.[env]
}

/**
 * 完整加载（§2.1 层级落地）：
 * defaults + envConfigs[env] + defaults.platform[platform] + remote → 最终运行时配置
 */
export function loadAppConfig(layers: LoadAppConfigLayers): AppConfig {
  const envLayer = resolveEnvConfig(layers.envConfigs, layers.env)
  const platformLayer = layers.platform ? extractPlatformOverride(layers.defaults, layers.platform) : undefined
  return mergeAppConfig({
    defaults: layers.defaults,
    env: envLayer,
    platform: platformLayer,
    remote: layers.remote,
  })
}
