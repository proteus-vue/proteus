// packages/runtime/src/pinia/persistence/plugin.ts
// 兼容 pinia-plugin-persistedstate 的持久化插件（docs/proteus-pinia-plan M2 前半）
// 目标：现有使用 pinia-plugin-persistedstate 的项目「零改动」迁移到 Proteus 多端——
//   persist.storage 不写（自动选平台 Adapter）或写 localStorage（自动包成 Adapter）
// ★差异点（对齐社区插件）：
//   · storage 选项可选（不传自动按平台 createStorage()）——社区必传
//   · SSR 跳过判断用 getPlatform() === 'ssr'（Proteus 多端模型：MP 无 window 但需持久化）
//   · cookieOptions 不支持（App 端无 cookie 概念）
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { PiniaPluginContext } from 'pinia'
import { createStorage, serialize, deserialize, type StorageAdapter } from '@proteus/shared'
import { getPlatform } from '@proteus/shared'

/** 兼容层选项（对齐 pinia-plugin-persistedstate 的 persist 配置） */
export interface PersistOptions {
  /** 存储 key（默认 store.$id） */
  key?: string
  /** 存储后端：StorageAdapter 或 Web Storage 兼容对象（localStorage/sessionStorage）；不传自动选平台 */
  storage?: StorageAdapter | { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
  /** 只持久化指定字段（支持 lodash-style 嵌套路径 a.b.c） */
  paths?: string[]
  beforeRestore?: (ctx: PiniaPluginContext) => void
  afterRestore?: (ctx: PiniaPluginContext) => void
}

/** 把 Web Storage 兼容对象包成 StorageAdapter */
function normalizeStorage(s: PersistOptions['storage']): StorageAdapter {
  if (typeof s === 'object' && s !== null && typeof (s as { getItem?: unknown }).getItem === 'function') {
    const web = s as { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
    return {
      getItem: (k) => Promise.resolve(web.getItem(k)),
      setItem: async (k, v) => {
        web.setItem(k, v)
      },
      removeItem: async (k) => {
        web.removeItem(k)
      },
    }
  }
  return s as StorageAdapter
}

/** 按路径读取（a.b.c），支持数组下标 a.0.b */
function getByPath(state: Record<string, unknown>, path: string): unknown {
  let cur: unknown = state
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 按路径集合挑字段（paths 语义：a.b.c 提取 { a: { b: { c } } }） */
function pickPaths(state: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of paths) {
    const segs = p.split('.')
    let node = out
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      if (typeof node[seg] !== 'object' || node[seg] === null) {
        node[seg] = {}
      }
      node = node[seg] as Record<string, unknown>
    }
    node[segs[segs.length - 1]] = getByPath(state, p)
  }
  return out
}

/**
 * 创建兼容层插件：与 createPersistence（自研）可共存（识别标记不同）
 * 用法：pinia.use(createPersistedStatePlugin({ storage: new WxStorageAdapter() }))
 */
export function createPersistedStatePlugin(options: { storage?: StorageAdapter } = {}) {
  const defaultStorage = options.storage === undefined ? createStorage() : options.storage

  return function persistedStatePlugin(ctx: PiniaPluginContext): void {
    const persist = ctx.options.persist as PersistOptions | undefined
    if (!persist) return // 该 store 不需要持久化

    // SSR：只创建空 state，跳过 hydrate + subscribe（避免 hydration mismatch）
    if (getPlatform() === 'ssr') return

    const storage = persist.storage === undefined ? defaultStorage : normalizeStorage(persist.storage)
    const key = persist.key === undefined ? ctx.store.$id : persist.key

    // 1. 初始化：从 storage 恢复（异步——Adapter 统一 async）
    if (persist.beforeRestore) persist.beforeRestore(ctx)
    void storage.getItem(key).then((raw) => {
      if (raw !== null) {
        const saved = deserialize<Record<string, unknown>>(raw)
        const data = persist.paths ? pickPaths(saved, persist.paths) : saved
        // as never：动态结构恢复（运行时无影响，类型断言剥离）
        ctx.store.$patch(data as never)
      }
      if (persist.afterRestore) persist.afterRestore(ctx)
    })

    // 2. 订阅变化：写入 storage
    ctx.store.$subscribe(
      (_mutation, state) => {
        const data = persist.paths ? pickPaths(state, persist.paths) : state
        void storage.setItem(key, serialize(data))
      },
      { detached: true },
    )
  }
}
