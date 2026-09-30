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

/**
 * ★★C1：**宿主操作批次**（批量协议的元素）——一次跨边界调用携带整批变更。
 *
 * 【为什么必须有（Host ABI 的批处理红线）】`docs/Proteus_HostABI宿主抽象层设计方案.md` §3 原文：
 *   「**所有跨边界调用必须是批处理的**」+ 红线「跨边界调用 = 帧数」。
 *   而逐节点命令式适配器（`NativeViewAdapter`）在 4050 节点树上会产生
 *   **数千次跨边界调用**（每节点 create + insert + ...）⇒ 直接违反该红线。
 *
 * 【真机链路本来就是这样做的（I6 评估的实测证据）】真机宿主协议是**批量**的：
 *   `mount(treeJson)` / `updatePatches(patchesJson)` / `applyOps(bytesJson)` —— 每帧**一次**调用。
 *   ⇒ 本类型把"真机已用的批量形态"**显式建模进 SPI**，让 NativeBackend 能表达它。
 */
export type NativeHostOp =
  /** 建视图（宿主侧创建 UIView/View/ArkUI Node） */
  | { op: 'create'; id: number; type: string; props: Record<string, unknown> }
  /** 插入子视图（anchor 可选——同批次内按序应用） */
  | { op: 'insert'; id: number; parentId: number | null; anchorId?: number }
  /** 移除视图 */
  | { op: 'remove'; id: number }
  /** 属性/样式变更 */
  | { op: 'patch'; id: number; key: string; prev: unknown; next: unknown }
  /** 文本同步 */
  | { op: 'text'; id: number; text: string }

/**
 * ★★C1：**批量宿主适配器**（与逐节点 `NativeViewAdapter` 并列的第二形态）。
 *
 * 【两者的分工（本评估的结论，勿混用）】
 *   · `NativeViewAdapter`（逐节点）＝ **原型形态**：接口直观，适合简单宿主/测试；
 *     但**不满足批处理红线** ⇒ 不能作为生产形态。
 *   · `NativeBatchAdapter`（批量）＝ **生产形态**：一次 `commit` 携带整批 ⇒ 跨边界调用数 = flush 次数。
 *
 * 【与真机链路的对应】`commit(ops)` 即真机 `mount`/`updatePatches`/`applyOps` 的统一抽象：
 *   宿主侧把批次翻译成自己的渲染调用（iOS CALayer / Android Canvas / ArkUI）。
 */
export interface NativeBatchAdapter {
  /** 提交一批变更（★**一次跨边界调用**——调用方保证一批 = 一帧的变更） */
  commit(ops: readonly NativeHostOp[]): void
  /** 已提交批次数（诊断/判据用——跨边界调用计数） */
  commitCount?(): number
}

