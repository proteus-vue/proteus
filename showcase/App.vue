<!-- showcase/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
import { onMounted } from 'vue'
import RouterView from './router/RouterView.vue'
// ★应用标题唯一事实源（决策 #212）：app.config.ts 的 app.name——运行时设置浏览器标签标题
import appConfig from './app.config'

onMounted(() => {
  document.title = appConfig.app.name
})
</script>

<template>
  <div class="app">
    <RouterView />
  </div>
</template>

<style global>
/* 设计 token（styles/tokens.css）由 main.ts 引入，全局可用 */
.app {
  min-height: 100vh;
  background: var(--sp-bg);
  color: var(--sp-text);
}
</style>
