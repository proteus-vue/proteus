<!-- src/components/p-icon/index.vue —— 图标（★G-32 B2：ui.icon U4）
     矢量优先：内置字形映射（unicode 自包含，零资源）；name/size/color/spin 约束
     双端同源码：span → text；MP 安全（纯文本字形 + 样式） -->
<template>
  <span class="p-icon" :class="{ 'p-icon-spin': spin }" :style="iconStyle">{{ glyph }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 图标名（内置字形表；未知 → '?'） */
  name: { type: String, default: 'info' },
  /** 尺寸 px */
  size: { type: Number, default: 16 },
  /** 颜色 */
  color: { type: String, default: 'currentColor' },
  /** 旋转动画 */
  spin: { type: Boolean, default: false },
})

/** 内置字形表（自包含零资源——语义图标最小集，扩展走 slot/字体图标后续批次） */
const GLYPHS: Record<string, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
  warn: '!',
  back: '‹',
  close: '✕',
  search: '⌕',
  star: '★',
  heart: '♥',
  arrowDown: '↓',
  arrowUp: '↑',
  arrowLeft: '←',
  arrowRight: '→',
  plus: '+',
  minus: '−',
  check: '✓',
  menu: '☰',
  user: '👤',
  home: '⌂',
  more: '⋯',
}

const glyph = computed(() => GLYPHS[props.name] ?? '?')

const iconStyle = computed(() => {
  const style: CSSProperties = {
    fontSize: props.size + 'px',
    lineHeight: '1',
    width: props.size + 'px',
    height: props.size + 'px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: props.color,
    fontStyle: 'normal',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-icon-spin {
  animation: p-icon-rotate 1s linear infinite;
}
@keyframes p-icon-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>