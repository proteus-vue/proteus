<!-- src/components/p-svg-canvas/index.vue —— ★G-62 Canvas 通道运行时组件（2026-09-09）
     复杂 SVG 动画支持：离屏 canvas 逐帧绘制 → toDataURL → image src（rAF 驱动）。
     为什么不用可见 canvas：实测 SelectorQuery.node() 拿不到 node（正常运行时同样 TIMEOUT，§12.2 A）。
     诚实边界：回传是瓶颈（setData 18ms/次）→ 建议 ≤512px、目标 30fps；纯静态/整体变换请用 image 方案。 -->
<template>
  <image class="p-svg-canvas" :src="src" :style="imageStyle" mode="scaleToFill" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SvgScene } from './engine'
import { drawScene } from './engine'

const props = defineProps({
  /** 场景（编译期产出的 SvgScene） */
  scene: { type: Object as () => SvgScene | null, default: null },
  /** 画布宽 px（建议 ≤512——回传成本随尺寸增长） */
  width: { type: Number, default: 200 },
  /** 画布高 px */
  height: { type: Number, default: 200 },
  /** 目标帧率（默认 30——回传瓶颈下的平衡点） */
  fps: { type: Number, default: 30 },
  /** 是否播放（外部控制） */
  playing: { type: Boolean, default: true },
})

const src = ref('')
/** 已渲染帧数（调试/外部观察用——模拟器与真机均可读取） */
const frames = ref(0)
const imageStyle = computed(() => ({ width: props.width + 'px', height: props.height + 'px' }))

/** 离屏画布句柄（惰性创建） */
// ★实例属性（模块级变量在组件多实例场景会跨实例共享——改挂 this）
//   canvas/rafId/startTime/lastEmit 均通过 this 访问

function ensureCanvas(this: any): any {
  if (this.canvas) return this.canvas
  const w = wx as any
  if (typeof w.createOffscreenCanvas !== 'function') return null
  this.canvas = w.createOffscreenCanvas({ type: '2d', width: props.width, height: props.height })
  return this.canvas
}

/** 单帧绘制 + 回传 */
function renderFrame(this: any, tMs: number): void {
  const c = this.ensureCanvas()
  const scene = this.data.scene
  if (!c || !scene) return
  drawScene(c, scene, tMs)
  // 回传节流：按目标帧率 emit（回传 18ms/次——避免每帧都 setData）
  const minInterval = 1000 / Math.max(1, this.data.fps)
  if (this.__lastEmit === undefined || tMs - this.__lastEmit >= minInterval) {
    this.__lastEmit = tMs
    try {
      this.setData({ src: c.toDataURL('image/png') })
    } catch {
      /* toDataURL 失败忽略（下一帧重试） */
    }
  }
}

/** rAF 循环（this = 组件实例） */
/** 帧驱动（★实证：模拟器静止时 rAF 被节流——只跑 3 帧就停；setInterval 更可靠）
 *  真机/有交互时 rAF 正常，但为跨环境一致，统一用 setInterval（默认 30fps）。 */
function loop(this: any): void {
  if (!this.data.playing) return
  const now = Date.now()
  if (!this.__startTime) this.__startTime = now
  const elapsed = now - this.__startTime
  const dur = this.data.scene?.duration ?? 0
  try {
    this.renderFrame(dur > 0 ? elapsed % dur : elapsed)
    const n = (this.data.frames || 0) + 1
    this.setData({ frames: n })
    // 每 10 帧向页面上报（便于外部观察动画是否推进——模拟器/真机均可）
    if (n % 10 === 0 && this.triggerEvent) this.triggerEvent('tick', { frames: n })
  } catch {
    /* 单帧绘制失败忽略（下一帧重试） */
  }
}

function stop(this: any): void {
  if (this.__timer !== undefined) {
    clearInterval(this.__timer)
    this.__timer = undefined
  }
}

function play(this: any): void {
  const c = this.ensureCanvas()
  if (!c || this.__timer !== undefined) return
  this.__startTime = 0
  this.__lastEmit = undefined
  if (!this.__loop) this.__loop = loop.bind(this)
  const interval = Math.max(16, Math.round(1000 / Math.max(1, this.data.fps || 30)))
  this.__timer = setInterval(this.__loop, interval)
}

// ★显式启动（不依赖 watch immediate——编译器对 immediate watch 支持有限）：
//   onMounted → 组件 ready（属性已到位）→ 渲染首帧 + 启动 rAF。
onMounted(function (this: any) {
  if (!this.data.scene) return
  this.renderFrame(0) // 首帧立即出图（避免空白等待）
  if (this.data.playing) this.play()
})

// 场景/播放状态变化 → 重启
watch(
  () => [props.scene, props.playing] as const,
  function (this: any) {
    this.stop()
    if (this.data.scene && this.data.playing) this.play()
    else if (this.data.scene) this.renderFrame(0)
  },
)

onUnmounted(function (this: any) {
  this.stop()
})
</script>

<style scoped>
.p-svg-canvas {
  display: block;
}
</style>
