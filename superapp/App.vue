<!--
  superapp/App.vue —— 超级应用 · Web 端根组件（SPA 壳）

  【与 App.mp.vue 的关系】**同一套声明形态**（`<app-root>` / `<*-layer>`），落地机制不同：
    · Web：标签是运行时组件（本文件是真根组件，RouterView 在 `<page-layer>` 内，
      Global 层内容**天然跨路由存活**——它在 RouterView 之外，同一实例）
    · MP ：编译期概念（App.mp.vue 的 Global 内容注入每页 + 共享状态）

  【★Web 端的全局层状态】无编译期注入 ⇒ 经 `superapp/global-state.ts`（模块单例，
    Vite 模块缓存 = 同一份）——与 MP 的 `_proteus/global-layer.js` 同思路；
    页面经 `globalThis.__SUPERAPP_GLOBAL__` 桥调用（页面不 import 外部模块——那会破坏 MP 侧编译）。

  【§GP5 八条场景（生产形态）】与本工程 MP 壳同语义同字段：④客服球 ⑤音乐条 ⑥网络条
    ⑦主题容器 ⑧IM 角标（①②③为 Overlay 能力，宿主挂在本层）。
-->
<script setup lang="ts">
import { onMounted, watch } from 'vue'
import RouterView from './router/RouterView.vue'
import { PToastHost, PLoadingHost } from '@proteus-vue/components'
import * as globalState from './global-state'
import { theme, isDark, netBarVisible, netBarText, netBarLevel, fabVisible, musicVisible, musicPlaying, musicTitle, musicArtist, imUnread } from './global-state'
import { tabRoutes } from './router/auto-routes'
import { ref } from 'vue'

// ★★2026-10-04（外部视觉验收抓出「无底部 Tab 栏 ⇒ 超级应用骨架不成立」）：Web 端补底部 Tab 栏。
//   MP 端由**原生 tabBar** 提供（proteus.config 的 router.tabBar.list——微信原生渲染）；
//   Web 端没有原生等价物 ⇒ 在这里渲染一个（同一份 `tabRoutes` 路由产物驱动，两端信息同源）。
//   ★放在 page 层之外、Global 层之下：它不随路由切换（App 壳级），且不参与页面文档流。
const activeTab = ref('index')
/** Tab 文案（★与 MP 原生 tabBar 的 `text` 同源——proteus.config 的 router.tabBar.list；两端同一套） */
function tabLabel(name: string): string {
  return name === 'index' ? '首页' : name === 'messages' ? '消息' : name === 'mine' ? '我的' : name
}
function tabGo(name: string, path: string): void {
  if (activeTab.value === name) return
  activeTab.value = name
  // 走适配器（两端同一 API：MP=wx.switchTab / Web=history）
  const g = globalThis as unknown as { wx?: { switchTab: (o: { url: string }) => void } }
  if (g.wx?.switchTab) g.wx.switchTab({ url: '/' + path })
}
// 页面切换时同步高亮（RouterView 的 onPageLoad 已改 current；这里读 location 兜底）
if (typeof window !== 'undefined') {
  const sync = (): void => {
    const p = window.location.pathname
    const hit = tabRoutes.find((r) => p.includes(r.path))
    if (hit) activeTab.value = hit.name
  }
  sync()
  window.addEventListener('popstate', sync)
}
// 应用标题唯一事实源（app.config.ts 的 app.name）
import appConfig from './app.config'

// ★★2026-10-04：把主题类同步到**应用根**（`<html>`）——`global.css` 的 `.sa-dark` 变量覆盖块
//   在根上生效 ⇒ 全应用（含 teleport 到 body 的浮层）一致换肤。这是"深色模式"真正生效的开关。
watch(
  isDark,
  (v) => {
    const root = document.documentElement
    if (v) root.classList.add('sa-dark')
    else root.classList.remove('sa-dark')
  },
  { immediate: true },
)

onMounted(() => {
  document.title = appConfig.app.name
  // ★Web 桥：把全局状态与控制函数挂到 globalThis（页面不 import 外部模块——MP 侧会落 undefined）
  // ★GP7：glStats/glUnmount/glSetBudget 一并挂桥（验收控制台同形读数——MP 走页实例桥 __proteusGlStats）
  ;(globalThis as unknown as Record<string, unknown>).__SUPERAPP_GLOBAL__ = globalState
})
</script>

