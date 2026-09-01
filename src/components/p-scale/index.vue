<!-- src/components/p-scale/index.vue —— 动态字号/密度（★Fluid System S4：无障碍 + 密度语义）
     只声明「字号级别 + 密度」：容器 font-size = base × 级别倍率 × 全局字号缩放（var(--proteus-font-scale, 1)
     宿主/系统注入——折叠屏/平板密度适配），子项用 em 继承即随缩放；密度 → 行高 + --proteus-density-gap 间距 token
     纯逻辑在 @proteus-vue/fluid scale.ts（buildScaleStyle 字符串级可单测）；MP 安全：无类型标注 -->
<template>
  <div class="p-scale" :class="'p-scale-' + density" :style="scaleStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { buildScaleStyle } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 字号级别：0 小 / 1 标准 / 2 大 / 3 特大（无障碍档位） */
  level: { type: Number, default: 1 },
  /** 密度：compact（紧凑）/ regular / comfortable（宽松无障碍） */
  density: { type: String, default: 'regular' },
  /** 基准字号（px）——子项用 em 继承即随缩放 */
  baseSize: { type: Number, default: 16 },
})

// ★断言放方法体内（MP 编译器剥离方法体 as；纯函数解析 → CSSProperties 字面量类型）
const scaleStyle = computed(() => {
  const style = buildScaleStyle({
    level: props.level,
    density: props.density as 'compact' | 'regular' | 'comfortable',
    baseSize: props.baseSize,
  })
  return style as CSSProperties
})
</script>
