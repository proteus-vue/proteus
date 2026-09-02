<!-- src/components/p-virtual-list/index.vue —— 虚拟化长列表（★G-32 B2：layout.virtual-list L11）
     薄转发层（同 virtual-list 模式）：API 表面 items/itemHeight/height → p-list-view 单实现
     语义命名对齐 G-32（p-virtual-list）；旧标签 virtual-list 保留兼容 -->
<template>
  <p-list-view :items="items" :item-height="itemHeight" :height="height" />
</template>

<script setup lang="ts">
import PListView from '../p-list-view/index.vue'

defineProps({
  /** 列表数据（渲染 item 数组） */
  items: { type: Array as () => unknown[], default: () => [] },
  /** 固定行高 px（虚拟化前提） */
  itemHeight: { type: Number, default: 44 },
  /** 可视区高度 px */
  height: { type: Number, default: 400 },
})
</script>