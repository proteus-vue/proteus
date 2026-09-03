// packages/render-backend/src/vue-bridge.ts
// ★G-41 B3（proteus-host-integration-plan batches B3）：真实 Vue createRenderer 接入 —— 标准 SFC/render 函数经 Dispatcher 落到任意后端
//   Vue 在 Proteus 里是「编译器 + 响应式引擎」，不是渲染引擎——渲染最后一步 nodeOps 是 SPI（B1 Dispatcher）
//   本文件：把 ProteusNodeOpsDispatcher 包装成 Vue 官方 createRenderer 的 RendererOptions（对齐 renderer-app host.ts 模型）
//   产出：createProteusRenderer（标准 Vue renderer）——createApp(...).mount(后端容器节点) 即 "Vue 代码不变、引擎可换"
//   ★结构性：业务 SFC → Vue 编译器 → VNode 树（不变）→ 本 bridge 的 nodeOps → currentBackend（可换）
import { createRenderer } from '@vue/runtime-core'
import type { RendererOptions } from '@vue/runtime-core'
import type { NodeHandle } from './spi'
import { createNodeOpsDispatcher } from './dispatcher'
import type { DispatcherNodeOps, ProteusNodeOpsDispatcher } from './dispatcher'

/** B3 bridge：Dispatcher → Vue RendererOptions（HostNode=HostElement=NodeHandle——后端句柄即 Vue 的"节点"） */
export function createVueRendererOptions(dispatch: ProteusNodeOpsDispatcher): RendererOptions<NodeHandle, NodeHandle> {
  const d: DispatcherNodeOps = dispatch.nodeOps
  return {
    // Vue 真实签名：createElement(type, namespace?, isCustomizedBuiltIn?, vnodeProps?)
    createElement(type, _namespace, _isCustomizedBuiltIn, vnodeProps) {
      return d.createElement(type, (vnodeProps ?? {}) as Record<string, unknown>)
    },
    createText(text) {
      return d.createText(text)
    },
    createComment(text) {
      return d.createComment(text)
    },
    setText(node, text) {
      d.setText(node, text)
    },
    // 元素直接文本内容（Vue 清空子树时调用）——语义等价 setText
    setElementText(el, text) {
      d.setText(el, text)
    },
    insert(child, parent, anchor) {
      d.insert(child, parent, anchor ?? undefined)
    },
    remove(node) {
      d.remove(node)
    },
    parentNode(node) {
      return d.parentNode(node) ?? null
    },
    nextSibling(node) {
      return d.nextSibling(node) ?? null
    },
    patchProp(el, key, prev, next) {
      d.patchProp(el, key, prev, next)
    },
    // —— 以下对齐 renderer-app host.ts 语义降级（非核心渲染路径） ——
    querySelector() {
      return null // 后端树由渲染器持有，无 DOM 查询（对齐原生扁平布局）
    },
    setScopeId() {
      // 无 CSS 作用域（原生/后端树无 className scoping）
    },
    cloneNode() {
      return d.createComment('') // 静态提升克隆 → 注释占位（不克隆后端节点）
    },
    insertStaticContent(_content, parent, anchor) {
      // 静态 HTML → 空
      const c = d.createComment('')
      if (parent) d.insert(c, parent, anchor ?? undefined)
      return [c, c]
    },
  }
}

export interface ProteusRenderer {
  /** 底层 Dispatcher（换引擎/查 trace/热切换） */
  dispatch: ProteusNodeOpsDispatcher
  /** 标准 Vue renderer（createRenderer(nodeOps) 产物——createApp/render 均可用） */
  renderer: ReturnType<typeof createRenderer<NodeHandle, NodeHandle>>
}

/**
 * 创建 Proteus 渲染器：Dispatcher → Vue RendererOptions → createRenderer
 *   const { renderer } = createProteusRenderer(createNodeOpsDispatcher(headlessBackend))
 *   renderer.render(h('p-text', { content: '商品 A' }), containerNode)  // containerNode = 后端容器句柄
 *   或 renderer.createApp(App).mount(containerNode)                      // 标准 App 入口
 */
export function createProteusRenderer(dispatch: ProteusNodeOpsDispatcher): ProteusRenderer {
  const renderer = createRenderer<NodeHandle, NodeHandle>(createVueRendererOptions(dispatch))
  return { dispatch, renderer }
}

/** 便捷：直接给后端就建好 Dispatcher + renderer（省一步 createNodeOpsDispatcher） */
export function createProteusRendererForBackend(backend: Parameters<typeof createNodeOpsDispatcher>[0]): ProteusRenderer {
  return createProteusRenderer(createNodeOpsDispatcher(backend))
}