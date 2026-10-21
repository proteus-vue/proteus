// packages/api/src/capability-fetch-cache-runtime.ts
// ★★★决策 #1151：**按端选择持久化后端**——业务只写 `cache: { persist: true }`，不用关心端差异。
//
// 【为什么需要这一层（三端的持久化形态不同，取证见 #1151）】
//   | 端 | 可用能力 | 形态 |
//   |---|---|---|
//   | Web | `localStorage`（经桥 `getStorage`） | KV，同步 |
//   | MP  | `wx.setStorage`（经桥 `getStorage`） | KV，同步+异步，10MB 上限 |
//   | App | **无** `getStorage`；只有 `fs.readBytes/writeBytes/remove` | 文件，**异步** |
//   ⇒ 若把"用哪种后端"交给业务，同一份源码在三端就要写三个分支（本仓反复禁止的形态）。
//     这里按端**探测**一次，业务侧感知为零。
//
// 【★探测必须"失败即降级"（不报错）】
//   缓存是**可选的加速层**：拿不到持久化介质时退回内存（= #1149/#1150 的行为），
//   而不是让 `useFetch` 整体不可用。★但要**如实标记**（`degraded` + `reason`），
//   否则"以为开了持久化其实没开"就是静默失效。
//
// 【诚实边界】
//   · App 端的文件目录由宿主校验（沙箱相对路径）；目录不存在时**第一次写会自动创建**
//     （宿主 `fs.writeBytes` 的既有语义：写前 mkdir）——本轮不额外调 `mkdir`；
//   · 只做"单进程"持久化：不处理多进程同时写同一缓存文件（本仓 Shell 是单进程模型）。

import { detectRuntime } from '@proteus-vue/shared'
import { detectAppHost } from './capability-app'
import { createKvFetchCacheStorage, createFileFetchCacheStorage } from './capability-fetch-cache-persist'
import type { CachePersistBackend } from './capability-fetch-cache-persist'

/** 后端选择结果（`degraded=true` 表示"要持久化但拿不到介质，已退回内存"）。 */
export interface PersistBackendChoice {
  backend?: CachePersistBackend
  degraded: boolean
  /** 选择依据（排障/判据读数）：`kv` / `file` / `none:...` */
  reason: string
}

/** 宿主 `fs.*` 的最小面（App 端；与 `APP_NATIVE_METHODS` 的 `fs.*` 对齐）。 */
export interface HostFsLike {
  readBytes?: (path: string) => Promise<Uint8Array>
  writeBytes?: (path: string, bytes: Uint8Array) => Promise<void>
  remove?: (path: string) => Promise<void>
}

/**
 * 探测当前端的持久化介质。
 *
 * @param opts.dir 文件后端目录（App），默认 `cache/http`
 * @param opts.kv  显式 KV（判据用）
 * @param opts.fs  显式文件能力（判据用）
 */
export function choosePersistBackend(opts: {
  dir?: string
  kv?: Parameters<typeof createKvFetchCacheStorage>[0]
  fs?: HostFsLike
} = {}): PersistBackendChoice {
  const dir = opts.dir ?? 'cache/http'

  // ① 显式注入优先（判据/自定义）
  if (opts.kv) return { backend: createKvFetchCacheStorage(opts.kv), degraded: false, reason: 'kv:injected' }
  if (opts.fs && opts.fs.readBytes && opts.fs.writeBytes && opts.fs.remove) {
    return { backend: createFileFetchCacheStorage(opts.fs as Required<HostFsLike>, dir), degraded: false, reason: 'file:injected' }
  }

  // ② App 宿主：只有文件通路（无 `getStorage`）
  if (detectAppHost()) {
    const fs = hostFs()
    if (fs) return { backend: createFileFetchCacheStorage(fs, dir), degraded: false, reason: 'file:app-host' }
    return { degraded: true, reason: 'none:app-host-without-fs' }
  }

  // ③ Web / MP：KV（`localStorage` / `wx.setStorage`）
  const kv = runtimeKv()
  if (kv) return { backend: createKvFetchCacheStorage(kv), degraded: false, reason: `kv:${detectRuntime()}` }
  return { degraded: true, reason: 'none:no-storage' }
}

