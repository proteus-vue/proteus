// tests/app-config-remote.test.ts
// ★app-config G-35 M4：远端下发 + L1 缓存（03-remote-config.md §1/§3/§4/§7）
// createMemoryConfigCache / createHttpsFetcher / fetchAndApplyRemote（降级链四态 + 非法降级）
import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryConfigCache,
  createHttpsFetcher,
  fetchAndApplyRemote,
} from '../packages/app-config/src/remote'
import type { FetchLike } from '../packages/app-config/src/remote'
import type { AppConfig } from '../packages/app-config/src/index'

const CURRENT: AppConfig = {
  app: { id: 'x', name: 'X', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: { baseUrl: 'https://local.com', timeout: 10000, retry: 2, cache: { defaultTTL: 1, enabledEndpoints: [] } },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
}

describe('createMemoryConfigCache（L1 缓存抽象）', () => {
  it('get/set/clear 往返；初始 undefined', () => {
    const cache = createMemoryConfigCache()
    expect(cache.get()).toBeUndefined()
    cache.set({ features: { glassEffect: true } })
    expect(cache.get()).toEqual({ features: { glassEffect: true } })
    cache.clear()
    expect(cache.get()).toBeUndefined()
  })
})

describe('createHttpsFetcher（https source 默认拉取）', () => {
  const mkFetch = (): { impl: FetchLike; calls: Array<{ url: string; headers: Record<string, string> }> } => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const impl: FetchLike = (url, init) => {
      calls.push({ url: url as string, headers: (init?.headers ?? {}) as Record<string, string> })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ features: { glassEffect: true } }) })
    }
    return { impl, calls }
  }

  it('拉取：URL + X-App-Version 头 + JSON 解析', async () => {
    const { impl, calls } = mkFetch()
    const fetcher = createHttpsFetcher(impl)
    const raw = await fetcher({ url: 'https://cfg.example.com/v1/app', version: '1.2.3' })
    expect(calls[0]?.url).toBe('https://cfg.example.com/v1/app')
    expect(calls[0]?.headers['X-App-Version']).toBe('1.2.3')
    expect(raw).toEqual({ features: { glassEffect: true } })
  })

  it('无 version → 不带头；HTTP 非 2xx → 抛错', async () => {
    const ok = createHttpsFetcher(mkFetch().impl)
    await expect(ok({ url: 'https://x' })).resolves.toBeTruthy()
    const bad = createHttpsFetcher((url, init) => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    await expect(bad({ url: 'https://x' })).rejects.toThrow(/HTTP/)
  })

  it('环境无 fetch → 抛错提示注入 custom fetcher', async () => {
    const saved = (globalThis as { fetch?: unknown }).fetch
    ;(globalThis as { fetch?: unknown }).fetch = undefined
    try {
      await expect(createHttpsFetcher()({ url: 'https://x' })).rejects.toThrow(/custom fetcher/)
    } finally {
      ;(globalThis as { fetch?: unknown }).fetch = saved
    }
  })
})

describe('fetchAndApplyRemote（§1 集成模型 + §4 降级链）', () => {
  it('拉取成功 → 深合并 + apply 生效 + 写缓存（source: remote）', async () => {
    const cache = createMemoryConfigCache()
    const apply = vi.fn()
    const result = await fetchAndApplyRemote({
      current: CURRENT,
      fetcher: async () => ({ api: { timeout: 8000 }, features: { glassEffect: true } }),
      url: 'https://cfg.example.com/v1/app',
      cache,
      cacheEnabled: true,
      apply,
    })
    expect(result.source).toBe('remote')
    expect(result.config.api.timeout).toBe(8000) // 远端覆盖
    expect(result.config.api.baseUrl).toBe('https://local.com') // 未声明字段保留本地
    expect(result.config.features.glassEffect).toBe(true)
    expect(result.degraded).toBeUndefined()
    expect(apply).toHaveBeenCalledWith(result.config)
    expect(cache.get()).toEqual({ api: { timeout: 8000 }, features: { glassEffect: true } })
  })

  it('远端非法字段 → 降级为当前值 + degraded 报告（其余生效）', async () => {
    const result = await fetchAndApplyRemote({
      current: CURRENT,
      fetcher: async () => ({ api: { timeout: 999999 }, features: { skeletonScreen: true } }),
      url: 'https://cfg.example.com/v1/app',
    })
    expect(result.source).toBe('remote')
    expect(result.config.api.timeout).toBe(10000) // 999999 超 (0,120000] → 降级
    expect(result.config.features.skeletonScreen).toBe(true) // 合法字段仍生效
    expect(result.degraded?.some((e) => e.path === 'api.timeout')).toBe(true)
  })

  it('拉取失败 + fallback last-cached + 有缓存 → 缓存合并生效（source: cache）', async () => {
    const cache = createMemoryConfigCache()
    cache.set({ features: { memorialGray: true } })
    const result = await fetchAndApplyRemote({
      current: CURRENT,
      fetcher: async () => {
        throw new Error('network down')
      },
      url: 'https://cfg.example.com/v1/app',
      cache,
      cacheEnabled: true,
      fallback: 'last-cached',
    })
    expect(result.source).toBe('cache')
    expect(result.config.features.memorialGray).toBe(true)
    expect(result.config.api.baseUrl).toBe('https://local.com')
    expect(result.cached).toBe(true)
  })

  it('拉取失败 + 无缓存 → 默认值（source: defaults）', async () => {
    const result = await fetchAndApplyRemote({
      current: CURRENT,
      fetcher: async () => {
        throw new Error('network down')
      },
      url: 'https://cfg.example.com/v1/app',
    })
    expect(result.source).toBe('defaults')
    expect(result.config).toBe(CURRENT)
    expect(result.cached).toBe(false)
  })

  it('拉取失败 + fallback defaults（即使有缓存）→ 默认值', async () => {
    const cache = createMemoryConfigCache()
    cache.set({ features: { memorialGray: true } })
    const result = await fetchAndApplyRemote({
      current: CURRENT,
      fetcher: async () => {
        throw new Error('network down')
      },
      url: 'https://cfg.example.com/v1/app',
      cache,
      cacheEnabled: true,
      fallback: 'defaults',
    })
    expect(result.source).toBe('defaults')
    expect(result.config.features.memorialGray).toBe(false)
  })
})
