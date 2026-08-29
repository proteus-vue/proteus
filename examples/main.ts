// examples/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA + Pinia 状态管理）
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
