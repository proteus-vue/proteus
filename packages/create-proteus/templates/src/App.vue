<!-- src/App.vue —— Web 端根组件（SPA 壳：RouterView 按当前路由渲染页面） -->
<script setup lang="ts">
import RouterView from '@proteus/router/RouterView.vue'
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
