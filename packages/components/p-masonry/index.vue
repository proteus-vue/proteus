<!-- src/components/p-masonry/index.vue —— 瀑布流（★G-32 B2：layout.masonry L12）
     CSS columns 实现（col-count/column-gap + 子项 break-inside:avoid + 纵向 gap via CSS 变量）
     双端同源码：div → view；MP 安全（columns 未支持时退化为单列堆叠——朴素但正确 G-22.2）
     ★踩坑：scoped style 内不写 v-bind()（compileVueSfc style 转换不处理）——gap 经 CSS 变量由根样式注入 -->
<template>
  <div class="p-masonry" :style="masonStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 列数（默认 2） */
  colCount: { type: Number, default: 2 },
  /** 列与行间距 px */
  gap: { type: Number, default: 12 },
})

const masonStyle = computed(() => {
  const gapPx = props.gap + 'px'
  const style: CSSProperties = {
    columns: String(Math.max(1, Math.floor(props.colCount))),
    columnGap: gapPx,
  }
  ;(style as Record<string, string>)['--p-masonry-gap'] = gapPx
  return style as CSSProperties
})
</script>

<style scoped>
.p-masonry > :deep(*) {
  break-inside: avoid;
  margin-bottom: var(--p-masonry-gap);
}
</style>