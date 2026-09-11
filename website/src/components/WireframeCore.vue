<template>
  <canvas ref="cv" class="wf-canvas" :class="{ 'is-off': off }" aria-hidden="true" />
</template>

<script setup lang="ts">
// website/src/components/WireframeCore.vue —— 零依赖 WebGL 线框核心（Vue 壳）
//   ★2026-09-11：官网「炫技」元素回归——旧版是粒子场 + 3D 萌宠（AI 感重）；改为**工程精确风**的
//   线框几何体（icosahedron）：单色品牌紫、慢速旋转、深度衰减、边缘流光——零第三方依赖（无 three.js）。
//   价值主张：官网即框架编译产物，这块手写 WebGL 是「同一套工程标准」的自证（参见 visual/wireframe.ts）。
//   降级链：WebGL 不可用 → 引擎返回 null → canvas 隐藏；prefers-reduced-motion → 静态单帧。
import { onMounted, onUnmounted, ref } from 'vue'
import { createWireframeCore, type WireframeHandle } from '../visual/wireframe'

const props = defineProps({
  /** 线框颜色（hex，如 '#7c5cff'） */
  color: { type: String, default: '#7c5cff' },
  /** 不透明度 */
  alpha: { type: Number, default: 0.62 },
  /** 旋转速度（弧度/秒） */
  speed: { type: Number, default: 0.22 },
})

const cv = ref<HTMLCanvasElement | null>(null)
const off = ref(false)
let handle: WireframeHandle | null = null

/** hex → 0..1 三元组（容错：非 hex 回退品牌紫） */
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0.486, 0.361, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

onMounted(() => {
  if (!cv.value) return
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  handle = createWireframeCore(cv.value, {
    color: hexToRgb01(props.color),
    alpha: props.alpha,
    speed: props.speed,
    still: reduce,
  })
  if (!handle) off.value = true // WebGL 不可用 → 隐藏 canvas（布局不受影响）
})

onUnmounted(() => {
  handle?.destroy()
  handle = null
})
</script>

<style scoped>
.wf-canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.wf-canvas.is-off { display: none; }
</style>
