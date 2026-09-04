<script setup lang="ts">
// website/src/App.vue —— 官网壳：顶部导航 + 路由出口
// ★B4 导航重构（#379）：顶部导航只留区块入口（首页/Playground/文档/GitHub），
//   指南清单归文档侧边栏（guides.ts）——长标题进导航是杂乱根源
// ★D-2：布局标签 p-view/p-text；★W-6：v-p-fluid clamp，零 @media
// ★#389c 滚动上下文：顶部渐变进度条（scaleX 合成器）+ 导航滚动态（scrolled 投影）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
// ★#389b 全站固定语义粒子场（背景层）
import ParticleField from './components/ParticleField.vue'
// ★#389i 海神精灵（Three.js 3D 果冻萌宠——spirit.html iframe 嵌入右下角；three 隔离在独立 chunk，主应用 bundle 零增量）
// ★#389d 指针跟随光晕（G-24 B5 新桌面原语 v-p-cursor-glow——全局注册的指令）

const route = useRoute()
const isDocs = computed(() => route.path.startsWith('/docs'))
const links = [
  { to: '/', label: '首页', key: 'home' },
  { to: '/playground', label: 'Playground', key: 'playground' },
]

// ★#389i 海神精灵：iframe 源（BASE_URL 绝对路径——web history 下相对路径会被 /docs/* 破坏）
const spiritSrc = import.meta.env.BASE_URL + 'spirit.html'
// 形态主题气泡：iframe postMessage → 父页弹出（3.4s 自动收起；同源校验）
const spiritBubble = ref<{ name: string; theme: string } | null>(null)
let bubbleTimer: ReturnType<typeof setTimeout> | undefined
function onSpiritMessage(e: MessageEvent): void {
  if (e.origin !== window.location.origin) return
  const d = e.data as { type?: string; name?: string; theme?: string } | null
  if (d?.type !== 'proteus-spirit-morph' || !d.name || !d.theme) return
  spiritBubble.value = { name: d.name, theme: d.theme }
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => (spiritBubble.value = null), 3400)
}

// ★#389c 滚动进度（0→1）+ scrolled 态（rAF 节流）
const progress = ref(0)
const scrolled = ref(false)
let scrollRaf = 0
function onScroll(): void {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const y = window.scrollY
    scrolled.value = y > 12
    const max = document.documentElement.scrollHeight - window.innerHeight
    progress.value = max > 0 ? Math.min(1, y / max) : 0
  })
}
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('message', onSpiritMessage)
  onScroll()
})
onUnmounted(() => {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('message', onSpiritMessage)
  clearTimeout(bubbleTimer)
})

// ★#389d 光晕配置（Proteus 品牌双光斑；尺寸/透明度经 llm-style-guide 视觉校准）
const cursorGlowOptions = {
  size: 520,
  color: 'rgba(124, 92, 255, 0.13)',
  accent: 'rgba(0, 224, 198, 0.09)',
  lerp: 0.14,
}
</script>

<template>
  <p-page ref="siteEl" v-p-cursor-glow="cursorGlowOptions" class="site">
    <!-- ★#389b 全站固定语义粒子场（WebGL 零依赖引擎——所有页面共享背景；密度/透明度按全站背景校准） -->
    <ParticleField
      class="site-particles"
      :max-particles="1200"
      :alpha="0.6"
      :density-divisor="1050"
      :link-distance="150"
    />
    <!-- ★#389i 海神精灵（Three.js 3D——iframe 隔离渲染，点击变身；dock 不拦截指针，仅 iframe 本体接收点击） -->
    <div class="spirit-dock">
      <Transition name="spirit-bubble">
        <pg-glass v-if="spiritBubble" preset="floating" :radius="14" class="spirit-speech" role="status">
          <p-text class="spirit-speech-name">{{ spiritBubble.name }}</p-text>
          <p-text class="spirit-speech-theme">{{ spiritBubble.theme }}</p-text>
        </pg-glass>
      </Transition>
      <iframe
        class="site-spirit"
        :src="spiritSrc"
        title="Proteus 海神精灵（点击变身）"
        aria-label="Proteus 海神精灵（点击变身）"
      ></iframe>
    </div>
    <!-- ★#389 液态玻璃语义落地（G-07）：导航栏走 <pg-glass preset="navigationBar">——
         消除手写 backdrop-filter（CSS017 禁裸写；GLS001 单入口）；blur/tint/高光边/降噪层全由组件承担 -->
    <pg-glass preset="navigationBar" class="nav-shell" :class="{ 'is-scrolled': scrolled }">
      <header>
        <p-stack v-p-fluid="'padding(14, 28)'" direction="row" :gap="8" wrap class="nav">
          <router-link to="/" class="brand">
            <span class="brand-mark">◆</span>
            <p-text class="brand-name">Proteus</p-text>
            <span class="brand-tag">/ semantic engine</span>
          </router-link>
          <p-stack direction="row" :gap="4" wrap class="nav-links">
            <router-link
              v-for="l in links"
              :key="l.key"
              :to="l.to"
              class="nav-link"
              :class="{ active: route.name === l.key }"
            >
              <p-text class="nav-text">{{ l.label }}</p-text>
            </router-link>
            <router-link to="/docs/intro" class="nav-link" :class="{ active: isDocs }">
              <p-text class="nav-text">文档</p-text>
            </router-link>
            <a class="nav-link nav-github" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">
              <p-text class="nav-text">GitHub ↗</p-text>
            </a>
          </p-stack>
        </p-stack>
      </header>
      <!-- ★#389c 顶部滚动进度条（渐变填充 scaleX——合成器属性） -->
      <div class="scroll-progress" aria-hidden="true">
        <div class="scroll-progress-bar" :style="{ transform: 'scaleX(' + progress + ')' }" />
      </div>
    </pg-glass>

    <main v-p-fluid="'padding(12, 24)'" class="main" :class="{ 'is-docs': isDocs }">
      <router-view />
    </main>

    <p-view v-p-fluid="'padding(20, 28)'" class="footer">
      <p-text class="footer-line">Proteus — One semantic model. Any render engine. Zero native glue.</p-text>
      <p-text class="footer-dim">官网用 Proteus 自身构建（dogfooding）：p-* 语义组件 + @proteus-vue/docs 文档引擎 + G-22 柔性布局（零 @media）</p-text>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ★#389b 全站粒子背景层（fixed——滚动时粒子恒定不随内容移动；内容层 z1 浮于其上）
   ★#389e 分层修复：nav-shell 不在此设 position（sticky 归 .nav-shell 规则——relative 会覆盖 sticky） */