/**
 * 取 Web/MP 的 KV 面。
 * ★为什么直接摸 `localStorage` / `wx`（而不是走桥的 `getStorage`）：
 *   桥的 `CompatStorage` 是**值语义**（`set(key, unknown)` 内部会 `JSON.stringify`），
 *   而本层要存**原始字符串**（自己控制序列化与版本号）。
 *   直接摸介质能让"编码/版本/损坏容错"都留在本层，不依赖桥的实现细节。
 *   ★MP 的 `wx.setStorageSync` 在超限时会**抛错** ⇒ 由 `createKv…` 的 write 兜住（返回 false）。
 */
function runtimeKv(): Parameters<typeof createKvFetchCacheStorage>[0] | undefined {
  const g = globalThis as {
    localStorage?: {
      getItem(k: string): string | null
      setItem(k: string, v: string): void
      removeItem(k: string): void
      key(i: number): string | null
      length: number
    }
    wx?: {
      getStorageSync?: (k: string) => unknown
      setStorageSync?: (k: string, v: unknown) => void
      removeStorageSync?: (k: string) => void
      getStorageInfoSync?: () => { keys?: string[] }
    }
  }
  // Web：localStorage（含 `getStorage` 桥的同一介质）
  if (typeof g.localStorage?.getItem === 'function') {
    const ls = g.localStorage
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => {
        const out: string[] = []
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (k !== null) out.push(k)
        }
        return out
      },
    }
  }
  // MP：wx.setStorageSync（值语义 ⇒ 这里只存字符串，仍按字符串写入）
  const wx = g.wx
  if (wx && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function') {
    return {
      getItem: (k) => {
        const v = wx.getStorageSync!(k)
        // ★wx 空值返回 `''`（不是 null）——按"不存在"处理
        return typeof v === 'string' && v.length > 0 ? v : null
      },
      setItem: (k, v) => wx.setStorageSync!(k, v),
      removeItem: (k) => wx.removeStorageSync?.(k),
      keys: () => wx.getStorageInfoSync?.().keys ?? [],
    }
  }
  return undefined
}

/**
 * 取 App 宿主的 `fs.*`（经 `invokeHostAsync`，与 `capability-transfer.ts` 同一通路）。
 * ★异步：App 的文件能力只有异步帧通道（无 `getStorage`，也无同步 fs）。
 */
function hostFs(): Required<HostFsLike> | undefined {
  // 延迟 import 避免把 capability-invoke 拖进纯策略模块的静态依赖
  const g = globalThis as { __PROTEUS_HOST_ID__?: string }
  if (!g.__PROTEUS_HOST_ID__) return undefined
  return {
    readBytes: async (path: string): Promise<Uint8Array> => {
      const { invokeHostAsync } = await import('./capability-invoke')
      const r = await invokeHostAsync('fs.readBytes', { path }, 15000)
      return bytesOf(r)
    },
    writeBytes: async (path: string, bytes: Uint8Array): Promise<void> => {
      const { invokeHostAsync } = await import('./capability-invoke')
      // ★线格式：字节走 `bytes` 字段（宿主 `fs.writeBytes` 的既有契约，见 #1095）
      await invokeHostAsync('fs.writeBytes', { path, bytes: Array.from(bytes) }, 15000)
    },
    remove: async (path: string): Promise<void> => {
      const { invokeHostAsync } = await import('./capability-invoke')
      await invokeHostAsync('fs.remove', { path }, 15000)
    },
  }
}

/** 从宿主回执取字节（`Uint8Array` / `number[]` / base64 都接——三端壳习惯不同，与 #1095 同口径）。 */
function bytesOf(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d
  if (Array.isArray(d)) return new Uint8Array(d as number[])
  const obj = d as { bytes?: unknown; data?: unknown } | null
  const inner = obj?.bytes ?? obj?.data
  if (inner instanceof Uint8Array) return inner
  if (Array.isArray(inner)) return new Uint8Array(inner as number[])
  if (typeof inner === 'string') {
    // base64（三端壳都可能有）
    const bin = atobSafe(inner)
    return bin
  }
  return new Uint8Array(0)
}

/** `atob` 的跨端兜底（App 精简引擎可能没有）。 */
function atobSafe(b64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string }
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // 最小 base64 解码（RFC 4648 标准字母表）
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = table.indexOf(clean[i] ?? 'A')
    const c1 = table.indexOf(clean[i + 1] ?? 'A')
    const c2 = table.indexOf(clean[i + 2] ?? 'A')
    const c3 = table.indexOf(clean[i + 3] ?? 'A')
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3)
    out.push((n >> 16) & 0xff)
    if (i + 2 < clean.length) out.push((n >> 8) & 0xff)
    if (i + 3 < clean.length) out.push(n & 0xff)
  }
  return new Uint8Array(out)
}
