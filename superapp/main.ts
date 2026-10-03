// superapp/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA）
// 与 MP 端同一套源码：Web 端装小程序语义模拟层，使 view/text/button 等标签与 wx.* 在浏览器可用。
import { createApp } from 'vue'
import App from './App.vue'
import { defineApp } from '@proteus-vue/runtime'
import { installWebPlatform } from '@proteus-vue/web'
import { installFluidLayout } from '@proteus-vue/components'
import { initAppConfig } from '@proteus-vue/app-config'
import appConfig from './app.config'
// ★小程序语义标签的 Web 模拟层样式（proteus-view/button/input… 的原生语义视觉）
import '@proteus-vue/built-in-components/style.css'
// ★★超级应用视觉设计规范（L1 token + L2 组件规范）——**单一事实源**
//   MP 端同一份经 proteus.config 的 globalStyle → app.wxss（两端同源）
import './styles/global.css'

initAppConfig(appConfig)

defineApp({
  interactive() {
    const app = createApp(App)
    installWebPlatform(app)
    installFluidLayout(app)
    app.mount('#app')
  },
}).run({ launchType: 'cold' })
