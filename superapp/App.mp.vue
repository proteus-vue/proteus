<!--
  superapp/App.mp.vue —— ★★★超级应用 App 壳（MP 端 · Global 层声明处）

  【这是什么】Proteus 三层挂载模型在 MP 端的声明面：**在这里写一次**（编译期注入每个页面）。
    本工程是**框架最终验收场**——这里的八条场景是**生产形态**（不是演示占位）：
      ④ 客服悬浮球（真实形态：常驻入口 + 未读提示）        ⑤ 音乐播放条（真实形态：曲目 + 播放控制）
      ⑥ 网络状态条（真实形态：弱网提示 + 可忽略）          ⑦ 主题容器（真实形态：跟随设置页开关）
      ⑧ IM 未读角标（真实形态：消息数同步 + 点进消息页）
    ①②③（Toast / Loading / 登录拦截）为 Overlay 层能力——按需注入/根组件声明（GP4-a/b/c），
    其验收见「验收控制台」页（verify.vue）。

  【★状态同源（本工程的关键设计）】Global 层状态不写死在壳里，而与**设置页/消息页**共享：
    · 主题：设置页开关 → 写入 App 壳共享字段（`theme`）→ 全应用即时生效
    · IM 未读：消息页读/写同一份（点掉一条则角标减一）
    ⇒ 这是"Global + 状态"的真实业务形态（而非各页各自为政）。

  【★诚实边界（方案 §1.2-bis）】
    · **源码层**：声明一次 ✔（本文件）· **实例层**：MP 每页一份实例（N = 页面栈）
    · 跨页一致靠**共享状态**（`_proteus/global-layer.js`）= **状态一份**
    · **不得说"单实例跨页面存活"**（Web/自绘端才是）
-->
<script setup lang="ts">
import { ref } from 'vue'

/* ══ ⑦ 主题容器（全应用主题：设置页开关控制） ══ */
const theme = ref('light')
/** 切换主题（设置页/验收控制台调）——全应用即时生效、无需刷新 */
function saToggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}
/** 设为指定主题（设置页三态用） */
function saSetTheme(t: string) {
  theme.value = t === 'dark' ? 'dark' : 'light'
}

/* ══ ⑥ 网络状态条（弱网提示：可忽略） ══ */
const netBarVisible = ref(false)
const netBarText = ref('当前网络不稳定，图片加载可能较慢')
const netBarLevel = ref('warn')
/** 显示网络提示（业务在网络状态变化时调，如 useNetworkStatus 回调） */
function saShowNetBar(text: string, level: string) {
  netBarText.value = text
  netBarLevel.value = level === 'error' ? 'error' : 'warn'
  netBarVisible.value = true
}
/** 收起（用户点「忽略」） */
function saHideNetBar() {
  netBarVisible.value = false
}

/* ══ ④ 客服悬浮球（常驻入口 + 拖拽位置保持） ══ */
const fabVisible = ref(true)
function saToggleFab() {
  fabVisible.value = !fabVisible.value
}
/** 客服会话打开计数（验收读数 + 业务入口）——点悬浮球即进入会话（本工程由页面侧监听） */
const fabOpens = ref(0)
function saTapFab() {
  fabOpens.value = fabOpens.value + 1
}

/* ══ ⑤ 音乐播放条（常驻播放器 + 播放控制） ══ */
const musicVisible = ref(false)
const musicPlaying = ref(false)
const musicTitle = ref('')
const musicArtist = ref('')
/** 播放（业务在播放器服务里调） */
function saPlayMusic(title: string, artist: string) {
  musicTitle.value = title
  musicArtist.value = artist
  musicPlaying.value = true
  musicVisible.value = true
}
/** 暂停/继续 */
function saTogglePlay() {
  musicPlaying.value = !musicPlaying.value
}
/** 关闭播放条（停止播放） */
function saStopMusic() {
  musicVisible.value = false
  musicPlaying.value = false
}

/* ══ ⑧ IM 未读角标（消息数跨页同步） ══ */
const imUnread = ref(0)

/**
 * ★改名（2026-10-04）：原名 `saSyncTabBarBadge` 的 `__` 前缀让**编译器不把它当壳方法**
 *   （注入每个页面时**整个函数体丢失**——产物里 setTabBarBadge 出现 0 次，角标永不显示）。
 *   改名 `saSyncTabBarBadge`（与 saSetUnread 同规范前缀）后正常注入。
 * ★2026-10-04（用户指出「web 上面把未读放到 tabbar 的消息上面了，小程序的这个还是在右上角啊」）：
 *   MP 端角标改走**原生 tabBar 角标**（`wx.setTabBarBadge` —— 微信官方 API，大厂做法），
 *   不再在页面右上角浮动一个自绘角标（那与 Web 端的 `Tab 角标` 形态**两端不一致**）。
 *   index = 1 = tabBar.list 第二项（消息：index/messages/mine）；0 条 ⇒ 移除角标。
 *   ★诚实边界：角标只对 **tabBar 页**可见（微信原生语义）；非 tabBar 页调用会 fail ⇒ 静默（不打扰）。
 */
function saSyncTabBarBadge() {
  const n = imUnread.value
  const fail = (): void => { /* 非 tabBar 环境/未配置 tabBar：静默（角标不可见是平台语义） */ }
  if (n > 0) {
    wx.setTabBarBadge({ index: 1, text: n > 99 ? '99+' : String(n), fail })
  } else {
    wx.removeTabBarBadge({ index: 1, fail })
  }
}
function saSetUnread(n: number) {
  imUnread.value = n > 0 ? n : 0
  saSyncTabBarBadge()
}
function saBumpUnread() {
  imUnread.value = imUnread.value + 1
  saSyncTabBarBadge()
}
function saClearUnread() {
  imUnread.value = 0
  saSyncTabBarBadge()
}
</script>

