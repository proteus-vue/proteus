<!-- examples/pages/image-spike.vue —— ★G-62 P0 地基 spike（2026-09-09）
     目的：验证 Skyline 下 <image> 能否渲染 SVG data-URI（P0 静态图标方案的唯一前提）。
     三形态对照：① base64 data-URI ② URL-encoded data-URI ③ 纯色 PNG data-URI（对照基线）
     @proteus-api-check-ignore：spike 性质 -->
<template>
  <view class="spike">
    <text class="spike-title">P0 image + SVG data-URI 验证</text>
    <text class="spike-sub">三个图标：base64 / urlencoded / 对照</text>

    <view class="spike-row">
      <image class="spike-img" :src="b64" mode="aspectFit" />
      <image class="spike-img" :src="urlenc" mode="aspectFit" />
      <image class="spike-img" :src="fallback" mode="aspectFit" />
    </view>

    <text class="spike-sub">↓ 编译器 lowering 产物（静态 &lt;svg&gt; 零改代码）</text>
    <view class="spike-row">
      <svg viewBox="0 0 100 100" width="80" height="80">
        <circle cx="50" cy="50" r="40" fill="#9b59b6" />
        <path d="M20 20 L80 80" stroke="#f1c40f" stroke-width="6" />
      </svg>
    </view>

    <text class="spike-sub">↓ P1 手写动态 SVG（encodeURIComponent，非 base64——btoa 不存在）</text>
    <view class="spike-row">
      <image class="spike-img" :src="dynamicUri" mode="aspectFit" />
    </view>

    <text class="spike-sub">↓ P1 编译器 lowering：动态 &lt;svg :d :fill&gt; 零改代码</text>
    <view class="spike-row">
      <svg viewBox="0 0 100 100" width="80" height="80">
        <circle cx="50" cy="50" r="40" :fill="dynColor" />
        <path :d="dynPath" stroke="#fff" stroke-width="6" />
      </svg>
    </view>
    <button class="spike-btn" @click="mutate">改颜色/路径（验证响应式）</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const b64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iI2U3NGMzYyIvPjxwYXRoIGQ9Ik0yMCAyMCBMODAgODAiIHN0cm9rZT0iIzJlY2M3MSIgc3Ryb2tlLXdpZHRoPSI2Ii8+PC9zdmc+'

const urlenc = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ccircle%20cx='50'%20cy='50'%20r='40'%20fill='%23e74c3c'/%3E%3C/svg%3E"

/** 对照：1x1 蓝色 PNG（确认 image 本身工作） */
const fallback = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ★P1 探测：运行时动态生成 SVG（微信逻辑层无 btoa → 用 encodeURIComponent 的 URL-encoded data-URI）
const dynColor = ref('#e67e22')
const dynamicUri = computed(() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="40" fill="' + dynColor.value + '"/>' +
    '<path d="M20 20 L80 80" stroke="#fff" stroke-width="6"/></svg>'
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
})
const dynPath = ref('M20 20 L80 80')
function mutate(): void {
  dynColor.value = dynColor.value === '#e67e22' ? '#16a085' : '#e67e22'
  dynPath.value = dynPath.value === 'M20 20 L80 80' ? 'M20 80 L80 20' : 'M20 20 L80 80'
}
</script>

<style scoped>
.spike {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
  gap: 12px;
}
.spike-title {
  font-size: 18px;
  font-weight: 700;
}
.spike-sub {
  font-size: 13px;
  color: #666;
}
.spike-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  margin-top: 8px;
}
.spike-img {
  width: 80px;
  height: 80px;
  border: 1px solid #ddd;
  background: #f7f8fa;
}
</style>
