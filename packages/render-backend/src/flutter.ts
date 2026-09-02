// packages/render-backend/src/flutter.ts
// ★G-27 B5：FlutterBackend spike——Proteus 语义 → Flutter widget 树的映射层（关键路径唯一技术不确定项，路线图建议最早 spike）
//   spike 目标：验证「语义收敛 → Flutter 渲染语义」可行性（不依赖真实引擎——真实 Embedder C ABI
//   （FlutterEngineRun + FlutterRendererConfig make_current/fbo_callback/present）是宿主工程，B5 后接）
//   nodeOps → FlutterWidgetDescriptor 树：语义标签经 WIDGET_MAP 映射为 Flutter widget（编译期映射的运行时对应）
//   布局：Flutter 自带布局（layout:'yoga'——Flutter 内部 Yoga/C++ 布局层可复用）
import type { BackendCapabilities, IRNode, NodeHandle, ProteusRenderBackend } from './spi'

/** Flutter widget 树节点（spike 层表示——宿主 Embedder 桥把本树投递给 FlutterEngineRun） */
export interface FlutterWidgetDescriptor {
  id: number
  /** Flutter widget 名（Container/Text/FilledButton/...） */
  widget: string
  props: Record<string, unknown>
  children: FlutterWidgetDescriptor[]
  parent: FlutterWidgetDescriptor | null
  text: string
}

/** 语义标签 → Flutter widget 映射（与 compiler 的 TAG_MAP 同哲学：语义收敛，后端决定怎么做） */
const WIDGET_MAP: Record<string, string> = {
  view: 'Container',
  text: 'Text',
  button: 'FilledButton',
  image: 'Image',
  input: 'TextField',
  textarea: 'TextField',
  'scroll-view': 'SingleChildScrollView',
  switch: 'Switch',
  slider: 'Slider',
  icon: 'Icon',
  progress: 'LinearProgressIndicator',
  navigator: 'GestureDetector',
  'p-grid': 'Wrap',
  'p-stack': 'Flex',
  'p-split': 'Row',
}

/** ★G-31 B5：semantic 语义 → Flutter widget（与 component-ir SEMANTIC_BACKEND_MAP flutter 列同源——语义收敛的运行时映射） */
const SEMANTIC_FLUTTER_MAP: Record<string, string> = {
  'layout.box': 'Container',
  'layout.stack': 'Flex',
  'layout.grid': 'GridView',
  'layout.fluid': 'Wrap',
  'layout.adaptive': 'showModal',
  'layout.fit': 'IntrinsicWidth',
  'layout.split': 'Row',
  'layout.safe': 'SafeArea',
  'layout.sidebar': 'NavigationRail',
  'ui.text': 'Text',
  'ui.button': 'FilledButton',
  'ui.image': 'Image',
  'ui.input': 'TextField',
  'ui.list': 'ListView',
  'ui.nav': 'Navigator',
  'capability.scan-qr': 'scanQR',
  'capability.pick-photo': 'pickPhoto',
  'capability.location': 'getLocation',
  // ★G-32 B1：新增 implemented 语义
  'layout.inline': 'InlineSpan',
  'layout.spacer': 'Spacer',
  'layout.divider': 'Divider',
  'layout.scroll': 'ScrollView',
  'layout.virtual-list': 'ListView',
  'layout.masonry': 'SliverMasonryGrid',
  'ui.heading': 'Text.heading',
  'ui.icon': 'Icon',
  'ui.textarea': 'TextField.multiline',
  'ui.switch': 'Switch',
  'ui.slider': 'Slider',
  'shell.nav': 'AppBar',
  'shell.tabbar': 'BottomNavigationBar',
  'shell.drawer': 'Drawer',
  'shell.modal': 'showDialog',
  // ★G-32 B4：Shell 补齐 + UI 补齐
  'shell.page': 'Scaffold',
  'shell.segment': 'SegmentedButton',
  'shell.popover': 'showMenu',
  'shell.action-sheet': 'showModalBottomSheet',
  'ui.rich-text': 'RichText',
  'ui.avatar': 'CircleAvatar',
  'ui.media': 'VideoPlayer',
  'ui.canvas': 'CustomPaint',
  'ui.svg': 'SvgPicture',
  'ui.select': 'DropdownButton',
  'ui.checkbox': 'Checkbox',
  'ui.radio': 'Radio',
  'ui.picker': 'showDatePicker',
  'ui.form': 'Form',
  'gesture.draggable': 'Draggable',
  'gesture.scrollable': 'Scrollable',
  // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
  'engineering.transition': 'AnimatedOpacity',
  'engineering.animate': 'AnimationController',
}

/** 语义标签 → Flutter widget（未映射标签保留原样——自定义 widget 透传） */
export function mapWidgetType(type: string): string {
  return WIDGET_MAP[type] ?? type
}

/** 序列化为纯 widget 树（spike 断言 / Embedder 桥输入） */
export function toWidgetTree(root: FlutterWidgetDescriptor): Record<string, unknown> {
  return {
    id: root.id,
    widget: root.widget,
    props: { ...root.props },
    text: root.text,
    children: root.children.map(toWidgetTree),
  }
}

const FLUTTER_CAPABILITIES: BackendCapabilities = {
  layout: 'yoga', // Flutter 自带布局引擎（Yoga/C++——后端可选，spike 标注）
  glass: 'L3', // Skia/Impeller 绘制玻璃（系统级渲染语义）
  blur: 'true',
  animation: 'native', // Flutter 动画管线
  textureSharing: true, // Texture/PlatformView 混合
  remoteRendering: false,
  ssr: false,
  input: ['touch', 'cursor', 'remote'],
}

export function createFlutterBackend(): ProteusRenderBackend {
  let nextId = 1
  const nodes = new Map<number, FlutterWidgetDescriptor>()

  function ensureNode(handle: NodeHandle): FlutterWidgetDescriptor {
    const n = handle as FlutterWidgetDescriptor
    if (!n || typeof n.id !== 'number') throw new Error('FlutterBackend: 非法句柄')
    return n
  }

  return {
    id: 'flutter',
    version: '0.1.0',
    capabilities: FLUTTER_CAPABILITIES,

    createElement(node: IRNode): NodeHandle {
      // ★G-31 B5：有 semantic → 按语义映射 widget（layout.grid → GridView）；否则走标签映射（兼容层 view/text/...）
      const widget = node.semantic ? SEMANTIC_FLUTTER_MAP[node.semantic] ?? mapWidgetType(node.type) : mapWidgetType(node.type)
      const descriptor: FlutterWidgetDescriptor = {
        id: nextId++,
        widget,
        props: { ...node.props },
        children: [],
        parent: null,
        text: '',
      }
      nodes.set(descriptor.id, descriptor)
      return descriptor
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
