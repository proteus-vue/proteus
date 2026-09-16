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
      height: '100%',
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