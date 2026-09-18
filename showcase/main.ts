// showcase/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA）
// 目标：展示「同一套源码 → 小程序 + Web」的跨端语义——Web 端装小程序语义模拟层，
// 使 view/text/button/input/image 等标签与 wx.* API 在浏览器内同样可用（以小程序为标准）。
import { createApp } from 'vue'
import App from './App.vue'
import { createWebPinia, defineApp } from '@proteus-vue/runtime'
import { createApi } from '@proteus-vue/api'
import { installWebPlatform } from '@proteus-vue/web'
import { installFluidLayout } from '@proteus-vue/components'
import { createGestureDirective } from '@proteus-vue/gesture'
import { getProteusTraceBus } from '@proteus-vue/devtools-runtime'
import { initAppConfig } from '@proteus-vue/app-config'
import appConfig from './app.config'
import { routes } from './router/auto-routes'
// ★小程序语义标签的 Web 模拟层样式（proteus-view/button/input… 的原生语义视觉）
//   缺此 → Web 端 <button> 无 type/size/plain/disabled/hover 样式（官方属性对齐在 Web 形同虚设）
import '@proteus-vue/built-in-components/style.css'
// ★设计 token（全局唯一来源）
import './styles/tokens.css'

// app-config 启动即初始化（页面 useAppConfig() 即可读取）
initAppConfig(appConfig)

const traceBus = getProteusTraceBus()
if (import.meta.env.DEV || __PROTEUS_DEBUG__) traceBus.setEnabled(true)

const api = createApi({ baseURL: 'https://api.proteus-vue.cn', traceBus })

// ★阶段化启动（lifecycle）：bootstrap → coreReady → interactive
defineApp({
  async coreReady(ctx) {
    ctx.isMinimalMode === false && console.log('[showcase] coreReady api:', api !== undefined)
  },
  interactive() {
    const app = createApp(App)
    // 小程序语义模拟层：注册 view/text/button/input/image 组件 + wx.* API
    installWebPlatform(app)
    // ★G-22 柔性布局：Web 端 v-p-fluid 指令（MP 端由编译器模板规则处理同名属性）
    installFluidLayout(app)
    // ★G-32 手势：v-gesture 指令（Web Pointer Events；MP 端由平台手势承接）
    app.directive('gesture', createGestureDirective())
    app.use(createWebPinia()).mount('#app')
  },
}).run({ launchType: 'cold' })
