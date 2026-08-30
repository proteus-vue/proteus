// packages/web/src/global-components.ts
// ★14-mp-first-semantics：小程序组件全局类型声明——模板里写 view/text/button/input/image
//   （Web 端经 defaultScopedPlugin 改写为 proteus-*）即用小程序语义组件类型
//   组件名必须带连字符（proteus-*）：Vue 编译器只对带连字符标签 resolveComponent
import type { WebView } from './components/view'
import type { WebText } from './components/text'
import type { WebButton } from './components/button'
import type { WebInput } from './components/input'
import type { WebImage } from './components/image'
import type { WebScrollView } from './components/scroll-view'
import type { WebTextarea } from './components/textarea'
import type { WebSwitch } from './components/switch'
import type { WebSlider } from './components/slider'
import type { WebIcon } from './components/icon'
import type { WebProgress } from './components/progress'
import type { WebNavigator } from './components/navigator'

declare module 'vue' {
  export interface GlobalComponents {
    'proteus-view': typeof WebView
    'proteus-text': typeof WebText
    'proteus-button': typeof WebButton
    'proteus-input': typeof WebInput
    'proteus-image': typeof WebImage
    'proteus-scroll-view': typeof WebScrollView
    'proteus-textarea': typeof WebTextarea
    'proteus-switch': typeof WebSwitch
    'proteus-slider': typeof WebSlider
    'proteus-icon': typeof WebIcon
    'proteus-progress': typeof WebProgress
    'proteus-navigator': typeof WebNavigator
  }
}

export {}
