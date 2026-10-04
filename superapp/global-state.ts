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
/** ★冷启动初值（真实业务 = 本地缓存/服务端；demo = 演示数据 3，与消息页会话未读之和一致）——
 *   2026-10-04 修「冷启动落在首页时徽标为空」（用户报「未读消息徽标又不显示了」）。 */
export const imUnread = ref(3)
export function setUnread(n: number): void {
  imUnread.value = n > 0 ? n : 0
}
export function bumpUnread(): void {
  imUnread.value = imUnread.value + 1
}
export function clearUnread(): void {
  imUnread.value = 0
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★★★GP7（2026-10-04）：**Global 层内存读数（Web 端同形实现，验收面）**
 *
 * 【与 MP 端的关系（分端口径——契约 MOUNT_LAYER_SEMANTICS 的分端诚实）】
 *   · MP ：框架产出的共享状态模块 `_proteus/global-layer.js` 自带 stats/unmount/预算告警
 *          （实例每页一份、状态一份 ⇒ resident = 状态 + 每页字节 × 页面栈）
 *   · Web（本文件）：SPA 单实例 ⇒ **恒 1 份**——但 Web 端全局状态归**应用持有**（框架不持有），
 *          框架无法替应用记账 ⇒ 这里由应用层实现同形 API 供验收控制台读数。
 * 【★口径诚实】字节 = JSON 序列化长度（近似——非 ASCII 偏小）；是**诊断口径不是计量承诺**。
 * 【★预算常量】`GLOBAL_LAYER_MEMORY_BUDGET_BYTES = 65536` 与契约同值（契约 SSOT 在
 *   packages/contracts/src/mount-layers.ts；应用层镜像一份——框架包不引入应用依赖面）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 全局层字段清单（stats 的记账面——与本文件导出的全局字段同源维护） */
const GL_FIELDS = [
  'theme', 'netBarVisible', 'netBarText', 'netBarLevel',
  'fabVisible', 'fabOpens', 'musicVisible', 'musicPlaying', 'musicTitle', 'musicArtist', 'imUnread',
] as const
/** 各字段初值（unmount = 复位到初值——Web 端"释放"的可达语义：应用唯一实例，没有"每页副本"可退） */
const GL_INITIAL: Record<string, unknown> = {
  theme: 'light', netBarVisible: false, netBarText: '当前网络不稳定，图片加载可能较慢', netBarLevel: 'warn',
  fabVisible: true, fabOpens: 0, musicVisible: false, musicPlaying: false, musicTitle: '', musicArtist: '', imUnread: 3,
}
const GL_BUDGET_DEFAULT = 65536
let glBudget = GL_BUDGET_DEFAULT

const refsOf = (): Record<string, { value: unknown }> => ({
  theme, netBarVisible, netBarText, netBarLevel, fabVisible, fabOpens,
  musicVisible, musicPlaying, musicTitle, musicArtist, imUnread,
})

let glWarned = false
/** ★GP7：Web 端内存读数（同形 API——字段名与 MP 共享模块 stats() 对齐） */
export function glStats(): Record<string, unknown> {
  const refs = refsOf()
  let bytes = 0
  let keys = 0
  const snap: Record<string, unknown> = {}
  for (const k of GL_FIELDS) {
    const v = refs[k]?.value
    snap[k] = v
    keys++
    try { bytes += JSON.stringify(v === undefined ? null : v).length } catch { /* ignore */ }
  }
  if (bytes > glBudget && !glWarned) {
    glWarned = true
    console.warn(`[proteus] Global 层共享状态 ${bytes} 字节，超过预算 ${glBudget} 字节——Global 层常驻内存（Web 端恒 1 份；MP 端为状态一份 + 每页 × 页面栈）。建议把大集合移出全局层，或 glSetBudget(b) 显式确认`)
  }
  return {
    keys,
    bytes,
    budgetBytes: glBudget,
    overBudget: bytes > glBudget,
    fieldCount: keys,
    // ★Web 端无"每页注入副本"⇒ perPageBytes=0、pageStack=1（resident = 状态本身——分端口径恒 1 份）
    perPageBytes: 0,
    pageStack: 1,
    residentEstimateBytes: bytes,
  }
}
/** ★GP7：显式卸载（Web 语义 = 该字段复位到初值——应用唯一实例，"释放"即复位；与 MP unmount 同形） */
export function glUnmount(k: string): boolean {
  const refs = refsOf()
  const r = refs[k]
  if (!r) return false
  r.value = GL_INITIAL[k]
  return true
}
/** ★GP7：调整预算（与 MP setBudget 同形；仅影响本端告警判定） */
export function glSetBudget(b: number): boolean {
  const n = Number(b)
  if (!Number.isFinite(n) || n <= 0) return false
  glBudget = n
  glWarned = false
  return true
}
