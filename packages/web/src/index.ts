// packages/web/src/index.ts —— @proteus-vue/web（小程序语义 Web 模拟层，14-mp-first-semantics）
// 以小程序组件/API 为标准，Web 端完全对齐：模板写小程序标签（view/text/button…）+ wx API 即双端可用
// ★类型引用：global-components.d.ts（GlobalComponents 声明 view/text/button/input/image 组件类型）随包类型加载
import './global-components'
export { installWebPlatform } from './install'
export { wx, installWxApi } from './wx'
export type { WxApi } from './wx'
export { OPEN_TYPE_EVENTS, OPEN_TYPE_STATUS } from './open-type'
export { WebView } from './components/view'
export { WebText } from './components/text'
export { WebButton } from './components/button'
export { WebInput } from './components/input'
export { WebImage } from './components/image'
export { WebScrollView } from './components/scroll-view'
