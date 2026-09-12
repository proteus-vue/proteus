<!-- showcase/pages/engineering-router.vue —— 路由（真跳转 + 参数传递） -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'

const routes = ref([
  { path: '/pages/index', name: 'index', title: '首页', isTab: true },
  { path: '/pages/components', name: 'components', title: '组件库', isTab: true },
  { path: '/pages/semantics', name: 'semantics', title: '语义与编译', isTab: true },
  { path: '/pages/system-glass', name: 'system-glass', title: '液态玻璃', isTab: false },
  { path: '/pages/about', name: 'about', title: '关于', isTab: false },
])
</script>

<template>
  <page-shell title="路由" subtitle="@proteus-vue/router · 点下方真实跳转">
    <p-text class="sec">路由表（由 pages/ 目录自动推导）</p-text>
    <p-view class="row" v-for="r in routes" :key="r.name">
      <p-view class="row-main">
        <p-text class="row-name">{{ r.name }}</p-text>
        <p-text class="row-path">{{ r.path }}</p-text>
      </p-view>
      <p-text class="badge" :class="{ tab: r.isTab }">{{ r.isTab ? 'tab' : 'page' }}</p-text>
    </p-view>

    <p-text class="sec">真实跳转</p-text>
    <p-view class="links">
      <a class="link" href="/pages/about">→ 关于页（普通页）</a>
      <a class="link" href="/pages/system-glass" route-type="halfScreen">→ 液态玻璃（halfScreen 转场）</a>
    </p-view>

    <p-text class="note">约定式路由：path/name 从文件路径推导；集中式 meta 在 proteus.config.ts 声明；tab 页用 switchTab、普通页用 navigateTo（框架自动选择）。</p-text>
  </page-shell>
</template>

<style scoped>
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-3) 0 var(--sp-2); color: var(--sp-text); }
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-md); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-2); }
.row-main { flex: 1; min-width: 0; display: block; }
.row-name { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.row-path { display: block; font-size: 11px; font-family: var(--sp-mono); color: var(--sp-text-3); margin-top: 2px; }
.badge { flex-shrink: 0; font-size: 11px; padding: 1px 8px; border-radius: var(--sp-radius-pill); background: var(--sp-surface-2); color: var(--sp-text-2); }
.badge.tab { background: var(--sp-brand-soft); color: var(--sp-brand-ink); }
.links { display: block; }
.link { display: block; padding: var(--sp-3) 0; font-size: 14px; color: var(--sp-brand-ink); text-decoration: none; border-bottom: 1px solid var(--sp-line-soft); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>
