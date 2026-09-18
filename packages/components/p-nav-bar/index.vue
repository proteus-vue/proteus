<!-- src/components/p-nav-bar/index.vue —— 导航栏（组件库 B6，普通态）
     矩阵 01 §9：title / back / fixed + left/right 插槽
     ★appBar 集成标注 v0.6（Router B5 ⬜）；本组件为普通 view 态导航栏
     C3：组件不直接调路由 —— back 仅 emit，由页面决定导航（api.navigator A8 未实现前）
     ★2026-09-14 官方属性对齐（end-alignment 批次 2）：对齐官方 <navigation-bar>（导航条）——
       补 loading（标题区加载指示）/ front-color（前景色）/ background-color / color-animation-duration /
       color-animation-timing-func（换色动画）。SSOT：component-ir/src/audit.ts「<navigation-bar> → shell.nav」 -->
<template>
  <view
    class="p-nav-bar"
    :class="{ 'is-fixed': fixed, 'p-nav-bar--dark': frontColor === '#ffffff' }"
    :style="barStyle"
    :aria-label="ariaLabel"
  >
    <view class="p-nav-bar-left">
      <text v-if="back" class="p-nav-bar-back" @tap="onBackTap">‹ 返回</text>
      <slot name="left" />
    </view>
    <view class="p-nav-bar-title">
      <view v-if="loading" class="p-nav-bar-loading"><view class="p-nav-bar-spinner-dot" /></view>
      <text class="p-nav-bar-title-text" :style="titleStyle">{{ title }}</text>
    </view>
    <view class="p-nav-bar-right">
      <slot name="right" />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  title: { type: String, default: '' },
  back: { type: Boolean, default: false },
  fixed: { type: Boolean, default: false },
  // ── ★官方 <navigation-bar> 属性（2026-09-14 对齐） ──
  /** 是否在标题区显示 loading 加载指示 */
  loading: { type: Boolean, default: false },
  /** 导航条前景色（按钮/标题/状态栏），仅支持 #ffffff / #000000 */
  frontColor: { type: String, default: '#000000' },
  /** 导航条背景色（十六进制） */
  backgroundColor: { type: String, default: '#ffffff' },
  /** 改变导航栏颜色时的动画时长（ms，0 = 无动画） */
  colorAnimationDuration: { type: Number, default: 0 },
  /** 换色动画方式：linear / easeIn / easeOut / easeInOut */
  colorAnimationTimingFunc: { type: String, default: 'linear' },
})

const emit = defineEmits(['back'])

// 背景色 + 换色动画（行内 style；颜色来自官方属性）
const barStyle = computed(() => ({
  background: props.backgroundColor,
  color: props.frontColor,
  transition: props.colorAnimationDuration > 0
    ? `background ${props.colorAnimationDuration}ms ${props.colorAnimationTimingFunc}, color ${props.colorAnimationDuration}ms ${props.colorAnimationTimingFunc}`
    : 'none',
}))
const titleStyle = computed(() => ({ color: props.frontColor }))

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
/* ★深色前景（front-color=#ffffff）：分隔线用 box-shadow 而非 border-color——
   单边异色 border 会触发 Skyline「border-radius 失效」告警（T11/skyline-pitfalls）；此处只需换色，
   但统一用 box-shadow 内阴影模拟底边线，避开该属性族。 */
.p-nav-bar--dark {
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.15);
}
.p-nav-bar--dark .p-nav-bar-back {
  color: #fff;
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
/* ★spinner（Skyline 安全画法，见 docs/skyline-pitfalls.md T11）：单边异色 border（border-top-color）
   在 Skyline 下会让 border-radius 失效 → 圆环变方块。改用「统一色 border 环 + 随转子元素点」。 */
.p-nav-bar-loading {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 2px solid rgba(127, 127, 127, 0.25);
  border-radius: 50%;
  position: relative;
  animation: p-nav-bar-spin 0.8s linear infinite;
}
.p-nav-bar-spinner-dot {
  position: absolute;
  top: -2px;
  left: 50%;
  margin-left: -2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
@keyframes p-nav-bar-spin {
  to {
    transform: rotate(360deg);
  }
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
