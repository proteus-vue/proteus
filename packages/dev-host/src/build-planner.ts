/**
 * G-45 B2 —— 双层构建计划器
 *
 * 「页面越多打包越慢」的根因消除（G-45.4 / CMP086）：
 *   base   cacheKey = f(框架版本, ABI)      —— 与页面数/插件数无关
 *   js     cacheKey = f(业务源码哈希)        —— 增量
 *   plugin cacheKey = f(插件id, 版本)        —— 每插件独立
 */

/** FNV-1a 简化版：为源码内容生成稳定 cache key 片段 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export interface BuildState {
  frameworkVersion: string
  abi: string
  /** 业务源码内容哈希（增量构建输入） */
  jsHash: string
  /** 全量插件版本表（id → semver） */
  pluginVersions: Record<string, string>
}

export type BuildLayer = 'base' | 'js' | 'plugin'

export interface LayerPlan {
  layer: BuildLayer
  cacheKey: string
  action: 'build' | 'skip'
}

export interface PluginLayerPlan extends LayerPlan {
  id: string
}

export interface BuildPlan {
  base: LayerPlan
  js: LayerPlan
  plugins: PluginLayerPlan[]
}

export class BuildCache {
  private built = new Map<string, number>()
  readonly buildCounts: Record<BuildLayer, number> = { base: 0, js: 0, plugin: 0 }

  /** 命中缓存返回 skip；未命中 build 并记账。cacheKey 层间独立（CMP086） */
  plan(layer: BuildLayer, cacheKey: string): LayerPlan {
    if (this.built.has(cacheKey)) {
      return { layer, cacheKey, action: 'skip' }
    }
    this.built.set(cacheKey, Date.now())
    this.buildCounts[layer] += 1
    return { layer, cacheKey, action: 'build' }
  }

  has(cacheKey: string): boolean {
    return this.built.has(cacheKey)
  }
}

export function planBuild(cache: BuildCache, state: BuildState): BuildPlan {
  return {
    base: cache.plan('base', `base:${state.frameworkVersion}:${state.abi}`),
    js: cache.plan('js', `js:${fnv1a(state.jsHash)}`),
    plugins: Object.entries(state.pluginVersions).map(([id, ver]) => ({
      id,
      ...cache.plan('plugin', `plugin:${id}:${ver}`),
    })),
  }
}
