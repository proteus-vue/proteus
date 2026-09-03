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
      <!-- ★header 布局走柔性框架（#381）：p-stack row+wrap 内联 style——窄屏整链接换行不折字 -->
      <p-stack v-p-fluid="'padding(14, 28)'" direction="row" :gap="8" wrap class="nav">
        <router-link to="/" class="brand">
          <span class="brand-mark">◆</span>
          <p-text class="brand-name">Proteus</p-text>
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

    <main v-p-fluid="'padding(12, 24)'" class="main">
      <router-view />
    </main>

    <p-view v-p-fluid="'padding(20, 28)'" class="footer">
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
  /* p-stack 内联 style 已定 row/wrap/gap——页面类只补两端对齐（内联未设 justify） */
  justify-content: space-between;
  max-width: 1180px;
  margin: 0 auto;
  width: 100%;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; flex-shrink: 0; }
.brand-mark {
  color: var(--brand);
  font-size: 16px;
  background: linear-gradient(120deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-name { color: var(--ink); font-weight: 700; font-size: 17px; letter-spacing: 0.4px; white-space: nowrap; }
.nav-links { display: flex; align-items: center; flex-wrap: wrap; }
.nav-link { text-decoration: none; padding: 7px 12px; border-radius: 8px; position: relative; }
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
.footer-dim { color: var(--dim); font-size: 12px; }
</style>
