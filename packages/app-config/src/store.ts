// packages/app-config/src/store.ts
// ★app-config G-35 M2：运行时存储 + 响应式 API（02-runtime-api.md §2/§3/§4）
// configRef 单例 reactive：setConfig 校验 → 深合并 → 触发所有 useAppConfig 消费者
// ★ES5 安全（运行时进 MP 产物：禁 ?. ?? 展开 解构）
import { ref, getCurrentInstance } from 'vue'
import type { Ref } from 'vue'
import type { AppConfig, DeepPartial } from './types'
import { deepMerge } from './merge'
import { validateAppConfig } from './validate'

let configRef: Ref<AppConfig> | null = null

/** 初始化配置存储（应用启动时调用一次；重复调用 = 覆盖默认 + 保留已合并层） */
export function initAppConfig(defaults: AppConfig): void {
  if (configRef === null) {
    configRef = ref(defaults)
  } else {
    configRef.value = defaults
  }
}

/** 当前配置（未初始化时抛错——应用启动必须 init） */
function requireConfig(): Ref<AppConfig> {
  if (configRef === null) throw new Error('[app-config] 未初始化：应用启动时需调用 initAppConfig / defineAppConfig 入口初始化')
  return configRef
}

/** 命令式读取（02 §3，非响应式场景） */
export function getConfig(): AppConfig {
  return requireConfig().value
}

export type SetConfigInput = DeepPartial<AppConfig> | ((current: AppConfig) => DeepPartial<AppConfig>)

/**
 * 命令式写入（02 §3）：partial/updater → 校验（非法拒绝 + 告警）→ 深合并 → 触发响应式通知
 * ★校验哲学（G-31 同源）：非法值拒绝更新并告警，不静默破坏配置
 */
export function setConfig(input: SetConfigInput): { ok: boolean; errors: string[] } {
  const ref_ = requireConfig()
  const partial = typeof input === 'function' ? input(ref_.value) : input
  // ★先深合并再校验：浅合并会把 features 等整体替换导致误报缺失（深合并保留未覆盖字段）
  const merged = deepMerge(ref_.value, partial) as AppConfig
  const { ok, errors } = validateAppConfig(merged)
  if (!ok) {
    // 非法：拒绝更新 + 告警（不抛错——宁可拒绝也不崩溃）
    console.warn(`[app-config] setConfig 校验失败，已拒绝更新：${errors.map((e) => e.message).join('；')}`)
    return { ok: false, errors: errors.map((e) => e.message) }
  }
  ref_.value = merged
  return { ok: true, errors: [] }
}

/** 响应式读取（02 §2）：返回 reactive 代理；setup 外调用报错（同 useRoute 语义） */
export function useAppConfig(): AppConfig {
  if (!getCurrentInstance()) {
    throw new Error('[app-config] useAppConfig 只能在 setup() 内调用（同 useRoute）')
  }
  return requireConfig().value
}

export interface FeatureFlagResult {
  enabled: boolean
  variant: string | boolean | number | undefined
}

/** 功能开关计算（纯函数：setup 外可测；布尔开关或实验分组值） */
export function getFeatureFlag(config: AppConfig, key: string): FeatureFlagResult {
  const value = (config.features as Record<string, string | boolean | number | undefined>)[key]
  return { enabled: value !== false && value !== undefined, variant: value }
}

/** 功能开关便捷 API（02 §4）：读 features[key]——布尔开关或实验分组值 */
export function useFeatureFlag(key: string): FeatureFlagResult {
  return getFeatureFlag(useAppConfig(), key)
}
