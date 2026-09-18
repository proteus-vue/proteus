// packages/renderer-app/src/adapters/mock.ts
// ★app-plan B1：mock NativeAdapter —— 构建可断言的原生节点树 + 操作日志（验证渲染器接线，无需真机）
import type { NativeAdapter, NativeNode, NativeTextNode, NativeElementNode, NativeCommentNode } from '../native'

export interface MockAdapter extends NativeAdapter {
  /** 渲染容器（mount 目标） */
  root: NativeElementNode
  /** 操作日志（断言 diff/更新/移除顺序） */
  ops: string[]
}

/** 创建 mock adapter（root 为容器；ops 记录 create/insert/setText/setElementText/patchProp/remove） */
export function createMockAdapter(): MockAdapter {
  const root: NativeElementNode = { __kind: 'element', tag: 'root', props: {}, children: [], parent: null }
  const ops: string[] = []

  function parentNode(node: NativeNode): NativeElementNode | null {
    return node.__kind === 'element' ? node.parent : null
  }

  return {
    root,
    ops,
    createElement(tag: string): NativeElementNode {
      ops.push(`create:${tag}`)
      return { __kind: 'element', tag, props: {}, children: [], parent: null }
    },
    createText(text: string): NativeTextNode {
      ops.push(`create:text`)
      return { __kind: 'text', text }
    },
    createComment(): NativeCommentNode {
      ops.push(`create:comment`)
      return { __kind: 'comment' }
    },
    setText(node: NativeTextNode, text: string): void {
      node.text = text
      ops.push(`setText:${text}`)
    },
    setElementText(el: NativeElementNode, text: string): void {
      // 清空子节点 + 附加文本节点（文本节点无需 parent——parentNode 只走元素）
      el.children = []
      const t = this.createText(text)
      el.children.push(t)
      ops.push(`setElementText:${text}`)
    },
    insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void {
      if (child.__kind === 'element') child.parent = parent
      // 移除 anchor 之后的所有兄弟（原生插入语义近似 splice）
      if (anchor === null) {
        parent.children.push(child)
      } else {
        const idx = parent.children.indexOf(anchor)
        parent.children.splice(idx, 0, child)
      }
      ops.push(`insert:${child.__kind === 'element' ? child.tag : child.__kind}->${parent.tag}`)
    },
    remove(node: NativeNode): void {
      const parent = parentNode(node)
      if (parent) {
        const idx = parent.children.indexOf(node)
        if (idx >= 0) parent.children.splice(idx, 1)
      }
      ops.push(`remove:${node.__kind === 'element' ? node.tag : node.__kind}`)
    },
    parentNode,
    patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void {
      if (next === null || next === undefined) delete el.props[key]
      else el.props[key] = next
      ops.push(`patchProp:${key}`)
    },
  }
}
