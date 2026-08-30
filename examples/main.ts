// examples/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA + Pinia 多端适配工厂）
// ★pinia-plan M3：createWebPinia() 注入平台标记 + LocalStorage 持久化（player store 持久化声明自动生效）
// ★lifecycle-plan B1/B2：defineApp 阶段化启动（bootstrap → interactive，超时降级 + trace）
import { createApp } from 'vue'
import App from './App.vue'
import { createWebPinia, defineApp } from '@proteus-vue/runtime'
import { createApi } from '@proteus-vue/api'

// ★api-plan B1：API 客户端初始化（lifecycle coreReady 阶段——业务零平台分支）
const api = createApi({ baseURL: 'https://api.example.com' })

// 阶段化启动：bootstrap 能力探测 → coreReady 核心服务 → navigationReady → interactive 可交互
// （Web 端零转换直跑；小程序端经编译期映射 App() 钩子）
defineApp({
  bootstrap(ctx) {
    console.log('[lifecycle] bootstrap', ctx.platform)
  },
  async coreReady(ctx) {
    // API 客户端就绪（真实业务在此做 token 刷新等）
    ctx.isMinimalMode === false && console.log('[lifecycle] coreReady api:', api !== undefined)
  },
  interactive() {
    createApp(App).use(createWebPinia()).mount('#app')
  },
}).run({ launchType: 'cold' })
