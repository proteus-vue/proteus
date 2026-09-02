<!-- src/components/p-spacer/index.vue —— 弹性空白（★G-32 B2：layout.spacer L8）
     弹性占用剩余空间（对齐 flex:1）：撑开布局让后续元素靠边；grow/shrink 可调
     双端同源码：div → view；MP 安全（纯内联样式） -->
<template>
  <div class="p-spacer" :style="spacerStyle" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 弹性增长比例（默认 1——占满剩余空间） */
  grow: { type: Number, default: 1 },
  /** 收缩比例（默认 1） */
  shrink: { type: Number, default: 1 },
  /** 自身尺寸下限 px（保证可见/可点） */
  minSize: { type: Number, default: 1 },
})

const spacerStyle = computed(() => {
  const style: CSSProperties = {
    flexGrow: String(props.grow),
    flexShrink: String(props.shrink),
    alignSelf: 'stretch',
    minWidth: props.minSize + 'px',
  }
  return style as CSSProperties
})
</script>