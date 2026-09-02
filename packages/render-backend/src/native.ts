// packages/render-backend/src/native.ts
// ★G-27 B4：NativeBackend——nodeOps → 原生视图（iOS UIView / Android View / ArkUI Node 的统一抽象）
//   验证「nodeOps → UIView」：语义节点 → NativeViewDescriptor 树（nodeOps 层句柄）+ 宿主适配器桥（真实平台 SDK 实现）
//   与 @proteus-vue/renderer-app 的 NativeAdapter（Vue host config 层）同构——B4 是 SPI 层，
//   未来宿主把两者桥接：NativeBackend.nodeOps → renderer-app NativeAdapter → iOS/Android/鸿蒙
//   默认内置 mock 适配器（ops 日志——无宿主环境验证接线，对齐 renderer-app adapters/mock.ts 范式）
import type { BackendCapabilities, IRNode, NodeHandle, ProteusRenderBackend } from './spi'

/** 原生视图描述（G-27 语义节点在原生后端的表示） */
export interface NativeViewDescriptor {
  id: number
  /** 语义标签（view/text/button/...——宿主映射到 UIView/View/ArkUI 组件） */
  type: string
  props: Record<string, unknown>
  children: NativeViewDescriptor[]
  parent: NativeViewDescriptor | null
  text: string
  /** 宿主句柄（adapter.createView 返回值；无宿主 = 自身） */
  handle: unknown
}

/** 宿主适配器（iOS/Android/鸿蒙 SDK 桥实现本接口；mock 见 createMockNativeAdapter） */
export interface NativeViewAdapter {
  /** 创建宿主视图（返回宿主句柄——UIView / View / ArkUI Node） */
  createView(descriptor: NativeViewDescriptor): unknown
  /** 属性/样式/事件同步到宿主（key=onXxx 为事件 → 原生手势桥） */
  updateView(handle: unknown, key: string, prev: unknown, next: unknown): void
  /** 插入子视图（anchor 可选） */
  insertView(child: unknown, parent: unknown, anchor?: unknown): void
  /** 移除视图 */
  removeView(child: unknown): void
  /** 文本同步 */
  setViewText(handle: unknown, text: string): void
}

export interface MockNativeAdapter extends NativeViewAdapter {
  /** 操作日志（断言 create/insert/update/remove/setText 顺序） */
  ops: string[]
}

/** 内置 mock 适配器（无宿主环境验证接线；真实平台 B4 后接 SDK 实现替换） */
export function createMockNativeAdapter(): MockNativeAdapter {
  const ops: string[] = []
  return {
    ops,
    createView(descriptor) {
      ops.push(`create:${descriptor.type}`)
      return descriptor // 无宿主：句柄 = 描述符自身
    },
    updateView(_handle, key, _prev, next) {
      ops.push(`update:${key}=${String(next)}`)
    },
    insertView(child, _parent, _anchor) {
      ops.push(`insert:${String((child as NativeViewDescriptor).type)}`)
    },
    removeView(child) {
      ops.push(`remove:${String((child as NativeViewDescriptor).type)}`)
    },
    setViewText(_handle, text) {
      ops.push(`setText:${text}`)
    },
  }
}

const NATIVE_CAPABILITIES: BackendCapabilities = {
  layout: 'native', // 原生布局（AutoLayout / ConstraintLayout / ArkUI 约束）
  glass: 'L3', // iOS UIGlassEffect / 鸿蒙 fractal（G-07 系统级玻璃语义）
  blur: 'true',
  animation: 'native', // 系统原生转场/动画
  textureSharing: true, // PlatformView / TextureView 混合
  remoteRendering: false,
  ssr: false,
  input: ['touch', 'cursor', 'remote'],
}

/** 原生平台（iOS UIKit / Android Jetpack / 鸿蒙 ArkUI） */
export type NativePlatform = 'ios' | 'android' | 'harmony'

