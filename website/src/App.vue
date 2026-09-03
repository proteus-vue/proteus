<script setup lang="ts">
// website/src/App.vue —— 官网壳：顶部导航 + 路由出口
// ★D-2（#377）：布局标签 p-view/p-text 语义组件（禁裸 div 布局）
// ★W-6 柔性框架优先：导航 padding 用 v-p-fluid clamp 表达式（模板指令，非 CSS）——零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { guides } from './guides'

const route = useRoute()
const currentSlug = computed(() => (route.params.slug as string | undefined) ?? '')
</script>

<template>
  <p-page class="site">
    <p-view v-p-fluid="'padding(16, 28)'" class="nav nav-row">
      <router-link to="/" class="brand">
        <p-text class="brand-mark">◆</p-text>
        <p-text class="brand-name">Proteus</p-text>
      </router-link>
      <p-stack direction="row" :gap="8" class="nav-links">
        <router-link to="/" class="nav-link" :class="{ active: route.name === 'home' }">
          <p-text class="nav-text">首页</p-text>
        </router-link>
        <router-link to="/playground" class="nav-link" :class="{ active: route.name === 'playground' }">
          <p-text class="nav-text">Playground</p-text>
        </router-link>
        <router-link
          v-for="g in guides.slice(0, 3)"
          :key="g.slug"
          :to="`/docs/${g.slug}`"
          class="nav-link"
          :class="{ active: currentSlug === g.slug }"
        >
          <p-text class="nav-text">{{ g.title }}</p-text>
        </router-link>
        <a class="nav-link" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">
          <p-text class="nav-text">GitHub ↗</p-text>
        </a>
      </p-stack>
    </p-view>

    <main class="main">
      <router-view />
    </main>

    <p-view v-p-fluid="'padding(28, 48)'" class="footer">
      <p-text class="footer-line">Proteus — One semantic model. Any render engine. Zero native glue.</p-text>
      <p-text class="footer-dim">官网用 Proteus 自身构建（dogfooding）：p-* 语义组件 + @proteus-vue/docs 文档引擎 + G-22 柔性布局（零 @media）</p-text>
    </p-view>
  </p-page>
</template>

<style scoped>
/* p-view 默认 flex-column——行向布局用更高特异性显式覆盖（组件默认 + 页面修饰 = 预期用法） */
.nav {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  justify-content: space-between;
  max-width: 1180px;
  margin: 0 auto;
  width: calc(100% - 48px);
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.brand-mark { color: var(--brand); font-size: 18px; }
.brand-name { color: var(--ink); font-weight: 700; font-size: 18px; letter-spacing: 0.5px; }
.nav-links { display: flex; align-items: center; flex-wrap: wrap; }
.nav-link { text-decoration: none; }
.nav-text { color: var(--muted); font-size: 14px; }
.nav-link:hover .nav-text { color: var(--ink); }
.nav-link.active .nav-text { color: var(--brand); }
.nav-link.active { background: rgba(124, 92, 255, 0.12); border-radius: 8px; }
.main { max-width: 1180px; margin: 0 auto; width: calc(100% - 48px); flex: 1; }
.footer {
  display: flex !important;
  max-width: 1180px;
  margin: 0 auto;
  width: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--line);
}
.footer-line { color: var(--muted); font-size: 13px; }
.footer-dim { color: var(--dim); font-size: 12px; }
</style>
