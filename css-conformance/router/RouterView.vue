<!--
  css-conformance/router/RouterView.vue —— Web 端渲染容器（应用壳，仅 Web 构建使用）

  【与 superapp 版的区别】去掉转场/遮罩（不参与 CSS 验收）；保留两条关键机制：
    · `adapter.onPageLoad` 驱动当前页（与 MP 端同一套导航语义）
    · 页面组件**预热缓存**（首次导航同步挂载——热路径与 superapp 一致）
-->
<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import { routeMap } from './auto-routes'
import { adapter } from '@proteus-vue/shared'

const modules = import.meta.glob('../pages/**/*.vue')
const pageCache = new Map<string, Component>()
for (const [key, load] of Object.entries(modules)) {
  ;(load() as Promise<{ default: Component }>).then((mod) => {
    pageCache.set(key, mod.default)
  })
}
const current = ref(adapter.getCurrentPages()[0]?.route || 'pages/index')
adapter.onPageLoad?.((route) => {
  current.value = route || 'pages/index'
})

const view = computed<Component | null>(() => {
  const rec =
    routeMap[current.value] || Object.values(routeMap).find((r) => r.path === current.value)
  if (!rec) return null
  const cached = pageCache.get(rec.component)
  if (cached) return cached
  const load = (modules as Record<string, () => Promise<unknown>>)[rec.component]
  return load ? defineAsyncComponent(load as () => Promise<Component>) : null
})
</script>

<template>
  <div class="router-view">
    <component :is="view" v-if="view" :key="current" class="page" />
    <div v-else class="page">404 Not Found</div>
  </div>
</template>

<style scoped>
/* ★★css-conformance 实测（2026-10-05 · 页面铺满对齐）：壳容器**不得声明任何背景**——
 *   首版照搬 superapp 的 `background: transparent`，而它带 scopeId（特异性 0,2,0）高于
 *   页面自身的 `.cc-page`（0,1,0）⇒ 把页面底色**覆盖成透明** ⇒ Web 基准页底变白，
 *   与 App 端（折进节点 backgroundColor=#f4f5f7）分叉。superapp 无此问题是因为它的页底
 *   由 Global 层壳（#sa-theme-bg）提供，不在页面类上。
 *   ⇒ 本壳只保留布局职责（min-height）；**底色完全归页面**（层次单一事实源）。 */
.page {
  min-height: 100vh;
}
</style>
