// tests/app-config-storage.test.ts
// ★app-config G-35 M5：五端配置存储适配层（05-five-end-storage.md JS 侧落地）
// Web（localStorage）/ Skyline（wx.setStorageSync）/ App 端内存降级 / createPlatformConfigStore 分发
import { describe, expect, it, vi } from 'vitest'
import {
  createWebConfigStore,
  createSkylineConfigStore,
  createVolatileConfigStore,
  createPlatformConfigStore,
} from '../packages/app-config/src/storage'
import type { WebStorageLike, WxStorageLike } from '../packages/app-config/src/storage'
import type { AppConfig } from '../packages/app-config/src/index'

const CONFIG: AppConfig = {
  app: { id: 'x', name: 'X', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: { baseUrl: 'https://api.com', timeout: 10000, retry: 2, cache: { defaultTTL: 1, enabledEndpoints: [] } },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
}

function memWebStorage(): WebStorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

function memWxStorage(): WxStorageLike {
  const map = new Map<string, string>()
  return {
    setStorageSync: vi.fn((k: string, v: string) => {
      map.set(k, v)
    }) as unknown as WxStorageLike['setStorageSync'],
    getStorageSync: vi.fn((k: string) => map.get(k) ?? '') as unknown as WxStorageLike['getStorageSync'],
    removeStorageSync: vi.fn((k: string) => {
      map.delete(k)
    }) as unknown as WxStorageLike['removeStorageSync'],
  }
}

describe('createWebConfigStore（Web localStorage）', () => {
  it('save → load 往返（JSON 持久化）；clear 清除', () => {
    const storage = memWebStorage()
    const store = createWebConfigStore(storage)
    expect(store.load()).toBeNull()
    store.save(CONFIG)
    expect(JSON.parse(storage.getItem('proteus.config') ?? 'null')).toMatchObject({ api: { baseUrl: 'https://api.com' } })
    expect(store.load()).toEqual(CONFIG)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('损坏 JSON → load 返回 null（不抛错）', () => {
    const storage = memWebStorage()
    storage.setItem('proteus.config', '{broken')
    expect(createWebConfigStore(storage).load()).toBeNull()
  })
})

describe('createSkylineConfigStore（Skyline wx.setStorageSync）', () => {
  it('save → wx.setStorageSync 被调用 + load 往返；clear 清除', () => {
    const wx = memWxStorage()
    const store = createSkylineConfigStore(wx)
    store.save(CONFIG)
    expect(wx.setStorageSync).toHaveBeenCalledWith('proteus.config', expect.stringContaining('https://api.com'))
    expect(store.load()).toEqual(CONFIG)
    store.clear()
    expect(wx.removeStorageSync).toHaveBeenCalledWith('proteus.config')
    expect(store.load()).toBeNull()
  })

  it('wx 存储损坏 → load 返回 null', () => {
    const wx = memWxStorage()
    wx.setStorageSync('proteus.config', 'not-json')
    expect(createSkylineConfigStore(wx).load()).toBeNull()
  })
})

describe('createVolatileConfigStore（App 端内存降级）', () => {
  it('save/load/clear 内存往返（不抛错——宁可降级不崩溃）', () => {
    const store = createVolatileConfigStore()
    store.save(CONFIG)
    expect(store.load()).toEqual(CONFIG)
    store.clear()
    expect(store.load()).toBeNull()
  })
})

describe('createPlatformConfigStore（05 §映射总览统一入口）', () => {
  it('web → localStorage 持久化', () => {
    const storage = memWebStorage()
    const store = createPlatformConfigStore('web', { storage })
    store.save(CONFIG)
    expect(storage.getItem('proteus.config')).toContain('api.com')
  })

  it('mp-weixin → wx.setStorageSync 持久化', () => {
    const wx = memWxStorage()
    const store = createPlatformConfigStore('mp-weixin', { wx })
    store.save(CONFIG)
    expect(wx.setStorageSync).toHaveBeenCalled()
  })

  it('ios/android/harmony → 内存降级（不抛错）', () => {
    for (const platform of ['ios', 'android', 'harmony'] as const) {
      const store = createPlatformConfigStore(platform)
      store.save(CONFIG)
      expect(store.load()).toEqual(CONFIG)
    }
  })
})
