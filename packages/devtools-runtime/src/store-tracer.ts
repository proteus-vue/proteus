// packages/devtools-runtime/src/store-tracer.ts
// devtools-plan M4：store 事件追踪（发射端）——pinia store 变更 → TraceBus `store` 源事件
// 面板 state 视图（对标 Vue DevTools Pinia 面板）消费协议：
//   `store.patch`  point  payload { id: storeId, ...state 快照 }   —— 初始快照（store 创建）+ state 变更（direct/$patch）
//   `store.action` point  payload { id: storeId, name: actionName } —— action 调用（包装捕获）
// ★type-only pinia 导入（运行时零依赖）；MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import type { Pinia, Store } from 'pinia'

/** store 事件总线（结构与 devtools-runtime TraceBus.emit 兼容；业务侧直接传 createTraceBus 实例） */
export interface StoreTraceBus {
  emit(source: 'store', phase: 'point', name: string, payload?: unknown, traceId?: string): void
}

export interface StoreTracer {
  /** 停止追踪（$subscribe 卸载 + action 包装还原） */
  dispose(): void
}

/**
 * 追踪 pinia 变更 → store 事件：
 *   · 已注册 store：遍历 pinia._s 逐个 $subscribe + 包装 actions
 *   · 未来创建 store：pinia.use 插件在 store 创建时挂（★需 pinia 已 install（app.use(pinia)）——
 *     未 install 时 use 插件进 toBeInstalled 延迟到 install 生效；已存在 store 不补跑 → 双路覆盖）
 *   · `store.patch`：★初始快照（store 创建即发——面板时间旅行「滑块最左 = 初始状态」+ state 视图打开即有数据）
 *     + $subscribe 的 direct/patch mutation → { id, ...state } 快照（去 $id，逐 key 拷贝防引用逃逸）
 *   · `store.action`：★pinia 4.x $subscribe 对 action 只报 type 'direct'（无 actionName）→ 包装 store 实例函数
 *     属性捕获 action 调用（$ 开头跳过；getter 是 computed ref 非函数不误包）；dispose 还原原函数
 * ★注：$subscribe 对 direct mutation 走 vue watch（异步 flush + 首触发吞事件）；$patch 同步触发——面板 16ms 节流渲染无感知
 */
export function createStoreTracer(pinia: Pinia, bus: StoreTraceBus): StoreTracer {
  const offs: Array<() => void> = []
  /** 被包装的 store 原函数（dispose 还原） */
  const originals = new Map<Store, Map<string, unknown>>()
  let seq = 0

  /** 包装 store 的 action 方法 → 每次调用发 store.action 事件 */
  function wrapActions(store: Store): void {
    const saved = new Map<string, unknown>()
    originals.set(store, saved)
    for (const key of Object.keys(store)) {
      if (key.startsWith('$')) continue
      const fn = (store as unknown as Record<string, unknown>)[key]
      if (typeof fn !== 'function') continue
      saved.set(key, fn)
      const name = key
      ;(store as unknown as Record<string, unknown>)[key] = function (this: unknown, ...args: unknown[]) {
        bus.emit('store', 'point', 'store.action', { id: store.$id, name }, 'store-' + ++seq)
        return (fn as (...a: unknown[]) => unknown).apply(this, args)
      }
    }
  }

  function trace(store: Store): void {
    wrapActions(store)
    // ★初始快照：store 创建即有完整 state（面板时间旅行「拖到最左 = 初始」+ state 视图打开即有数据）
    emitSnapshot(store)
    const off = store.$subscribe((_mutation, state) => {
      void state
      emitSnapshot(store)
    })
    offs.push(off)
  }

  /** 读取 store 当前 state → store.patch 事件（payload { id, ...state }；去 $id，逐 key 拷贝防引用逃逸） */
  function emitSnapshot(store: Store): void {
    const snapshot: Record<string, unknown> = { id: store.$id }
    const state = (store as unknown as { $state?: Record<string, unknown> }).$state
    if (state) {
      for (const key of Object.keys(state)) {
        if (key === '$id') continue
        snapshot[key] = state[key]
      }
    }
    bus.emit('store', 'point', 'store.patch', snapshot, 'store-' + ++seq)
  }

  const registered = (pinia as unknown as { _s: Map<string, Store> })._s
  for (const store of registered.values()) trace(store)
  pinia.use(({ store }) => {
    trace(store)
  })

  return {
    dispose() {
      for (const off of offs) off()
      offs.length = 0
      // 还原 action 包装
      for (const entry of originals) {
        const store = entry[0]
        const saved = entry[1]
        for (const kv of saved) (store as unknown as Record<string, unknown>)[kv[0]] = kv[1]
      }
      originals.clear()
    },
  }
}
