// packages/renderer-app/src/native.ts
// ★app-plan B1：NativeAdapter 接口 —— Vue createRenderer host config 与原生平台的解耦层
// v0.6 正式形态：iOS UIView / Android View 实现本接口（B2）；本仓用 mock adapter 验证渲染器接线
// 节点语义对齐 Web/MP：view=容器 / text=文本 / props=样式+属性 / 事件经 patchProp 以 onXxx 键传入（B2 桥接原生手势）
// ★NativeNode 必须是联合类型别名（非基接口）——TS 判别联合收窄依赖类型别名，基接口无法收窄到子接口

export interface NativeTextNode {
  readonly __kind: 'text'
  text: string
}

export interface NativeCommentNode {
  readonly __kind: 'comment'
}

export interface NativeElementNode {
  readonly __kind: 'element'
  tag: string
  props: Record<string, unknown>
  children: NativeNode[]
  parent: NativeElementNode | null
}

/** 原生节点联合（判别字段 __kind：element/text/comment） */
export type NativeNode = NativeTextNode | NativeCommentNode | NativeElementNode

/** 原生平台适配器（B2 由 iOS/Android 工程实现；mock 见 adapters/mock.ts） */
export interface NativeAdapter {
  createElement(tag: string): NativeElementNode
  createText(text: string): NativeTextNode
  createComment(): NativeCommentNode
  /** 文本节点更新 */
  setText(node: NativeTextNode, text: string): void
  /** 元素内容整体替换为纯文本（diff 叶路径优化，对齐 MP setElementText） */
  setElementText(el: NativeElementNode, text: string): void
  /** 插入子节点（anchor=null 追加到末尾；原生扁平布局下 anchor 语义由实现决定） */
  insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void
  /** 移除节点（从父级分离） */
  remove(node: NativeNode): void
  /** 父级反查（Vue diff 需要） */
  parentNode(node: NativeNode): NativeElementNode | null
  /** 属性/样式/事件同步（key=onXxx 为事件 → 原生手势桥；其余为样式/属性映射） */
  patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void
}
