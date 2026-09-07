// packages/render-backend/src/spi.ts
// ★G-27 ProteusRenderBackend SPI（render-backend-1-plan 02-backend-spi.md —— 接口唯一事实源）
//   后端实现者只需实现本接口即可接入任意渲染引擎；nodeOps 刻意对齐 Vue（createElement/insert/remove/patchProp/setText）
//   —— Vue Custom Renderer 即零成本后端（B2）。纯类型 + 零依赖。
// ★#425：BackendId 下沉 contracts（破 component-ir ↔ render-backend 循环依赖）——本文件 re-export 保外部兼容
import type { BackendId } from '@proteus-vue/contracts'
export type { BackendId } from '@proteus-vue/contracts'

/** 节点句柄（后端自己的节点表示——DOM 元素 / Flutter Element / 内存树节点……） */
export type NodeHandle = unknown

/** 语义节点描述（IR 层：后端消费的中间表示，不绑定任何平台） */
export interface IRNode {
  type: string
  /** ★G-31：语义类型（layout.grid/ui.button/...）——Backend 映射 semantic 而非 tag 字符串；缺省用 type */
  semantic?: string
  props: Record<string, unknown>
  children: IRNode[]
  ref?: unknown
}

/** 布局约束（后端可自带布局器，否则走框架 IR 求解） */
export interface LayoutConstraints {
  width?: number
  height?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

export interface Size {
  width: number
  height: number
}

/** 归一化输入事件（后端把平台事件归一化为 Proteus 标准事件） */
export interface NormalizedInputEvent {
  kind: 'tap' | 'longPress' | 'scroll' | 'focus' | 'key' | 'pointer'
  pointerType: 'touch' | 'mouse' | 'pen' | 'remote' | 'dial'
  x?: number
  y?: number
  key?: string
  target: NodeHandle
}

/** 外部纹理（混合渲染 Texture Sharing——原生视图混入自绘场景） */
export interface ExternalTexture {
  id: string
  nativeView?: unknown
  width: number
  height: number
}

/** 能力声明（对齐 G-22 CapabilityRegistry：框架按能力降级，不按 if/else 判断平台） */
export interface BackendCapabilities {
  layout: 'yoga' | 'native' | 'none'
  glass: 'L3' | 'L2' | 'L1' | 'none'
  blur: 'true' | 'approximate' | 'none'
  animation: 'native' | 'js' | 'none'
  textureSharing: boolean
  remoteRendering: boolean
  ssr: boolean
  input: Array<'touch' | 'cursor' | 'remote' | 'dial' | 'voice'>
}

/** ★G-27 核心：可插拔渲染后端接口（后端只需实现本接口即可接入任意渲染引擎） */
export interface ProteusRenderBackend {
  readonly id: BackendId
  readonly version: string
  readonly capabilities: BackendCapabilities

  // —— 节点操作集（对齐 Vue nodeOps 事实标准）——
  createElement(node: IRNode): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void
  querySelector?(selector: string): NodeHandle | null

  // —— 布局（可选：后端可自带布局器，否则走框架 IR 求解）——
  measure?(node: NodeHandle, constraints: LayoutConstraints): Size
  layout?(root: NodeHandle, constraints: LayoutConstraints): void

  // —— 帧调度（批量提交，减少跨端开销——对齐 Fabric Mounting）——
  scheduleFrame?(task: () => void): void
  flush?(): void

  // —— 输入（后端把平台事件归一化为 Proteus 标准事件）——
  dispatchInput?(event: NormalizedInputEvent): void

  // —— 生命周期 ——
  onMount?(root: NodeHandle): void
  onUnmount?(root: NodeHandle): void

  // —— 纹理共享（混合渲染）——
  registerExternalTexture?(id: string, texture: ExternalTexture): void
  unregisterExternalTexture?(id: string): void
}
