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
import { drawScene, shouldEmit } from './engine'

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

/** 设置 src（真机诊断：记录尾串，供页面显示） */
function setSrc(this: any, uri: string): void {
  if (!uri) return
  this.setData({ src: uri })
  this.__srcTail = String(uri).slice(-34)
}

/** 轮转清理：只保留最近 KEEP 个临时文件（当前显示的那个永不删），避免临时目录配额堆积 */
function pruneTempFiles(this: any, path: string): void {
  const KEEP = 24
  const ring: string[] = this.__ring || (this.__ring = [])
  ring.push(path)
  while (ring.length > KEEP) {
    const old = ring.shift()
    if (!old || old === this.data.src) continue
    try {
      const w = wx as unknown as { getFileSystemManager?: () => { unlink?: (o: { filePath: string; fail?: () => void }) => void } }
      const fs = typeof w.getFileSystemManager === 'function' ? w.getFileSystemManager() : null
      if (fs && typeof fs.unlink === 'function') fs.unlink({ filePath: old, fail: () => undefined })
    } catch {
      /* 清理失败不影响渲染 */
    }
  }
}

/** 前几帧探测：用 getImageInfo 确认该 src 在真机可解码（诊断用——失败说明是路径问题而非绘制问题） */
function probeSrc(this: any, uri: string): void {
  if ((this.__probeCount || 0) >= 2) return
  this.__probeCount = (this.__probeCount || 0) + 1
  const w = wx as unknown as { getImageInfo?: (o: { src: string; success?: (r: { width: number; height: number; path?: string }) => void; fail?: (e?: unknown) => void }) => void }
  if (typeof w.getImageInfo !== 'function') {
    this.__imgProbe = 'no-getImageInfo'
    return
  }
  try {
    w.getImageInfo({
      src: uri,
      success: (r) => {
        this.__imgProbe = `imgOK ${r.width}x${r.height} ${String(r.path || '').slice(-22)}`
      },
      fail: (e?: unknown) => {
        const msg = (e as { errMsg?: string })?.errMsg || String(e)
        this.__imgProbe = 'imgFAIL ' + msg.slice(0, 60)
      },
    })
  } catch (e) {
    this.__imgProbe = 'imgTHROW ' + String(e).slice(0, 40)
  }
}

/** 单帧回传：canvasToTempFilePath → src（失败回退 data-URI） */
function emitFrame(this: any, c: any): void {
  const w = wx as unknown as {
    canvasToTempFilePath?: (o: {
      canvas: unknown
      fileType?: string
      destWidth?: number
      destHeight?: number
      success?: (r: { tempFilePath: string }) => void
      fail?: (e?: unknown) => void
    }) => void
  }
  const toFile = w.canvasToTempFilePath
  if (typeof toFile !== 'function') {
    try {
      this.setSrc(c.toDataURL('image/png'))
    } catch {
      /* 通道不可用 */
    }
    return
  }
  try {
    toFile({
      canvas: c,
      fileType: 'png',
      destWidth: c.width,
      destHeight: c.height,
      success: (r) => {
        this.__emitCount = (this.__emitCount || 0) + 1
        this.__lastOk = Date.now()
        // ★2026-09-09 真机实证：src 必须是**裸 tempFilePath**——早期真机可渲染的形态正是
        //   `READ OK 120x120 wxxfile://tmp_...`（无查询参数）。两轮「真机空白」都恰好是拼了
        //   `?t=N` 之后：模拟器路径是 http://tmp/...（拼参数无碍），真机是 wxfile://（拼参数失效）。
        this.setSrc(r.tempFilePath)
        this.pruneTempFiles(r.tempFilePath)
        this.probeSrc(r.tempFilePath)
      },
      fail: (e?: unknown) => {
        this.__failCount = (this.__failCount || 0) + 1
        this.__lastErr = 'tmpFAIL ' + String(e).slice(0, 90)
        // 回退 data-URI（真机长串可能渲染失败，仅作最后手段——诊断计数会暴露）
        try {
          this.setSrc(c.toDataURL('image/png'))
        } catch {
          /* 两种通道都失败——下一帧重试 */
        }
      },
    })
  } catch (e) {
    this.__failCount = (this.__failCount || 0) + 1
    this.__lastErr = 'tmpTHROW ' + String(e).slice(0, 90)
    try {
      this.setSrc(c.toDataURL('image/png'))
    } catch {
      /* 同上 */
    }
  }
}

/** 单帧绘制 + 回传
 *  @param tMs   动画相位时间（elapsed % duration——供插值）
 *  @param rawMs 单调递增的真实经过时间（节流用；缺省取 tMs） */
function renderFrame(this: any, tMs: number, rawMs?: number): void {
  const c = this.ensureCanvas()
  const scene = this.data.scene
  if (!c || !scene) return
  drawScene(c, scene, tMs)
  // ★2026-09-09 真机「15 秒后动画停止」根因之一：节流曾用 tMs（= elapsed % duration）比较，
  //   动画跑完一个周期后相位回绕 → 差值恒为负 → src 永久停更（帧数照跑，故看似仍在动）。
  //   节流必须用**单调时间**（rawMs）。
  const now = typeof rawMs === 'number' ? rawMs : tMs
  if (shouldEmit(this.__lastEmit, now, this.data.fps)) {
    this.__lastEmit = now
    this.emitFrame(c)
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
    this.renderFrame(dur > 0 ? elapsed % dur : elapsed, elapsed)
    const n = (this.data.frames || 0) + 1
    this.setData({ frames: n })
    // 每 10 帧向页面上报（便于外部观察动画是否推进——模拟器/真机均可）
    // ★2026-09-09 真机诊断：附带回传通道计数/最后错误/src 尾串/前两帧解码探测结果，
    //   页面直接显示即可区分「写入失败」与「渲染失败」。
    if (n % 10 === 0 && this.triggerEvent) {
      this.triggerEvent('tick', {
        frames: n,
        emits: this.__emitCount || 0,
        fails: this.__failCount || 0,
        err: this.__lastErr || '',
        img: this.__imgProbe || '',
        src: this.__srcTail || '',
      })
    }
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
