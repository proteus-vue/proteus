// packages/web/src/index.ts —— @proteus-vue/web（小程序语义 Web 模拟层，14-mp-first-semantics）
// 以小程序组件/API 为标准，Web 端完全对齐：模板写小程序标签（view/text/button…）+ wx API 即双端可用
// ★拆包后（built-in-components）：本包保留 wx API 模拟层 + 聚合安装；内置组件本体在 @proteus-vue/built-in-components
// 组件类型（GlobalComponents）随 @proteus-vue/built-in-components 包加载
// ★模板类型（GlobalComponents 声明合并）随包加载——App.vue 写 <global-layer> 等标签获得类型检查
import './global-components'
export { installWebPlatform } from './install'
// ★★★GP3-a（2026-10-03）：三层挂载（Web 端）——Global / Page / Overlay
export {
  installMountLayers, createMountLayerComponent,
  AppRoot, GlobalLayer, PageLayer, OverlayLayer, WEB_MOUNT_LAYERS,
} from './mount-layers'
export { wx, installWxApi } from './wx'
export type { WxApi } from './wx'
// ★内置组件 re-export（向后兼容；新消费方建议直接 import @proteus-vue/built-in-components）
export { installBuiltInComponents, OPEN_TYPE_EVENTS, OPEN_TYPE_STATUS, BUILT_IN_TAGS } from '@proteus-vue/built-in-components'
export { WebView, WebText, WebButton, WebInput, WebImage, WebScrollView, WebTextarea, WebSwitch, WebSlider, WebIcon, WebProgress, WebNavigator, WebPicker } from '@proteus-vue/built-in-components'
