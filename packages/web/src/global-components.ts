// packages/web/src/global-components.d.ts
// ★14-mp-first-semantics：小程序组件全局类型声明——模板里写 view/text/button/input/image 即用小程序语义组件类型
//   （覆盖 Vue 原生 HTML 类型；Web 端 installWebPlatform 注册同名运行时组件，类型与运行时一致）
import type { WebView } from './components/view'
import type { WebText } from './components/text'
import type { WebButton } from './components/button'
import type { WebInput } from './components/input'
import type { WebImage } from './components/image'

declare module 'vue' {
  export interface GlobalComponents {
    view: typeof WebView
    text: typeof WebText
    button: typeof WebButton
    input: typeof WebInput
    image: typeof WebImage
  }
}

export {}
