<!-- examples/pages/provide-inject-demo.vue —— provide/inject 演示页（vue-compat-advance Batch 3 + Batch 4 响应式联动）
     页面顶层 provide("key", value) → 编译为 onLoad 注册 getApp().__proteusProvides；
     ★Batch 4 语义（对齐 Vue）：裸 ref 提供（provide("demo-user", user)）→ 响应式联动（ref 写入 → inject 组件自动 setData）；
     .value / 字面量提供 → 静态快照。组件 inject → attached 订阅 __subs[key]（值变化刷新），detached 取消 -->
<script setup lang="ts">
import { ref, provide } from 'vue'
// Web 端注册组件（MP 端编译器忽略 import，标签走 usingComponents）
import InjectConsumer from '../components/inject-consumer/index.vue'

const user = ref('proteus')
const theme = ref('dark')

// 裸 ref 提供 → 响应式联动（Batch 4）：changeUser 修改后组件自动刷新
provide('demo-user', user)
// .value 提供 → 静态快照（Batch 3 行为，不联动）
provide('demo-theme', theme.value)

function changeUser() {
  user.value = user.value === 'proteus' ? 'zeus' : 'proteus'
}
</script>

<template>
  <div class="provide-inject-demo">
    <h2>provide / inject</h2>
    <p class="sub">页面 provide → 组件 inject（getApp().__proteusProvides 全局注册表桥）</p>
    <inject-consumer />
    <button @click="changeUser">切换 user（裸 ref 联动 → 组件自动刷新）</button>
    <p class="sub">demo-user={{ user }}（联动）· demo-theme={{ theme }}（.value 快照）</p>
  </div>
</template>

<style scoped>
.provide-inject-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
  margin: 8px 0;
}
</style>
