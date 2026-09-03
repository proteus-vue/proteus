<script setup lang="ts">
// website/src/App.vue —— 官网壳：顶部导航 + 路由出口
// ★B4 导航重构（#379）：顶部导航只留区块入口（首页/Playground/文档/GitHub），
//   指南清单归文档侧边栏（guides.ts）——长标题进导航是杂乱根源
// ★D-2：布局标签 p-view/p-text；★W-6：v-p-fluid clamp，零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isDocs = computed(() => route.path.startsWith('/docs'))
const links = [
  { to: '/', label: '首页', key: 'home' },
  { to: '/playground', label: 'Playground', key: 'playground' },
]
</script>

<template>
  <p-page class="site">
    <header class="nav-shell">
      <p-view v-p-fluid="'padding(14, 28)'" class="nav">
        <router-link to="/" class="brand">
          <span class="brand-mark">◆</span>
          <p-text class="brand-name">Proteus</p-text>
        </router-link>
        <p-stack direction="row" :gap="4" class="nav-links">
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
      </p-view>
    </header>

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
/* ★玻璃拟态 sticky 顶栏（G-07 语义的 Web 形态：backdrop blur + 半透明） */
.nav-shell {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(10, 10, 12, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.nav {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  justify-content: space-between;
  max-width: 1180px;
  margin: 0 auto;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.brand-mark {
  color: var(--brand);
  font-size: 16px;
  background: linear-gradient(120deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-name { color: var(--ink); font-weight: 700; font-size: 17px; letter-spacing: 0.4px; }
.nav-links { display: flex; align-items: center; flex-wrap: wrap; }
.nav-link { text-decoration: none; padding: 7px 12px; border-radius: 8px; position: relative; }
.nav-text { color: var(--muted); font-size: 14px; transition: color 0.15s; }
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
.main { max-width: 1180px; margin: 0 auto; width: calc(100% - 48px); flex: 1; }
.footer {
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
