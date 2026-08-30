// packages/runtime/src/pinia/persistence/lightweight.ts
// 自研轻量持久化（docs/proteus-pinia-plan M2 后半 + M7.1/M7.2 增强）
//   · M2：persisted() 标记 + pick/omit + 防抖写盘 + 零开销（未标记不挂订阅）
//   · M7.1：eager/lazy/keys 分片（惰性 hydrate：$hydrated/$hydrate）
//   · M7.2：调度器（防抖 + maxWait + 高频合并 + 串行 flush）
// 与 createPersistedStatePlugin（兼容层）可共存：识别标记不同（__persisted__ vs persist）
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开（用 Object.assign）/ 数组解构
import type { PiniaPluginContext } from 'pinia'
import { type StorageAdapter } from '@proteus-vue/shared'
import { getPlatform } from '@proteus-vue/shared'
import { PersistScheduler, type PersistSchedulerOptions } from './scheduler'
import { isLazy, mountSharding, pickKeys, type ShardingOptions } from './sharding'
import { QuotaManager, QuotaExceededError, type QuotaOptions } from './quota'
import { parseVersioned, runMigrations, serializeWithVersion, type VersionedOptions } from './migrate'
import { prepareForPersist, restoreFromPersist, type SecureOptions } from './secure'
import { registerPageStore } from '../scope'

// 类型扩充：pinia 的 DefineStoreOptions 声明自定义持久化字段（vue-router 同款 augmentation 模式）
declare module 'pinia' {
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    /** pinia-plan 兼容层：社区 pinia-plugin-persistedstate 形态（plugin.ts 消费） */
    persist?: unknown
    /** pinia-plan 轻量方案：persisted() 标记（本文件消费） */
    persistence?: unknown
  }
}
import type { StateTree } from 'pinia'

export interface PersistenceOptions extends ShardingOptions, VersionedOptions, SecureOptions {
  /** 白名单字段（支持嵌套路径 a.b.c，与持久化时的提取/恢复一致） */
  pick?: string[]
  /** 黑名单字段（与 pick 二选一） */
  omit?: string[]
  /** 覆盖全局默认 storage */
  storage?: StorageAdapter
  /** 存储 key（默认 store.$id） */
  key?: string
  /** 写盘防抖窗口（ms，默认 50；M7.2 调度器 debounce，传 0 关闭防抖） */
  debounce?: number
  /** M7.2：调度器配置（per-store 覆盖全局；maxWait/高频合并等） */
  scheduler?: PersistSchedulerOptions
  /** M7.3：配额管理（per-store 覆盖全局） */
  quota?: QuotaOptions
  /** M7.5：生命周期作用域（'app' 默认 | 'page' 页面级，dispose 时清） */
  scope?: 'app' | 'page'
}

/** 持久化标记（编译期/运行时识别：未标记的 store 零开销） */
const PERSIST_MARK = '__persisted__'

/**
 * 标识函数：在 store options 里声明持久化（类型安全）
 * 用法：defineStore('user', () => {...}, { persistence: persisted({ pick: ['token'] }) })
 */
export function persisted(options: PersistenceOptions = {}): PersistenceOptions {
  return Object.assign({ [PERSIST_MARK]: true }, options)
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

/** pick/omit 过滤（仅 state 字段——getters 天然排除，可从 state 重算） */
function applyFilter(state: Record<string, unknown>, opt: PersistenceOptions): Record<string, unknown> {
  if (opt.pick && opt.pick.length > 0) {
    const out: Record<string, unknown> = {}
    for (const p of opt.pick) {
      const segs = p.split('.')
      let node = out
      for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i]
        if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {}
        node = node[seg] as Record<string, unknown>
      }
      node[segs[segs.length - 1]] = getByPath(state, p)
    }
    return out
  }
  if (opt.omit && opt.omit.length > 0) {
    const out = Object.assign({}, state)
    for (const o of opt.omit) {
      const segs = o.split('.')
      if (segs.length === 1) {
        delete out[o]
      } else {
        let node = out
        for (let i = 0; i < segs.length - 1; i++) {
          const seg = segs[i]
          const next = node[seg]
          if (typeof next !== 'object' || next === null) break
          node = next as Record<string, unknown>
        }
        delete node[segs[segs.length - 1]]
      }
    }
    return out
  }
  return state
}

