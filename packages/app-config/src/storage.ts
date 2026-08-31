// packages/app-config/src/storage.ts
// ★app-config G-35 M5：五端配置存储适配层（05-five-end-storage.md 映射表 JS 侧落地）
// Web（localStorage）/ Skyline（wx.setStorageSync）真实实现；iOS/Android/鸿蒙 → 内存降级（原生持久化待 G-22 App Renderer 接线）
// ★ES5 安全（进 MP 产物：禁 ?. ?? 展开 解构）；wx / storage 为注入点（可测 + 平台差异收敛）
import type { AppConfig, Platform } from './types'

export interface ConfigStore {
  save(config: AppConfig): void
  /** 读取持久化配置；无缓存或损坏（非法 JSON）→ null */
  load(): AppConfig | null
  clear(): void
}

const STORAGE_KEY = 'proteus.config'

function parseStored(json: string | null | undefined): AppConfig | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as unknown
    if (v && typeof v === 'object') return v as AppConfig
    return null
  } catch {
    return null
  }
}

/** Web 存储形状（localStorage 子集；缺省取全局 localStorage——注入便于测试/SSR 降级） */
export interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultWebStorage(): WebStorageLike | undefined {
  return (globalThis as { localStorage?: WebStorageLike }).localStorage
}

/** Web：localStorage（05 §Web 存储；SSR/无 localStorage 环境 → 内存降级不抛错） */
export function createWebConfigStore(storage?: WebStorageLike): ConfigStore {
  let memory: AppConfig | null = null
  return {
    save: (config) => {
      memory = config
      const s = storage ?? defaultWebStorage()
      if (s) {
        try {
          s.setItem(STORAGE_KEY, JSON.stringify(config))
        } catch {
          /* 配额/隐私模式：内存兜底 */
        }
      }
    },
    load: () => {
      const s = storage ?? defaultWebStorage()
      if (s) {
        try {
          const v = parseStored(s.getItem(STORAGE_KEY))
          if (v) return v
        } catch {
          /* fallthrough 内存 */
        }
      }
      return memory
    },
    clear: () => {
      memory = null
      const s = storage ?? defaultWebStorage()
      if (s) {
        try {
          s.removeItem(STORAGE_KEY)
        } catch {
          /* noop */
        }
      }
    },
  }
}

/** wx 存储形状（setStorageSync 子集；小程序端真实 wx，注入便于测试） */
export interface WxStorageLike {
  setStorageSync(key: string, data: string): void
  getStorageSync(key: string): string
  removeStorageSync(key: string): void
}

function defaultWxStorage(): WxStorageLike | undefined {
  return (globalThis as { wx?: WxStorageLike }).wx
}

/** Skyline：wx.setStorageSync（05 §Skyline 存储；无 wx 环境 → 内存降级） */
export function createSkylineConfigStore(wx?: WxStorageLike): ConfigStore {
  let memory: AppConfig | null = null
  const api = () => wx ?? defaultWxStorage()
  return {
    save: (config) => {
      memory = config
      const w = api()
      if (w) {
        try {
          w.setStorageSync(STORAGE_KEY, JSON.stringify(config))
        } catch {
          /* 存储满等：内存兜底 */
        }
      }
    },
    load: () => {
      const w = api()
      if (w) {
        try {
          const v = parseStored(w.getStorageSync(STORAGE_KEY))
          if (v) return v
        } catch {
          /* fallthrough 内存 */
        }
      }
      return memory
    },
    clear: () => {
      memory = null
      const w = api()
      if (w) {
        try {
          w.removeStorageSync(STORAGE_KEY)
        } catch {
          /* noop */
        }
      }
    },
  }
}

/** App 端（iOS/Android/鸿蒙）：原生持久化待 G-22 App Renderer 接线，先内存降级（宁可降级不崩溃） */
export function createVolatileConfigStore(): ConfigStore {
  let memory: AppConfig | null = null
  return {
    save: (config) => {
      memory = config
    },
    load: () => memory,
    clear: () => {
      memory = null
    },
  }
}

/**
 * 五端统一入口（05 §映射总览）：Web/Skyline 真实持久化，App 端内存降级
 * opts 注入 wx/storage 便于测试与平台差异收敛
 */
export function createPlatformConfigStore(platform: Platform, opts?: { wx?: WxStorageLike; storage?: WebStorageLike }): ConfigStore {
  if (platform === 'web') return createWebConfigStore(opts?.storage)
  if (platform === 'mp-weixin') return createSkylineConfigStore(opts?.wx)
  return createVolatileConfigStore()
}
