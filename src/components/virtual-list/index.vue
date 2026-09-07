<!-- src/components/virtual-list/index.vue —— 虚拟列表兼容别名（B3：virtual-list → p-list-view 通用化）
     保留原标签名（v0.4 产物兼容，examples/virtual-list-demo 继续可用）；新代码请直接用 <p-list-view>
     薄转发层：API 表面不变（items / itemHeight / height），实现单一来源（p-list-view） -->
<template>
  <p-list-view :items="items" :item-height="itemHeight" :height="height" />
</template>

<script setup lang="ts">
import PListView from '../p-list-view/index.vue'

defineProps({
  items: { type: Array as any, default: () => [] },
  itemHeight: { type: Number, default: 44 },
  height: { type: Number, default: 400 },
})
</script>
