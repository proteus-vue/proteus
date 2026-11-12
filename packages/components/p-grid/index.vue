<!-- src/components/p-grid/index.vue —— 自适应网格（★G-22 柔性布局 B2 + G-22.2 降级）
     只声明「每列最小宽度」+ 间距，列数自动：Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))
     （320px→1 / 768px→4 / 1440px→8 列；calcColumns 纯算法见 compiler/fluid-layout.ts）
     ★2026-11-12（外部 F-41）：固定 minColWidth 在窄屏排不出与手写断点一致的列数——
       实测 390 宽、minColWidth=142 只得 2 列，而手写版（小屏 min-width 降到 96）是 3 列。
       新增 `minColWidthMin` + `minColWidthVw`：合成为一个 CSS `max(96px, min(142px, 22vw))`
       —— 窄屏走下限、宽屏封顶原值、中间随视口流式。**纯 CSS 函数、零运行时**，
       且不改变「只声明下限、列数自动」的契约。
     ★#496 退役状态：MP 产物已走语义编译（编译器在产物层展开为 flex 档位 + px basis 档位容器，见
     docs/proteus-fluid-layout-plan/06-semantic-compile.md）——本组件 **Web-only**（真实 Vue CSS grid
     auto-fill 为 Web 最优解）+ 兼容别名保留；WebView/Skyline 不再经本组件。
     ★G-22.2 降级铁律「朴素但正确」：Web 端 CSS.supports 探测 grid 不支持 → flex-wrap 降级（slot 子项
     宽度由调用方 class 自决——子选择器机制跨端不通用，Skyline WXSS 拒绝通配，#495b 剔除） -->
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
  /** 每列最小宽度（px）——列数自动求解；启用流式时作为**上限** */
  minColWidth: { type: Number, default: 160 },
  /** ★F-41 窄屏下限（px）——0 或 ≥minColWidth 时退回固定 minColWidth（旧行为） */
  minColWidthMin: { type: Number, default: 0 },
  /** ★F-41 流式系数（vw 数值，如 22 = 22vw）——0 = 不启用 */
  minColWidthVw: { type: Number, default: 0 },
  /** 列间距（px） */
  gap: { type: Number, default: 12 },
})

// ★G-22.2 能力检测（组件初始化一次）：MP 无 CSS.supports → fluid 层按渲染端判（Skyline grid 不可用 → flex 降级；WebView/Web grid）
const gridOk = detectFluidCapabilities().grid

const gridClass = computed(() => (gridOk ? '' : 'p-grid-fallback'))

/**
 * ★F-41 每列最小宽度的 CSS 值（字符串）：
 *   · 未启用流式 → `${minColWidth}px`（旧行为，零变化）
 *   · 启用 → `max(${min}px, min(${max}px, ${vw}vw))`
 *     CSS max/min 由浏览器原生求值 ⇒ **零运行时**；min 兜住窄屏、max 封顶宽屏。
 * ★单表达式（MP 编译器不支持块体 computed；本组件 Web-only，保持形态一致便于产物对齐）
 */
const colWidthCss = computed<string>(() => {
  const max = props.minColWidth
  const min = props.minColWidthMin
  const vw = props.minColWidthVw
  if (min <= 0 || vw <= 0 || min >= max) return max + 'px'
  return 'max(' + min + 'px, min(' + max + 'px, ' + vw + 'vw))'
})

// ★#495c 单表达式（MP 编译器不支持块体 computed）；gridStyle 内联 props/gridOk（编译期 this.data/this 改写）
//   Skyline（gridOk=false）：flex row wrap（★Skyline 默认 flex-direction: column——必须显式 row；slot 子项宽度由内容/调用方 class 自决——朴素正确 G-22.2）
//   WebView/Web：CSS grid auto-fill
//   ★#495d 输出 style 字符串（Skyline 只认 style 字符串——对象绑定不生效）
const gridStyle = computed<string>(() =>
  styleToString(
    gridOk
      ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(' + colWidthCss.value + ', 1fr))', gap: props.gap + 'px' }
      : { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: props.gap + 'px' },
  ),
)
</script>

<style global>
/* ★G-22.2 降级：grid 不支持（旧浏览器/Skyline）→ flex-wrap 容器。slot 子项样式受组件模型限制
   （Web 端子选择器可用但为保持双端一致语义，子项宽度由调用方 class 自决——朴素但正确） */
</style>
