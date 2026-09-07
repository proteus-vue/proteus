<!-- src/components/p-loading/index.vue —— 加载中（组件库 B5）
     矩阵 01 §8：visible + text + spinner（CSS 旋转动画）；不自动关闭（由页面控制）
     转场：CSS animation；Worklet 自定义组件标注 v0.6 -->
<template>
  <view v-if="visible" class="p-loading">
    <view class="p-loading-mask" />
    <view class="p-loading-panel">
      <view class="p-loading-spinner" />
      <text v-if="text" class="p-loading-text">{{ text }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  visible: { type: Boolean, default: false },
  text: { type: String, default: '' },
})
</script>

<style scoped>
.p-loading-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: transparent;
}
.p-loading-panel {
  position: fixed;
  z-index: 1001;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 16px 20px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.p-loading-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  animation: proteus-loading-spin 800ms linear infinite;
}
.p-loading-text {
  color: #fff;
  font-size: 12px;
  margin-top: 8px;
}
@keyframes proteus-loading-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