<template>
  <app-root>
    <!--
      ★三层职责（Web 端；★2026-10-04 第二轮外部验收后定版）：
        · global-layer  = **背景类**（主题底）——层域最低，页面内容盖在其上（正确）
        · page-layer    = 路由内容（随页滚动）
        · overlay-layer = **全局 chrome（网络条/悬浮球/音乐条/角标）+ 浮层宿主**
      ★为什么 chrome 不放 Global 层：层间域偏移 `global(0) < page(1e6) < overlay(2e6)` ⇒ 挂 Global 的
        浮条会被页面文字击穿（暗色实测：页面白字横穿音乐条）。而"跨页存活"与"层叠在上"是两件事——
        Overlay 层也在 RouterView 之外 ⇒ 同样持久；层域 2e6 > 页面 1e6 ⇒ 天然浮于内容之上。
      ★MP 端不受此影响（chrome 在 App 壳 Global 层 + absolute 定位，已在页面静态内容之上）。
    -->
    <global-layer>
      <!-- ⑦ 主题容器：全屏底（深色切换无需刷新） -->
      <div id="sa-theme-bg" class="sa-theme-bg" :class="{ 'sa-theme-bg--dark': isDark }" />
    </global-layer>

    <page-layer>
      <RouterView />
    </page-layer>

    <overlay-layer>
      <div class="sa-chrome">
        <!-- ⑥ 网络状态条 -->
        <div v-if="netBarVisible" id="sa-net-bar" class="sa-net-bar" :class="{ 'sa-net-bar--error': netBarLevel === 'error' }">
          <span class="sa-net-bar__text">{{ netBarText }}</span>
          <span id="sa-net-hide" class="sa-net-bar__action" @click="globalState.hideNetBar()">忽略</span>
        </div>

        <!-- ④ 客服悬浮球 -->
        <div v-if="fabVisible" id="sa-fab" class="sa-fab" @click="globalState.tapFab()">
          <span class="sa-fab__icon">聊</span>
          <span class="sa-fab__label">客服</span>
        </div>

        <!-- ⑤ 音乐播放条 -->
        <div v-if="musicVisible" id="sa-music-bar" class="sa-music-bar">
          <div class="sa-music-bar__cover"><span class="sa-music-bar__note">♪</span></div>
          <div class="sa-music-bar__meta">
            <span class="sa-music-bar__title">{{ musicTitle }}</span>
            <span class="sa-music-bar__artist">{{ musicArtist }}</span>
          </div>
          <span id="sa-music-toggle" class="sa-music-bar__btn" @click="globalState.togglePlay()">{{ musicPlaying ? '暂停' : '播放' }}</span>
          <span id="sa-music-close" class="sa-music-bar__btn sa-music-bar__btn--close" @click="globalState.stopMusic()">✕</span>
        </div>

      </div>

      <!-- Toast / Loading 宿主（声明一次——页面零引入） -->
      <p-toast-host />
      <p-loading-host />

      <!-- 底部 Tab 栏（应用骨架：压过页面、让位浮层） -->
      <div class="sa-tabbar">
        <div
          v-for="t in tabRoutes"
          :key="t.name"
          class="sa-tabbar__item"
          :class="{ 'sa-tabbar__item--on': activeTab === t.name }"
          @click="tabGo(t.name, t.path)"
        >
          <span class="sa-tabbar__ic">
            {{ t.name === 'index' ? '⌂' : t.name === 'messages' ? '✉' : '☺' }}
            <span v-if="t.name === 'messages' && imUnread > 0" id="sa-im-badge" class="sa-im-badge">
              <span class="sa-im-badge__num">{{ imUnread > 99 ? '99+' : imUnread }}</span>
            </span>
          </span>
          <span class="sa-tabbar__tx">{{ tabLabel(t.name) }}</span>
        </div>
      </div>
    </overlay-layer>
  </app-root>
</template>

<style scoped>
/* ── 全局 chrome 容器（Overlay 层内：铺满视口、自身穿透、子元素自还原） ── */
.sa-chrome {
  position: fixed;
  inset: 0;
  pointer-events: none;
}
.sa-chrome > * {
  pointer-events: auto;
}

/* ── ⑦ 主题容器 ── */
.sa-theme-bg {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #f4f5f7;
  transition: background-color 200ms cubic-bezier(0.4, 0, 0.2, 1);
  /* ★★Web 端必须显式穿透（2026-10-04 superapp 验收抓出的真缺陷——与 p-toast-host 同源）：
     DOM 语义 = "元素覆盖即命中"（不看有无监听器）⇒ 全屏 absolute 层会吃光它下面的一切点击
     （实测 elementFromPoint 返回它 ⇒ 网络条「忽略」按钮点不动）。
     MP/Skyline 语义 = "无监听即穿透"（真机已验证）⇒ 两端由此对齐，且 Skyline 不识别
     pointer-events（无效属性，无副作用）。 */
  pointer-events: none;
}
.sa-theme-bg--dark {
  background-color: #14161b;
}

