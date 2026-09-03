<script setup lang="ts">
// website/src/App.vue —— 官网壳：顶部导航 + 路由出口
// ★W-6 柔性框架优先：导航 padding/间距用 v-p-fluid clamp 表达式（模板指令，非 CSS）——零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { guides } from './guides'

const route = useRoute()
const currentSlug = computed(() => (route.params.slug as string | undefined) ?? '')
</script>

<template>
  <div class="site">
    <header v-p-fluid="'padding(16, 28)'" class="nav">
      <router-link to="/" class="brand">
        <span class="brand-mark">◆</span>
        <span class="brand-name">Proteus</span>
      </router-link>
      <nav class="nav-links">
        <router-link to="/" class="nav-link" :class="{ active: route.name === 'home' }">首页</router-link>
        <router-link to="/playground" class="nav-link" :class="{ active: route.name === 'playground' }">Playground</router-link>
        <router-link
          v-for="g in guides.slice(0, 3)"
          :key="g.slug"
          :to="`/docs/${g.slug}`"
          class="nav-link"
          :class="{ active: currentSlug === g.slug }"
        >{{ g.title }}</router-link>
        <a class="nav-link" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
    </header>

    <main class="main">
      <router-view />
    </main>

    <footer v-p-fluid="'padding(28, 48)'" class="footer">
      <span>Proteus — One semantic model. Any render engine. Zero native glue.</span>
      <span class="footer-dim">官网用 Proteus 自身构建（dogfooding）：@proteus-vue/docs 文档引擎 + G-22 柔性布局（零 @media）</span>
    </footer>
  </div>
</template>

<style>
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 1180px;
  margin: 0 auto;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.brand-mark { color: var(--brand); font-size: 18px; }
.brand-name { color: var(--ink); font-weight: 700; font-size: 18px; letter-spacing: 0.5px; }
.nav-links { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.nav-link { color: var(--muted); text-decoration: none; font-size: 14px; padding: 6px 10px; border-radius: 8px; }
.nav-link:hover { color: var(--ink); background: var(--panel2); }
.nav-link.active { color: var(--brand); background: rgba(124, 92, 255, 0.12); }
.main { max-width: 1180px; margin: 0 auto; }
.footer {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  border-top: 1px solid var(--line);
}
.footer-dim { color: var(--dim); font-size: 12px; }
</style>
