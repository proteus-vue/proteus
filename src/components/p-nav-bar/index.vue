<!-- src/components/p-nav-bar/index.vue —— 导航栏（组件库 B6，普通态）
     矩阵 01 §9：title / back / fixed + left/right 插槽
     ★appBar 集成标注 v0.6（Router B5 ⬜）；本组件为普通 view 态导航栏
     C3：组件不直接调路由 —— back 仅 emit，由页面决定导航（api.navigator A8 未实现前） -->
<template>
  <view class="p-nav-bar" :class="{ 'is-fixed': fixed }" :aria-label="ariaLabel">
    <view class="p-nav-bar-left">
      <text v-if="back" class="p-nav-bar-back" @tap="onBackTap">‹ 返回</text>
      <slot name="left" />
    </view>
    <view class="p-nav-bar-title">
      <text class="p-nav-bar-title-text">{{ title }}</text>
    </view>
    <view class="p-nav-bar-right">
      <slot name="right" />
    </view>
  </view>
</template>

<script setup lang="ts">
const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  title: { type: String, default: '' },
  back: { type: Boolean, default: false },
  fixed: { type: Boolean, default: false },
})

const emit = defineEmits(['back'])

function onBackTap() {
  if (props.back) emit('back')
}
</script>

<style scoped>
.p-nav-bar {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.p-nav-bar.is-fixed {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 900;
}
.p-nav-bar-left {
  display: flex;
  align-items: center;
  min-width: 64px;
}
.p-nav-bar-back {
  font-size: 14px;
  color: #333;
  padding: 4px 8px 4px 0;
}
.p-nav-bar-title {
  flex: 1;
  text-align: center;
}
.p-nav-bar-title-text {
  font-size: 16px;
  font-weight: 500;
  color: #111;
}
.p-nav-bar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 64px;
}
</style>
