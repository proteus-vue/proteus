// website/src/main.ts —— Proteus 官网入口（dogfooding：官网用 Proteus 自身构建）
// ★柔性框架优先（W-6/D-5，#374）：响应式全部走 v-p-fluid clamp 表达式 + 柔性网格，
//   零 @media 断点——官网自己不用柔性框架，柔性布局的说服力归零。
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
// ★G-22 柔性布局：v-p-fluid 指令（font-size(28,56) → clamp 流式插值，与编译期 generateClamp 同源公式）
import { installFluidLayout } from '@proteus-vue/components'
// ★G-24 B1 桌面交互原语：v-p-hover（官网卡片 hover 语义——Pure logic 双端接线）
import { createDesktopDirectives } from '@proteus-vue/desktop'
import './style.css'

const app = createApp(App)

// 柔性布局指令（W-6：官网排版/间距的唯一响应式手段）
installFluidLayout(app, { designWidth: 375, viewportMax: 1440 })
// 桌面交互指令（G-24：卡片悬停等语义，触屏天然降级）
for (const [name, dir] of Object.entries(createDesktopDirectives())) {
  app.directive(name, dir)
}

app.use(router)
app.mount('#app')
