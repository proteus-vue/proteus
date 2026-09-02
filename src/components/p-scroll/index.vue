<!-- src/components/p-scroll/index.vue —— 显式滚动容器（★G-32 B2：layout.scroll L10）
     仅当需「滚动」语义时使用（对齐 scroll-view）；axis 控制方向，CSS overflow 实现 Web 滚动
     ★B2 范围：基础滚动容器（paging/refresh/indicator 为能力约束——随后续批次接入）
     双端同源码：div → view；Web overflow 滚动 -->
<template>
  <div class="p-scroll" :style="scrollStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 滚动轴：x 水平 / y 垂直 / both */
  axis: { type: String, default: 'y' },
  /** 翻页吸附（能力约束——B2 仅声明） */
  paging: { type: Boolean, default: false },
  /** 下拉刷新（能力约束——B2 仅声明） */
  refresh: { type: Boolean, default: false },
  /** 滚动指示器 */
  indicator: { type: Boolean, default: true },
})

const scrollStyle = computed(() => {
  const style: CSSProperties = {
    overflowX: props.axis === 'x' || props.axis === 'both' ? 'auto' : 'hidden',
    overflowY: props.axis === 'y' || props.axis === 'both' ? 'auto' : 'hidden',
  }
  if (!props.indicator) {
    style.scrollbarWidth = 'none'
  }
  return style as CSSProperties
})
</script>