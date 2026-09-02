<!-- src/components/p-svg/index.vue —— 矢量图形（★G-32 B2：ui.svg U9）
     path（SVG path d 数据）+ viewbox 渲染；矢量优先（无位图）
     ★B2 Web-first：内联 svg 元素（MP 端 Skia 矢量映射后续批次） -->
<template>
  <svg class="p-svg" :viewBox="viewbox" :style="svgStyle">
    <path v-if="path" :d="path" fill="currentColor" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** SVG path d 数据（无 fill 语义——随 currentColor） */
  path: { type: String, default: '' },
  /** 视盒 "x y w h"（缺省 0 0 24 24） */
  viewbox: { type: String, default: '0 0 24 24' },
  /** 尺寸 px */
  size: { type: Number, default: 24 },
  /** 颜色 */
  color: { type: String, default: 'currentColor' },
})

const svgStyle = computed(() => {
  const style: CSSProperties = {
    width: props.size + 'px',
    height: props.size + 'px',
    color: props.color,
    display: 'inline-block',
    verticalAlign: 'middle',
  }
  return style as CSSProperties
})
</script>