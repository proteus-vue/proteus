// packages/component-ir/src/map.ts
// ★G-31 B1：semantic → 各端 Backend 映射（验证「Backend 消费 semantic 而非 tag 字符串」）
//   后端实现的是「语义类型 → 原生控件」的映射，不是「标签名 → 标签名」的翻译（G-31 §5）
//   ★覆盖五端（G-31 B3 补全）：vue-dom（Web）/ native-ios（UIKit）/ native-android（Jetpack）/
//     native-harmony（ArkUI）/ skyline（微信小程序原生渲染）/ flutter / headless
//   控件名参考：fluid-layout-essence 02-system-capability-mapping + adaptive-container 03-five-end-mapping
import type { BackendId } from '@proteus-vue/render-backend'

/** 语义类型 → 各端 Backend 控件（布局原语 + UI 原语 + 能力入口——G-31 §3 组件清单） */
export const SEMANTIC_BACKEND_MAP: Record<string, Partial<Record<BackendId | 'web', string>>> = {
  // —— 布局原语（G-22 四原语 + box/adaptive）——
  'layout.box': {
    'vue-dom': 'div',
    'native-ios': 'UIView',
    'native-android': 'FrameLayout',
    'native-harmony': 'Stack',
    skyline: 'view',
    flutter: 'Container',
    headless: 'box',
  },
  'layout.stack': {
    'vue-dom': 'div.flex',
    'native-ios': 'UIStackView',
    'native-android': 'LinearLayout',
    'native-harmony': 'Flex',
    skyline: 'view.flex',
    flutter: 'Flex',
    headless: 'stack',
  },
  'layout.grid': {
    'vue-dom': 'div.grid',
    'native-ios': 'UICollectionView',
    'native-android': 'GridLayoutManager',
    'native-harmony': 'Grid',
    skyline: 'grid', // Skyline 原生 grid 组件（编译期静态 WXSS）
    flutter: 'GridView',
    headless: 'grid',
  },
  'layout.fluid': {
    'vue-dom': 'div.fluid',
    'native-ios': 'AutoLayout',
    'native-android': 'ConstraintLayout',
    'native-harmony': 'Flex.fluid',
    skyline: 'view.fluid',
    flutter: 'Wrap',
    headless: 'fluid',
  },
  'layout.adaptive': {
    'vue-dom': 'dialog',
    'native-ios': 'UISheet',
    'native-android': 'BottomSheetDialog',
    'native-harmony': 'Sheet', // @ohos.arkui.advanced
    skyline: 'half-screen',
    flutter: 'showModal',
    headless: 'adaptive',
  },
  'layout.fit': {
    'vue-dom': 'div.fit',
    'native-ios': 'intrinsicSize',
    'native-android': 'wrapContent',
    'native-harmony': 'fitContent',
    skyline: 'view.fit',
    flutter: 'IntrinsicWidth',
    headless: 'fit',
  },
  // ★G-31 B4：Fluid 体系扩展语义（五端映射）
  'layout.split': {
    'vue-dom': 'div.split',
    'native-ios': 'UISplitViewController',
    'native-android': 'SlidingPaneLayout',
    'native-harmony': 'SideBarContainer',
    skyline: 'view.split',
    flutter: 'Row',
    headless: 'split',
  },
  'layout.safe': {
    'vue-dom': 'div.safe',
    'native-ios': 'safeAreaLayoutGuide',
    'native-android': 'WindowInsets',
    'native-harmony': 'getAvoidArea',
    skyline: 'env.safe-area',
    flutter: 'SafeArea',
    headless: 'safe',
  },
  'layout.sidebar': {
    'vue-dom': 'div.sidebar',
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
    'vue-dom': 'div.list',
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
    'vue-dom': 'dialog.scan',
    'native-ios': 'AVCaptureSession',
    'native-android': 'CameraX',
    'native-harmony': 'ScanKit',
    skyline: 'wx.scanCode',
    flutter: 'scanQR',
    headless: 'scan-qr',
  },
  'capability.pick-photo': {
    'vue-dom': 'input.file',
    'native-ios': 'UIImagePicker',
    'native-android': 'PhotoPicker',
    'native-harmony': 'PhotoViewPicker',
    skyline: 'wx.chooseMedia',
    flutter: 'pickPhoto',
    headless: 'pick-photo',
  },
  'capability.location': {
    'vue-dom': 'geolocation',
    'native-ios': 'CLLocationManager',
    'native-android': 'FusedLocation',
    'native-harmony': 'geoLocationManager',
    skyline: 'wx.getLocation',
    flutter: 'getLocation',
    headless: 'location',
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
