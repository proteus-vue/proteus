<!-- src/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
// RouterView 为应用壳（随应用存放），不再从框架包引子路径（拆包步骤 7）
import RouterView from './router/RouterView.vue'
</script>

<template>
  <div class="app">
    <RouterView />
  </div>
</template>

<style>
.app {
  font-family: system-ui, -apple-system, sans-serif;
  color: #1f2328;
}
</style>
