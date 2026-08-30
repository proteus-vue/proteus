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

declare module 'vue' {
  export interface GlobalComponents {
    'proteus-view': typeof WebView
    'proteus-text': typeof WebText
    'proteus-button': typeof WebButton
    'proteus-input': typeof WebInput
    'proteus-image': typeof WebImage
    'proteus-scroll-view': typeof WebScrollView
  }
}

export {}