export interface PersistenceGlobal {
  /** 全局默认 storage */
  storage: StorageAdapter
  /** M7.2：全局调度器配置（共享实例 → 串行 flush；per-store persisted({scheduler}) 覆盖） */
  scheduler?: PersistSchedulerOptions
  /** M7.3：全局配额管理（共享实例；per-store persisted({quota}) 覆盖） */
  quota?: QuotaOptions
}

/**
 * 创建轻量持久化插件（全局默认 storage 由平台入口注入）
 * 用法：pinia.use(createPersistence({ storage: new WxStorageAdapter() }))
 */
export function createPersistence(global: PersistenceGlobal) {
  // 共享调度器：所有 store 的写入统一节奏 + 串行 flush（无显式配置也走调度——防抖语义与 M2 一致）
  const sharedScheduler = new PersistScheduler(global.storage, global.scheduler ?? { debounce: 50 })
  // M7.3：共享配额管理器（全局配置时启用；淘汰事件日志）
  const sharedQuota =
    global.quota !== undefined ? new QuotaManager(global.storage, global.quota) : null
  if (sharedQuota) {
    sharedQuota.onEvict = (ev) => {
      console.warn(`[proteus] 配额淘汰 ${ev.key}（${ev.usedBytes}/${ev.maxBytes}B，${ev.strategy}）`)
    }
  }

  return function persistencePlugin(ctx: PiniaPluginContext): void {
    const opt = ctx.options.persistence as (PersistenceOptions & { [PERSIST_MARK]?: boolean }) | undefined
    // 未声明 persisted() → 零开销（不挂订阅）
    if (!opt || opt[PERSIST_MARK] !== true) return

    // SSR：跳过持久化（只创建空 state，避免 hydration mismatch）
    if (getPlatform() === 'ssr') return

    const storage = opt.storage === undefined ? global.storage : opt.storage
    const key = opt.key === undefined ? ctx.store.$id : opt.key
    const scheduler =
      opt.scheduler !== undefined || opt.debounce !== undefined
        ? new PersistScheduler(storage, Object.assign({}, opt.scheduler, opt.debounce !== undefined ? { debounce: opt.debounce } : {}))
        : sharedScheduler
    const quota = opt.quota !== undefined ? new QuotaManager(storage, opt.quota) : sharedQuota
    const version = opt.version ?? 0

    /** 从存储读取并恢复（版本迁移 → 敏感字段解密/剔 volatile → 过滤 → keys 限制） */
    const doHydrate = async (): Promise<Record<string, unknown> | null> => {
      const raw = await storage.getItem(key)
      if (raw === null) return null
      // M7.4：版本迁移（失败 → null → 初始值兜底）
      const parsed = parseVersioned(raw)
      const migrated = runMigrations(parsed, version, opt.migrations)
      if (!migrated) return null
      // M7.6：volatile 不恢复 + encrypted 解密
      let data = restoreFromPersist(migrated.state, opt)
      data = applyFilter(data, opt)
      if (opt.keys && opt.keys.length > 0) data = pickKeys(data, opt.keys)
      return data
    }

    // M7.1：eager（默认）立即 hydrate；lazy → $hydrated/$hydrate 惰性
    if (isLazy(opt)) {
      mountSharding(ctx, opt, doHydrate)
    } else {
      void doHydrate()
        .then((data) => {
          if (data) ctx.store.$patch(data as never)
        })
        .catch((err) => {
          console.warn('[proteus] 持久化恢复失败（存储后端异常）', err)
        })
    }

    // M7.5：scope: 'page' → 注册页面级（应用在页面 onUnload 调 disposePageStores(pageId) 批量销毁）
    if (opt.scope === 'page') {
      registerPageStore(ctx.store.$id, ctx.store)
    }

    // Subscribe（写入调度：防抖 + maxWait + 高频合并 + 串行 flush + 版本标记 + 敏感字段处理）
    // M7.3：配额检查挂在写盘完成后（flush → 淘汰真实数据，账本一致）
    scheduler.onAfterFlush = (written) => {
      if (!quota) return
      void Promise.all(
        Array.from(written.entries()).map(([k, v]) =>
          quota.recordWrite(k, v).catch((err: unknown) => {
            if (err instanceof QuotaExceededError) {
              console.warn(err.message)
            } else {
              console.warn('[proteus] 配额检查异常', err)
            }
          }),
        ),
      )
    }
    ctx.store.$subscribe(
      (_m, state) => {
        // M7.6：volatile 不落盘 + encrypted 加密
        const safe = prepareForPersist(applyFilter(state, opt), opt)
        const data = serializeWithVersion(safe, version)
        scheduler.schedule(key, data)
      },
      { detached: true },
    )
  }
}
