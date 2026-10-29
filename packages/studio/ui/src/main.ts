// 入口（决策 #1183）：挂 Vue 应用。样式是全局的——三栏 grid 不属于任何单个组件。
// ★独立设置窗口（决策 #1267）：同一个 `index.html`，用 `?view=settings` 分流到设置页。
//   为什么复用一份产物：Tauri 的第二个 WebviewWindow 只能指向同一套 dist；
//   分成两个入口文件会让 `tauri.conf` 的 frontendDist 与构建都变复杂。
import { createApp } from 'vue'
import App from './App.vue'
import SettingsApp from './SettingsApp.vue'
import './styles.css'

/* 设置窗口的标识有两个来源：
   ① Tauri 新建窗口时注入的 `window.__PROTEUS_VIEW__`（生产路径，零歧义）
   ② `?view=settings`（判据用 http 打开同一个 dist 时走这条） */
const injected = (window as { __PROTEUS_VIEW__?: string }).__PROTEUS_VIEW__
const view = injected ?? new URLSearchParams(location.search).get('view')
createApp(view === 'settings' ? SettingsApp : App).mount('#app')

/* ★启动画面收尾（决策 #1381）：等**两帧**再淡出。
   为什么要两帧：`mount()` 返回时 DOM 已插入，但**首帧还没画出来**；
   立刻移除遮罩会露出"还没绘制的空白" —— 那正是另一种白闪。
   两帧后（rAF→rAF）浏览器已完成一次绘制，这时淡出才是无缝的。 */
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const sp = document.getElementById('splash')
    if (!sp) return
    sp.classList.add('done')
    window.setTimeout(() => sp.remove(), 260)
  })
})
