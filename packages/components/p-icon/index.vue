<!-- src/components/p-icon/index.vue —— 图标（★G-32 B2：ui.icon U4）
     矢量优先：内置字形映射（unicode 自包含，零资源）；name/size/color/spin 约束
     ★2026-09-14 官方属性对齐（批次 2）：新增官方 `type`（取值 success/info/warn/…）——与 name 同义（name 优先）。
     ★★真机修复（2026-09-14）：根节点由 `<text>` 改 **`<view>`**——Skyline 下 `<text>` 不支持 `inline-flex`
       （尺寸/居中/transform 全失效 → 图标整体不显示、旋转中心也不对）；改为 view 盒 + 内层 text 承载字形，
       尺寸/居中/旋转都作用在 view 盒上（两块图标演示均恢复正常）。 -->
<template>
  <view class="p-icon" :class="{ 'p-icon-spin': spin }" :style="boxStyle">
    <text class="p-icon__glyph">{{ glyph }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 图标名（内置字形表；未知 → '?'）。框架名，优先于官方 type */
  name: { type: String, default: '' },
  /** ★官方 <icon> type（success/info/warn/waiting/cancel/download/clear…）——name 的官方别名 */
  type: { type: String, default: '' },
  /** 尺寸 px */
  size: { type: Number, default: 16 },
  /** 颜色 */
  color: { type: String, default: 'currentColor' },
  /** 旋转动画 */
  spin: { type: Boolean, default: false },
})

/** 内置字形表（自包含零资源——语义图标最小集，扩展走 slot/字体图标后续批次）
 *  取值对齐官方 <icon> type：success / success_no_circle / info / warn / waiting / cancel / download / clear */
const GLYPHS: Record<string, string> = {
  success: '✓',
  success_no_circle: '✓',
  error: '✕',
  info: 'i',
  warn: '!',
  waiting: '◷',
  cancel: '✕',
  download: '⤓',
  clear: '✕',
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

const glyph = computed(() => GLYPHS[props.name || props.type || 'info'] ?? '?')

/** 盒尺寸/居中/颜色（作用在 view 盒上——旋转中心即盒中心，不随字形墨迹偏移） */
const boxStyle = computed(() => {
  const style: CSSProperties = {
    fontSize: props.size + 'px',
    lineHeight: `${props.size}px`,
    width: props.size + 'px',
    height: props.size + 'px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: props.color,
    fontStyle: 'normal',
    // 旋转围绕盒中心（显式声明，避免继承/默认差异）
    transformOrigin: '50% 50%',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-icon__glyph {
  display: block;
  line-height: 1;
  text-align: center;
}
.p-icon-spin {
  animation: p-icon-rotate 1s linear infinite;
}
@keyframes p-icon-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