/** ★G-31 B3：semantic 语义 → 原生视图类型（三平台——与 component-ir SEMANTIC_BACKEND_MAP 对应列同源） */
const SEMANTIC_NATIVE_MAPS: Record<NativePlatform, Record<string, string>> = {
  ios: {
    'layout.box': 'UIView',
    'layout.stack': 'UIStackView',
    'layout.grid': 'UICollectionView',
    'layout.fluid': 'UIView.fluid',
    'layout.adaptive': 'UISheet',
    'layout.fit': 'UIView.fit',
    'layout.split': 'UISplitViewController',
    'layout.safe': 'safeAreaLayoutGuide',
    'layout.sidebar': 'UISplitViewController.side',
    'ui.text': 'UILabel',
    'ui.button': 'UIButton',
    'ui.image': 'UIImageView',
    'ui.input': 'UITextField',
    'ui.list': 'UITableView',
    'ui.nav': 'UINavigationController',
    'capability.scan-qr': 'AVCaptureSession',
    'capability.pick-photo': 'UIImagePicker',
    'capability.location': 'CLLocationManager',
    // ★G-32 B1：新增 implemented 语义
    'layout.inline': 'UITextAttachment',
    'layout.spacer': 'UILayoutGuide',
    'layout.divider': 'UIView.divider',
    'layout.scroll': 'UIScrollView',
    'layout.virtual-list': 'UICollectionView',
    'layout.masonry': 'UICollectionView.masonry',
    'ui.heading': 'UILabel.heading',
    'ui.icon': 'UIImageView.icon',
    'ui.textarea': 'UITextView',
    'ui.switch': 'UISwitch',
    'ui.slider': 'UISlider',
    'shell.nav': 'UINavigationBar',
    'shell.tabbar': 'UITabBar',
    'shell.drawer': 'UIView.drawer',
    'shell.modal': 'UIAlertController',
    // ★G-32 B4：Shell 补齐 + UI 补齐
    'shell.page': 'UIViewController',
    'shell.segment': 'UISegmentedControl',
    'shell.popover': 'UIPopoverController',
    'shell.action-sheet': 'UIAlertController.actionSheet',
    'ui.rich-text': 'UITextView.attributed',
    'ui.avatar': 'UIImageView.avatar',
    'ui.media': 'AVPlayerView',
    'ui.canvas': 'UIView.canvas',
    'ui.svg': 'UIView.svg',
    'ui.select': 'UIPickerView',
    'ui.checkbox': 'UIButton.checkbox',
    'ui.radio': 'UIButton.radio',
    'ui.picker': 'UIDatePicker',
    'ui.form': 'UIView.form',
    'gesture.draggable': 'UIPanGestureRecognizer',
    'gesture.scrollable': 'UIScrollView.gesture',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'UIView.transition',
    'engineering.animate': 'CAKeyframeAnimation',
  },
  android: {
    'layout.box': 'FrameLayout',
    'layout.stack': 'LinearLayout',
    'layout.grid': 'GridLayoutManager',
    'layout.fluid': 'ConstraintLayout',
    'layout.adaptive': 'BottomSheetDialog',
    'layout.fit': 'wrapContent',
    'layout.split': 'SlidingPaneLayout',
    'layout.safe': 'WindowInsets',
    'layout.sidebar': 'NavigationRail',
    'ui.text': 'TextView',
    'ui.button': 'Button',
    'ui.image': 'ImageView',
    'ui.input': 'EditText',
    'ui.list': 'RecyclerView',
    'ui.nav': 'NavigationRail',
    'capability.scan-qr': 'CameraX',
    'capability.pick-photo': 'PhotoPicker',
    'capability.location': 'FusedLocation',
    // ★G-32 B1：新增 implemented 语义
    'layout.inline': 'TextView.inline',
    'layout.spacer': 'Space',
    'layout.divider': 'View.divider',
    'layout.scroll': 'ScrollView',
    'layout.virtual-list': 'RecyclerView',
    'layout.masonry': 'StaggeredGridLayoutManager',
    'ui.heading': 'TextView.heading',
    'ui.icon': 'ImageView.icon',
    'ui.textarea': 'EditText.multiline',
    'ui.switch': 'Switch',
    'ui.slider': 'SeekBar',
    'shell.nav': 'Toolbar',
    'shell.tabbar': 'BottomNavigationView',
    'shell.drawer': 'DrawerLayout',
    'shell.modal': 'Dialog',
    // ★G-32 B4：Shell 补齐 + UI 补齐
    'shell.page': 'Activity',
    'shell.segment': 'TabLayout',
    'shell.popover': 'PopupWindow',
    'shell.action-sheet': 'BottomSheet',
    'ui.rich-text': 'TextView.html',
    'ui.avatar': 'ImageView.avatar',
    'ui.media': 'VideoView',
    'ui.canvas': 'SurfaceView',
    'ui.svg': 'VectorDrawable',
    'ui.select': 'Spinner',
    'ui.checkbox': 'CheckBox',
    'ui.radio': 'RadioButton',
    'ui.picker': 'DatePicker',
    'ui.form': 'LinearLayout.form',
    'gesture.draggable': 'GestureDetector',
    'gesture.scrollable': 'NestedScrollView',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'View.animate.transition',
    'engineering.animate': 'ValueAnimator',
  },
  harmony: {
    'layout.box': 'Stack',
    'layout.stack': 'Flex',
    'layout.grid': 'Grid',
    'layout.fluid': 'Flex.fluid',
    'layout.adaptive': 'Sheet',
    'layout.fit': 'fitContent',
    'layout.split': 'SideBarContainer',
    'layout.safe': 'getAvoidArea',
    'layout.sidebar': 'SideBarContainer',
    'ui.text': 'Text',
    'ui.button': 'Button',
    'ui.image': 'Image',
    'ui.input': 'TextInput',
    'ui.list': 'List',
    'ui.nav': 'Navigation',
    'capability.scan-qr': 'ScanKit',
    'capability.pick-photo': 'PhotoViewPicker',
    'capability.location': 'geoLocationManager',
    // ★G-32 B1：新增 implemented 语义
    'layout.inline': 'Span',
    'layout.spacer': 'Blank',
    'layout.divider': 'Divider',
    'layout.scroll': 'Scroll',
    'layout.virtual-list': 'List',
    'layout.masonry': 'WaterFlow',
    'ui.heading': 'Text.heading',
    'ui.icon': 'SymbolGlyph',
    'ui.textarea': 'TextArea',
    'ui.switch': 'Toggle',
    'ui.slider': 'Slider',
    'shell.nav': 'NavigationBar',
    'shell.tabbar': 'Tabs',
    'shell.drawer': 'Panel',
    'shell.modal': 'CustomDialog',
    // ★G-32 B4：Shell 补齐 + UI 补齐
    'shell.page': 'Page',
    'shell.segment': 'Segmented',
    'shell.popover': 'Popup',
    'shell.action-sheet': 'ActionSheet',
    'ui.rich-text': 'RichText',
    'ui.avatar': 'Image.avatar',
    'ui.media': 'Video',
    'ui.canvas': 'Canvas',
    'ui.svg': 'Shape',
    'ui.select': 'Select',
    'ui.checkbox': 'Checkbox',
    'ui.radio': 'Radio',
    'ui.picker': 'DatePicker',
    'ui.form': 'FormComponent',
    'gesture.draggable': 'PanGesture',
    'gesture.scrollable': 'Scroll.gesture',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'animateTo.transition',
    'engineering.animate': 'Animator.transition',
  },
}

