<!-- src/components/p-grid/index.vue —— 自适应网格（★G-22 柔性布局 B2 + G-22.2 降级）
     只声明「每列最小宽度」+ 间距，列数自动：Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))
     （320px→1 / 768px→4 / 1440px→8 列；calcColumns 纯算法见 compiler/fluid-layout.ts）
     双端同源码：div → view（编译期映射）；MP webview 渲染支持 grid，Skyline 降级为普通容器
     ★G-22.2 降级铁律「朴素但正确」：Web 端 CSS.supports 探测 grid 不支持 → flex-wrap 模拟 auto-fit
       （MP 逻辑层无 CSS.supports → 假设支持 → 恒 grid 模式，渲染端自决降级） -->
<template>
  <div class="p-grid" :class="gridClass" :style="gridStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { detectFluidCapabilities, styleToString } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 每列最小宽度（px）——列数自动求解 */
  minColWidth: { type: Number, default: 160 },
  /** 列间距（px） */
  gap: { type: Number, default: 12 },
})

// ★G-22.2 能力检测（组件初始化一次）：MP 无 CSS.supports → fluid 层按渲染端判（Skyline grid 不可用 → flex 降级；WebView/Web grid）
const gridOk = detectFluidCapabilities().grid

const gridClass = computed(() => (gridOk ? '' : 'p-grid-fallback'))

// ★#495c 单表达式（MP 编译器不支持块体 computed）；gridStyle 内联 props/gridOk（编译期 this.data/this 改写）
//   Skyline（gridOk=false）：flex row wrap（★Skyline 默认 flex-direction: column——必须显式 row；slot 子项宽度由内容/调用方 class 自决——朴素正确 G-22.2）
//   WebView/Web：CSS grid auto-fill
//   ★#495d 输出 style 字符串（Skyline 只认 style 字符串——对象绑定不生效）
const gridStyle = computed<string>(() =>
  styleToString(
    gridOk
      ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(' + props.minColWidth + 'px, 1fr))', gap: props.gap + 'px' }
      : { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: props.gap + 'px' },
  ),
)
</script>

<style global>
/* ★G-22.2 降级：grid 不支持（旧浏览器/Skyline）→ flex-wrap 容器。slot 子项样式受组件模型限制
   （Web 端子选择器可用但为保持双端一致语义，子项宽度由调用方 class 自决——朴素但正确） */
</style>
