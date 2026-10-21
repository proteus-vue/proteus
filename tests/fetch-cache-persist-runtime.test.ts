// tests/fetch-cache-persist-runtime.test.ts
// ★★★决策 #1151：`cache: { persist: true }` 的**按端探测**与**降级**判据。
//
// 【为什么需要单独一条】
//   `tests/fetch-cache-persist.test.ts` 验的是"持久层本身对不对"（显式注入 backend）。
//   而业务真正用的是**一个开关**：`createCapabilityHooks(bridge, { fetch: { cache: { persist: true } } })`。
//   这条判据守的是那个开关的三件事：
//     ① **按端选对后端**（Web/MP ⇒ KV；App ⇒ 文件）；选错 = 静默用不了；
//     ② **拿不到介质时降级为内存**（不报错、不炸请求），但**要标记**（否则"以为开了其实没开"）；
//     ③ **三端共用同一份源码**：业务侧不写任何端分支。
//
// 【★判据口径】
//   用全局桩模拟三端环境（`localStorage` / `wx` / `__PROTEUS_HOST_ID__`），
//   逐个断言 `choosePersistBackend()` 给出的 `reason` 与 `degraded`。
//   ★`reason` 是**可机读**的选择依据——它把"为什么选了这个后端"变成断言对象，
//     而不是靠读代码猜（本仓反复吃"判据只看有输出"的亏）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { choosePersistBackend } from '../packages/api/src/capability-fetch-cache-runtime'
import { createFetchCache } from '../packages/api/src/capability-fetch-cache'
import {
  createFileFetchCacheStorage,
  createKvFetchCacheStorage,
  createPersistentFetchCache,
} from '../packages/api/src/capability-fetch-cache-persist'

const g = globalThis as Record<string, unknown>

/** 清掉三端环境桩（每个用例前重置，避免互相污染） */
function clearEnv(): void {
  delete g['localStorage']
  delete g['wx']
  delete g['__PROTEUS_HOST_ID__']
}

/** 内存 KV 桩 */
function kvStub(): Record<string, unknown> {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    length: 0,
  }
}

beforeEach(() => {
  clearEnv()
  vi.resetModules()
})

afterEach(() => {
  clearEnv()
})

describe('★★#1151 `persist: true` 的按端探测', () => {
  it('★Web（有 localStorage）⇒ 选 KV 后端，不降级', () => {
    // 注意：`localStorage.length` 桩为 0，`keys()` 仍需可用
    g['localStorage'] = kvStub()
    const c = choosePersistBackend({})
    expect(c.degraded).toBe(false)
    expect(c.backend?.kind).toBe('kv')
    expect(c.reason).toBe('kv:web')
  })

  it('★MP（有 wx.setStorageSync）⇒ 选 KV 后端', () => {
    g['wx'] = {
      getStorageSync: () => '',
      setStorageSync: () => undefined,
      removeStorageSync: () => undefined,
      getStorageInfoSync: () => ({ keys: [] }),
    }
    const c = choosePersistBackend({})
    expect(c.degraded).toBe(false)
    expect(c.backend?.kind).toBe('kv')
    // ★detectRuntime() 在 Node 里无 window 但有 wx ⇒ 判成 mp
    expect(c.reason).toBe('kv:mp')
  })

  it('★★App 宿主（有 __PROTEUS_HOST_ID__、无 getStorage）⇒ 选**文件**后端', () => {
    g['__PROTEUS_HOST_ID__'] = 'android'
    const c = choosePersistBackend({})
    expect(c.degraded).toBe(false)
    expect(c.backend?.kind, '★App 必须用文件后端（它没有 getStorage）').toBe('file')
    expect(c.reason).toBe('file:app-host')
  })

  it('★★★拿不到任何介质 ⇒ 降级为内存（不抛、不炸请求），但**必须标记原因**', () => {
    // 只有宿主 ID（App）但宿主没实现 fs 会被 hostFs() 判为 available（它只检查 ID + 动态调用）——
    // 所以这里构造"什么都没有"的环境：无 localStorage / 无 wx / 非 App 宿主
    const c = choosePersistBackend({})
    expect(c.degraded, '★无介质却没有降级标记 —— 会静默用不上持久化').toBe(true)
    expect(c.backend).toBeUndefined()
    expect(c.reason).toBe('none:no-storage')
  })

  it('★显式注入 KV 优先于端探测（判据/自定义后端）', () => {
    g['__PROTEUS_HOST_ID__'] = 'android' // 即使当前是 App
    const c = choosePersistBackend({ kv: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, keys: () => [] } })
    expect(c.reason).toBe('kv:injected')
    expect(c.backend?.kind).toBe('kv')
  })

  it('★显式注入 fs 优先（且目录可配）', () => {
    const fs = {
      readBytes: async () => new Uint8Array(),
      writeBytes: async () => undefined,
      remove: async () => undefined,
    }
    const c = choosePersistBackend({ fs, dir: 'my/cache' })
    expect(c.reason).toBe('file:injected')
    expect(c.backend?.kind).toBe('file')
  })
})

