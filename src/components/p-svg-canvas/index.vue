<!-- src/components/p-svg-canvas/index.vue —— ★G-62 Canvas 通道运行时组件（2026-09-09）
     复杂 SVG 动画支持：离屏 canvas 逐帧绘制 → toDataURL → image src（rAF 驱动）。
     为什么不用可见 canvas：实测 SelectorQuery.node() 拿不到 node（正常运行时同样 TIMEOUT，§12.2 A）。
     诚实边界：回传是瓶颈（setData 18ms/次）→ 建议 ≤512px、目标 30fps；纯静态/整体变换请用 image 方案。 -->
<template>
  <!-- ★2026-09-09 真机反馈「点击没反应」：Skyline 下 image 是原生组件会吞触摸——
       内部捕获 tap 后 triggerEvent 透传，外层父容器的 bind:tap 才收得到 -->
  <image class="p-svg-canvas" :src="src" :style="imageStyle" mode="scaleToFill" @tap="onInnerTap" />
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
  /** 目标帧率（默认 20——平衡流畅度与 I/O；每帧需 PNG 编码 + setData） */
  fps: { type: Number, default: 20 },
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
  // ★2026-09-09 真机反馈「整体太模糊」：画布内部分辨率须按 DPR 放大（否则 2x/3x 屏上被拉伸模糊）。
  //   CSS 尺寸不变（image 按 width/height 显示），内部分辨率 = CSS × dpr，绘制时 ctx.scale(dpr)。
  let dpr = 1
  try {
    const info = typeof w.getWindowInfo === 'function' ? w.getWindowInfo() : w.getSystemInfoSync()
    dpr = Number(info && info.pixelRatio) || 1
    if (dpr > 3) dpr = 3 // 上限（内存/性能平衡）
  } catch {
    dpr = 1
  }
  this.__dpr = dpr
  try {
    this.canvas = w.createOffscreenCanvas({
      type: '2d',
      width: Math.round(this.data.width * dpr),
      height: Math.round(this.data.height * dpr),
    })
  } catch {
    return null
  }
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
    // ★2026-09-09 真机实证：真机 <image> 渲染 canvasToTempFilePath 的**临时文件路径**比 data-URI 更可靠
    //   （data-URI 长字符串在真机 setData 可能被截断/渲染失败——真机帧数在跑但图形不显示）；
    //   模拟器两者均可。优先 tempFilePath，失败回退 data-URI。
    const emit = (uri: string): void => {
      if (uri) this.setData({ src: uri })
    }
    try {
      const w = wx as unknown as {
        env?: { USER_DATA_PATH?: string }
        canvasToTempFilePath?: (o: {
          canvas: unknown
          fileType?: string
          destWidth?: number
          destHeight?: number
          filePath?: string
          success?: (r: { tempFilePath: string }) => void
          fail?: (e?: unknown) => void
        }) => void
      }
      // ★2026-09-09 真机两轮实证：
      //   ① 每帧新临时文件 → 150 帧（≈7.5MB）后堆积超配额 → 停止；
      //   ② 固定 filePath 复用同一文件 → image 正在读取时无法覆盖写入 → 渲染失败（空白）。
      //   → 采用**轮转 N 个文件**：文件数有上限（不堆积），且写入时该文件已不被 image 占用（不冲突）。
      const ROTATE = 4
      this.__slot = ((this.__slot || 0) + 1) % ROTATE
      const tmpName = `proteus-svg-${this.__slot}.png`
      const basePath = (w.env && w.env.USER_DATA_PATH) || ''
      const toFile = w.canvasToTempFilePath
      if (typeof toFile === 'function') {
        toFile({
          canvas: c,
          fileType: 'png',
          destWidth: c.width,
          destHeight: c.height,
          filePath: basePath ? `${basePath}/${tmpName}` : undefined,
          success: (r) => {
            this.__emitCount = (this.__emitCount || 0) + 1
            this.__lastOk = Date.now()
            // src 加查询参数强制重载（轮转路径本身已变，加参数双保险）
            emit(r.tempFilePath + '?t=' + this.__emitCount)
          },
          fail: (e?: unknown) => {
            this.__failCount = (this.__failCount || 0) + 1
            this.__lastErr = String(e).slice(0, 120)
            // ★回退：不带 filePath 的默认临时文件（真机可渲染，仅会堆积——轮转失败时才走此路）
            toFile({
              canvas: c,
              success: (r2) => emit(r2.tempFilePath),
              fail: () => emit(c.toDataURL('image/png')),
            })
          },
        })
      } else {
        emit(c.toDataURL('image/png'))
      }
    } catch {
      try {
        emit(c.toDataURL('image/png'))
      } catch {
        /* 两种通道都失败——下一帧重试 */
      }
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

/** ★内部 tap → triggerEvent('tap')：编译期把源码 <svg @tap> 透传为 <p-svg-canvas bind:tap>，
 *  组件内部捕获原生 image 触摸后抛同名事件（微信自定义事件默认不冒泡，故由组件直接抛给监听方） */
function onInnerTap(this: any, e: unknown): void {
  this.triggerEvent('tap', (e as { detail?: unknown })?.detail ?? {})
}
</script>

<style scoped>
.p-svg-canvas {
  display: block;
}
</style>
