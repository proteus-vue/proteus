// packages/devtools/src/component-trace.ts
// devtools 打通：Vue 组件树发射端（Web 端）——app.mixin 注入 mounted/unmounted → component 源事件
//   面板 components 视图聚合为组件树（mount/unmount）；MP 端编译产物无 vue 实例——component 事件由编译期注入（后续）
// ★type-only vue 导入（运行时仅用 app.mixin）；bus 门控生产零开销
import type { App } from 'vue'

/** component 事件总线（结构与 devtools-runtime TraceBus.emit 兼容；业务侧直接传 createTraceBus 实例） */
export interface ComponentTraceBus {
  emit(source: 'component', phase: 'point', name: string, payload?: unknown, traceId?: string): void
}

/**
 * 注入组件生命周期事件：
 *   component.mount   payload { id, name, parentId }   traceId comp-<id>
 *   component.unmount payload { id }                    （面板移除节点）
 * 实例 id 经 WeakMap 稳定（复用组件挂载 id 不变 → 面板计数 ×N）
 * ★app.mixin 无卸载 API——安装后随 app 生命周期；返回 no-op 保持调用面一致
 */
export function installComponentTrace(app: App, bus: ComponentTraceBus): () => void {
  const ids = new WeakMap<object, number>()
  let seq = 0

  function getId(instance: object): number {
    const id = ids.get(instance)
    if (id !== undefined) return id
    const next = ++seq
    ids.set(instance, next)
    return next
  }

  app.mixin({
    mounted() {
      const self = this as { $options?: { name?: string; __name?: string }; $parent?: object }
      const parentId = self.$parent ? getId(self.$parent) : undefined
      const name = self.$options?.name ?? self.$options?.__name ?? 'Anonymous'
      const id = getId(self)
      bus.emit('component', 'point', 'component.mount', { id, name, parentId }, 'comp-' + id)
    },
    unmounted() {
      const id = getId(this as object)
      bus.emit('component', 'point', 'component.unmount', { id }, 'comp-' + id)
    },
  })
  return () => {
    // mixin 无法移除（vue 无卸载 API）；应用级 trace 随 app 生命周期
  }
}
