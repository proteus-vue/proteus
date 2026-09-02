<!-- src/components/p-drawer/index.vue —— 侧滑抽屉（★G-32 B2：shell.drawer S5）
     open 受控（v-model:open ←→ modelValue）+ side 方向 + width + overlay 遮罩点击关闭
     双端同源码：div → view；CSS transform 滑入滑出（MP 安全） -->
<template>
  <div class="p-drawer-root">
    <div v-if="modelValue && overlay" class="p-drawer-mask" @click="onClose" />
    <div
      class="p-drawer"
      :class="[side, { 'p-drawer-open': modelValue }]"
      :style="{ width: width + 'px' }"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 展开状态（v-model:open） */
  modelValue: { type: Boolean, default: false },
  /** 侧向：left / right */
  side: { type: String, default: 'left' },
  /** 抽屉宽度 px */
  width: { type: Number, default: 300 },
  /** 遮罩（点击关闭） */
  overlay: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue'])

function onClose(): void {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.p-drawer-root {
  position: relative;
}
.p-drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 999;
}
.p-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  background: #ffffff;
  z-index: 1000;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.25s ease;
  overflow-y: auto;
}
.p-drawer.left {
  left: 0;
  transform: translateX(-100%);
}
.p-drawer.right {
  right: 0;
  transform: translateX(100%);
}
.p-drawer.p-drawer-open {
  transform: translateX(0);
}
</style>