// packages/devtools/src/component-trace.ts
// devtools 打通：Vue 组件树发射端（Web 端）——app.mixin 注入 mounted/unmounted → component 源事件
//   面板 components 视图聚合为组件树（mount/unmount）；MP 端编译产物无 vue 实例——component 事件由编译期注入（后续）
// ★type-only vue 导入（运行时仅用 app.mixin）；bus 门控生产零开销
// ★P1 升级：mount payload 带 props/state 序列化快照（serializeState type tag 安全）+ 元素 registry（页面高亮用）
import type { App } from 'vue'
import { serializeState } from '@proteus-vue/devtools-runtime'

/** component 事件总线（结构与 devtools-runtime TraceBus.emit 兼容；业务侧直接传 createTraceBus 实例） */
export interface ComponentTraceBus {
  emit(source: 'component', phase: 'point', name: string, payload?: unknown, traceId?: string): void
}

/** 组件快照数据（props/state 序列化后——type tag 安全，JSON-safe） */
export interface ComponentSnapshot {
  props?: unknown
  state?: unknown
}

/** DOM 树节点（选中组件时构建渲染元素树，事件流下发——远程面板同样可见） */
export interface DomTreeNode {
  tag: string
  id?: string
  cls?: string[]
  children: DomTreeNode[]
}

/**
 * 构建 DOM 元素树摘要（选中组件 → 渲染结构可视化）：tag/id/class + 子元素递归
 * ★深度/数量上限防超大 payload（depth ≤ 4、children ≤ 20、class ≤ 10）
 */
export function buildDomTree(el: Element, depth = 0): DomTreeNode | null {
  if (depth > 4) return null
  const node: DomTreeNode = { tag: el.tagName.toLowerCase(), children: [] }
  if (el.id) node.id = el.id
  const cls = Array.from(el.classList)
  if (cls.length) node.cls = cls.slice(0, 10)
  let count = 0
  for (const child of Array.from(el.children)) {
    if (count >= 20) break
    const sub = buildDomTree(child, depth + 1)
    if (sub) {
      node.children.push(sub)
      count++
    }
  }
  return node
}

export interface ComponentTraceHandle {
  dispose(): void
  /** ★P1：按组件 id 取根 DOM 元素（页面高亮；fragment 取首个元素节点） */
  getElement(id: number): HTMLElement | null
}

/**
 * 注入组件生命周期事件：
 *   component.mount   payload { id, name, parentId, props?, state? }   traceId comp-<id>（★props/state 为 mount 时刻快照）
 *   component.unmount payload { id }                    （面板移除节点）
 * 实例 id 经 WeakMap 稳定（复用组件挂载 id 不变 → 面板计数 ×N）
 * ★app.mixin 无卸载 API——安装后随 app 生命周期；返回 handle（dispose no-op + getElement registry）
 */
export function installComponentTrace(app: App, bus: ComponentTraceBus): ComponentTraceHandle {
  const ids = new WeakMap<object, number>()
  const elements = new Map<number, HTMLElement | null>()
  let seq = 0

  function getId(instance: object): number {
    const id = ids.get(instance)
    if (id !== undefined) return id
    const next = ++seq
    ids.set(instance, next)
    return next
  }

  /** 组件公共实例 → 根 DOM 元素（fragment → 首个元素子节点；组件无根节点（keep-alive 空）→ null） */
  function getRootEl(self: { $el?: unknown }): HTMLElement | null {
    const el = self.$el
    if (!el || typeof el !== 'object') return null
    const node = el as { nodeType?: number; firstElementChild?: HTMLElement | null }
    if (node.nodeType === 1) return el as HTMLElement
    return node.firstElementChild ?? null
  }

  /** 组件快照（props + options data + setupState；serializeState 处理循环/Date/Map/Set） */
  function snapshot(self: { $props?: unknown; $data?: unknown; $?: { setupState?: unknown } }): ComponentSnapshot {
    const out: ComponentSnapshot = {}
    if (self.$props && typeof self.$props === 'object') out.props = serializeState(self.$props)
    const data = self.$data && typeof self.$data === 'object' ? (self.$data as Record<string, unknown>) : undefined
    const setupState = self.$?.setupState
    if (data && Object.keys(data).length) {
      out.state = serializeState(data)
    } else if (setupState && typeof setupState === 'object' && Object.keys(setupState as object).length) {
      out.state = serializeState(setupState)
    }
    return out
  }

  app.mixin({
    mounted() {
      const self = this as { $options?: { name?: string; __name?: string }; $parent?: object } & object
      const parentId = self.$parent ? getId(self.$parent) : undefined
      const name = self.$options?.name ?? self.$options?.__name ?? 'Anonymous'
      const id = getId(self)
      const el = getRootEl(self as { $el?: unknown })
      elements.set(id, el)
      bus.emit('component', 'point', 'component.mount', { id, name, parentId, ...snapshot(self as never) }, 'comp-' + id)
    },
    unmounted() {
      const id = getId(this as object)
      elements.delete(id)
      bus.emit('component', 'point', 'component.unmount', { id }, 'comp-' + id)
    },
  })
  return {
    dispose() {
      // mixin 无法移除（vue 无卸载 API）；应用级 trace 随 app 生命周期
    },
    getElement(id) {
      return elements.get(id) ?? null
    },
  }
}
