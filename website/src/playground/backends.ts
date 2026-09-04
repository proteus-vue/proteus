// website/src/playground/backends.ts —— Mini Playground v2 后端切换（★W-3 可切换性可视化：全部真实调用，零伪造）
// 同一份用户 SFC → CompilerIR（NodeBackend 真实编译）→ renderIRTree(selected backend) → 各后端真实输出树：
//   VueDom  = 真实 DOM 序列化（createElement/insert 真跑）
//   Headless = 内存节点树 toPlainTree（SSR/Agent 视图）
//   Native   = NativeViewDescriptor 树（iOS UIKit / Android Jetpack / 鸿蒙 ArkUI 三平台语义映射表——G-27 B4 真实现）
//   Flutter  = Widget 树 toWidgetTree（G-27 B5 spike 真映射）
// Rust 后端：浏览器内不可用（需本地 proteus-cc-rust CLI）——诚实禁用项，不做假输出
import {
  createHeadlessBackend,
  toPlainTree,
  createNativeBackend,
  createFlutterBackend,
  toWidgetTree,
  createVueDomBackend,
  renderIRTree,
  type IRNode,
} from '@proteus-vue/render-backend'
import { formForWidth } from '@proteus-vue/test-ir'

/** 渲染后端选项（v3 构图：RENDER BACKEND select） */
export interface RenderBackendOption {
  id: string
  label: string
  /** 平台色（design-tokens color.backend） */
  color: string
  /** 输出树种类（决定预览视觉的标签语言） */
  kind: 'dom' | 'headless' | 'native' | 'flutter'
}

export const RENDER_BACKENDS: RenderBackendOption[] = [
  { id: 'vuedom', label: 'VueDomBackend (Web)', color: 'var(--bk-vue)', kind: 'dom' },
  { id: 'headless', label: 'HeadlessBackend (内存树)', color: 'var(--bk-skia)', kind: 'headless' },
  { id: 'native-ios', label: 'NativeBackend · iOS (UIKit)', color: 'var(--bk-ios)', kind: 'native' },
  { id: 'native-android', label: 'NativeBackend · Android (Jetpack)', color: 'var(--bk-android)', kind: 'native' },
  { id: 'native-harmony', label: 'NativeBackend · 鸿蒙 (ArkUI)', color: 'var(--bk-harmony)', kind: 'native' },
  { id: 'flutter', label: 'FlutterBackend (Widget)', color: 'var(--bk-flutter)', kind: 'flutter' },
]

/** 编译后端选项（Rust = 诚实禁用：浏览器无 Rust 运行时） */
export const COMPILE_BACKENDS = [
  { id: 'node', label: 'Node (TS)', disabled: false },
  { id: 'rust', label: 'Rust (native · 需本地 CLI)', disabled: true },
]

/** 设备档位（DEVICE select——预览框真实宽高 + G-25 formForWidth 真实档位求解） */
export interface DeviceOption {
  id: string
  label: string
  width: number
  height: number
}

export const DEVICES: DeviceOption[] = [
  { id: 'web', label: 'Web 1440', width: 1440, height: 900 },
  { id: 'tablet', label: '平板 834', width: 834, height: 1112 },
  { id: 'phone', label: '手机 390', width: 390, height: 844 },
  { id: 'tv', label: '车机 1280', width: 1280, height: 720 },
  { id: 'watch', label: '手表 198', width: 198, height: 194 },
]

/** 树 JSON 节点（各后端输出归一化后的形状） */
export interface TreeJsonNode {
  label: string
  kind: string
  props: Record<string, unknown>
  text?: string
  children: TreeJsonNode[]
}

function trimProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v !== '' && v !== false && v != null) out[k] = v
  }
  return out
}

/** 从真实 DOM 序列化视图树（VueDomBackend 真跑产物） */
function domToTree(el: Element): TreeJsonNode {
  const children: TreeJsonNode[] = []
  for (const child of el.children) children.push(domToTree(child))
  const ownText = [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  return {
    label: el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : ''),
    kind: 'dom',
    props: {},
    text: ownText || undefined,
    children,
  }
}

/** IR → 选中渲染后端的真实输出树（全部真实调用 renderIRTree） */
export function renderWithBackend(
  irRoot: IRNode,
  backendId: string,
): { tree: TreeJsonNode; dom?: Element } {
  // VueDom：真跑 DOM（浏览器全局 document——semantic → proteus-* 语义类映射真实生效）
  if (backendId === 'vuedom') {
    const backend = createVueDomBackend()
    const root = renderIRTree(backend, irRoot)
    const el = root as unknown as Element
    return { tree: domToTree(el), dom: el }
  }
  // Headless：内存节点树
  if (backendId === 'headless') {
    const backend = createHeadlessBackend()
    const root = renderIRTree(backend, irRoot)
    const plain = toPlainTree(root as never) as never as {
      type: string
      props: Record<string, unknown>
      text: string
      children: never[]
    }
    return { tree: plainToNode(plain) }
  }
  // Native：三平台语义映射（UIView/View/ArkUI…）
  if (backendId.startsWith('native-')) {
    const platform = backendId.split('-')[1] as 'ios' | 'android' | 'harmony'
    const backend = createNativeBackend(undefined, platform)
    const root = renderIRTree(backend, irRoot) as never as {
      type: string
      props: Record<string, unknown>
      text: string
      children: never[]
    }
    return { tree: descToNode(root) }
  }
  // Flutter：widget 树
  const backend = createFlutterBackend()
  const root = renderIRTree(backend, irRoot)
  const widget = toWidgetTree(root as never) as never as {
    widget: string
    props: Record<string, unknown>
    text: string
    children: never[]
  }
  return { tree: widgetToNode(widget) }
}

function plainToNode(n: { type: string; props: Record<string, unknown>; text: string; children: unknown[] }): TreeJsonNode {
  return {
    label: n.type,
    kind: 'headless',
    props: trimProps(n.props),
    text: n.text || undefined,
    children: (n.children as never[]).map((c) => plainToNode(c as never)),
  }
}

function descToNode(d: { type: string; props: Record<string, unknown>; text: string; children: unknown[] }): TreeJsonNode {
  return {
    label: d.type,
    kind: 'native',
    props: trimProps(d.props),
    text: d.text || undefined,
    children: (d.children as unknown[]).map((c) => descToNode(c as never)),
  }
}

function widgetToNode(w: { widget: string; props: Record<string, unknown>; text: string; children: unknown[] }): TreeJsonNode {
  return {
    label: w.widget,
    kind: 'flutter',
    props: trimProps(w.props),
    text: w.text || undefined,
    children: (w.children as unknown[]).map((c) => widgetToNode(c as never)),
  }
}

/** G-25 设备档位（formForWidth 真实求解） */
export function deviceForm(width: number): string {
  return formForWidth(width)
}
