<!-- src/components/p-aspect/index.vue —— 纵横比容器（★Fluid System S2：内容驱动宽高比盒）
     只声明「宽/高比」：Web = CSS aspect-ratio（Chrome 88+ 原生）；不支持 → padding-top hack 降级
     （height:0 + paddingTop:1/ratio% + 子项绝对定位——全端 CSS2 技术「朴素但正确」，铁律 G-22.2）
     MP：aspect-ratio Skyline 部分支持；逻辑层无 CSS.supports → 假设支持（渲染端自决） -->
<template>
  <div class="p-aspect" :class="aspectClass" :style="aspectStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { detectFluidCapabilities } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 宽/高比（如 16/9 = 1.777；默认 1.777） */
  ratio: { type: Number, default: 16 / 9 },
  /** 最大宽度（px；0 = 不限） */
  maxWidth: { type: Number, default: 0 },
})

// ★能力检测（组件初始化一次）：MP 无 CSS.supports → aspectRatio 恒真（渲染端自决）
const aspectOk = detectFluidCapabilities().aspectRatio

const aspectClass = computed(() => (aspectOk ? '' : 'p-aspect-fallback'))

// ★断言放方法体内（MP 编译器剥离方法体 as；CSSProperties 字面量类型）
const aspectStyle = computed(() => {
  const ratio = props.ratio > 0 ? props.ratio : 16 / 9
  const style: CSSProperties = {
    position: 'relative',
    width: '100%',
  }
  if (props.maxWidth > 0) style.maxWidth = props.maxWidth + 'px'
  if (aspectOk) {
    // 原生：aspect-ratio 保持盒比例（子项随内容自然填充）
    style.aspectRatio = ratio + ' / 1'
    return style as CSSProperties
  }
  // ★降级：padding-top hack——height 0 + paddingTop = 1/ratio%，子项绝对定位铺满（<style global> 规则）
  style.height = '0px'
  style.paddingTop = 100 / ratio + '%'
  return style as CSSProperties
})
</script>

<style global>
/* ★S2 降级：aspect-ratio 不支持时 padding-top hack——slot 子元素无法从组件内联样式触达，
     全局规则按容器类切换生效（子项绝对定位铺满容器内容区） */
.p-aspect-fallback > * {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>
