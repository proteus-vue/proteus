// examples/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA + Pinia 多端适配工厂）
// ★pinia-plan M3：createWebPinia() 注入平台标记 + LocalStorage 持久化（player store 持久化声明自动生效）
import { createApp } from 'vue'
import App from './App.vue'
import { createWebPinia } from '@proteus/runtime'

createApp(App).use(createWebPinia()).mount('#app')
