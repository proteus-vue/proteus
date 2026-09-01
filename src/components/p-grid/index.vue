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
import type { CSSProperties } from 'vue'
import { detectFluidCapabilities } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 每列最小宽度（px）——列数自动求解 */
  minColWidth: { type: Number, default: 160 },
  /** 列间距（px） */
  gap: { type: Number, default: 12 },
})

// ★G-22.2 能力检测（组件初始化一次）：MP 无 CSS.supports → grid 恒真（渲染端自决）
const gridOk = detectFluidCapabilities().grid

const gridClass = computed(() => (gridOk ? '' : 'p-grid-fallback'))

// ★断言放方法体内（MP 编译器剥离方法体 as；字符串模板拼接满足 CSSProperties 字面量类型）
const gridStyle = computed(() => {
  if (!gridOk) {
    // ★降级：flex-wrap 模拟 repeat(auto-fit, minmax(N, 1fr))——slot 子项 min-width/flex 由 <style global> 规则按类提供
    const style: CSSProperties = {
      display: 'flex',
      flexWrap: 'wrap',
      gap: props.gap + 'px',
      alignItems: 'stretch',
    }
    const custom = style as CSSProperties & { ['--pgrid-min']?: string }
    custom['--pgrid-min'] = props.minColWidth + 'px'
    return custom
  }
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(' + props.minColWidth + 'px, 1fr))',
    gap: props.gap + 'px',
  }
  return style as CSSProperties
})
</script>

<style global>
/* ★G-22.2 降级：grid 不支持时 flex-wrap 模拟 auto-fit——slot 子元素无法从组件内联样式触达，
     全局规则按容器类切换生效（min-width 经 --pgrid-min 由组件内联注入，默认 160px 兜底） */
.p-grid-fallback > * {
  min-width: var(--pgrid-min, 160px);
  flex: 1 1 auto;
}
</style>
