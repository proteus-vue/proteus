// packages/built-in-components/src/index.ts
// @proteus-vue/built-in-components —— 框架内置组件（微信小程序内置组件为基准的跨端组件本体）
// 定位：内置组件（框架控制、以微信原生组件为基准）与扩展组件（@proteus-vue/components，p-* 生态组件）
//       明确区分；Web 端为 Vue 实现（proteus-*），Skyline 端用原生（usingComponents 自动解析），App 端 v0.6。
// ★类型引用：global-components.ts（GlobalComponents 声明 proteus-* 组件类型）随包加载
import './global-components'
export { installBuiltInComponents } from './install'
export { OPEN_TYPE_EVENTS, OPEN_TYPE_STATUS } from './open-type'
export { BUILT_IN_TAGS, getBuiltInSchema } from './schemas'
export { WebView } from './components/view'
export { WebText } from './components/text'
export { WebButton } from './components/button'
export { WebInput } from './components/input'
export { WebImage } from './components/image'
export { WebScrollView } from './components/scroll-view'
export { WebTextarea } from './components/textarea'
export { WebSwitch } from './components/switch'
export { WebSlider } from './components/slider'
export { WebIcon } from './components/icon'
export { WebProgress } from './components/progress'
export { WebNavigator } from './components/navigator'
export { WebPicker } from './components/picker'
