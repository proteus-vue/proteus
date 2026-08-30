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

/** 注册小程序语义组件（view/text/button/input/image…）+ wx API 模拟（wx.* 全局注入） */
export function installWebPlatform(app: App): App {
  app.component('view', WebView)
  app.component('text', WebText)
  app.component('button', WebButton)
  app.component('input', WebInput)
  app.component('image', WebImage)
  installWxApi()
  return app
}
