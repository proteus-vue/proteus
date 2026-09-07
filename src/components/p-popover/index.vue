<!-- src/components/p-popover/index.vue —— 气泡浮层（★G-32 B4：shell.popover S7）
     trigger click/hover/focus + placement 位置（top/bottom/left/right）
     ★B2/B4 薄壳：v-model 显隐受控 + 自绘定位（智能定位批次接入）
     双端同源码：div → view；MP 安全（遮罩点关闭，避 document 监听） -->
<template>
  <div class="p-popover">
    <div class="p-popover-trigger" @click="onTrigger">
      <slot name="trigger" />
    </div>
    <template v-if="modelValue">
      <div class="p-popover-mask" @click="close" />
      <div class="p-popover-panel" :class="'p-popover-' + placement">
        <slot />
      </div>
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
.p-popover-mask {
  position: fixed;
  inset: 0;
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