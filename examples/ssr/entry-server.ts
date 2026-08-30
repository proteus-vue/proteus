// examples/ssr/entry-server.ts —— SSR 服务端入口（参考实现，docs/proteus-pinia-plan M4）
// ★铁律：createSsrPinia() 必须在每个请求内调用，绝不在模块顶层——Node 单例长生命周期下
//   并发请求共享会导致 A 用户状态泄漏给 B（本文件即演示：render() 内新建）
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSsrPinia } from '@proteus-vue/runtime'
import App from '../App.vue'
import { usePlayerStore } from '../stores/player'

/** 每个请求调用：独立 Pinia 实例 + 收集 initialState 供客户端 hydration */
export async function render(url: string): Promise<{ html: string; initialState: string }> {
  const app = createSSRApp(App)
  const pinia = createSsrPinia() // ★每请求独立
  app.use(pinia)

  // 服务端填充数据（示例：URL 携带曲目则写入 store）
  const track = url.includes('/track/') ? url.split('/track/')[1] : undefined
  if (track) {
    const store = usePlayerStore(pinia)
    store.play({ title: decodeURIComponent(track), durationSec: 120 })
  }

  const html = await renderToString(app)
  // 收集 state → 客户端 window.__INITIAL_STATE__ 注水
  const initialState = JSON.stringify(pinia.state.value)
  return { html, initialState }
}
