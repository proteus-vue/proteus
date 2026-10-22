// 入口（决策 #1183）：挂 Vue 应用。样式是全局的——三栏 grid 不属于任何单个组件。
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

createApp(App).mount('#app')
