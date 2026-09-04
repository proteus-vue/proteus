<template>
  <canvas ref="cv" class="particle-canvas" aria-hidden="true" />
</template>

<script setup lang="ts">
// website/src/components/ParticleField.vue —— 语义粒子场（★#389b WebGL 零依赖引擎的 Vue 壳）
// 降级链：WebGL 不可用 → 引擎返回 null → canvas 隐藏（静态辉光仍在）；reduced-motion → 静态单帧
import { onMounted, onUnmounted, ref } from 'vue'
import { createParticleField, type ParticleFieldHandle } from '../playground/particles'

const props = defineProps({
  /** 粒子上限 */
  maxParticles: { type: Number, default: 900 },
  /** 全局不透明度 */
  alpha: { type: Number, default: 0.5 },
  /** 面积除数（越小密度越高） */
  densityDivisor: { type: Number, default: 1700 },
  /** 鼠标扰动半径 */
  mouseRadius: { type: Number, default: 150 },
  /** 连线距离阈值 */
  linkDistance: { type: Number, default: 150 },
})

const cv = ref<HTMLCanvasElement | null>(null)
let handle: ParticleFieldHandle | null = null

onMounted(() => {
  if (!cv.value) return
  handle = createParticleField(cv.value, {
    maxParticles: props.maxParticles,
    alpha: props.alpha,
    densityDivisor: props.densityDivisor,
    mouseRadius: props.mouseRadius,
    linkDistance: props.linkDistance,
  })
})

onUnmounted(() => {
  handle?.destroy()
  handle = null
})
</script>

<style scoped>
.particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.particle-canvas[hidden] {
  display: none;
}
</style>
