// css-conformance/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA）
// 与 MP 端同一套源码：Web 端装小程序语义模拟层，使 view/text 等标签与 wx.* 在浏览器可用。
import { createApp } from 'vue'
import App from './App.vue'
import { defineApp } from '@proteus-vue/runtime'
import { installWebPlatform } from '@proteus-vue/web'
import { installFluidLayout } from '@proteus-vue/components'
import { initAppConfig } from '@proteus-vue/app-config'
import appConfig from './app.config'
// 小程序语义标签的 Web 模拟层样式（proteus-view/button/input… 的原生语义视觉）
import '@proteus-vue/built-in-components/style.css'
// 全局样式（与 MP 端 app.wxss 同一份——proteus.config 的 globalStyle，单一事实源）
import './styles/global.css'
// ★★★$nav 平台级导航全局（Web · 决策 #616）：导入应用路由单例（其顶层 `createRouter(routes)`
//   在创建时登记 `globalThis.$nav`）——`installWebPlatform` 的 `globalProperties.$nav` 委托它。
//   与 RouterView 共用同一 `adapter` ⇒ `$nav` 驱动的导航会走 RouterView 的 onPageLoad。
import './router'

initAppConfig(appConfig)

defineApp({
  interactive() {
    const app = createApp(App)
    installWebPlatform(app)
    installFluidLayout(app)
    app.mount('#app')
  },
}).run({ launchType: 'cold' })
