// src/main.ts —— Web 端入口（Web 原生、零转换：标准 Vue SPA）
import { createApp } from 'vue'
import App from './App.vue'
// 全局样式（与小程序端 app.wxss / App 端编译期折叠**同一份**——proteus.config 的 globalStyle）
import './styles/global.css'

createApp(App).mount('#app')
