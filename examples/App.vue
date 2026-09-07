<!-- src/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
import { onMounted } from 'vue'
import RouterView from './router/RouterView.vue'
// ★应用标题唯一事实源（决策 #212）：app.config.ts 的 app.name——运行时设置浏览器标签标题
//   （index.html 静态 <title> 仅首屏兜底，避免白屏期无标题；页面级标题 = router.meta.title 待导航组件消费）
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
.app {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1f2328;
}
</style>
