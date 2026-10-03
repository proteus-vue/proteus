// examples/gp5-state.ts —— ★★★GP5：Web 端的全局场景状态（模块单例）
//
// 【为什么需要它】MP 端的全局场景状态在 App 壳的 `<global-layer>` 里（编译期注入每个页面）；
//   而 **Web 端没有注入机制**（App.vue 是 SPA 真根组件）⇒ 页面与根组件之间需要一条状态通道。
//   模块单例 = 同一份实例（Vite 模块缓存），与 MP 的 `_proteus/global-layer.js` 同思路。
//
// 【★它与 MP 端的语义对齐】字段名与 App.mp.vue 的 Global 层字段**同名同义**
//   （fabVisible / musicVisible / musicPlaying / musicTitle / theme / imUnread）——
//   "同形不同机制"（GP3-a 结论）在场景演示上的体现。

import { ref } from 'vue'

/* ── 场景 ④：全局悬浮球 ── */
export const fabVisible = ref(false)
export function toggleFab(): void {
  fabVisible.value = !fabVisible.value
}

/* ── 场景 ⑤：全局音乐播放条 ── */
export const musicVisible = ref(false)
export const musicPlaying = ref(true)
export const musicTitle = ref('夜曲 · 周杰伦')
export function toggleMusic(): void {
  musicVisible.value = !musicVisible.value
}
export function togglePlay(): void {
  musicPlaying.value = !musicPlaying.value
}

/* ── 场景 ⑦：全局主题容器 ── */
export const theme = ref('light')
export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

/* ── 场景 ⑧：全局 IM 未读角标 ── */
export const imUnread = ref(0)
export function bumpIm(): void {
  imUnread.value = imUnread.value + 1
}
export function clearIm(): void {
  imUnread.value = 0
}
