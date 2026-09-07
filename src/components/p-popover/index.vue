<!-- src/components/p-popover/index.vue —— 气泡浮层（★G-32 B4：shell.popover S7）
     trigger click/hover/focus + placement 位置（top/bottom/left/right）
     ★B2/B4 薄壳：v-model 显隐受控 + 自绘定位（智能定位批次接入）
     双端同源码：div → view；MP 安全（遮罩点关闭，避 document 监听） -->
<template>
  <div class="p-popover">
    <div class="p-popover-trigger" @click="onTrigger">
      <slot name="trigger" />
    </div>
    <!-- ★2026-09-07 Skyline 悬浮层：常驻 overlay + visibility 切换（对齐 p-drawer 常驻模式；wx:if 子树在
         glass-easel 不可靠）。portal 版曾实证可渲染但「脱离导致锚定失效（面板左上角）」→ 去 portal，
         面板 absolute 锚定留在原组件树（containing block = .p-popover 根，定位不破坏） -->
    <view class="p-popover-overlay" :class="{ 'p-popover-overlay--on': modelValue }">
      <view class="p-popover-layer" @click="close" />
      <view v-if="placement === 'bottom'" class="p-popover-panel p-popover-bottom">
        <slot />
      </view>
      <view v-else-if="placement === 'top'" class="p-popover-panel p-popover-top">
        <slot />
      </view>
      <view v-else-if="placement === 'left'" class="p-popover-panel p-popover-left">
        <slot />
      </view>
      <view v-else class="p-popover-panel p-popover-right">
        <slot />
      </view>
    </view>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 显隐（v-model） */
  modelValue: { type: Boolean, default: false },
  /** 触发方式：click / hover / focus（hover/focus 批次接入——B4 薄壳 click） */
  trigger: { type: String, default: 'click' },
  /** 位置：top / bottom / left / right */
  placement: { type: String, default: 'bottom' },
})

const emit = defineEmits(['update:modelValue'])

function onTrigger(): void {
  if (props.trigger === 'hover') return // hover 批次接入；click 直接切换
  emit('update:modelValue', !props.modelValue)
}
function close(): void {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.p-popover {
  position: relative;
  display: inline-block;
}
.p-popover-overlay {
  /* 常驻 overlay：关闭态隐藏（不拦截不绘制），打开态可见——skyline 终案（wx:if 子树不可靠，弃 portal） */
  visibility: hidden;
  transition: visibility 0s linear 0.25s;
}
.p-popover-overlay--on {
  visibility: visible;
  transition: visibility 0s linear 0s;
}
.p-popover-layer {
  /* 全屏可靠命中层：显式四边定位（skyline 不认 inset）；popover 非模态 → 透明底 + 微透明兜底绘制 */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.01);
  z-index: 998;
}
.p-popover-panel {
  position: absolute;
  z-index: 999;
  min-width: 120px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 14px;
}
.p-popover-top {
  bottom: calc(100% + 6px);
  left: 0;
}
.p-popover-bottom {
  top: calc(100% + 6px);
  left: 0;
}
.p-popover-left {
  right: calc(100% + 6px);
  top: 0;
}
.p-popover-right {
  left: calc(100% + 6px);
  top: 0;
}
</style>