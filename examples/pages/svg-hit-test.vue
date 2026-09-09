<!-- examples/pages/svg-hit-test.vue —— ★G-62 SVG 事件命中真机验证（2026-09-09）
     验证：SVG 图形 @click → 编译器生成 touchstart 命中方法 → 点中图形触发对应 handler。
     ★真机约束：Skyline tap 事件无坐标（detail/touches undefined），必须用 touchstart。 -->
<template>
  <view class="page">
    <text class="title">SVG 事件命中验证</text>
    <text class="log">{{ log }}</text>
    <view class="row">
      <svg viewBox="0 0 100 100" width="120" height="120" class="canvas">
        <circle cx="30" cy="30" r="20" fill="#e74c3c" @click="onRed" />
        <circle cx="70" cy="70" r="20" fill="#3498db" @click="onBlue" />
        <rect x="60" y="10" width="30" height="30" fill="#2ecc71" @click="onGreen" />
      </svg>
    </view>
    <text class="hint">红圆(30,30) / 蓝圆(70,70) / 绿方(60-90,10-40)</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const log = ref('未命中')
function onRed(): void {
  log.value = 'HIT: red circle'
  console.log('[svg-hit]', log.value)
}
function onBlue(): void {
  log.value = 'HIT: blue circle'
  console.log('[svg-hit]', log.value)
}
function onGreen(): void {
  log.value = 'HIT: green rect'
  console.log('[svg-hit]', log.value)
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  gap: 8px;
}
.title {
  font-size: 16px;
  font-weight: 700;
}
.log {
  font-size: 14px;
  color: #e74c3c;
  font-weight: 700;
}
.row {
  display: flex;
  justify-content: center;
}
.canvas {
  border: 1px solid #ddd;
  background: #fafafa;
}
.hint {
  font-size: 11px;
  color: #666;
}
</style>