/** 判断适配器是否为批量形态（有 `commit` 即批量） */
function isBatchAdapter(a: NativeViewAdapter | NativeBatchAdapter): a is NativeBatchAdapter {
  return typeof (a as NativeBatchAdapter).commit === 'function'
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
    'layout.formfactor': 'UIViewController.formFactor',
    'ui.text': 'UILabel',
    'ui.button': 'UIButton',
    'ui.image': 'UIImageView',
    'ui.input': 'UITextField',
    'ui.list': 'UITableView',
    'ui.nav': 'UINavigationController',
    'capability.qr-code': 'AVCaptureSession',
    'capability.camera': 'UIImagePicker',
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
    // ★2026-09-30 补缺（同 vue-dom 注释）
    'shell.toast': 'UIView.toast',
    'ui.loading': 'UIActivityIndicatorView',
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
    // ★G-32 B5 尾巴：E18 声明式导航（p-router-link）
    'engineering.router-link': 'UIButton.link',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'UIView.transition',
    'engineering.share-element': 'UIView.matchedTransition',
    'engineering.animate': 'CAKeyframeAnimation',
    // ★能力颗粒度对齐 C2
    'ui.progress': 'UIProgressView',
    'ui.label': 'UILabel.label',
    'shell.page-container': 'UIPresentationController',
    'ui.selection': 'UITextView.selection',
    'shell.keyboard-accessory': 'UIInputView',
    'ui.camera': 'AVCaptureVideoPreviewLayer',
    'shell.webview': 'WKWebView',
    'shell.ad': 'UIView.ad',
    'ui.map': 'MKMapView',
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
    'layout.formfactor': 'FormFactorLayout',
    'ui.text': 'TextView',
    'ui.button': 'Button',
    'ui.image': 'ImageView',
    'ui.input': 'EditText',
    'ui.list': 'RecyclerView',
    'ui.nav': 'NavigationRail',
    'capability.qr-code': 'CameraX',
    'capability.camera': 'PhotoPicker',
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
    // ★2026-09-30 补缺（同 vue-dom 注释）
    'shell.toast': 'Toast',
    'ui.loading': 'ProgressBar',
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
    // ★G-32 B5 尾巴：E18 声明式导航（p-router-link）
    'engineering.router-link': 'TextView.link',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'View.animate.transition',
    'engineering.share-element': 'SharedElementTransition',
    'engineering.animate': 'ValueAnimator',
    // ★能力颗粒度对齐 C2
    'ui.progress': 'ProgressBar',
    'ui.label': 'TextView.label',
    'shell.page-container': 'BottomSheetDialog',
    'ui.selection': 'TextView.selection',
    'shell.keyboard-accessory': 'InputMethodService.accessory',
    'ui.camera': 'CameraX.PreviewView',
    'shell.webview': 'WebView',
    'shell.ad': 'View.ad',
    'ui.map': 'MapView',
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
    'layout.formfactor': 'GridRow.formFactor',
    'ui.text': 'Text',
    'ui.button': 'Button',
    'ui.image': 'Image',
    'ui.input': 'TextInput',
    'ui.list': 'List',
    'ui.nav': 'Navigation',
    'capability.qr-code': 'ScanKit',
    'capability.camera': 'PhotoViewPicker',
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
    'shell.toast': 'promptAction.showToast',
    'ui.loading': 'LoadingProgress',
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
    // ★G-32 B5 尾巴：E18 声明式导航（p-router-link）
    'engineering.router-link': 'Text.link',
    // ★G-32 B5 续二：工程原语动画组件形态（E19/E20）
    'engineering.transition': 'animateTo.transition',
    'engineering.share-element': 'geometryTransition',
    'engineering.animate': 'Animator.transition',
    // ★能力颗粒度对齐 C2
    'ui.progress': 'Progress',
    'ui.label': 'Text.label',
    'shell.page-container': 'bindSheet',
    'ui.selection': 'Text.selection',
    'shell.keyboard-accessory': 'KeyboardAccessory',
    'ui.camera': 'XComponent.camera',
    'shell.webview': 'Web',
    'shell.ad': 'AdSlot',
    'ui.map': 'MapComponent',
  },
}

/**
 * NativeBackend：nodeOps → 原生视图（B4——验证「nodeOps → UIView」抽象层；G-31 B3 三平台语义映射）
 * - 维护 NativeViewDescriptor 树（nodeOps 层句柄，唯一 id）
 * - 所有变更同步宿主 adapter（createView/updateView/insertView/removeView/setViewText）
 * - adapter 缺省 mock（ops 日志）；真实平台注入 SDK 桥
 * - platform：ios（UIKit 基准）/ android（Jetpack）/ harmony（ArkUI）——决定 id + semantic 映射表
 */
