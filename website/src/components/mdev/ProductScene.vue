<script setup lang="ts">
// mdev 场景 ①：商品卡（真实 DOM 渲染——同一份组件，六种端形态）
import { ref } from 'vue'
const count = ref(1)
const price = '¥ 299'
</script>

<template>
  <p-view class="sc-product">
    <p-heading :level="1">Mono speaker</p-heading>
    <p-text class="price">{{ price }}</p-text>
    <p-stack direction="row" :gap="6" wrap class="row">
      <p-button class="btn" @tap="count = Math.max(1, count - 1)">−</p-button>
      <p-text class="qty">× {{ count }}</p-text>
      <p-button class="btn" @tap="count = count + 1">＋</p-button>
    </p-stack>
    <p-text class="note">One card · six device forms</p-text>
  </p-view>
</template>

<style scoped>
.sc-product { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.price { color: #d9483b; font-weight: 700; font-size: 16px; }
.row { align-items: center; }
.btn { padding: 2px 10px; }
.qty { font-size: 13px; }
.note { font-size: 10.5px; color: #778; }
</style>
