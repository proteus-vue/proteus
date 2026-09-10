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
  /** ★2026-09-10 播放速率（外部控制）：1 = 原速；<1 慢放；>1 快放；0 = 定格；负数 = 倒放。
   *  以「相位时钟」累加（dt × speed）→ 变速不跳帧（相不突变）。 */
  speed: { type: Number, default: 1 },
  /** ★2026-09-10 相位种子（外部控制，0..1 归一化）：变化时把动画相位跳到该周期位置。
   *  用于**动作切换的相位连续**（走→跑时腿部不回到起点，承接上一动作的周期位置）。
   *  -1 = 不设种子（默认，从当前相位继续）。 */
  progress: { type: Number, default: -1 },
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

/** 首次回传前清理上一会话遗留的 proteus-svg-*.png（USER_DATA_PATH 持久——跨会话会累积）。
 *  只跑一次；失败静默（不影响渲染）。 */
function cleanupStale(this: any): void {
  if (this.__cleaned) return
  this.__cleaned = true
  try {
    const w = wx as unknown as {
      env?: { USER_DATA_PATH?: string }
      getFileSystemManager?: () => {
        readdirSync?: (p: string) => string[]
        unlink?: (o: { filePath: string; success?: () => void; fail?: (e?: unknown) => void }) => void
      }
    }
    const base = w.env && w.env.USER_DATA_PATH
    const fs = typeof w.getFileSystemManager === 'function' ? w.getFileSystemManager() : null
    if (!base || !fs || typeof fs.readdirSync !== 'function' || typeof fs.unlink !== 'function') return
    let names: string[] = []
    try {
      names = fs.readdirSync(base) || []
    } catch {
      return
    }
    const prefix = 'proteus-svg-'
    for (const n of names) {
      if (n.indexOf(prefix) === 0) fs.unlink({ filePath: `${base}/${n}`, fail: () => undefined })
    }
  } catch {
    /* 清理失败静默 */
  }
}

/** 设置 src（真机诊断：记录尾串，供页面显示）
 *  ★帧数与 src 合并为一次 setData——setData 是回传瓶颈，避免每帧两次桥接 */
function setSrc(this: any, uri: string): void {
  if (!uri) return
  this.setData({ src: uri, frames: this.__frames || 0 })
  this.__srcTail = String(uri).slice(-34)
}

/** 清理超龄临时文件（只保留最近 KEEP 个，当前显示的那个永不删）。
 *  ★文件名唯一（seq 自增）→ src 永不重复 → image 必然重载（无需查询参数——那会导致真机 wxfile:// 不渲染）。
 *  ★写入用 USER_DATA_PATH（filePath 参数）→ 该目录可 unlink（实证）；默认 http://tmp/ 文件 unlink 权限不足。
 *  模拟器忽略 filePath（返回 http://tmp/）→ 此处 unlink 失败静默（模拟器无配额问题，不影响渲染）。 */
