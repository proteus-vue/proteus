<!-- src/components/p-box/index.vue —— 原子容器（★G-32 L1：layout.box）
     统一 flex 纵向容器 + 可选宽高比 / 溢出策略；p-view 为通用容器，p-box 强调「盒」语义（宽高比/裁剪）
     ★Skyline 线收口：p-box 为纯布局原语（零平台 API，双端一致）；aspect-ratio 不支持时（Skyline）宽度自适应、高度 auto -->
<template>
  <div class="p-box" :class="{ 'p-box-clip': overflow === 'hidden' }" :style="boxStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 宽高比（如 '16/9'；0/空 = 不设）——Skyline 无 aspect-ratio → 降级为不约束（内容撑高） */
  aspectRatio: { type: String, default: '' },
  /** 溢出：visible（默认）/ hidden（裁剪） */
  overflow: { type: String, default: 'visible' },
})

// ★MP 编译安全：断言语义在方法体内（computted 返回字面量对象）
const boxStyle = computed(() => {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  }
  if (props.aspectRatio) style.aspectRatio = props.aspectRatio
  if (props.overflow === 'hidden') style.overflow = 'hidden'
  return style
})
</script>

<style scoped>
.p-box {
  min-width: 0;
  min-height: 0;
}
.p-box-clip {
  overflow: hidden;
}
</style>
