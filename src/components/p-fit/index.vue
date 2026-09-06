<!-- src/components/p-fit/index.vue —— 内在尺寸（★G-22 柔性布局 B3）
     宽度由内容决定（fit-content），但不超过容器 maxRatio（默认 80%）——动态文本/图片自适应
     双端同源码：div → view（编译期映射） -->
<template>
  <div class="p-fit" :style="fitStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { styleToString } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 最大占容器比例（0-1；默认 0.8）——防动态内容撑爆容器 */
  maxRatio: { type: Number, default: 0.8 },
})

// ★#495c/d：单表达式 + style 字符串。Skyline 无 fit-content——width 走 auto（内容驱动天然），maxWidth 上限仍生效
const fitStyle = computed<string>(() =>
  styleToString({
    width: 'fit-content',
    maxWidth: Math.max(0, Math.min(1, props.maxRatio)) * 100 + '%',
  }),
)
</script>
