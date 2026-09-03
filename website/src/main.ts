// website/src/main.ts —— Proteus 官网入口（dogfooding：官网用 Proteus 自身构建）
// ★D-2 兑现（#377）：模板布局标签全部使用 p-* 语义组件（p-view/p-text/p-heading/p-grid/p-stack/p-button…）
// ★柔性框架优先（W-6/D-5）：响应式全部走 v-p-fluid clamp 表达式 + 柔性网格，零 @media 断点
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
// ★p-* 语义组件库（59 组件，128 原语 SSOT 的组件形态）——官网全局注册后模板直接写 p-* 标签
import {
  PView,
  PText,
  PHeading,
  PGrid,
  PStack,
  PButton,
  PDivider,
  PPage,
  installFluidLayout,
} from '@proteus-vue/components'
// ★G-24 B1 桌面交互原语：v-p-hover（官网卡片 hover 语义——Pure logic 双端接线）
import { createDesktopDirectives } from '@proteus-vue/desktop'
import './style.css'

const app = createApp(App)

// ★D-2：p-* 语义组件全局注册（模板写 <p-view>/<p-text>/…——禁第三方 UI、禁裸 div 布局）
const components: Record<string, unknown> = {
  'p-view': PView,
  'p-text': PText,
  'p-heading': PHeading,
  'p-grid': PGrid,
  'p-stack': PStack,
  'p-button': PButton,
  'p-divider': PDivider,
  'p-page': PPage,
}
for (const [name, comp] of Object.entries(components)) {
  app.component(name, comp as never)
}

// 柔性布局指令（W-6：官网排版/间距的唯一响应式手段）
installFluidLayout(app, { designWidth: 375, viewportMax: 1440 })
// 桌面交互指令（G-24：卡片悬停等语义，触屏天然降级）
for (const [name, dir] of Object.entries(createDesktopDirectives())) {
  app.directive(name, dir)
}

app.use(router)
app.mount('#app')
