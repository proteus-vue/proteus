// superapp/global-state.ts —— 超级应用的全局层状态（模块单例）
//
// 【为什么需要它】MP 端的全局场景状态在 App 壳的 `<global-layer>` 里（编译期注入每个页面）；
//   Web 端没有注入机制（App.vue 是 SPA 真根组件）⇒ 页面与根组件之间需要一条状态通道。
//   模块单例 = 同一份实例（Vite 模块缓存），与 MP 的 `_proteus/global-layer.js` 同思路。
//
// 【★字段名与 MP 壳同源】`App.mp.vue` 的 Global 层字段（theme/netBar*/fab*/music*/imUnread）
//   与本文件同名同义——**"同形不同机制"**（GP3-a 结论）在本工程八条场景上的体现。
//   页面经 `globalThis.__SUPERAPP_GLOBAL__`（App.vue onMounted 注册）调用，**不 import 本文件**
//   （跨目录 import 在 MP 侧产物落 undefined——实测）。

import { ref } from 'vue'

/* ══ ⑦ 主题容器 ══ */
export const theme = ref('light')
export const isDark = ref(false)
function syncTheme(): void {
  isDark.value = theme.value === 'dark'
}
export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  syncTheme()
}
export function setTheme(t: string): void {
  theme.value = t === 'dark' ? 'dark' : 'light'
  syncTheme()
}

/* ══ ⑥ 网络状态条 ══ */
export const netBarVisible = ref(false)
export const netBarText = ref('当前网络不稳定，图片加载可能较慢')
export const netBarLevel = ref('warn')
export function showNetBar(text: string, level: string): void {
  netBarText.value = text
  netBarLevel.value = level === 'error' ? 'error' : 'warn'
  netBarVisible.value = true
}
export function hideNetBar(): void {
  netBarVisible.value = false
}

/* ══ ④ 客服悬浮球 ══ */
export const fabVisible = ref(true)
export const fabOpens = ref(0)
export function toggleFab(): void {
  fabVisible.value = !fabVisible.value
}
export function tapFab(): void {
  fabOpens.value = fabOpens.value + 1
}

/* ══ ⑤ 音乐播放条 ══ */
export const musicVisible = ref(false)
export const musicPlaying = ref(false)
export const musicTitle = ref('')
export const musicArtist = ref('')
export function playMusic(title: string, artist: string): void {
  musicTitle.value = title
  musicArtist.value = artist
  musicPlaying.value = true
  musicVisible.value = true
}
export function togglePlay(): void {
  musicPlaying.value = !musicPlaying.value
}
export function stopMusic(): void {
  musicVisible.value = false
  musicPlaying.value = false
}

/* ══ ⑧ IM 未读角标 ══ */
export const imUnread = ref(0)
export function setUnread(n: number): void {
  imUnread.value = n > 0 ? n : 0
}
export function bumpUnread(): void {
  imUnread.value = imUnread.value + 1
}
export function clearUnread(): void {
  imUnread.value = 0
}
