<!-- src/components/p-heading/index.vue —— 标题（★G-32 B2：ui.heading U2）
     语义级标题（对齐 h1-h6）：level 控制级别 → 字号/字重；双端安全（div → view）
     不用动态标签而用 class 表达级别——MP 编译器不支持动态标签名。 -->
<template>
  <div class="p-heading" :class="'p-heading-' + level" :style="headingStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 标题级别 1-6（字号递减） */
  level: { type: Number, default: 1 },
})

const SIZES = ['24px', '20px', '17px', '15px', '13px', '12px']

const headingStyle = computed(() => {
  const lv = Math.min(6, Math.max(1, Math.floor(props.level)))
  const style: CSSProperties = {
    fontSize: SIZES[lv - 1],
    fontWeight: 'bold',
    margin: '0',
    lineHeight: 1.4,
  }
  return style as CSSProperties
})
</script>