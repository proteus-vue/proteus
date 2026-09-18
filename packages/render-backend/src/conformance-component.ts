// packages/render-backend/src/conformance-component.ts
// ★G-31 B5：组件渲染快照（Component Render Snapshot）——conformance「渲染层」的公共基础设施
//   conformance.md 三层验证的渲染层：同一份 C-IR 经各后端 nodeOps 渲染后，归一化为
//   (type + semantic + 控件 readback + props) 快照树 → 跨端 diff（结构同构 + 控件映射一致）
//   ★划分（防循环依赖）：本文件 = 通用快照基础设施（render-backend 拥有各后端句柄形状）；
//     参考表对照（SEMANTIC_BACKEND_MAP）在 component-ir/conformance.ts（规范表归属方）
//   用法：const snap = renderComponentSnapshot(backend, ir, createControlReader(backend.id))
//         → component-ir checkComponentSnapshot(backend.id, snap) 产出 G-31 门禁结果
import type { IRNode, NodeHandle, ProteusRenderBackend } from './spi'
import type { NativeViewDescriptor } from './native'
import type { FlutterWidgetDescriptor } from './flutter'
import type { HeadlessNode } from './headless'

/** 归一化渲染节点快照（IR 级：与平台无关的「语义 → 控件」描述；golden diff / Agent 断言载体） */
export interface RenderNodeSnapshot {
  /** C-IR type（源码标签——p-grid/view/...） */
  type: string
  /** 语义（无 semantic 时 = type，即 Layer 1 兼容层标签） */
  semantic: string
  /** 后端实际渲染的控件类型（readback：tag.class / 原生视图类型 / widget 名 / headless 类型） */
  control: string
  /** 透传约束属性（C-IR props） */
  props: Record<string, unknown>
  text: string
  children: RenderNodeSnapshot[]
}

/** 从后端句柄读取控件类型（后端实现者可为自定义句柄注入自己的 reader） */
export type ControlReader = (handle: NodeHandle) => string

/**
 * 内置后端的默认控件 reader（句柄形状由 render-backend 拥有）
 * - vue-dom：tagName + class（div.proteus-grid）——与 SEMANTIC_WEB_MAP 产出一致
 * - native-*：NativeViewDescriptor.type（UICollectionView/GridLayoutManager/Grid）
 * - flutter：FlutterWidgetDescriptor.widget（GridView/Text/...）
 * - headless：HeadlessNode.type（box/grid/...）
 * - 其他/未知：取句柄的 type 字段，缺省字符串化（外部后端可自行注入 reader）
 */
export function createControlReader(backendId: string): ControlReader {
  switch (backendId) {
    case 'vue-dom':
      return (h) => {
        const el = h as HTMLElement
        const cls = el.getAttribute?.('class') ?? ''
        return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
      }
    case 'native-ios':
    case 'native-android':
    case 'native-harmony':
      return (h) => (h as NativeViewDescriptor).type
    case 'flutter':
      return (h) => (h as FlutterWidgetDescriptor).widget
    case 'headless':
      return (h) => (h as HeadlessNode).type
    default:
      return (h) => String(((h as { type?: unknown } | null)?.type as string | undefined) ?? h)
  }
}

/**
 * 驱动后端 nodeOps 渲染一棵 C-IR 树，归一化为快照树
 * （createElement + patchProp + insert——与真实渲染路径一致；setText 由文本节点单独触发，此处不涉及）
 * ★关键：渲染的是 IRNode.semantic（Layout 0 语义），不是 tag 字符串翻译——conformance 对比的是
 *   后端对语义的控件映射结果（layout.grid → UICollectionView/GridLayoutManager/Grid/GridView/div.proteus-grid）
 */
export function renderComponentSnapshot(backend: ProteusRenderBackend, ir: IRNode, readControl: ControlReader): RenderNodeSnapshot {
  const snapOf = new Map<NodeHandle, RenderNodeSnapshot>()

  function visit(node: IRNode): NodeHandle {
    const handle = backend.createElement(node)
    // 属性经 patchProp 应用（还原真实渲染路径；props 语义一致性与控件映射无关，但为完整快照保留）
    for (const key of Object.keys(node.props)) {
      backend.patchProp(handle, key, undefined, node.props[key])
    }
    const snap: RenderNodeSnapshot = {
      type: node.type,
      semantic: node.semantic ?? node.type,
      control: readControl(handle),
      props: { ...node.props },
      text: '',
      children: [],
    }
    snapOf.set(handle, snap)
    for (const child of node.children) {
      const childHandle = visit(child)
      backend.insert(childHandle, handle)
      const childSnap = snapOf.get(childHandle)
      if (childSnap) snap.children.push(childSnap)
    }
    return handle
  }

  const rootHandle = visit(ir)
  return snapOf.get(rootHandle) as RenderNodeSnapshot
}
