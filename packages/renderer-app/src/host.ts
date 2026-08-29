// packages/renderer-app/src/host.ts
// ★app-plan B1：createAppHostConfig —— Vue 官方 createRenderer 的 RendererOptions（原生 host config）
// 语义对齐 01-app-renderer.md §2：createElement→原生视图、patchProp→样式/事件桥、nextSibling→null（原生扁平布局）
import type { RendererOptions } from '@vue/runtime-core'
import type { NativeAdapter, NativeNode, NativeElementNode, NativeTextNode, NativeCommentNode } from './native'

export type { NativeAdapter, NativeNode, NativeElementNode, NativeTextNode }

/** 组装 Vue createRenderer 所需的 host config（原生平台语义降级已注释） */
export function createAppHostConfig(adapter: NativeAdapter): RendererOptions<NativeNode, NativeElementNode> {
  return {
    // ★view/原生标签 → 原生视图容器
    createElement(type: string): NativeElementNode {
      return adapter.createElement(type)
    },
    createText(text: string): NativeTextNode {
      return adapter.createText(text)
    },
    createComment(): NativeNode {
      return adapter.createComment()
    },
    setText(node: NativeNode, text: string): void {
      adapter.setText(node as NativeTextNode, text)
    },
    setElementText(el: NativeElementNode, text: string): void {
      adapter.setElementText(el, text)
    },
    insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void {
      adapter.insert(child, parent, anchor)
    },
    remove(node: NativeNode): void {
      adapter.remove(node)
    },
    parentNode(node: NativeNode): NativeElementNode | null {
      return adapter.parentNode(node)
    },
    nextSibling(): NativeNode | null {
      return null // 原生扁平布局：无 DOM sibling 概念（对齐虚拟列表切片思想）
    },
    patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void {
      adapter.patchProp(el, key, prev, next)
    },
    querySelector(): NativeElementNode | null {
      return null // 无 DOM 查询（原生树由渲染器持有）
    },
    setScopeId(): void {
      // 无作用域 ID（原生无 CSS 作用域）
    },
    cloneNode(): NativeNode {
      // 静态内容克隆 → 空注释节点（原生树不克隆）
      return adapter.createComment()
    },
    insertStaticContent(): [NativeNode, NativeNode] {
      // 静态 HTML → 空（原生无 innerHTML）
      const c = adapter.createComment()
      return [c, c]
    },
  }
}
