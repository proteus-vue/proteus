// packages/app-config/src/merge.ts
// ★app-config G-35 M1：合并引擎（01-app-config.md §2.1）
// 四层合并：默认 < env < platform < remote；深合并 + 数组替换（不拼接）；纯函数零依赖
import type { AppConfig, ConfigLayer, DeepPartial } from './types'

/** 深合并：override 覆盖 base（对象递归、数组替换、其余替换）；不突变入参，返回新对象 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const key of Object.keys(override as Record<string, unknown>)) {
      out[key] = deepMerge(out[key], (override as Record<string, unknown>)[key])
    }
    return out
  }
  // 数组替换（不拼接）、标量替换
  return override === undefined ? base : override
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 四层合并（§2.1 优先级：默认 < env < platform < remote）
 * layers: { defaults, env?, platform?, remote? }——各层可缺省；返回最终运行时配置
 */
export function mergeAppConfig(layers: { defaults: AppConfig; env?: DeepPartial<AppConfig>; platform?: DeepPartial<AppConfig>; remote?: DeepPartial<AppConfig> }): AppConfig {
  let merged: unknown = layers.defaults
  for (const layer of ['env', 'platform', 'remote'] as ConfigLayer[]) {
    const override = layers[layer as keyof typeof layers]
    if (override !== undefined) merged = deepMerge(merged, override)
  }
  return merged as AppConfig
}

/** 平台覆盖提取：从全量配置中取 platform.<platform> 覆盖层（§2.2 platform 字段） */
export function extractPlatformOverride(config: AppConfig, platform: string): DeepPartial<AppConfig> | undefined {
  const p = config.platform as Record<string, DeepPartial<AppConfig>> | undefined
  return p?.[platform]
}