describe('★★★#1151 清盘必须真的清干净（真机假绿的根因）', () => {
  /**
   * 【真机抓到的形态】iOS 首次跑持久层判据读到 `ageMs=91620`（约 25 小时）——
   *   那是**前一天调试留下的旧条目**，而两次运行只差 92 秒。
   *   根因：清盘走"索引里列出的键"，而索引为空/损坏时**什么也清不掉** ⇒ 判据假绿。
   *   ⇒ 改成 `backend.clearAll()`（KV 删前缀键 / 文件删单文件），并在这里守住。
   */
  it('★★文件后端：不带索引也能清干净（删单文件，不依赖 readdir/索引）', async () => {
    const files = new Map<string, Uint8Array>()
    const fs = {
      readBytes: async (p: string) => {
        const v = files.get(p)
        if (!v) throw new Error('ENOENT')
        return v
      },
      writeBytes: async (p: string, b: Uint8Array) => {
        files.set(p, b)
      },
      remove: async (p: string) => {
        files.delete(p)
      },
    }
    const backend = createFileFetchCacheStorage(fs, 'cache/http')
    // 写入两条
    await backend.write('e-aaaaaaaa', JSON.stringify({ v: 1, entry: {}, cacheKey: 'a' }))
    await backend.write('e-bbbbbbbb', JSON.stringify({ v: 1, entry: {}, cacheKey: 'b' }))
    expect((await backend.keys()).length).toBe(2)
    await backend.clearAll()
    expect(await backend.keys(), '★clearAll 之后仍能列出键 ⇒ 没清干净').toEqual([])
    expect(await backend.read('e-aaaaaaaa'), '★clearAll 之后旧值仍可读 ⇒ 没清干净').toBeNull()
    expect(files.size, '★磁盘上仍有文件残留').toBe(0)
  })

  it('★★KV 后端：clearAll 只清本层键（不动别人的数据）', async () => {
    const map = new Map<string, string>([
      ['e-aaaaaaaa', '{}'],
      ['__pf-cache-index.json', '{}'],
      ['other-app-key', 'keep-me'],
      ['v1:user:123', 'also-keep'],
    ])
    const backend = createKvFetchCacheStorage({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
      keys: () => [...map.keys()],
    })
    await backend.clearAll()
    expect(map.has('e-aaaaaaaa'), '★本层条目没清掉').toBe(false)
    expect(map.has('__pf-cache-index.json'), '★索引没清掉').toBe(false)
    expect(map.get('other-app-key'), '★★误删了其它模块的数据（清盘范围过大）').toBe('keep-me')
    expect(map.get('v1:user:123'), '★★误删了业务数据').toBe('also-keep')
  })

  it('★store.clear() 走 backend.clearAll（不靠索引）', async () => {
    const files = new Map<string, Uint8Array>()
    const fs = {
      readBytes: async (p: string) => {
        const v = files.get(p)
        if (!v) throw new Error('ENOENT')
        return v
      },
      writeBytes: async (p: string, b: Uint8Array) => {
        files.set(p, b)
      },
      remove: async (p: string) => {
        files.delete(p)
      },
    }
    const backend = createFileFetchCacheStorage(fs, 'cache/http')
    const store = createPersistentFetchCache({ backend, flushDelayMs: 0 })
    store.put({
      key: 'GET http://x/a rt=auto',
      status: 200,
      headers: {},
      body: { kind: 'text', text: 'x' },
      json: false,
      storedAt: 0,
      lifetimeMs: 60000,
      mustRevalidate: false,
      varyNames: [],
      varyValues: {},
      lastUsed: 0,
      bytes: 0,
    })
    await store.flush()
    expect(files.size).toBeGreaterThan(0)
    store.clear()
    await new Promise((r) => setTimeout(r, 40))
    expect(files.size, '★store.clear() 没清盘').toBe(0)
  })
})

describe('★★#1151 `createFetchCache` 的 persist 开关', () => {  it('★`persist` 未设置 ⇒ 纯内存（store 无 persistStats）', () => {
    const ctl = createFetchCache({ enabled: true })
    expect((ctl as unknown as { persistStats?: unknown }).persistStats, '★没开持久化却有持久层读数').toBeUndefined()
  })

  it('★★介质不可用 ⇒ 仍能查缓存（降级为内存），不抛', () => {
    // 清空所有介质 ⇒ choosePersistBackend 返回 degraded
    const ctl = createFetchCache({ enabled: true, persist: true })
    // 关键：构造控制器本身不能抛（缓存是可选加速层）
    expect(ctl).toBeTruthy()
    // 降级后没有持久层读数
    expect((ctl as unknown as { persistStats?: unknown }).persistStats).toBeUndefined()
  })

  it('★开了持久化 ⇒ 控制器暴露 persistStats 与 flush（判据/收尾用）', () => {
    const map = new Map<string, string>()
    const ctl = createFetchCache({
      enabled: true,
      persist: {
        backend: {
          kind: 'kv',
          read: async (k: string) => map.get(k) ?? null,
          write: async (k: string, v: string) => {
            map.set(k, v)
            return true
          },
          remove: async (k: string) => {
            map.delete(k)
          },
          keys: async () => [...map.keys()],
        },
      },
    })
    expect(typeof (ctl as unknown as { persistStats?: () => unknown }).persistStats).toBe('function')
    expect(typeof ctl.flush).toBe('function')
  })
})