.site-particles {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.site > .main,
.site > .footer {
  z-index: 1;
}
.site > .nav-shell {
  z-index: 20;
}
/* ★#389i 3D 精灵 dock（右下角悬浮，全站可见；容器 pointer-events 穿透——点击只落在 iframe 本体；clamp 适配小屏，零 @media） */
.spirit-dock {
  position: fixed;
  right: 8px;
  bottom: 0;
  z-index: 25;
  width: clamp(150px, 16vw, 200px);
  pointer-events: none;
}
.site-spirit {
  display: block;
  width: 100%;
  height: clamp(170px, 18vw, 220px);
  border: 0;
  background: transparent;
  pointer-events: auto;
}
/* ★#389i 形态主题气泡（pg-glass floating 玻璃——玻璃语义单入口，页面零裸写 backdrop-filter） */
.spirit-speech {
  position: absolute;
  right: 4px;
  bottom: calc(100% - 26px);
  width: min(268px, 74vw);
  padding: 11px 14px;
  text-align: left;
  pointer-events: none;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}
.spirit-speech-name { display: block; color: var(--ink); font-weight: 700; font-size: 12.5px; }
.spirit-speech-theme { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.55; margin-top: 3px; }
/* 气泡出入场（Vue Transition——信息性显示，过渡极短） */
.spirit-bubble-enter-active { transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
.spirit-bubble-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.spirit-bubble-enter-from,
.spirit-bubble-leave-to { opacity: 0; transform: translateY(8px) scale(0.92); }
/* ★#389 玻璃语义归 <pg-glass>（G-07）：页面只保留定位与底部细线；blur/tint/高光/降噪全归组件
   ★#389f 吸顶兼容性：-webkit-sticky 前缀（老 iOS/安卓内核对 flex 子项 sticky 需要前缀）；
   同时禁止任何祖先层把 sticky 顶走——position 只在本元素声明 */
.nav-shell {
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--line);
  transition: box-shadow 0.2s ease;
}
.nav-shell.is-scrolled { box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); }
/* ★#389c 滚动进度条（渐变填充） */
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
  background: linear-gradient(90deg, var(--brand), var(--brand2));
  transform-origin: 0 50%;
  transform: scaleX(0);
}
.nav {
  /* p-stack 内联 style 已定 row/wrap/gap——页面类只补两端对齐（内联未设 justify） */
  justify-content: space-between;
  max-width: 1180px;
  margin: 0 auto;
  width: 100%;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; flex-shrink: 0; }
/* ★#387 Conic mark（v3 品牌标识：同心方 conic 渐变） */
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
  -webkit-background-clip: initial;
  background-clip: initial;
}
.brand-name { color: var(--ink); font-weight: 700; font-size: 17px; letter-spacing: 0.4px; white-space: nowrap; }
/* ★#387 v3 品牌尾缀（/ semantic engine） */
.brand-tag { color: var(--dim); font-size: 13px; white-space: nowrap; }
.nav-links { display: flex; align-items: center; flex-wrap: wrap; }
.nav-link { text-decoration: none; padding: 7px 12px; border-radius: var(--radius-sm); position: relative; }
/* ★#381：链接文字禁折字（首/页 竖排两字的根因）——窄屏整链接换行 */
.nav-text { color: var(--muted); font-size: 14px; transition: color 0.15s; white-space: nowrap; }
.nav-link:hover { background: var(--panel2); }
.nav-link:hover .nav-text { color: var(--ink); }
/* active：品牌色文字 + 底部短下划线（替代大药丸） */
.nav-link.active { background: none; }
.nav-link.active .nav-text { color: var(--brand); font-weight: 600; }
.nav-link.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 2px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--brand), var(--brand2));
}
/* GitHub：描边按钮形态（与页面内 CTA 同语言） */
.nav-github { border: 1px solid var(--line); margin-left: 6px; }
.nav-github:hover { border-color: var(--brand2); }
.main { max-width: 1180px; margin: 0 auto; width: 100%; flex: 1; }
/* ★文档页三栏（左导航+正文+右导读）需要更宽的容器——isDocs 时放开（首页/Playground 维持 1180） */
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
/* ★#386 对比度（a11y AA）：12px 小字不用 dim（#5c5c6a 在 #0a0a0c 上不足 4.5:1） */
.footer-dim { color: var(--muted); font-size: 12px; }
</style>
