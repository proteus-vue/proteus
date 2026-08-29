<!-- src/components/p-toast/index.vue —— 轻提示（组件库 B5）
     矩阵 01 §8：text + duration 自动关闭（0 = 不自动关）+ enter 淡入；visible 驱动（B3 原语）
     转场：CSS animation；Worklet 自定义组件（避开原生 showToast 限制）标注 v0.6 -->
<template>
  <view v-if="visible" class="p-toast">
    <view class="p-toast-mask" />
    <view class="p-toast-panel" :class="'p-toast-panel--' + position">
      <text class="p-toast-text">{{ text }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  visible: { type: Boolean, default: false },
  text: { type: String, default: '' },
  duration: { type: Number, default: 2000 }, // ms，0 = 不自动关
  position: { type: String, default: 'center' }, // center / top / bottom
})

const emit = defineEmits(['close'])

const timer = ref(0)

// 显示时自动关闭定时器（emit close → 父置 visible=false）
watch(() => props.visible, () => {
  if (props.visible && props.duration > 0) {
    clearTimeout(timer.value)
    timer.value = setTimeout(() => {
      emit('close')
    }, props.duration) as unknown as number
  }
})
</script>

<style scoped>
.p-toast-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: transparent;
}
.p-toast-panel {
  position: fixed;
  z-index: 1001;
  max-width: 70%;
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.75);
  left: 50%;
  transform: translateX(-50%);
  animation: proteus-toast-in 250ms ease-out;
}
.p-toast-panel--top {
  top: 64px;
}
.p-toast-panel--center {
  top: 50%;
  transform: translate(-50%, -50%);
}
.p-toast-panel--bottom {
  bottom: 120px;
}
.p-toast-text {
  color: #fff;
  font-size: 13px;
}
@keyframes proteus-toast-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
</style>
