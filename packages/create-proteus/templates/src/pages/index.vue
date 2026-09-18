<!-- src/pages/index.vue —— 首页（路由页面：编译期由 gen-routes 扫描注册） -->
<route>
{
  "meta": {
    "title": "首页",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>Hello Proteus</h1>
    <p class="tapped-count">tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home {
  text-align: center;
  padding: 48px 0;
}
</style>
