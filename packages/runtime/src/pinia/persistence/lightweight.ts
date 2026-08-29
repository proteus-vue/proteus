// packages/runtime/src/pinia/persistence/lightweight.ts
// 自研轻量持久化（docs/proteus-pinia-plan M2 后半）—— 比社区插件更少样板、防抖写盘、类型安全
// 与 createPersistedStatePlugin（兼容层）可共存：识别标记不同（__persisted vs persist）
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开（用 Object.assign）/ 数组解构
import type { PiniaPluginContext, StateTree } from 'pinia'
import { serialize, deserialize, type StorageAdapter } from '@proteus/shared'
import { getPlatform } from '@proteus/shared'

// 类型扩充：pinia 的 DefineStoreOptions 声明自定义持久化字段（vue-router 同款 augmentation 模式）
declare module 'pinia' {
  export interface DefineStoreOptionsBase<S extends StateTree, Store> {
    /** pinia-plan 兼容层：社区 pinia-plugin-persistedstate 形态（plugin.ts 消费） */
    persist?: unknown
    /** pinia-plan 轻量方案：persisted() 标记（本文件消费） */
    persistence?: unknown
  }
}

export interface PersistenceOptions {
  /** 白名单字段（支持嵌套路径 a.b.c，与持久化时的提取/恢复一致） */
  pick?: string[]
  /** 黑名单字段（与 pick 二选一） */
  omit?: string[]
  /** 覆盖全局默认 storage */
  storage?: StorageAdapter
  /** 存储 key（默认 store.$id） */
  key?: string
  /** 写盘防抖窗口（ms，默认 50；传 0 关闭防抖） */
  debounce?: number
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
        // 嵌套 omit：只删叶路径（简化：顶层段定位到父对象后 delete）
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

/**
 * 创建轻量持久化插件（全局默认 storage 由平台入口注入）
 * 用法：pinia.use(createPersistence({ storage: new WxStorageAdapter() }))
 */
export function createPersistence(global: { storage: StorageAdapter }) {
  return function persistencePlugin(ctx: PiniaPluginContext): void {
    const opt = ctx.options.persistence as (PersistenceOptions & { [PERSIST_MARK]?: boolean }) | undefined
    // 未声明 persisted() → 零开销（不挂订阅）
    if (!opt || opt[PERSIST_MARK] !== true) return

    // SSR：跳过持久化（只创建空 state，避免 hydration mismatch）
    if (getPlatform() === 'ssr') return

    const storage = opt.storage === undefined ? global.storage : opt.storage
    const key = opt.key === undefined ? ctx.store.$id : opt.key
    const debounce = opt.debounce === undefined ? 50 : opt.debounce

    // Hydrate（异步恢复）
    void storage.getItem(key).then((raw) => {
      if (raw !== null) {
        const saved = deserialize<Record<string, unknown>>(raw)
        // as never：动态结构恢复（运行时无影响，类型断言剥离）
        ctx.store.$patch(applyFilter(saved, opt) as never)
      }
    })

    // Subscribe（防抖写盘；高频变更合并为一次）
    let timer: ReturnType<typeof setTimeout> | null = null
    ctx.store.$subscribe(
      (_m, state) => {
        const data = serialize(applyFilter(state, opt))
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void storage.setItem(key, data)
        }, debounce)
      },
      { detached: true },
    )
  }
}
