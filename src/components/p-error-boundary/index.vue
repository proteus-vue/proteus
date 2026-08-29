<!-- src/components/p-error-boundary/index.vue —— 错误兜底（组件库 B6）
     矩阵 10：Vue errorCaptured 捕获后代错误（Web）；MP 端无 Vue 运行时 → onErrorCaptured 被编译器剥离，退化为透传容器（平台限制标注）
     fallback：默认文案 or #fallback 具名插槽（插槽为 Web 能力，MP 端不触发错误态故不涉及） -->
<template>
  <view v-if="error" class="p-error-boundary" :aria-label="ariaLabel">
    <slot name="fallback">
      <text class="p-error-boundary-text">{{ fallbackText }}</text>
    </slot>
  </view>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  fallbackText: { type: String, default: '页面出错了，请重试' },
})

const error = ref(false)

// Web：捕获后代组件渲染/生命周期错误 → 切换 fallback；return false 阻止继续向上冒泡
onErrorCaptured(() => {
  error.value = true
  return false
})
</script>

<style scoped>
.p-error-boundary {
  padding: 32px 16px;
  text-align: center;
}
.p-error-boundary-text {
  font-size: 14px;
  color: #999;
}
</style>
