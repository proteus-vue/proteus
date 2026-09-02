# Backend SPI 规范（G-27）

> 后端实现者只需实现 `ProteusRenderBackend` 接口即可接入任意渲染引擎。本文件是接口的唯一事实源（Single Source of Truth）。

## 1. 核心接口

```ts
export interface ProteusRenderBackend {
  readonly id: BackendId
  readonly version: string
  readonly capabilities: BackendCapabilities

  // 节点操作集（对齐 Vue nodeOps 事实标准）
  createElement(node: IRNode): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void
  querySelector?(selector: string): NodeHandle | null

  // 布局（可选）
  measure?(node: NodeHandle, constraints: LayoutConstraints): Size
  layout?(root: NodeHandle, constraints: LayoutConstraints): void

  // 帧调度
  scheduleFrame?(task: () => void): void
  flush?(): void

  // 输入
  dispatchInput?(event: NormalizedInputEvent): void

  // 生命周期
  onMount?(root: NodeHandle): void
  onUnmount?(root: NodeHandle): void

  // 纹理共享（混合渲染）
  registerExternalTexture?(id: string, texture: ExternalTexture): void
  unregisterExternalTexture?(id: string): void
}
```

## 2. 能力声明（对齐 G-22 CapabilityRegistry）

```ts
export interface BackendCapabilities {
  layout: 'yoga' | 'native' | 'none'
  glass: 'L3' | 'L2' | 'L1' | 'none'
  blur: 'true' | 'approximate' | 'none'
  animation: 'native' | 'js' | 'none'
  textureSharing: boolean
  remoteRendering: boolean
  ssr: boolean
  input: ('touch' | 'cursor' | 'remote' | 'dial' | 'voice')[]
}
```

## 3. 类型定义

```ts
export type BackendId =
  | 'vue-dom' | 'flutter' | 'native-ios' | 'native-android'
  | 'native-harmony' | 'skia' | 'canvas2d' | 'headless'

export interface IRNode {
  type: string
  props: Record<string, unknown>
  children: IRNode[]
  ref?: Ref
}

export interface LayoutConstraints {
  width?: number; height?: number
  minWidth?: number; maxWidth?: number
  minHeight?: number; maxHeight?: number
}

export interface NormalizedInputEvent {
  kind: 'tap' | 'longPress' | 'scroll' | 'focus' | 'key' | 'pointer'
  pointerType: 'touch' | 'mouse' | 'pen' | 'remote' | 'dial'
  x?: number; y?: number
  key?: string
  target: NodeHandle
}
```

## 4. 一致性测试（`backend-conformance-test`）

每个后端须通过：节点 CRUD、属性更新、布局契约、事件归一化、生命周期、纹理共享（如声明支持）。详见 `06-integration-batches.md` B1。

## 5. 严格规则

- **RND001**：禁止业务直调后端专有 API
- **RND002**：后端必须通过 conformance test
- **RND003**：布局语义不得硬编码为某后端算法
- **RND004**：混合后端须声明纹理/事件边界
- **RND005**：后端不得在 IR 层外修改组件树
