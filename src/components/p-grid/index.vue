<!-- src/components/p-grid/index.vue —— 自适应网格（★G-22 柔性布局 B2）
     只声明「每列最小宽度」+ 间距，列数自动：Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))
     （320px→1 / 768px→4 / 1440px→8 列；calcColumns 纯算法见 compiler/fluid-layout.ts）
     双端同源码：div → view（编译期映射）；MP webview 渲染支持 grid，Skyline 降级为普通容器 -->
<template>
  <div class="p-grid" :style="gridStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 每列最小宽度（px）——列数自动求解 */
  minColWidth: { type: Number, default: 160 },
  /** 列间距（px） */
  gap: { type: Number, default: 12 },
})

// ★断言放方法体内（MP 编译器剥离方法体 as；字符串模板拼接满足 CSSProperties 字面量类型）
const gridStyle = computed(() => {
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(' + props.minColWidth + 'px, 1fr))',
    gap: props.gap + 'px',
  }
  return style as CSSProperties
})
</script>
