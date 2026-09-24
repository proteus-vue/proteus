<!-- src/components/p-divider/index.vue —— 分隔线（★G-32 B2：layout.divider L9）
     水平/垂直分隔线：orientation 控制方向，inset 控制内缩（水平=上下边距，垂直=左右边距）
     双端同源码：div → view；MP 安全（border 样式计算） -->
<template>
  <div class="p-divider" :class="'p-divider-' + orientation" :style="dividerStyle" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 方向：horizontal 水平 / vertical 垂直 */
  orientation: { type: String, default: 'horizontal' },
  /** 内缩距离 px（水平=上下外边距；垂直=左右外边距） */
  inset: { type: Number, default: 0 },
  /** 线色（缺省随主题变量） */
  color: { type: String, default: '' },
})

const dividerStyle = computed(() => {
  const lineColor = props.color || 'var(--p-divider-color, #e5e6eb)'
  if (props.orientation === 'vertical') {
    const style: CSSProperties = {
      borderLeft: '1px solid ' + lineColor,
      // ★垂直分隔线的可见性修复（2026-09-24 实测）：
      //   `height: 100%` 在**内容驱动高度**的父容器里无法解析（百分比高度需父级有确定高度）→
      //   分隔线塌成 0 高、完全不可见（实测：p-stack row 里 h=0，E2E 可见占比 2/4 报红）。
      //   改 `alignSelf: stretch`——flex 父容器下沿交叉轴撑满（行内分隔的正确语义）；
      //   minHeight 兜底：非 flex 父容器（align-self 无效）时至少 1em 可见，不再静默消失。
      alignSelf: 'stretch',
      minHeight: '1em',
      marginLeft: props.inset + 'px',
      marginRight: props.inset + 'px',
      display: 'inline-block',
      verticalAlign: 'middle',
    }
    return style as CSSProperties
  }
  const style: CSSProperties = {
    borderTop: '1px solid ' + lineColor,
    marginTop: props.inset + 'px',
    marginBottom: props.inset + 'px',
    width: '100%',
  }
  return style as CSSProperties
})
</script>