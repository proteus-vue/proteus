<script setup lang="ts">
/**
 * Icon.vue —— Studio 自绘图标集（决策 #1390）
 *
 * 【为什么要自建】此前终端会话列表用了 `▣ ✎ 🗑` 这类字符/emoji：
 *   · 字体依赖：不同系统/字号下粗细、基线、留白都不一样，和工具栏的线性图标风格割裂；
 *   · 颜色不可控：emoji 自带色，主题切换时会"花"。
 * 这里统一成 **16×16 线性图标（stroke=currentColor）**：细线、圆角端点、随 `color` 变色。
 *
 * 用法：`<Icon name="trash" :size="12" />`
 */
type IconName =
  | 'terminal'
  | 'pencil'
  | 'trash'
  | 'close'
  | 'split'
  | 'plus'
  | 'chevron-down'
  | 'maximize'
  | 'search'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 14 })

/* 路径表：全部按 16×16 画（`stroke-width=1.4`、圆角端点），与 Studio 其它细线图标一致 */
const PATHS: Record<IconName, string> = {
  /* 终端：外框 + 提示符箭头 + 下划线 */
  terminal: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M4.5 6.5l2 1.7-2 1.6 M8.5 10h3',
  pencil: 'M11.4 2.9l1.7 1.7-7.4 7.4-2.4.7.7-2.4z M9.9 4.4l1.7 1.7',
  trash: 'M3.5 5h9 M6 5V3.7h4V5 M4.7 5l.6 7.6h5.4L11.3 5 M6.6 7v4 M9.4 7v4',
  close: 'M4 4l8 8 M12 4l-8 8',
  split: 'M2.5 3.5h11v9h-11z M8 3.5v9',
  plus: 'M8 3.5v9 M3.5 8h9',
  'chevron-down': 'M4 6.5l4 3.5 4-3.5',
  /* 最大化/还原：四角括号 */
  maximize: 'M3 6V3.5h2.5 M13 6V3.5h-2.5 M3 10v2.5h2.5 M13 10v2.5h-2.5',
  /* 放大镜 */
  search: 'M7.2 2.6a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2z M10.7 10.7l2.8 2.8',
}
</script>

<template>
  <svg
    class="ico"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[props.name]" />
  </svg>
</template>

<style scoped>
.ico {
  display: inline-block;
  vertical-align: -2px;
  flex: none;
  pointer-events: none;
}
</style>
