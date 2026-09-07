<!-- src/components/p-skeleton/index.vue —— 骨架屏（组件库 B6）
     矩阵 10 业务组件：绑定加载态（:visible="loading"），不自带定时器（C4）
     lines 为数组 prop（宽度百分比），规避 MP range v-for 不可用（wx:for 需数组）
     shimmer 动画走 CSS keyframes（双端） -->
<template>
  <view v-if="visible" class="p-skeleton" :aria-label="ariaLabel">
    <view v-if="avatar" class="p-skeleton-avatar" />
    <view class="p-skeleton-lines">
      <view v-for="(w, i) in lines" :key="i" class="p-skeleton-line" :style="{ width: w + '%' }" />
    </view>
  </view>
  <slot v-else />
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  visible: { type: Boolean, default: true },
  avatar: { type: Boolean, default: false },
  lines: { type: Array as any, default: () => [90, 70, 80] },
})
</script>

<style scoped>
.p-skeleton {
  display: flex;
  padding: 12px 16px;
}
.p-skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  margin-right: 12px;
}
.p-skeleton-lines {
  flex: 1;
}
.p-skeleton-line {
  height: 14px;
  border-radius: 4px;
  margin: 8px 0;
}
/* shimmer：background-position 动画（双端 CSS animation） */
.p-skeleton-avatar,
.p-skeleton-line {
  background: linear-gradient(90deg, #eee 25%, #f5f5f5 37%, #eee 63%);
  background-size: 400% 100%;
  animation: proteus-shimmer 1.4s ease infinite;
}
@keyframes proteus-shimmer {
  from { background-position: 100% 50%; }
  to { background-position: 0 50%; }
}
</style>
