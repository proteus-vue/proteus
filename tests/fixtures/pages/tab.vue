<!-- tests/fixtures/pages/tab.vue —— TabBar golden fixture：isTab + 样式换算 -->
<route>
{
  "meta": {
    "title": "标签页",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div class="tab">{{ count }}</div>
</template>

<style>
.tab {
  font-size: 14px;
}
</style>
