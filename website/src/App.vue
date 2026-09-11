<script setup lang="ts">
// website/src/App.vue —— 官网壳：顶部导航 + 路由出口
// ★2026-09-11 风格收敛（用户评审「AI 味过重」）：
//   移除全站粒子场 / 3D 萌宠 / 指针光晕 / 品牌大辉光——这些「演示型特效」是 AI 味的主要来源。
//   导航改**实底细边框**（去掉玻璃发光），视觉重心回到内容。品牌紫保留为单一强调色。
// ★B4 导航重构（#379）：顶部导航只留区块入口（首页/Playground/文档/GitHub）
// ★D-2：布局标签 p-view/p-text；★W-6：v-p-fluid clamp，零 @media
// ★#389c 滚动上下文：顶部渐变进度条（scaleX 合成器）+ 导航滚动态（scrolled 投影）
import { computed, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DocSearch from './DocSearch.vue'
// ★#449 desktop 原语（豁免回收）：滚动进度/滚动态 = p-scroll-observer
//   ——window/document 监听与 origin 校验收口到框架包，页面零裸平台 API
import { createScrollObserver, type ScrollState } from '@proteus-vue/desktop'
// ★#472 语言切换（全局顶栏——chrome 双语状态）
import { locale, setLocale, t } from './i18n'

const route = useRoute()
const isDocs = computed(() => route.path.startsWith('/docs'))
// ★#489 全宽演示页（multi-device 撑满屏宽）
const isWide = computed(() => route.path.startsWith('/multi-device'))
interface NavLink {
  key: string
  label: string
  to?: string
  external?: boolean
  href?: string
}
const links: NavLink[] = [
  { to: '/', label: '首页', key: 'home' },
  { to: '/playground', label: 'Playground', key: 'playground' },
  // ★#489 同一份语义 → 六端形态（站内页——同壳同风格、双语）
  { to: '/multi-device', label: '多端同屏', key: 'multidev' },
]
/** 导航文案（双语 key） */
function navText(l: { key: string; label: string }): string {
  if (l.key === 'home') return t('app.home')
  if (l.key === 'multidev') return t('app.multidev')
  return l.label
}

// ★#389c 滚动进度（0→1）+ scrolled 态（desktop p-scroll-observer——监听注册 + rAF 节流 + 几何全在框架包内）
const progress = ref(0)
const scrolled = ref(false)
const scrollObs = createScrollObserver({
  immediate: true,
  onChange: (s: ScrollState) => {
    scrolled.value = s.y > 12
    progress.value = s.progress
  },
})
onUnmounted(() => {
  scrollObs.destroy()
})
</script>

<template>
  <p-page ref="siteEl" class="site">
    <!-- ★#389 导航：实底细边框（去掉玻璃发光——风格收敛） -->
    <header class="nav-shell" :class="{ 'is-scrolled': scrolled }">
      <p-stack v-p-fluid="'padding(14, 24)'" direction="row" :gap="8" wrap class="nav">
        <router-link to="/" class="brand">
          <span class="brand-mark">◆</span>
          <p-text class="brand-name">Proteus</p-text>
          <span class="brand-tag">/ semantic engine</span>
        </router-link>
        <p-stack direction="row" :gap="4" wrap class="nav-links">
          <DocSearch />
          <button
            type="button"
            class="lang-switch"
            :aria-label="locale === 'zh' ? 'Switch to English' : '切换中文'"
            @click="setLocale(locale === 'zh' ? 'en' : 'zh')"
          >
            {{ locale === 'zh' ? 'EN' : '中文' }}
          </button>
          <template v-for="l in links" :key="l.key">
            <a
              v-if="l.external"
              class="nav-link"
              :href="l.href"
              :aria-label="l.key === 'flexible' ? t('app.multidev') : ''"
            >
              <p-text class="nav-text">{{ navText(l) }}</p-text>
            </a>
            <router-link v-else :to="l.to ?? '/'" class="nav-link" :class="{ active: route.name === l.key }">
              <p-text class="nav-text">{{ navText(l) }}</p-text>
            </router-link>
          </template>
          <router-link to="/docs/01-intro" class="nav-link" :class="{ active: isDocs }">
            <p-text class="nav-text">{{ t('app.docs') }}</p-text>
          </router-link>
          <a class="nav-link nav-github" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">
            <p-text class="nav-text">GitHub ↗</p-text>
          </a>
        </p-stack>
      </p-stack>
      <!-- ★#389c 顶部滚动进度条（品牌色细线 scaleX——合成器属性） -->
      <div class="scroll-progress" aria-hidden="true">
        <div class="scroll-progress-bar" :style="{ transform: 'scaleX(' + progress + ')' }" />
      </div>
    </header>

    <main v-p-fluid="'padding(12, 24)'" class="main" :class="{ 'is-docs': isDocs, 'is-wide': isWide }">
      <router-view />
    </main>

    <p-view v-p-fluid="'padding(20, 28)'" class="footer">
      <p-text class="footer-line">Proteus — One semantic model. Any render engine. Zero native glue.</p-text>
      <p-text class="footer-dim">{{ t('app.footer') }}</p-text>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ★2026-09-11 风格收敛：移除粒子场/萌宠/指针光晕的定位样式；导航改实底细边框 */
.site > .main,
.site > .footer {
  z-index: 1;
}
.site > .nav-shell {
  z-index: 20;
}
/* ★#472 语言切换（顶栏 pill——与导航一致的轻量样式） */
.lang-switch {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s, color 0.15s;
}
.lang-switch:hover { border-color: var(--brand); color: var(--ink); }
/* ★导航：实底 + 细下边框（去玻璃发光；滚动后加投影区分层级） */
.nav-shell {
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  transition: box-shadow 0.2s ease, background 0.2s ease;
}
.nav-shell.is-scrolled { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); background: var(--glass-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
/* ★#389c 滚动进度条（品牌色细线） */
.scroll-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  pointer-events: none;
}
.scroll-progress-bar {
  height: 100%;
  background: var(--brand);
  transform-origin: 0 50%;
  transform: scaleX(0);
}
.nav {
  justify-content: space-between;
  max-width: 1320px;
  margin: 0 auto;
  width: 100%;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; flex-shrink: 0; }
/* ★#387 品牌标识（同心方 conic 渐变） */
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  font-size: 11px;
  color: #fff;
  background: conic-gradient(from 210deg, var(--brand), var(--brand2), var(--accent), var(--brand));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.brand-name { color: var(--ink); font-weight: 700; font-size: 17px; letter-spacing: 0.4px; white-space: nowrap; }
.brand-tag { color: var(--dim); font-size: 13px; white-space: nowrap; }
.nav-links { display: flex; align-items: center; flex-wrap: wrap; }
.nav-link { text-decoration: none; padding: 7px 12px; border-radius: var(--radius-sm); position: relative; }
/* ★#381：链接文字禁折字（首/页 竖排两字的根因）——窄屏整链接换行 */
.nav-text { color: var(--muted); font-size: 14px; transition: color 0.15s; white-space: nowrap; }
.nav-link:hover .nav-text { color: var(--ink); }
/* active：品牌色文字 + 底部短下划线（替代大药丸） */
.nav-link.active .nav-text { color: var(--ink); font-weight: 600; }
.nav-link.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 2px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand);
}
/* GitHub：描边按钮形态（与页面内 CTA 同语言） */
.nav-github { border: 1px solid var(--line); margin-left: 6px; }
.nav-github:hover { border-color: var(--brand); }
.main { max-width: 1180px; margin: 0 auto; width: 100%; flex: 1; }
/* ★#489 全宽演示页：通栏全屏（max-width 放开 + 水平 padding 清零，内边距交给 .six-root） */
.main.is-wide { max-width: none; width: 100%; padding-left: 0 !important; padding-right: 0 !important; }
/* ★文档页三栏（左导航+正文+右导读）需要更宽的容器——isDocs 时放开 */
.main.is-docs { max-width: 1320px; }
.footer {
  max-width: 1180px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--line);
}
.footer-line { color: var(--muted); font-size: 13px; }
.footer-dim { color: var(--muted); font-size: 12px; }
</style>