export function createNativeBackend(
  adapter?: NativeViewAdapter | NativeBatchAdapter,
  platform: NativePlatform = 'ios',
): ProteusRenderBackend & { flush(): void; hostCalls(): number } {
  const rawAdapter: NativeViewAdapter | NativeBatchAdapter = adapter ?? createMockNativeAdapter()
  const viewAdapter: NativeViewAdapter = rawAdapter as NativeViewAdapter
  const batchAdapter: NativeBatchAdapter | null = isBatchAdapter(rawAdapter) ? rawAdapter : null
  const semanticMap = SEMANTIC_NATIVE_MAPS[platform]
  const id = platform === 'ios' ? 'native-ios' : platform === 'android' ? 'native-android' : 'native-harmony'
  let nextId = 1
  const nodes = new Map<number, NativeViewDescriptor>()

  /**
   * ★★C1 批量模式：待提交操作队列（**逐节点适配器模式下恒为空**）。
   *
   * 【为什么不直接调用】批量适配器的语义是"一次跨边界 = 一帧变更"⇒ nodeOps 期间只**入队**，
   *   由 `flush()`（或调用方的帧边界）一次性 `commit`。
   */
  const pending: NativeHostOp[] = []
  /** 已发生的宿主调用数（★批处理红线的判据读数：逐节点模式 = 每操作 1 次；批量模式 = flush 次数） */
  let hostCalls = 0
  const queueOrCall = (op: NativeHostOp, imperative: () => void): void => {
    if (batchAdapter) {
      pending.push(op)
      return
    }
    hostCalls++
    imperative()
  }

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
      // ★C1：批量模式只入队（create 的宿主句柄在批量语义下由宿主自己管理）
      queueOrCall({ op: 'create', id: descriptor.id, type: viewType, props: descriptor.props }, () => {
        descriptor.handle = viewAdapter.createView(descriptor)
      })
      if (!batchAdapter) descriptor.handle = descriptor.handle ?? descriptor
      nodes.set(descriptor.id, descriptor)
      return descriptor
    },

    // ★2026-09-26 文本保留：'#text' → 文本描述符（type 'text'，text 字段承载内容——
    //   readback/控件树即见真实文案；真机渲染通道接线时映射 Text/Label 内容）
    createText(text: string): NodeHandle {
      const descriptor: NativeViewDescriptor = {
        id: nextId++,
        type: 'text',
        props: {},
        children: [],
        parent: null,
        text,
        handle: null,
      }
      // ★mock 适配器约定「句柄 = 描述符自身」（createView 同款）——insert 时 insertView(child.handle)
      descriptor.handle = descriptor as never
      // ★C1：批量模式也入队（否则宿主看不到文本节点创建 ⇒ 批次不自包含）
      queueOrCall({ op: 'create', id: descriptor.id, type: 'text', props: {} }, () => {
        /* 逐节点模式：文本节点由 insert+setText 表达，无独立 createView 调用（与既有行为一致） */
      })
      // ★★批量模式：**文本内容必须随创建一起进批次**——否则首帧 mount 的树种里
      //   文本节点只有空 props 与无 text ⇒ 宿主画不出任何字（而"节点数"读数照样正确，
      //   **部分读数掩盖整块丢失**）。本仓实测：S5 端到端首次跑，4051 节点的树里
      //   由 `createText` 建的文本节点全部无色无字。⇒ 补一条 text op（与 setText 同码路）。
      //   （逐节点模式不需要：那条路文本由 `insert` + `setText` 表达，行为不变。）
      if (batchAdapter) pending.push({ op: 'text', id: descriptor.id, text })
      return descriptor as never as NodeHandle
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
      queueOrCall({ op: 'insert', id: c.id, parentId: p.id, anchorId: anchor ? ensureNode(anchor).id : undefined }, () => {
        viewAdapter.insertView(c.handle, p.handle, anchor ? ensureNode(anchor).handle : undefined)
      })
    },

    remove(child) {
      const c = ensureNode(child)
      if (c.parent) {
        const idx = c.parent.children.indexOf(c)
        if (idx >= 0) c.parent.children.splice(idx, 1)
        c.parent = null
      }
      nodes.delete(c.id)
      queueOrCall({ op: 'remove', id: c.id }, () => viewAdapter.removeView(c.handle))
    },

    patchProp(el, key, prev, next) {
      const n = ensureNode(el)
      if (next === null || next === undefined) {
        delete n.props[key]
      } else {
        n.props[key] = next
      }
      queueOrCall({ op: 'patch', id: n.id, key, prev, next }, () => viewAdapter.updateView(n.handle, key, prev, next))
    },

    setText(el, text) {
      const n = ensureNode(el)
      n.text = text
      queueOrCall({ op: 'text', id: n.id, text }, () => viewAdapter.setViewText(n.handle, text))
    },

    measure() {
      return { width: 0, height: 0 }
    },

    // ★★C1 批量模式的两个接口（逐节点模式下：flush 为空操作、hostCalls 反映真实调用数）
    /** 提交本帧累积的操作（**一次跨边界调用**——批处理红线的落点） */
    flush(): void {
      if (!batchAdapter) return
      if (pending.length === 0) return
      hostCalls++
      const batch = pending.splice(0, pending.length)
      batchAdapter.commit(batch)
    },
    /** 已发生的宿主调用数（判据：批量模式下应 == flush 次数，不随节点数增长） */
    hostCalls(): number {
      return hostCalls
    },
  }
}
