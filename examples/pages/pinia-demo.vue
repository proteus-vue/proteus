<!-- examples/pages/pinia-demo.vue —— Pinia 状态管理演示页（v0.4）
     Web 端：原生 Pinia（main.ts createPinia + stores/counter.ts）
     MP 端：⚠ 本页为 Web 端 Pinia 演示——MP 端 Pinia 依赖跨模块编译（MVP 限制），
     过渡方案用框架 store 桥 src/runtime/store -->
<route>
{
  "meta": {
    "title": "状态管理"
  }
}
</route>
<script setup lang="ts">
import { useCounterStore } from '../stores/counter'

const store = useCounterStore()
</script>

<template>
  <div class="pinia-demo">
    <h2>Pinia 状态管理</h2>
    <p class="sub">Web 端原生 Pinia（store：counter / setup 风格 + computed）</p>
    <p class="count">count：{{ store.count }}（double：{{ store.double }}）</p>
    <button @click="store.inc()">inc</button>
    <button @click="store.reset()">reset</button>
  </div>
</template>

<style scoped>
.pinia-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
}
.count {
  font-size: 18px;
  font-weight: 600;
  margin: 16px 0;
}
button {
  margin: 0 8px;
}
</style>
