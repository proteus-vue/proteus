<!-- src/components/p-popover/index.vue —— 气泡浮层（★G-32 B4：shell.popover S7）
     trigger click/hover/focus + placement 位置（top/bottom/left/right）
     ★B2/B4 薄壳：v-model 显隐受控 + 自绘定位（智能定位批次接入）
     双端同源码：div → view；MP 安全（遮罩点关闭，避 document 监听） -->
<template>
  <div class="p-popover">
    <div class="p-popover-trigger" @click="onTrigger">
      <slot name="trigger" />
    </div>
    <!-- ★2026-09-07 弹层命中契约（p-drawer P7 同款）：关闭事件挂全屏 layer（可靠命中层）而非遮罩元素——
         skyline 下纯背景/无绘制子节点不参与命中。popover 为透明浮层：layer 几何全屏 + 微透明底
         兜底绘制（Web 透明即可命中）；面板 anchored 于 trigger 保持原位（非 layer 子级，点击不冒泡到 layer） -->
    <template v-if="modelValue">
      <view class="p-popover-layer" @click="close" />
      <!-- placement 静态分支（同 p-popup 位置类教训：动态类 Skyline 无 scoped 匹配 → 面板左上角） -->
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
    </template>
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