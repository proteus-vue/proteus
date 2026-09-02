// packages/render-backend/src/headless.ts
// ★G-27 B3 前置：HeadlessBackend——内存节点树后端（零依赖纯逻辑）
//   SSR / 测试断言 / 截图 / AI Agent 无设备回归（Headless 是 G-23 Agent 的核心运行底座）
//   同时是 conformance 的参考实现（行为正确性由本文件单测兜底）
import type { BackendCapabilities, IRNode, NodeHandle, ProteusRenderBackend } from './spi'

export interface HeadlessNode {
  id: number
  type: string
  props: Record<string, unknown>
  children: HeadlessNode[]
  parent: HeadlessNode | null
  text: string
}

/** 序列化为纯对象树（测试断言 / SSR 输出 / Agent 快照） */
export function toPlainTree(root: HeadlessNode): Record<string, unknown> {
  return {
    id: root.id,
    type: root.type,
    props: { ...root.props },
    text: root.text,
    children: root.children.map(toPlainTree),
  }
}

/** ★G-31 B5：semantic 语义 → headless 节点类型（与 component-ir SEMANTIC_BACKEND_MAP headless 列同源——SSR/debug/AI Agent 视图语义化） */
const SEMANTIC_HEADLESS_MAP: Record<string, string> = {
  'layout.box': 'box',
  'layout.stack': 'stack',
  'layout.grid': 'grid',
  'layout.fluid': 'fluid',
  'layout.adaptive': 'adaptive',
  'layout.fit': 'fit',
  'layout.split': 'split',
  'layout.safe': 'safe',
  'layout.sidebar': 'sidebar',
  'ui.text': 'text',
  'ui.button': 'button',
  'ui.image': 'image',
  'ui.input': 'input',
  'ui.list': 'list',
  'ui.nav': 'nav',
  'capability.scan-qr': 'scan-qr',
  'capability.pick-photo': 'pick-photo',
  'capability.location': 'location',
  // ★G-32 B1：新增 implemented 语义（与 component-ir SEMANTIC_BACKEND_MAP headless 列同源）
  'layout.inline': 'inline',
  'layout.spacer': 'spacer',
  'layout.divider': 'divider',
  'layout.scroll': 'scroll',
  'layout.virtual-list': 'virtual-list',
  'layout.masonry': 'masonry',
  'ui.heading': 'heading',
  'ui.icon': 'icon',
  'ui.textarea': 'textarea',
  'ui.switch': 'switch',
  'ui.slider': 'slider',
  'shell.nav': 'nav',
  'shell.tabbar': 'tabbar',
  'shell.drawer': 'drawer',
  'shell.modal': 'modal',
  // ★G-32 B4：Shell 补齐 + UI 补齐（与 SEMANTIC_BACKEND_MAP headless 列同源）
  'shell.page': 'page',
  'shell.segment': 'segment',
  'shell.popover': 'popover',
  'shell.action-sheet': 'action-sheet',
  'ui.rich-text': 'rich-text',
  'ui.avatar': 'avatar',
  'ui.media': 'media',
  'ui.canvas': 'canvas',
  'ui.svg': 'svg',
  'ui.select': 'select',
  'ui.checkbox': 'checkbox',
  'ui.radio': 'radio',
  'ui.picker': 'picker',
  'ui.form': 'form',
  'gesture.draggable': 'draggable',
  'gesture.scrollable': 'scrollable',
}

const HEADLESS_CAPABILITIES: BackendCapabilities = {
  layout: 'none', // 框架 IR 求解（headless 无布局器）
  glass: 'none',
  blur: 'none',
  animation: 'js',
  textureSharing: false,
  remoteRendering: false,
  ssr: true,
  input: ['touch'],
}

export function createHeadlessBackend(): ProteusRenderBackend {
  let nextId = 1
  const nodes = new Map<number, HeadlessNode>()

  function ensureNode(handle: NodeHandle): HeadlessNode {
    const n = handle as HeadlessNode
    if (!n || typeof n.id !== 'number') throw new Error('HeadlessBackend: 非法句柄')
    return n
  }

  return {
    id: 'headless',
    version: '0.1.0',
    capabilities: HEADLESS_CAPABILITIES,

    createElement(node: IRNode): NodeHandle {
      // ★G-31 B5：有 semantic → 按语义映射节点类型（box/grid/...）；否则按 type 原样（兼容层）
      const viewType = node.semantic ? SEMANTIC_HEADLESS_MAP[node.semantic] ?? node.type : node.type
      const n: HeadlessNode = {
        id: nextId++,
        type: viewType,
        props: { ...node.props },
        children: [],
        parent: null,
        text: '',
      }
      nodes.set(n.id, n)
      return n
    },

    insert(child, parent, anchor) {
      const c = ensureNode(child)
      const p = ensureNode(parent)
      if (c.parent) {
        const oldIdx = c.parent.children.indexOf(c)
        if (oldIdx >= 0) c.parent.children.splice(oldIdx, 1)
      }
      if (anchor) {
        const a = ensureNode(anchor)
        const idx = p.children.indexOf(a)
        p.children.splice(idx >= 0 ? idx : p.children.length, 0, c)
      } else {
        p.children.push(c)
      }
      c.parent = p
    },

    remove(child) {
      const c = ensureNode(child)
      if (c.parent) {
        const idx = c.parent.children.indexOf(c)
        if (idx >= 0) c.parent.children.splice(idx, 1)
        c.parent = null
      }
      nodes.delete(c.id)
    },

    patchProp(el, key, prev, next) {
      const n = ensureNode(el)
      if (next === null || next === undefined) {
        delete n.props[key]
      } else {
        n.props[key] = next
      }
    },

    setText(el, text) {
      ensureNode(el).text = text
    },

    measure() {
      return { width: 0, height: 0 }
    },
  }
}
