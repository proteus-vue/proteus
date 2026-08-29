<!-- examples/pages/provide-inject-demo.vue —— provide/inject 演示页（vue-compat-advance Batch 3）
     页面顶层 provide("key", value) → 编译为 onLoad 注册 getApp().__proteusProvides（ref.value → this.data 快照）；
     组件 inject("key") → attached 读取 + setData。MVP 值快照（非响应式联动），响应式为后续 -->
<route>
{
  "meta": {
    "title": "注入演示"
  }
}
</route>
<script setup lang="ts">
import { ref, provide } from 'vue'
// Web 端注册组件（MP 端编译器忽略 import，标签走 usingComponents）
import InjectConsumer from '../components/inject-consumer/index.vue'

const user = ref('proteus')
const theme = ref('dark')

// provide 顶层调用（零缩进）→ 编译期提取 + onLoad 注册
provide('demo-user', user.value)
provide('demo-theme', theme.value)
</script>

<template>
  <div class="provide-inject-demo">
    <h2>provide / inject</h2>
    <p class="sub">页面 provide → 组件 inject（getApp().__proteusProvides 全局注册表桥，MVP 值快照）</p>
    <inject-consumer />
    <p class="sub">已提供：demo-user={{ user }} · demo-theme={{ theme }}</p>
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
