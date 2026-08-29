// src/runtime/store/index.ts
// 框架级轻量 store（v0.4）—— 跨页共享状态 + 广播 setData
// 定位：
//   - Web 端：Pinia 原生可用（examples/main.ts createPinia + examples/stores/，见 pinia-demo 页）
//   - MP 端：Pinia 依赖跨模块编译（MVP 限制：产物单文件无模块系统），本模块是**过渡方案**——
//     单例 store + subscribe 广播，页面 connectPageStore 把变化 setData 到页面
// 演进：跨模块编译能力落地后（roadmap），MP 端 store 走编译期内联 + 本模块的广播机制
interface Store<T extends Record<string, unknown>> {
  /** 当前状态（引用） */
  state: T
  /** 批量更新（触发所有订阅者） */
  set(patch: Partial<T>): void
  /** 读取字段 */
  get<K extends keyof T>(key: K): T[K]
  /** 订阅变化，返回取消函数 */
  subscribe(fn: (patch: Partial<T>) => void): () => void
}

const stores = new Map<string, Store<Record<string, unknown>>>()

/** 创建（或复用）单例 store：跨页面共享状态 */
export function createStore<T extends Record<string, unknown>>(id: string, initial: T): Store<T> {
  const existing = stores.get(id) as Store<T> | undefined
  if (existing) return existing
  const listeners = new Set<(patch: Partial<T>) => void>()
  const state: T = { ...initial }
  const store: Store<T> = {
    state,
    set(patch) {
      Object.assign(state, patch)
      for (const fn of listeners) fn(patch)
    },
    get(k) {
      return state[k]
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  stores.set(id, store as Store<Record<string, unknown>>)
  return store
}

/**
 * 页面连接 store：订阅变化 → page.setData（MP 端页面 onReady 调用，onUnload 取消）
 * map：把 store 状态映射为页面 data 字段（默认全量 state）
 * 返回取消订阅函数
 */
export function connectPageStore(
  page: { setData(data: Record<string, unknown>): void },
  store: Store<Record<string, unknown>>,
  map?: (state: Store<Record<string, unknown>>) => Record<string, unknown>,
): () => void {
  // 初始同步
  page.setData(map ? map(store) : { ...store.state })
  return store.subscribe((patch) => {
    page.setData(map ? map(store) : patch)
  })
}
