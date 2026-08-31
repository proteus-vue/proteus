// packages/built-in-components/src/install.ts
// ★installBuiltInComponents：注册框架内置组件（微信小程序内置组件为基准的 Vue 实现）
// 用法：main.ts 中 installWebPlatform(app) 内部调用；或独立使用 installBuiltInComponents(app)
// 组件注册为全局（proteus-view/proteus-text/…）——模板里写小程序标签即用内置组件模拟
// ★组件名必须带连字符（proteus-*）：Vue 编译器只对带连字符标签 resolveComponent——
//   view/text/button 等无连字符标签永远编译为原生元素（注册单字组件名不生效，CDP 实测）
import type { App } from 'vue'
import { WebView } from './components/view'
import { WebText } from './components/text'
import { WebButton } from './components/button'
import { WebInput } from './components/input'
import { WebImage } from './components/image'
import { WebScrollView } from './components/scroll-view'
import { WebTextarea } from './components/textarea'
import { WebSwitch } from './components/switch'
import { WebSlider } from './components/slider'
import { WebIcon } from './components/icon'
import { WebProgress } from './components/progress'
import { WebNavigator } from './components/navigator'
import { WebPicker } from './components/picker'

/** 注册框架内置组件（proteus-*） */
export function installBuiltInComponents(app: App): App {
  app.component('proteus-view', WebView)
  app.component('proteus-text', WebText)
  app.component('proteus-button', WebButton)
  app.component('proteus-input', WebInput)
  app.component('proteus-image', WebImage)
  app.component('proteus-scroll-view', WebScrollView)
  app.component('proteus-textarea', WebTextarea)
  app.component('proteus-switch', WebSwitch)
  app.component('proteus-slider', WebSlider)
  app.component('proteus-icon', WebIcon)
  app.component('proteus-progress', WebProgress)
  app.component('proteus-navigator', WebNavigator)
  app.component('proteus-picker', WebPicker)
  return app
}
