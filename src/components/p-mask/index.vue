<!-- src/components/p-mask/index.vue —— 遮罩（组件库 B5）
     矩阵 01 §8 弹层体系：visible + close-on-tap + opacity；无动画（动画由弹层组件自行编排）
     双端同源码：view + fixed 定位；Skyline fixed 支持（基础库 2.26+，真机异常时降级 absolute + 全屏容器，v0.6 评估编译器 transform） -->
<template>
  <view v-if="visible" class="p-mask" :style="{ opacity: opacity }" :aria-label="ariaLabel" @tap="onTap" />
</template>

<script setup lang="ts">
const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  visible: { type: Boolean, default: false },
  opacity: { type: Number, default: 0.5 },
  closeOnTap: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

function onTap() {
  if (props.closeOnTap) emit('close')
}
</script>

<style scoped>
.p-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: #000;
}
</style>
