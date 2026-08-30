<!-- examples/pages/virtual-list-demo.vue —— 虚拟列表演示页（v0.4） -->
<route>
{
  "meta": {
    "title": "虚拟列表"
  }
}
</route>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
// Web 端注册框架内置组件（聚合入口；MP 端编译器忽略 import，标签走 usingComponents /proteus/...）
import { VirtualList } from '@proteus-vue/components'

// ref 用非空初始值推导类型（空数组会推断 never[]，编译器不支持泛型标注）
const items = ref([{ title: '' }])

onMounted(() => {
  // 万条数据：data 全量一次传输，WXML 只渲染可视区（VirtualList 切片）
  const arr = []
  for (let i = 0; i < 10000; i++) arr.push({ title: 'item ' + i })
  items.value = arr
})
</script>

<template>
  <div class="vl-demo">
    <h2>虚拟列表</h2>
    <p class="sub">10000 条数据，只渲染可视区（VirtualList 组件，item 高度 44）</p>
    <virtual-list :items="items" :item-height="44" :height="500" />
  </div>
</template>

<style scoped>
.vl-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
</style>
