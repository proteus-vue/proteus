// packages/app-config/src/remote.ts
// ★app-config G-35 M4：远端下发 + L1 缓存（03-remote-config.md §1/§3/§4/§7）
// 集成模型：异步拉取远端 → 合并 → 校验（非法字段降级）→ 生效（apply 回调，调用方接 setConfig 响应式）→ 写缓存
// 降级链（§4，应用永不因配置失败崩溃）：拉取失败 → fallback last-cached 查 L1 缓存 → 默认值
// ★L1 缓存抽象：createMemoryConfigCache 缺省内存实现；对接 Cache G-28 时替换存储实现（接口不变）
// ★ES5 安全（进 MP 产物：禁 ?. ?? 展开 解构）；fetch 为注入点（小程序端无全局 fetch → custom fetcher 走 wx.request）
import type { AppConfig, DeepPartial } from './types'
import { mergeAppConfig } from './merge'
import { validateAndApply } from './validate'
import type { ConfigError } from './validate'

/** L1 缓存抽象（G-28 Cache 落地的对接点：换磁盘/原生存储实现，接口不变） */
export interface ConfigCache {
  get(): DeepPartial<AppConfig> | undefined
  set(value: DeepPartial<AppConfig>): void
  clear(): void
}

/** 内存 L1 缓存（缺省实现；测试 + 无磁盘环境） */
export function createMemoryConfigCache(): ConfigCache {
  let value: DeepPartial<AppConfig> | undefined
  return {
    get: () => value,
    set: (v) => {
      value = v
    },
    clear: () => {
      value = undefined
    },
  }
}

/** 结构化 fetch 形状（避免 DOM lib 依赖；Node 全局 fetch / Web fetch / 注入 mock 均满足） */
export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}

export interface RemoteFetchContext {
  url: string
  version?: string
}

export type RemoteFetcher = (ctx: RemoteFetchContext) => Promise<unknown>

/** https source 默认拉取（03 §2：X-App-Version 头 + JSON；小程序端注入 custom fetcher 走 wx.request） */
export function createHttpsFetcher(fetchImpl?: FetchLike): RemoteFetcher {
  return async (ctx: RemoteFetchContext) => {
    const f = fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch
    if (!f) throw new Error('当前环境无 fetch（小程序端请注入 custom fetcher 走 wx.request）')
    const headers: Record<string, string> = {}
    if (ctx.version) headers['X-App-Version'] = ctx.version
    const res = await f(ctx.url, { headers })
    if (!res.ok) throw new Error(`远端配置拉取失败 HTTP ${res.status}`)
    return res.json()
  }
}

export interface FetchRemoteOptions {
  /** 当前生效配置（本地层合并结果） */
  current: AppConfig
  /** 拉取函数（createHttpsFetcher 或 custom） */
  fetcher: RemoteFetcher
  url: string
  /** 应用版本（X-App-Version 头） */
  version?: string
  /** L1 缓存（缺省不启用） */
  cache?: ConfigCache
  /** strategy.cacheToDisk：成功拉取后写缓存 + 失败时读缓存 */
  cacheEnabled?: boolean
  /** fallback 语义：last-cached = 失败优先缓存；defaults = 失败直接默认值（03 §2） */
  fallback?: 'last-cached' | 'defaults'
  /** 生效回调（调用方接 setConfig 触发响应式；缺省不应用） */
  apply?: (merged: AppConfig) => void
}

export interface RemoteApplyResult {
  /** 配置来源（§4 降级链落点） */
  source: 'remote' | 'cache' | 'defaults'
  /** 生效配置（merged 或当前） */
  config: AppConfig
  /** 是否已写/读 L1 缓存 */
  cached: boolean
  /** remote 层非法字段（降级为当前值；仅 source=remote 且存在违规时非空） */
  degraded?: ConfigError[]
}

/**
 * 远端下发完整管线（§1 集成模型 ②③④ + §4 降级链）：
 * 拉取成功 → 合并 → 非法字段降级（validateAndApply 哲学：宁可降级不崩溃）→ apply + 写缓存
 * 拉取失败 → fallback=last-cached 且有缓存 → 缓存合并生效；否则默认值
 */
export async function fetchAndApplyRemote(opts: FetchRemoteOptions): Promise<RemoteApplyResult> {
  let raw: unknown
  try {
    raw = await opts.fetcher({ url: opts.url, version: opts.version })
  } catch {
    // 拉取失败 → 降级链（§4）
    if (opts.fallback === 'last-cached' && opts.cacheEnabled && opts.cache) {
      const cached = opts.cache.get()
      if (cached) {
        const config = mergeAppConfig({ defaults: opts.current, remote: cached })
        return { source: 'cache', config, cached: true }
      }
    }
    return { source: 'defaults', config: opts.current, cached: false }
  }
  // 合并 + 校验（非法字段降级为当前值；必填缺失已由本地层兜底）
  const merged = mergeAppConfig({ defaults: opts.current, remote: raw as DeepPartial<AppConfig> })
  const { config, invalidFields } = validateAndApply(merged, opts.current)
  if (opts.cacheEnabled && opts.cache) opts.cache.set(raw as DeepPartial<AppConfig>)
  if (opts.apply) opts.apply(config)
  return {
    source: 'remote',
    config,
    cached: !!opts.cacheEnabled && !!opts.cache,
    degraded: invalidFields.length ? invalidFields : undefined,
  }
}
