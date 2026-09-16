<!-- src/components/p-inline/index.vue —— 行内容器（★G-32 B2：layout.inline L2）
     内联盒语义（对齐 CSS inline-flex）：内容按行排列，wrap 开启允许折行
     双端同源码：div → view（编译期映射）；MP 安全（纯 class/style 计算，无平台 API） -->
<template>
  <div class="p-inline" :style="inlineStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 允许折行（默认不折行） */
  wrap: { type: Boolean, default: false },
  /** 元素间距 px */
  gap: { type: Number, default: 0 },
  /** 主轴对齐（flex-start/center/end/space-between/space-around） */
  justify: { type: String, default: 'flex-start' },
  /** 交叉轴对齐（flex-start/center/end/stretch） */
  align: { type: String, default: 'center' },
})

const inlineStyle = computed(() => {
  const style: CSSProperties = {
    display: 'inline-flex',
    flexWrap: props.wrap ? 'wrap' : 'nowrap',
    justifyContent: props.justify,
    alignItems: props.align,
  }
  if (props.gap) style.gap = props.gap + 'px'
  return style as CSSProperties
})
</script>