/**
 * NativeBackend：nodeOps → 原生视图（B4——验证「nodeOps → UIView」抽象层；G-31 B3 三平台语义映射）
 * - 维护 NativeViewDescriptor 树（nodeOps 层句柄，唯一 id）
 * - 所有变更同步宿主 adapter（createView/updateView/insertView/removeView/setViewText）
 * - adapter 缺省 mock（ops 日志）；真实平台注入 SDK 桥
 * - platform：ios（UIKit 基准）/ android（Jetpack）/ harmony（ArkUI）——决定 id + semantic 映射表
 */
export function createNativeBackend(adapter?: NativeViewAdapter, platform: NativePlatform = 'ios'): ProteusRenderBackend {
  const viewAdapter: NativeViewAdapter = adapter ?? createMockNativeAdapter()
  const semanticMap = SEMANTIC_NATIVE_MAPS[platform]
  const id = platform === 'ios' ? 'native-ios' : platform === 'android' ? 'native-android' : 'native-harmony'
  let nextId = 1
  const nodes = new Map<number, NativeViewDescriptor>()

  function ensureNode(handle: NodeHandle): NativeViewDescriptor {
    const n = handle as NativeViewDescriptor
    if (!n || typeof n.id !== 'number') throw new Error('NativeBackend: 非法句柄')
    return n
  }

  return {
    id,
    version: '0.1.0',
    capabilities: NATIVE_CAPABILITIES,

    createElement(node: IRNode): NodeHandle {
      // ★G-31 B3：有 semantic → 按平台语义映射原生视图类型（layout.grid → GridLayoutManager / Grid）；否则按 type 原样
      const viewType = node.semantic ? semanticMap[node.semantic] ?? node.type : node.type
      const descriptor: NativeViewDescriptor = {
        id: nextId++,
        type: viewType,
        props: { ...node.props },
        children: [],
        parent: null,
        text: '',
        handle: null,
      }
      descriptor.handle = viewAdapter.createView(descriptor)
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
      viewAdapter.insertView(c.handle, p.handle, anchor ? ensureNode(anchor).handle : undefined)
    },

    remove(child) {
      const c = ensureNode(child)
      if (c.parent) {
        const idx = c.parent.children.indexOf(c)
        if (idx >= 0) c.parent.children.splice(idx, 1)
        c.parent = null
      }
      nodes.delete(c.id)
      viewAdapter.removeView(c.handle)
    },

    patchProp(el, key, prev, next) {
      const n = ensureNode(el)
      if (next === null || next === undefined) {
        delete n.props[key]
      } else {
        n.props[key] = next
      }
      viewAdapter.updateView(n.handle, key, prev, next)
    },

    setText(el, text) {
      const n = ensureNode(el)
      n.text = text
      viewAdapter.setViewText(n.handle, text)
    },

    measure() {
      return { width: 0, height: 0 }
    },
  }
}
