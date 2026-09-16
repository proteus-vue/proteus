<!-- src/components/p-canvas/index.vue —— 画布（★G-32 B2：ui.canvas U8）
     engine 2d/webgl/skia + resolution 分辨率感知
     ★B2 Web-first：标准 canvas 元素承载 + width/height（devicePixelRatio 缩放后续批次）；
     宿主上下文经 slots/ref 透出（帧渲染属能力批次） -->
<template>
  <div class="p-canvas" :style="canvasStyle">
    <canvas :width="pixelWidth" :height="pixelHeight" class="p-canvas-el" />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 渲染引擎：2d / webgl / skia */
  engine: { type: String, default: '2d' },
  /** CSS 宽 px（0=自适应） */
  width: { type: Number, default: 300 },
  /** CSS 高 px（0=自适应） */
  height: { type: Number, default: 150 },
  /** 分辨率倍率（>1 高清渲染；canvas 内部分辨率 = CSS × 倍率） */
  resolution: { type: Number, default: 1 },
})

const pixelWidth = computed(() => Math.max(1, Math.round(props.width * props.resolution)))
const pixelHeight = computed(() => Math.max(1, Math.round(props.height * props.resolution)))

const canvasStyle = computed(() => {
  const style: CSSProperties = {
    width: props.width + 'px',
    height: props.height + 'px',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-canvas {
  display: inline-block;
  background: #f7f8fa;
  border-radius: 4px;
  overflow: hidden;
}
.p-canvas-el {
  display: block;
}
</style>