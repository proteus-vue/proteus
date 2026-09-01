// examples/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA + Pinia 多端适配工厂）
// ★pinia-plan M3：createWebPinia() 注入平台标记 + LocalStorage 持久化（player store 持久化声明自动生效）
// ★lifecycle-plan B1/B2：defineApp 阶段化启动（bootstrap → interactive，超时降级 + trace）
// ★devtools-plan UI：TraceBus 事件流 → Vue DevTools Timeline 面板（浏览器装 Vue DevTools 扩展可见）
import { createApp } from 'vue'
import App from './App.vue'
import { createWebPinia, defineApp } from '@proteus-vue/runtime'
import { createApi } from '@proteus-vue/api'
// ★14-mp-first-semantics：小程序语义 Web 模拟层——注册 view/text/button/input/image 组件 + wx API（以小程序为标准）
import { installWebPlatform } from '@proteus-vue/web'
// 微信默认样式对齐层（button/input 等原生默认外观对齐小程序，双端视觉一致）
import '@proteus-vue/built-in-components/style.css'
// ★devtools-plan：TraceBus 事件源 + Vue DevTools Timeline 接入（@vue/devtools-api）
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import { createTraceBusSource, installProteusTimeline } from '@proteus-vue/devtools'
import { setupDevtoolsPlugin } from '@vue/devtools-api'

// ★api-plan B1：API 客户端初始化（lifecycle coreReady 阶段——业务零平台分支）
const api = createApi({ baseURL: 'https://api.example.com' })

// ★devtools-plan：TraceBus（开发可观测事件流；生产零开销——setEnabled 门控）
const traceBus = createTraceBus({ enabled: true })
const emit = (source: 'lifecycle' | 'router' | 'api', phase: 'start' | 'end' | 'point', name: string): void => {
  traceBus.emit(source, phase, name)
}

// 阶段化启动：bootstrap 能力探测 → coreReady 核心服务 → navigationReady → interactive 可交互
// （Web 端零转换直跑；小程序端经编译期映射 App() 钩子）
defineApp({
  bootstrap(ctx) {
    emit('lifecycle', 'start', 'bootstrap')
    console.log('[lifecycle] bootstrap', ctx.platform)
  },
  async coreReady(ctx) {
    emit('lifecycle', 'end', 'bootstrap')
    emit('lifecycle', 'start', 'coreReady')
    // API 客户端就绪（真实业务在此做 token 刷新等）
    ctx.isMinimalMode === false && console.log('[lifecycle] coreReady api:', api !== undefined)
  },
  interactive() {
    emit('lifecycle', 'end', 'coreReady')
    emit('lifecycle', 'start', 'interactive')
    // ★小程序语义组件/API 注入（installWebPlatform：view/text/button/input/image + wx.*）
    const app = createApp(App)
    installWebPlatform(app)
    app.use(createWebPinia()).mount('#app')
    emit('lifecycle', 'end', 'interactive')

    // ★Vue DevTools 接入：Timeline 面板出现 Proteus layer（编译/路由/API/生命周期事件；
    //   组件树 + Pinia 状态由 Vue DevTools 原生展示——Web 端即标准 Vue 应用）
    setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (devtoolsApi) => {
      installProteusTimeline(devtoolsApi as never, { source: createTraceBusSource(traceBus) })
    })
  },
}).run({ launchType: 'cold' })
