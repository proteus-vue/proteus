// packages/component-ir/src/map.ts
// ★G-31 B1：semantic → 各端 Backend 映射（验证「Backend 消费 semantic 而非 tag 字符串」）
//   后端实现的是「语义类型 → 原生控件」的映射，不是「标签名 → 标签名」的翻译（G-31 §5）
//   ★覆盖五端（G-31 B3 补全）：vue-dom（Web）/ native-ios（UIKit）/ native-android（Jetpack）/
//     native-harmony（ArkUI）/ skyline（微信小程序原生渲染）/ flutter / headless
//   控件名参考：fluid-layout-essence 02-system-capability-mapping + adaptive-container 03-five-end-mapping
import type { BackendId } from '@proteus-vue/render-backend'

/** 语义类型 → 各端 Backend 控件（布局原语 + UI 原语 + 能力入口——G-31 §3 组件清单）
 *  ★G-31 B5：vue-dom 列与 render-backend SEMANTIC_WEB_MAP 实际产出一致（div.proteus-* 语义类）——
 *    参考表即门禁标准，component-conformance 机器校验「快照 control == 参考表」 */
export const SEMANTIC_BACKEND_MAP: Record<string, Partial<Record<BackendId | 'web', string>>> = {
  // —— 布局原语（G-22 四原语 + box/adaptive）——
  'layout.box': {
    'vue-dom': 'div.proteus-box',
    'native-ios': 'UIView',
    'native-android': 'FrameLayout',
    'native-harmony': 'Stack',
    skyline: 'view',
    flutter: 'Container',
    headless: 'box',
  },
  'layout.stack': {
    'vue-dom': 'div.proteus-stack',
    'native-ios': 'UIStackView',
    'native-android': 'LinearLayout',
    'native-harmony': 'Flex',
    skyline: 'view.flex',
    flutter: 'Flex',
    headless: 'stack',
  },
  'layout.grid': {
    'vue-dom': 'div.proteus-grid',
    'native-ios': 'UICollectionView',
    'native-android': 'GridLayoutManager',
    'native-harmony': 'Grid',
    skyline: 'grid', // Skyline 原生 grid 组件（编译期静态 WXSS）
    flutter: 'GridView',
    headless: 'grid',
  },
  'layout.fluid': {
    'vue-dom': 'div.proteus-fluid',
    'native-ios': 'AutoLayout',
    'native-android': 'ConstraintLayout',
    'native-harmony': 'Flex.fluid',
    skyline: 'view.fluid',
    flutter: 'Wrap',
    headless: 'fluid',
  },
  'layout.adaptive': {
    'vue-dom': 'div.proteus-adaptive',
    'native-ios': 'UISheet',
    'native-android': 'BottomSheetDialog',
    'native-harmony': 'Sheet', // @ohos.arkui.advanced
    skyline: 'half-screen',
    flutter: 'showModal',
    headless: 'adaptive',
  },
  'layout.fit': {
    'vue-dom': 'div.proteus-fit',
    'native-ios': 'intrinsicSize',
    'native-android': 'wrapContent',
    'native-harmony': 'fitContent',
    skyline: 'view.fit',
    flutter: 'IntrinsicWidth',
    headless: 'fit',
  },
  // ★G-31 B4：Fluid 体系扩展语义（五端映射）
  'layout.split': {
    'vue-dom': 'div.proteus-split',
    'native-ios': 'UISplitViewController',
    'native-android': 'SlidingPaneLayout',
    'native-harmony': 'SideBarContainer',
    skyline: 'view.split',
    flutter: 'Row',
    headless: 'split',
  },
  'layout.safe': {
    'vue-dom': 'div.proteus-safe',
    'native-ios': 'safeAreaLayoutGuide',
    'native-android': 'WindowInsets',
    'native-harmony': 'getAvoidArea',
    skyline: 'env.safe-area',
    flutter: 'SafeArea',
    headless: 'safe',
  },
  'layout.sidebar': {
    'vue-dom': 'div.proteus-sidebar',
    'native-ios': 'UISplitViewController.side',
    'native-android': 'NavigationRail',
    'native-harmony': 'SideBarContainer',
    skyline: 'view.sidebar',
    flutter: 'NavigationRail',
    headless: 'sidebar',
  },
  // —— 基础 UI 原语 ——
  'ui.text': {
    'vue-dom': 'span',
    'native-ios': 'UILabel',
    'native-android': 'TextView',
    'native-harmony': 'Text',
    skyline: 'text',
    flutter: 'Text',
    headless: 'text',
  },
  'ui.button': {
    'vue-dom': 'button',
    'native-ios': 'UIButton',
    'native-android': 'Button',
    'native-harmony': 'Button',
    skyline: 'button',
    flutter: 'FilledButton',
    headless: 'button',
  },
  'ui.image': {
    'vue-dom': 'img',
    'native-ios': 'UIImageView',
    'native-android': 'ImageView',
    'native-harmony': 'Image',
    skyline: 'image',
    flutter: 'Image',
    headless: 'image',
  },
  'ui.input': {
    'vue-dom': 'input',
    'native-ios': 'UITextField',
    'native-android': 'EditText',
    'native-harmony': 'TextInput',
    skyline: 'input',
    flutter: 'TextField',
    headless: 'input',
  },
  'ui.list': {
    'vue-dom': 'div.proteus-list',
    'native-ios': 'UITableView',
    'native-android': 'RecyclerView',
    'native-harmony': 'List',
    skyline: 'list-view',
    flutter: 'ListView',
    headless: 'list',
  },
  'ui.nav': {
    'vue-dom': 'nav',
    'native-ios': 'UINavigationController',
    'native-android': 'NavigationRail',
    'native-harmony': 'Navigation',
    skyline: 'navigator',
    flutter: 'Navigator',
    headless: 'nav',
  },
  // —— 能力入口（G-28 组件化）——
  'capability.scan-qr': {
    'vue-dom': 'button.proteus-scan-qr',
    'native-ios': 'AVCaptureSession',
    'native-android': 'CameraX',
    'native-harmony': 'ScanKit',
    skyline: 'wx.scanCode',
    flutter: 'scanQR',
    headless: 'scan-qr',
  },
  'capability.pick-photo': {
    'vue-dom': 'input.proteus-pick-photo',
    'native-ios': 'UIImagePicker',
    'native-android': 'PhotoPicker',
    'native-harmony': 'PhotoViewPicker',
    skyline: 'wx.chooseMedia',
    flutter: 'pickPhoto',
    headless: 'pick-photo',
  },
  'capability.location': {
    'vue-dom': 'button.proteus-location',
    'native-ios': 'CLLocationManager',
    'native-android': 'FusedLocation',
    'native-harmony': 'geoLocationManager',
    skyline: 'wx.getLocation',
    flutter: 'getLocation',
    headless: 'location',
  },
  // ★G-32 B1：新增 implemented 语义（16 个——布局补齐 6 + UI 补齐 4(+textarea) + Shell 4）
  'layout.inline': {
    'vue-dom': 'div.proteus-inline',
    'native-ios': 'UITextAttachment',
    'native-android': 'TextView.inline',
    'native-harmony': 'Span',
    skyline: 'view.inline',
    flutter: 'InlineSpan',
    headless: 'inline',
  },
  'layout.spacer': {
    'vue-dom': 'div.proteus-spacer',
    'native-ios': 'UILayoutGuide',
    'native-android': 'Space',
    'native-harmony': 'Blank', // ArkUI Blank 弹性空白
    skyline: 'view.spacer',
    flutter: 'Spacer',
    headless: 'spacer',
  },
  'layout.divider': {
    'vue-dom': 'hr.proteus-divider',
    'native-ios': 'UIView.divider',
    'native-android': 'View.divider',
    'native-harmony': 'Divider', // ArkUI Divider
    skyline: 'view.divider',
    flutter: 'Divider',
    headless: 'divider',
  },
  'layout.scroll': {
    'vue-dom': 'div.proteus-scroll',
    'native-ios': 'UIScrollView',
    'native-android': 'ScrollView',
    'native-harmony': 'Scroll', // ArkUI Scroll
    skyline: 'scroll-view',
    flutter: 'ScrollView',
    headless: 'scroll',
  },
  'layout.virtual-list': {
    'vue-dom': 'div.proteus-virtual-list',
    'native-ios': 'UICollectionView',
    'native-android': 'RecyclerView',
    'native-harmony': 'List',
    skyline: 'list-view',
    flutter: 'ListView',
    headless: 'virtual-list',
  },
  'layout.masonry': {
    'vue-dom': 'div.proteus-masonry',
    'native-ios': 'UICollectionView.masonry',
    'native-android': 'StaggeredGridLayoutManager',
    'native-harmony': 'WaterFlow', // ArkUI WaterFlow 瀑布流
    skyline: 'grid.masonry',
    flutter: 'SliverMasonryGrid',
    headless: 'masonry',
  },
  'ui.heading': {
    'vue-dom': 'div.proteus-heading',
    'native-ios': 'UILabel.heading',
    'native-android': 'TextView.heading',
    'native-harmony': 'Text.heading',
    skyline: 'text.heading',
    flutter: 'Text.heading',
    headless: 'heading',
  },
  'ui.icon': {
    'vue-dom': 'span.proteus-icon',
    'native-ios': 'UIImageView.icon',
    'native-android': 'ImageView.icon',
    'native-harmony': 'SymbolGlyph', // ArkUI 符号图标
    skyline: 'icon',
    flutter: 'Icon',
    headless: 'icon',
  },
  'ui.textarea': {
    'vue-dom': 'textarea',
    'native-ios': 'UITextView',
    'native-android': 'EditText.multiline',
    'native-harmony': 'TextArea', // ArkUI TextArea
    skyline: 'textarea',
    flutter: 'TextField.multiline',
    headless: 'textarea',
  },
  'ui.switch': {
    'vue-dom': 'div.proteus-switch',
    'native-ios': 'UISwitch',
    'native-android': 'Switch',
    'native-harmony': 'Toggle', // ArkUI Toggle
    skyline: 'switch',
    flutter: 'Switch',
    headless: 'switch',
  },
  'ui.slider': {
    'vue-dom': 'div.proteus-slider',
    'native-ios': 'UISlider',
    'native-android': 'SeekBar',
    'native-harmony': 'Slider', // ArkUI Slider
    skyline: 'slider',
    flutter: 'Slider',
    headless: 'slider',
  },
  'shell.nav': {
    'vue-dom': 'nav.proteus-nav',
    'native-ios': 'UINavigationBar',
    'native-android': 'Toolbar',
    'native-harmony': 'NavigationBar',
    skyline: 'navigator',
    flutter: 'AppBar',
    headless: 'nav',
  },
  'shell.tabbar': {
    'vue-dom': 'nav.proteus-tabbar',
    'native-ios': 'UITabBar',
    'native-android': 'BottomNavigationView',
    'native-harmony': 'Tabs', // ArkUI Tabs
    skyline: 'tabbar',
    flutter: 'BottomNavigationBar',
    headless: 'tabbar',
  },
  'shell.drawer': {
    'vue-dom': 'aside.proteus-drawer',
    'native-ios': 'UIView.drawer',
    'native-android': 'DrawerLayout',
    'native-harmony': 'Panel',
    skyline: 'view.drawer',
    flutter: 'Drawer',
    headless: 'drawer',
  },
  'shell.modal': {
    'vue-dom': 'div.proteus-modal',
    'native-ios': 'UIAlertController',
    'native-android': 'Dialog',
    'native-harmony': 'CustomDialog',
    skyline: 'modal',
    flutter: 'showDialog',
    headless: 'modal',
  },
  // ★G-32 B4：Shell 补齐（page/segment/popover/action-sheet）+ UI 补齐（rich-text/avatar/media/canvas/svg/select/checkbox/radio/picker/form）
  'shell.page': {
    'vue-dom': 'div.proteus-page',
    'native-ios': 'UIViewController',
    'native-android': 'Activity',
    'native-harmony': 'Page', // ArkUI Page
    skyline: 'page',
    flutter: 'Scaffold',
    headless: 'page',
  },
  'shell.segment': {
    'vue-dom': 'div.proteus-segment',
    'native-ios': 'UISegmentedControl',
    'native-android': 'TabLayout',
    'native-harmony': 'Segmented', // ArkUI 分段器
    skyline: 'segment',
    flutter: 'SegmentedButton',
    headless: 'segment',
  },
  'shell.popover': {
    'vue-dom': 'div.proteus-popover',
    'native-ios': 'UIPopoverController',
    'native-android': 'PopupWindow',
    'native-harmony': 'Popup', // ArkUI Popup
    skyline: 'view.popover',
    flutter: 'showMenu',
    headless: 'popover',
  },
  'shell.action-sheet': {
    'vue-dom': 'div.proteus-action-sheet',
    'native-ios': 'UIAlertController.actionSheet',
    'native-android': 'BottomSheet',
    'native-harmony': 'ActionSheet', // ArkUI ActionSheetDialog
    skyline: 'action-sheet',
    flutter: 'showModalBottomSheet',
    headless: 'action-sheet',
  },
  'ui.rich-text': {
    'vue-dom': 'div.proteus-rich-text',
    'native-ios': 'UITextView.attributed',
    'native-android': 'TextView.html',
    'native-harmony': 'RichText', // ArkUI RichText
    skyline: 'rich-text',
    flutter: 'RichText',
    headless: 'rich-text',
  },
  'ui.avatar': {
    'vue-dom': 'div.proteus-avatar',
    'native-ios': 'UIImageView.avatar',
    'native-android': 'ImageView.avatar',
    'native-harmony': 'Image.avatar',
    skyline: 'image.avatar',
    flutter: 'CircleAvatar',
    headless: 'avatar',
  },
  'ui.media': {
    'vue-dom': 'div.proteus-media',
    'native-ios': 'AVPlayerView',
    'native-android': 'VideoView',
    'native-harmony': 'Video', // ArkUI Video
    skyline: 'video',
    flutter: 'VideoPlayer',
    headless: 'media',
  },
  'ui.canvas': {
    'vue-dom': 'canvas',
    'native-ios': 'UIView.canvas',
    'native-android': 'SurfaceView',
    'native-harmony': 'Canvas', // ArkUI Canvas
    skyline: 'canvas',
    flutter: 'CustomPaint',
    headless: 'canvas',
  },
  'ui.svg': {
    'vue-dom': 'svg',
    'native-ios': 'UIView.svg',
    'native-android': 'VectorDrawable',
    'native-harmony': 'Shape', // ArkUI Shape
    skyline: 'view.svg',
    flutter: 'SvgPicture',
    headless: 'svg',
  },
  'ui.select': {
    'vue-dom': 'div.proteus-select',
    'native-ios': 'UIPickerView',
    'native-android': 'Spinner',
    'native-harmony': 'Select', // ArkUI Select
    skyline: 'picker',
    flutter: 'DropdownButton',
    headless: 'select',
  },
  'ui.checkbox': {
    'vue-dom': 'div.proteus-checkbox',
    'native-ios': 'UIButton.checkbox',
    'native-android': 'CheckBox',
    'native-harmony': 'Checkbox', // ArkUI Checkbox
    skyline: 'checkbox',
    flutter: 'Checkbox',
    headless: 'checkbox',
  },
  'ui.radio': {
    'vue-dom': 'div.proteus-radio',
    'native-ios': 'UIButton.radio',
    'native-android': 'RadioButton',
    'native-harmony': 'Radio', // ArkUI Radio
    skyline: 'radio',
    flutter: 'Radio',
    headless: 'radio',
  },
  'ui.picker': {
    'vue-dom': 'div.proteus-picker',
    'native-ios': 'UIDatePicker',
    'native-android': 'DatePicker',
    'native-harmony': 'DatePicker', // ArkUI DatePicker
    skyline: 'picker-view',
    flutter: 'showDatePicker',
    headless: 'picker',
  },
  'ui.form': {
    'vue-dom': 'form',
    'native-ios': 'UIView.form',
    'native-android': 'LinearLayout.form',
    'native-harmony': 'FormComponent', // ArkUI FormComponent
    skyline: 'form',
    flutter: 'Form',
    headless: 'form',
  },
  // ★G-32 B4 ④ Gesture 组件形态（drag/scrollable——指令/useGesture 属绑定层不产渲染节点）
  'gesture.draggable': {
    'vue-dom': 'div.proteus-draggable',
    'native-ios': 'UIPanGestureRecognizer',
    'native-android': 'GestureDetector',
    'native-harmony': 'PanGesture', // ArkUI PanGesture
    skyline: 'movable-view',
    flutter: 'Draggable',
    headless: 'draggable',
  },
  'gesture.scrollable': {
    'vue-dom': 'div.proteus-scrollable',
    'native-ios': 'UIScrollView.gesture',
    'native-android': 'NestedScrollView',
    'native-harmony': 'Scroll.gesture', // ArkUI Scroll + 手势增强
    skyline: 'scroll-view',
    flutter: 'Scrollable',
    headless: 'scrollable',
  },
  // ★G-32 B5 尾巴：E18 声明式导航组件形态（p-router-link——语义「导航目标」；点击 emit('navigate') 由工程层执行）
  'engineering.router-link': {
    'vue-dom': 'a.proteus-router-link',
    'native-ios': 'UIButton.link',
    'native-android': 'TextView.link',
    'native-harmony': 'Text.link',
    skyline: 'navigator', // Skyline <navigator> 声明式导航
    flutter: 'TextButton',
    headless: 'router-link',
  },
  // ★G-32 B5 续二：工程原语动画组件形态（E19 transition / E20 animate——纯 CSS 声明语义；Hook 归 API 层不产节点）
  'engineering.transition': {
    'vue-dom': 'div.proteus-transition',
    'native-ios': 'UIView.transition', // UIView transition(with:duration:options:) 显隐过渡
    'native-android': 'View.animate.transition', // ObjectAnimator alpha/translation 组合
    'native-harmony': 'animateTo.transition', // ArkUI animateTo 显隐过渡
    skyline: 'view.transition', // Skyline transition CSS
    flutter: 'AnimatedOpacity',
    headless: 'transition',
  },
  'engineering.animate': {
    'vue-dom': 'div.proteus-animate',
    'native-ios': 'CAKeyframeAnimation', // 核心动画关键帧
    'native-android': 'ValueAnimator', // 属性动画
    'native-harmony': 'Animator.transition', // ArkUI Animator
    skyline: 'view.animation', // Skyline animation CSS
    flutter: 'AnimationController',
    headless: 'animate',
  },
}

/**
 * 语义 → 指定后端控件（未映射 → null，由后端自定义）
 * ★关键：Backend 映射的是 semantic 字段（layout.grid），不是 tag 字符串（p-grid）——
 *   同一 semantic 在不同后端得到不同原生控件，这就是「语义收敛 + 后端实现」
 */
export function mapSemanticToBackend(semantic: string, backendId: string): string | null {
  const row = SEMANTIC_BACKEND_MAP[semantic]
  if (!row) return null
  return row[backendId as BackendId] ?? null
}
