<!-- src/components/p-stack/index.vue —— 弹性栈（★G-22 柔性布局 B3）
     方向 + 间距 + 智能换行：Web = flex + gap（wrap 时空间不足自动换行）
     双端同源码：div → view（编译期映射） -->
<template>
  <div class="p-stack" :class="['p-stack-' + direction, { 'p-stack-wrap': wrap }]" :style="stackStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 主轴方向：row（横向）/ column（纵向） */
  direction: { type: String, default: 'column' },
  /** 空间不足自动换行（仅 row） */
  wrap: { type: Boolean, default: false },
  /** 子项间距（px） */
  gap: { type: Number, default: 0 },
})

// ★断言放方法体内（MP 编译器剥离方法体 as；CSSProperties 字面量类型）
const stackStyle = computed(() => {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: (props.direction === 'row' ? 'row' : 'column') as CSSProperties['flexDirection'],
    flexWrap: (props.wrap ? 'wrap' : 'nowrap') as CSSProperties['flexWrap'],
    gap: props.gap + 'px',
  }
  return style as CSSProperties
})
</script>
