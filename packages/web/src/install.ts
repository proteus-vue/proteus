// packages/web/src/install.ts
// ★installWebPlatform：注册小程序语义组件 + wx API 模拟（14-mp-first-semantics）
// 用法：createApp(App).use(createWebPinia()).use? / main.ts: installWebPlatform(app)
// 组件注册为全局（view/text/button/input/image…）——模板里写小程序标签即用模拟组件
import type { App } from 'vue'
import { WebView } from './components/view'
import { WebText } from './components/text'
import { WebButton } from './components/button'
import { WebInput } from './components/input'
import { WebImage } from './components/image'
import { installWxApi } from './wx'

/** 注册小程序语义组件（proteus-view/text/button/input/image…）+ wx API 模拟（wx.* 全局注入）
 * ★组件名必须带连字符（proteus-*）：Vue 编译器只对带连字符标签 resolveComponent——
 *   view/text/button 等无连字符标签永远编译为原生元素（注册单字组件名不生效，CDP 实测）
 */
export function installWebPlatform(app: App): App {
  app.component('proteus-view', WebView)
  app.component('proteus-text', WebText)
  app.component('proteus-button', WebButton)
  app.component('proteus-input', WebInput)
  app.component('proteus-image', WebImage)
  installWxApi()
  return app
}
