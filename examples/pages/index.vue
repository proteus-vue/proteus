<!-- src/pages/index.vue —— 首页（TabBar 页面示例，覆盖核心映射：ref/v-if/v-for/:src/事件/ref 写入） -->
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

const title = ref('Proteus')
const items = ref(['Web', 'Mini Program'])
const show = ref(true)
const count = ref(0)

function handleTap() {
  // Web 端：Vue 真实响应式更新；MP 端：编译器重写为 this.setData({ count: ... })
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>{{ title }}</h1>
    <p v-if="show">One Vue source. Every form.</p>
    <p class="tapped-count">tapped {{ count }} times</p>
    <div v-for="(item, idx) in items" :key="idx" class="item">{{ idx }}. {{ item }}</div>
    <button @click="handleTap">tap</button>
    <div class="links">
      <a href="/pages/forms">表单与指令</a>
      <a href="/pages/config-demo">配置演示</a>
      <a href="/pages/components-demo">组件演示</a>
      <a href="/pages/virtual-list-demo">虚拟列表</a>
      <a href="/pages/user/index">用户中心</a>
      <a href="/pages/user/profile">个人资料</a>
      <a href="/subpackages/order/pages/list">订单列表</a>
    </div>
  </div>
</template>

<style>
.home {
  text-align: center;
  padding: 48px 0;
}
.item {
  padding: 4px 0;
}
.links {
  margin-top: 24px;
}
.links a {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
</style>