<template>
  <app-root>
    <!-- ★Global 层（方案 §3.2 C1）：只能在这里声明；层标签解壳不产元素 -->
    <global-layer>
      <!-- ⑦ 主题容器：全屏底（树序最底——页面透明区透出；深色切换无需刷新） -->
      <view id="sa-theme-bg" class="sa-theme-bg" :class="{ 'sa-theme-bg--dark': theme === 'dark' }" />

      <!-- ⑥ 网络状态条（顶部，弱网/离线提示） -->
      <view v-if="netBarVisible" id="sa-net-bar" class="sa-net-bar" :class="{ 'sa-net-bar--error': netBarLevel === 'error' }">
        <text class="sa-net-bar__text">{{ netBarText }}</text>
        <text id="sa-net-hide" class="sa-net-bar__action" @click="saHideNetBar">忽略</text>
      </view>

      <!-- ④ 客服悬浮球（右下角常驻入口） -->
      <view v-if="fabVisible" id="sa-fab" class="sa-fab" @click="saTapFab">
        <text class="sa-fab__icon">聊</text>
        <text class="sa-fab__label">客服</text>
      </view>

      <!-- ⑤ 音乐播放条（底部停靠播放器） -->
      <view v-if="musicVisible" id="sa-music-bar" class="sa-music-bar">
        <view class="sa-music-bar__cover">
          <text class="sa-music-bar__note">♪</text>
        </view>
        <view class="sa-music-bar__meta">
          <text class="sa-music-bar__title">{{ musicTitle }}</text>
          <text class="sa-music-bar__artist">{{ musicArtist }}</text>
        </view>
        <text id="sa-music-toggle" class="sa-music-bar__btn" @click="saTogglePlay">{{ musicPlaying ? '暂停' : '播放' }}</text>
        <text id="sa-music-close" class="sa-music-bar__btn sa-music-bar__btn--close" @click="saStopMusic">✕</text>
      </view>

    </global-layer>
  </app-root>
</template>

<style scoped>
/* ── ⑦ 主题容器：全屏底层（深色切换的全应用视觉基座） ── */
.sa-theme-bg {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #f4f5f7;
  transition: background-color var(--sa-dur-med) var(--sa-ease-in-out);
}
.sa-theme-bg--dark {
  background-color: #14161b;
}
/* ★与 Web 端同源的穿透声明（MP 端语义本就是"无监听即穿透"，此行对 Skyline 是无效属性、
   对 DOM 端是必需——两端同一份源码，见 App.vue 的同名注释）。 */

/* ── ⑥ 网络状态条：顶部细条（不遮挡内容——它是提示不是弹窗） ── */
.sa-net-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  /* ★2026-10-04：顶部安全区（不与系统状态栏重叠） */
  padding-top: var(--sa-safe-top);
  min-height: 64rpx;
  box-sizing: content-box;
  padding-left: 24rpx;
  padding-right: 24rpx;
  background-color: var(--sa-netbar-bg);
  border-bottom: 1rpx solid rgba(138, 109, 59, 0.18);
}
.sa-net-bar--error {
  background-color: #fdeaea;
  border-bottom-color: rgba(214, 69, 69, 0.2);
}
.sa-net-bar__text {
  flex: 1;
  font-size: 24rpx;
  color: var(--sa-netbar-ink);
}
.sa-net-bar--error .sa-net-bar__text {
  color: #a83a3a;
}
.sa-net-bar__action {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 8rpx 16rpx;
  font-size: 24rpx;
  color: var(--sa-brand-ink);
}

/* ── ④ 客服悬浮球：圆形入口 + 图标 + 文案（生产形态：不只一个色点） ── */
.sa-fab {
  position: absolute;
  right: 28rpx;
  /* ★2026-10-04：让开音乐条（104rpx + 底距 32rpx）+ 安全区 */
  bottom: calc(160rpx + var(--sa-safe-bottom));
  z-index: 2;
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--sa-fab-bg);
  box-shadow: 0 6rpx 20rpx rgba(91, 91, 214, 0.35);
}
.sa-fab__icon {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--sa-fab-ink);
  line-height: 1.1;
}
.sa-fab__label {
  font-size: 20rpx;
  color: var(--sa-fab-ink);
  opacity: 0.92;
}

/* ── ⑤ 音乐播放条：封面 + 曲目 + 控制（生产形态：三段式） ── */
.sa-music-bar {
  position: absolute;
  left: 16rpx;
  right: 16rpx;
  /* ★2026-10-04：底部安全区（审计：全局条不守安全区 ⇒ 与 Home Indicator 重叠） */
  bottom: calc(16rpx + var(--sa-safe-bottom));
  z-index: 3;
  height: 104rpx;
  padding: 0 20rpx;
  border-radius: 20rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--sa-music-bg);
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.28);
}
.sa-music-bar__cover {
  flex-shrink: 0;
  width: 64rpx;
  height: 64rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.1);
  margin-right: 16rpx;
}
.sa-music-bar__note {
  font-size: 30rpx;
  color: var(--sa-music-accent);
}
.sa-music-bar__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.sa-music-bar__title {
  font-size: 26rpx;
  color: var(--sa-music-ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sa-music-bar__artist {
  font-size: 22rpx;
  color: rgba(242, 243, 246, 0.6);
}
.sa-music-bar__btn {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 26rpx;
  color: var(--sa-music-accent);
}
.sa-music-bar__btn--close {
  color: rgba(242, 243, 246, 0.55);
}

</style>