/* ── ⑥ 网络状态条 ── */
.sa-net-bar {
  pointer-events: auto; /* ★fixed 容器穿透契约：交互元素自还原 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* ★2026-10-04：顶部安全区内缩（审计实测：全局条从 y=0 起铺 ⇒ 真机与状态栏重叠） */
  padding-top: var(--sa-safe-top);
  min-height: 32px;
  box-sizing: content-box;
  padding-left: 12px;
  padding-right: 12px;
  background-color: #fff7e6;
  border-bottom: 1px solid rgba(138, 109, 59, 0.18);
  font-size: 12px;
  color: #8a6d3b;
}
.sa-net-bar--error {
  background-color: #fdeaea;
  border-bottom-color: rgba(214, 69, 69, 0.2);
  color: #a83a3a;
}
.sa-net-bar__text {
  flex: 1;
}
.sa-net-bar__action {
  flex-shrink: 0;
  margin-left: 8px;
  padding: 4px 8px;
  color: #4a4ab8;
  cursor: pointer;
}

/* ── ④ 客服悬浮球 ── */
.sa-fab {
  pointer-events: auto; /* ★fixed 容器穿透契约：交互元素自还原 */
  position: absolute;
  right: 14px;
  /* ★2026-10-04：让开音乐条（52px + 底距 16px）+ 安全区 */
  bottom: calc(136px + var(--sa-safe-bottom)); /* ★让开音乐条 64+52 与 Tab 栏 */
  z-index: 2;
  width: 56px;
  height: 56px;
  border-radius: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #5b5bd6;
  box-shadow: 0 3px 10px rgba(91, 91, 214, 0.35);
  cursor: pointer;
}
.sa-fab__icon {
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.1;
}
.sa-fab__label {
  font-size: 10px;
  color: #ffffff;
  opacity: 0.92;
}

/* ── ⑤ 音乐播放条 ── */
.sa-music-bar {
  pointer-events: auto; /* ★fixed 容器穿透契约：交互元素自还原 */
  position: absolute;
  left: 8px;
  right: 8px;
  /* ★2026-10-04：底部安全区（审计：全局条不守安全区 ⇒ 真机与 Home Indicator 重叠） */
  /* ★避开底部 Tab 栏（56px）——否则被压住 */
  bottom: calc(64px + var(--sa-safe-bottom));
  height: 52px;
  z-index: 3; /* 层内序：音乐条在悬浮球/角标之下（避免互相压） */
  padding: 0 10px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  background-color: #1d2028;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}
.sa-music-bar__cover {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  margin-right: 8px;
}
.sa-music-bar__note {
  font-size: 15px;
  color: #9ea8ff;
}
.sa-music-bar__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sa-music-bar__title {
  font-size: 13px;
  color: #f2f3f6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sa-music-bar__artist {
  font-size: 11px;
  color: rgba(242, 243, 246, 0.6);
}
.sa-music-bar__btn {
  flex-shrink: 0;
  margin-left: 10px;
  font-size: 13px;
  color: #9ea8ff;
  cursor: pointer;
}
.sa-music-bar__btn--close {
  color: rgba(242, 243, 246, 0.55);
}

/* ── 底部 Tab 栏（Web 端补充；MP 用原生 tabBar） ── */
.sa-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* z-index 取 page(1e6) 与 overlay(2e6) **之间**——Tab 栏属 App 壳骨架：压过页面内容、
     让位任何浮层（Toast/弹窗必须能盖住它）。 */
  z-index: 1500000;
  height: calc(52px + var(--sa-safe-bottom));
  padding-bottom: var(--sa-safe-bottom);
  display: flex;
  align-items: center;
  background: var(--sa-surface);
  border-top: 1px solid var(--sa-line);
}
.sa-tabbar__item {
  flex: 1;
  height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--sa-text-3);
  cursor: pointer;
  pointer-events: auto;
}
.sa-tabbar__item--on {
  color: var(--sa-brand);
}
.sa-tabbar__ic {
  position: relative;
  font-size: 19px;
  line-height: 1;
  margin-bottom: 2px;
}
.sa-tabbar__tx {
  font-size: 10px;
}
/* 页面底部留白（给 Tab 栏让位——否则内容被压住）
   ★2026-10-04：同时改 page 层容器自带下内边距（路由页面 min-height:100vh 会吃掉这个 pad 块）。 */
.proteus-mount-layer--page {
  /* 顶部留白 = 网络条(32) + 角标区 —— chrome 是 fixed，不占流（外部验收 P0：网络条/角标压住标题） */
  padding-top: calc(44px + var(--sa-safe-top));
  /* 底部留白 = Tab 栏(52) + 音乐条(52) + 边距 —— 全局 chrome 不遮内容（外部验收 P1） */
  padding-bottom: calc(120px + var(--sa-safe-bottom));
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}


/* ── ⑧ IM 未读角标 ── */
.sa-im-badge {
  position: absolute;
  left: 50%;
  top: -4px;
  margin-left: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  display: flex; /* ★两端接受集（skyline 仅 none/flex/block）——不用 inline-flex（门禁抓住） */
  align-items: center;
  justify-content: center;
  background-color: var(--sa-rec);
}
.sa-im-badge__num {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
}
</style>
