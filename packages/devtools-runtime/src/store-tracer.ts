// packages/devtools-runtime/src/store-tracer.ts
// devtools-plan M4：store 事件追踪（发射端）——pinia store 变更 → TraceBus `store` 源事件
// 面板 state 视图消费协议：`store.patch` point 事件，payload = { id: storeId, ...state 快照 }
//   （面板聚合：payload.id 更新快照 + 进步骤列表 → inspector 树 + 时间旅行滑块）
// ★type-only pinia 导入（运行时零依赖）；MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import type { Pinia, Store } from 'pinia'

/** store 事件总线（结构与 devtools-runtime TraceBus.emit 兼容；业务侧直接传 createTraceBus 实例） */
export interface StoreTraceBus {
  emit(source: 'store', phase: 'point', name: string, payload?: unknown, traceId?: string): void
}

export interface StoreTracer {
  /** 停止追踪（全部 $subscribe 卸载） */
  dispose(): void
}

/**
 * 追踪 pinia 变更 → store 事件：
 *   · 已注册 store：遍历 pinia._s 逐个 $subscribe
 *   · 未来创建 store：pinia.use 插件在 store 创建时挂 $subscribe（★需 pinia 已 install（app.use(pinia)）——
 *     未 install 时 use 插件进 toBeInstalled 延迟到 install 生效；已存在 store 不补跑 → 双路覆盖）
 *   · payload 为 { id: storeId, ...state }（去 $id），逐 key 拷贝防引用逃逸
 * ★注：$subscribe 对 direct mutation 走 vue watch（异步 flush + 首触发吞事件）；$patch 同步触发——面板 16ms 节流渲染无感知
 */
export function createStoreTracer(pinia: Pinia, bus: StoreTraceBus): StoreTracer {
  const offs: Array<() => void> = []
  let seq = 0

  function trace(store: Store): void {
    const off = store.$subscribe((_mutation, state) => {
      const snapshot: Record<string, unknown> = { id: store.$id }
      for (const key of Object.keys(state)) {
        if (key === '$id') continue
        snapshot[key] = (state as Record<string, unknown>)[key]
      }
      bus.emit('store', 'point', 'store.patch', snapshot, 'store-' + ++seq)
    })
    offs.push(off)
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
    },
  }
}
