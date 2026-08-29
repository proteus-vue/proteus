// examples/ssr/entry-client.ts —— SSR 客户端入口（参考实现，docs/proteus-pinia-plan M4 §3）
// ★注意：必须先 pinia.state.value = initialState 再 app.use(pinia)——
//   否则组件首次渲染读到空 state，导致 hydration mismatch
import { createApp } from 'vue'
import { createWebPinia } from '@proteus/runtime'
import App from '../App.vue'

declare global {
  interface Window {
    __INITIAL_STATE__?: string
  }
}

const app = createApp(App)
const pinia = createWebPinia()

// 服务端注入的 state → 恢复（在 app.use(pinia) 之前）
const initialState = window.__INITIAL_STATE__
if (initialState) {
  pinia.state.value = JSON.parse(initialState) as typeof pinia.state.value
}

app.use(pinia)
app.mount('#app')