function pruneTempFiles(this: any, path: string): void {
  const KEEP = 24
  const ring: string[] = this.__ring || (this.__ring = [])
  ring.push(path)
  while (ring.length > KEEP) {
    const old = ring.shift()
    if (!old || old === this.data.src) continue
    try {
      const w = wx as unknown as {
        getFileSystemManager?: () => { unlink?: (o: { filePath: string; success?: () => void; fail?: (e?: unknown) => void }) => void }
      }
      const fs = typeof w.getFileSystemManager === 'function' ? w.getFileSystemManager() : null
      if (fs && typeof fs.unlink === 'function') {
        fs.unlink({
          filePath: old,
          success: () => {
            this.__pruned = (this.__pruned || 0) + 1
          },
          fail: (e?: unknown) => {
            this.__pruneErr = ((e as { errMsg?: string })?.errMsg || String(e)).slice(0, 60)
          },
        })
      }
    } catch (e) {
      this.__pruneErr = String(e).slice(0, 60)
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

/** 单帧回传：canvasToTempFilePath → src（失败回退 data-URI）
 *  ★在途保护（长跑关键）：一次转换未完成前不再发起下一帧——防止编码耗时>间隔时任务无限堆积
 *  （大画布/真机 PNG 编码慢于帧间隔时，无保护会积压 → 内存上涨/卡顿）。
 *  @returns 是否已发起本次回传（false = 在途未完成或通道不可用） */
function emitFrame(this: any, c: any): boolean {
  if (this.__converting) return false
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
  const toFile = w.canvasToTempFilePath
  if (typeof toFile !== 'function') {
    try {
      this.setSrc(c.toDataURL('image/png'))
      return true
    } catch {
      return false
    }
  }
  // ★文件名唯一（seq 自增）→ src 永不重复 → image 必然重载（不靠查询参数——真机 wxfile:// 拼参数不渲染）。
  // ★filePath 指向 USER_DATA_PATH：该目录可 unlink（实证）→ 清理有效、文件有界；
  //   默认临时目录（http://tmp/）不可 unlink（模拟器实测 permission denied）→ 会堆积。
  //   模拟器忽略 filePath（返回 http://tmp/）→ 清理静默失败，但模拟器无配额问题。
  this.__seq = (this.__seq || 0) + 1
  const basePath = (w.env && w.env.USER_DATA_PATH) || ''
  if (basePath) this.cleanupStale() // 首次：清上一会话遗留（同一稳定前缀）
  const filePath = basePath ? `${basePath}/proteus-svg-${this.__seq}.png` : undefined
  this.__converting = true
  this.__issued = (this.__issued || 0) + 1
  try {
    toFile({
      canvas: c,
      fileType: 'png',
      destWidth: c.width,
      destHeight: c.height,
      filePath,
      success: (r) => {
        this.__converting = false
        this.__emitCount = (this.__emitCount || 0) + 1
        this.__lastOk = Date.now()
        // ★src 必须**裸 tempFilePath**（无查询参数——真机 wxfile:// 拼参数不渲染，两轮「真机空白」根因）
        this.setSrc(r.tempFilePath)
        this.pruneTempFiles(r.tempFilePath)
        this.probeSrc(r.tempFilePath)
      },
      fail: (e?: unknown) => {
        this.__converting = false
        this.__failCount = (this.__failCount || 0) + 1
        this.__lastErr = 'tmpFAIL ' + String(e).slice(0, 90)
        // 回退：不带 filePath 的默认临时文件（真机可渲染，仅会堆积——filePath 通道失败才走此路）
        try {
          toFile({
            canvas: c,
            fileType: 'png',
            destWidth: c.width,
            destHeight: c.height,
            success: (r2) => this.setSrc(r2.tempFilePath),
            fail: () => this.setSrc(c.toDataURL('image/png')),
          })
        } catch {
          try {
            this.setSrc(c.toDataURL('image/png'))
          } catch {
            /* 三种通道都失败——下一帧重试 */
          }
        }
      },
    })
    return true
  } catch (e) {
    this.__converting = false
    this.__failCount = (this.__failCount || 0) + 1
    this.__lastErr = 'tmpTHROW ' + String(e).slice(0, 90)
    try {
      this.setSrc(c.toDataURL('image/png'))
    } catch {
      /* 同上 */
    }
    return true
  }
}

/** 单帧绘制 + 回传
 *  @param tMs   动画相位时间（elapsed % duration——供插值）
 *  @param rawMs 单调递增的真实经过时间（节流用）
 *  @returns 是否已发起回传
 *  ★性能（长跑关键）：**先判节流再绘制**——不需要回传的帧直接跳过，不做无谓的 drawScene
 *  （模拟器高帧率下少一半绘制量；真机 20fps 节流时更是省去约一半绘制 + 全部 PNG 编码）。 */
function renderFrame(this: any, tMs: number, rawMs: number): boolean {
  // ★2026-09-09 真机「15 秒后动画停止」根因之一：节流曾用 tMs（= elapsed % duration）比较，
  //   动画跑完一个周期后相位回绕 → 差值恒为负 → src 永久停更（帧数照跑，故看似仍在动）。
  //   节流必须用**单调时间**（rawMs）+ 容差（定时器抖动）。
  if (!shouldEmit(this.__lastEmit, rawMs, this.data.fps, 4)) return false
  // 在途未完成 → 本帧不绘制（下一帧重试）——避免堆积，也避免画了白发
  if (this.__converting) return false
  const c = this.ensureCanvas()
  const scene = this.data.scene
  if (!c || !scene) return false
  this.__lastEmit = rawMs
  drawScene(c, scene, tMs)
  return this.emitFrame(c)
}

/** rAF 循环（this = 组件实例） */
/** 帧驱动（★实证：模拟器静止时 rAF 被节流——只跑 3 帧就停；setInterval 更可靠）
 *  真机/有交互时 rAF 正常，但为跨环境一致，统一用 setInterval（默认 30fps）。 */
function loop(this: any): void {
  const now = Date.now()
  // ★时钟先更新（即使暂停）——避免恢复播放/切到该场景时 dt 累积成巨值 → 相位跳变
  if (!this.__lastTick) this.__lastTick = now
  const dt = now - this.__lastTick
  this.__lastTick = now
  if (!this.data.playing) return // 暂停：停表（不绘制不回传），但定时器保持存活（切到该场景即可续播）
  // ★2026-09-10 播放速率：相位时钟按 dt × speed 累加（变速不跳帧——相位连续，不因 speed 突变而跳变）。
  //   speed=0 定格、负数倒放。★节流用**单调时钟** __clock（恒增），绘制用相位 __phase（可负/可停）——
  //   倒放时相位递减，若拿相位做节流会恒不满足 → 冻结，故两者必须分开。
  const speed = typeof this.data.speed === 'number' ? this.data.speed : 1
  this.__clock = (this.__clock || 0) + dt
  this.__phase = (this.__phase || 0) + dt * speed
  const dur = this.data.scene?.duration ?? 0
  const phase = this.__phase
  try {
    const n = (this.__frames || 0) + 1
    this.__frames = n
    // ★帧数与 src 合并为一次 setData（setSrc）——回传发起时由 setSrc 一并写入；
    //   未发起回传（在途保护/节流跳过）时才单独补一次，避免每帧两次桥接。
    const emitted = this.renderFrame(dur > 0 ? ((phase % dur) + dur) % dur : phase, this.__clock)
    if (!emitted) this.setData({ frames: n })
    // 每 10 帧向页面上报；但**相位进度每 2 帧上报**（动作切换要按当前进度承接相位——
    //   10 帧（0.5s）粒度太粗，1.2s 周期下最多偏 40%，切换会明显跳）。
    // ★2026-09-09 真机诊断：附带回传通道计数（issued/emits/fails——issued-(emits+fails)=在途）、
    //   最后错误、src 尾串、前两帧解码探测——页面直接显示即可判断写入/渲染哪一步失败、是否积压。
    const heavy = n % 10 === 0
    const light = n % 2 === 0
    if ((heavy || light) && this.triggerEvent) {
      this.triggerEvent('tick', {
        frames: n,
        progress: dur > 0 ? ((phase % dur) + dur) % dur / dur : 0,
        ...(heavy
          ? {
              emits: this.__emitCount || 0,
              fails: this.__failCount || 0,
              issued: this.__issued || 0,
              pruned: this.__pruned || 0,
              pruneErr: this.__pruneErr || '',
              err: this.__lastErr || '',
              img: this.__imgProbe || '',
              src: this.__srcTail || '',
            }
          : {}),
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
  // ★相位**保留**（不重置）——暂停再播 / 动作切回时从冻结相位继续；
  //   需要跳到特定周期位置时由 progress 种子显式设置（见下 watch）。
  this.__lastTick = 0
  this.__lastEmit = undefined
  if (!this.__loop) this.__loop = loop.bind(this)
  const interval = Math.max(16, Math.round(1000 / Math.max(1, this.data.fps || 30)))
  this.__timer = setInterval(this.__loop, interval)
}

// ★显式启动（不依赖 watch immediate——编译器对 immediate watch 支持有限）：
//   onMounted → 组件 ready（属性已到位）→ 渲染首帧 + **总是启动定时器**。
//   ★2026-09-10：定时器常驻（loop 内按 playing 停表）——因为编译器的 prop-watch 不可靠
//   （`watch(() => [props.a, props.b])` / `watch(() => props.x)` 均编译不出 observer），
//   故不能靠 watch 在「playing 由 false→true」时启动定时器；常驻定时器由 loop 读 playing 决定是否绘制。
onMounted(function (this: any) {
  if (!this.data.scene) return
  this.__lastEmit = undefined
  this.renderFrame(0, 0) // 首帧立即出图（避免空白等待）
  this.play()
})

// ★相位种子：progress(0..1) 变化 → 相位跳到该周期位置（动作切换的相位连续）。
//   ★回调参数不用（编译器 prop-watch 回调首参绑定不可靠）——直接读 this.data.progress。
watch(
  () => props.progress,
  function (this: any) {
    const p = this.data.progress
    if (typeof p !== 'number' || p < 0) return
    const dur = (this.data.scene && this.data.scene.duration) || 0
    if (dur <= 0) return
    this.__phase = p * dur
    this.__lastEmit = undefined // 强制立即出图（暂停态也能看到新相位）
    this.renderFrame(this.__phase % dur, this.__clock || 0)
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
