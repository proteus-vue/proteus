<!--
  css-conformance/App.vue —— Web 端根组件（SPA 壳）

  【本工程为何是最简壳】CSS 验收只需要"路由 → 页面 → 真渲染"这条链；
  全局层/overlay/转场都不参与样式验收（多余层会引入与验收无关的层叠变量）。
  ⇒ 壳 = `app-root > page-layer > RouterView`，无全局层内容。
-->
<script setup lang="ts">
import { onMounted } from 'vue'
import RouterView from './router/RouterView.vue'
import appConfig from './app.config'

onMounted(() => {
  document.title = appConfig.app.name
})
</script>

<template>
  <app-root>
    <page-layer>
      <RouterView />
    </page-layer>
  </app-root>
</template>
