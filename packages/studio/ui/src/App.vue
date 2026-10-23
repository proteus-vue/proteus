<script setup lang="ts">
// Studio 壳（决策 #1183）：纯 Vue 3 + Vite，**不接 Proteus**（自举死锁的红线）。
// 布局仍是「顶部条 / 左栏 / 画布 / 右栏 / 状态栏」，画布位置由 HTML 驱动原生视图。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { setCanvasRect } from './bridge'
import { ms, num, pct, useStats } from './useStats'
import DevicePanel from './panels/DevicePanel.vue'
import PipelinePanel from './panels/PipelinePanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import InspectorPanel from './panels/InspectorPanel.vue'
import CodePanel from './panels/CodePanel.vue'
import StudioIcon from './icons/StudioIcon.vue'
import { clampZoom, hydrateWorkspace, useWorkspaceState, type ViewName } from './useWorkspaceState'

const { stats, error, hasBridge } = useStats(500)
const rect = ref('—')
const canvasEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

/** ★G5：视图状态存在工作区会话里（重启恢复），不再是组件内的临时 ref。
 *  ★切到 code 时必须把**原生视图**收成 0×0 —— 它是叠在 HTML 之上的独立 NSView，
 *    只隐藏 HTML 里的 #canvas 是盖不住它（会看到 GL 画面浮在代码面板上）。 */
const ws = useWorkspaceState()
const view = computed(() => ws.view)

/* ─── 设备画面：**等比**适配 + 缩放（2026-10-23 · 生产验收标准）─────────────────
 *
 * 【为什么必须做】原生视图之前是「main 区减去 20px 内边距」的一整块，而 blit 把纹理
 *   **铺满整个视口** ⇒ 画面被拉伸成视口的宽高比。这不是观感问题，是**画面失真**：
 *     · Android 1280x720 (1.78) 塞进约 1.25 的方形区 ⇒ 纵向拉伸约 40%；
 *     · iPhone 888x1920 (0.4625) 塞进同一区域 ⇒ 横向拉伸约 2.7 倍。
 *   为什么一直没被发现：`poc_dump` 读的是 **FBO（g_canvas 纹理）**而不是屏幕，
 *   dump 出来的像素永远正确，只有人眼看窗口才看得出变形。
 *
 * 【怎么修】让原生视图**只占设备那一块**：HTML 侧按设备宽高比算出矩形，
 *   原生视图跟着走 ⇒ 视口宽高比 == 画面宽高比 ⇒ 像素 1:1（无拉伸、无黑边）。
 *   原生侧同时加了等比兜底（embed_view.m 的 uFit），万一两边漂移也只留黑边、绝不变形。
 */
const stageBox = ref({ w: 0, h: 0 })
/** 设备宽高比；0 = 还没收到首帧（占满舞台，与旧行为一致） */
const devAspect = computed(() => {
  const s = stats.value
  return s && s.width > 0 && s.height > 0 ? s.width / s.height : 0
})

/* ─── 拖拽平移（配合缩放）──────────────────────────────────────────────────
 * 【为什么在前端做】B1 曾在原生侧接 mouseDown，但 GL 视图是
 *   `addSubview ... NSWindowBelow` 挂的（在所有兄弟视图最下面），而 webview 铺满 contentView
 *   ⇒ 真实点击全被 webview 吃掉，那个回调**一次都不会触发**。
 *   `#canvas` 是真实 DOM 元素、有真实几何，pointer 事件直接在这里处理最简单也最可靠。
 * 【为什么不持久化 pan】平移是"看哪里"的一次性手势，不是工作区偏好；
 *   重启后仍旧居中才是符合预期的（缩放会持久化，因为它代表"看多大"）。
 */
const pan = ref({ x: 0, y: 0 })

/** 屏幕实际尺寸（px）：contain 适配 × 缩放。`0` = 还没量到舞台 */
const screenSize = computed(() => {
  const { w, h } = stageBox.value
  if (!w || !h) return { w: 0, h: 0 }
  const ar = devAspect.value
  if (!ar) return { w, h }
  const fitW = Math.min(w, h * ar) * ws.zoom
  return { w: fitW, h: fitW / ar }
})
/** 平移上限：屏幕比舞台大才允许移动，且最多把边缘拖到舞台边缘（图像查看器的常规手感） */
function panLimit() {
  const st = stageBox.value
  const s = screenSize.value
  return { x: Math.max(0, (s.w - st.w) / 2), y: Math.max(0, (s.h - st.h) / 2) }
}
function clampPan(p: { x: number; y: number }) {
  const l = panLimit()
  return { x: Math.max(-l.x, Math.min(l.x, p.x)), y: Math.max(-l.y, Math.min(l.y, p.y)) }
}

const screenStyle = computed(() => {
  const { w, h } = screenSize.value
  // contain：两轴同一缩放 ⇒ 等比。**只 round 算式不 round 结果**（保留两位小数），
  // 否则 w/h 各自取整会把比例拧出最多 1px 的误差，等比判据就变得可疑。
  const size = w
    ? { width: `${w.toFixed(2)}px`, height: `${h.toFixed(2)}px` }
    : { width: '100%', height: '100%' }
  // 平移用 transform：不改布局 ⇒ `.screen` 仍是 flex 居中的那个元素，
  // 而 getBoundingClientRect **含 transform** ⇒ 原生矩形自动跟随。
  return { ...size, transform: `translate(${pan.value.x}px, ${pan.value.y}px)` }
})
const zoomLabel = computed(() =>
  Math.abs(ws.zoom - 1) < 0.001 ? '适应' : `${Math.round(ws.zoom * 100)}%`,
)
function setZoom(z: number) {
  ws.zoom = clampZoom(z)
  pan.value = clampPan(pan.value)
  void syncRect()
}

/** 画布矩形：HTML 定布局，原生跟随（#1173 的接线，这里只是搬到 Vue 里） */
async function syncRect() {
  const stage = stageEl.value
  if (!stage || view.value !== 'device') return
  // ① 先量**舞台**（决定屏幕该多大）→ ② 等 Vue 把新尺寸刷到 DOM → ③ 再量屏幕
  //   ★顺序不能反：直接量 #canvas 拿到的是**上一轮**的尺寸，缩放/改窗口时会慢一拍，
  //     而慢一拍的表现是"画面比边框大一点"（原生视图跟着旧矩形走）。
  const sb = stage.getBoundingClientRect()
  if (sb.width !== stageBox.value.w || sb.height !== stageBox.value.h) {
    stageBox.value = { w: sb.width, h: sb.height }
  }
  await nextTick()
  const el = canvasEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  rect.value = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`
  try {
    await setCanvasRect({ x: r.x, y: r.y, w: r.width, h: r.height })
  } catch {
    /* 没桥时静默：面板本身还要能看（Playwright / 浏览器直开） */
  }
}

async function switchView(v: ViewName) {
  ws.view = v
  if (v === 'code') {
    rect.value = '—'
    try {
      await setCanvasRect({ x: 0, y: 0, w: 0, h: 0 })
    } catch {
      /* 没桥时静默 */
    }
  } else {
    // ★等 DOM 把 #canvas 渲染回来再量（否则 canvasEl 还是 null）
    await nextTick()
    void syncRect()
  }
}

/* 缩放快捷键（IDE 通用）：⌘0 适应 / ⌘= 放大 / ⌘- 缩小。
   ★只在设备视图生效——代码视图里 ⌘- 该留给「编辑器字号」，不能在这里抢。 */
function onKey(e: KeyboardEvent) {
  if (view.value !== 'device' || !(e.metaKey || e.ctrlKey)) return
  if (e.key === '0') {
    e.preventDefault()
    setZoom(1)
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault()
    setZoom(ws.zoom + 0.25)
  } else if (e.key === '-') {
    e.preventDefault()
    setZoom(ws.zoom - 0.25)
  }
}

let rectTimer: ReturnType<typeof setInterval> | undefined
/** ★首帧到达 ⇒ 设备比例从"未知"变成真值 ⇒ 屏幕矩形变了 ⇒ **必须立刻**重新同步原生视图。
 *  只靠 1s 的兜底定时器会出现最多 1 秒的"画面仍按满屏拉伸"的窗口，
 *  而那一秒恰好是用户第一次看到画面的时刻。 */
watch(devAspect, () => {
  void syncRect()
})
/** 平移是高频事件（pointermove 可达 120Hz）：用 rAF 合并成每帧一次 IPC。
 *  不合并的话每个 pointermove 都发一次 set_canvas_rect，原生侧跟着改视图 frame —— 白烧 CPU。 */
let rafId = 0
function scheduleSync() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    void syncRect()
  })
}
watch(pan, scheduleSync)

/** 指针输入（点选落点 + 拖拽平移）。坐标一律折算成**设备像素** ——
 *  这是设备检查器真正关心的量（"我点的这个点在设备上是第几个像素"），
 *  而不是 CSS px（同一台设备在 100% / 200% 缩放下 CSS 值会变，设备值不会）。 */
const pick = ref<{ x: number; y: number } | null>(null)
let drag: { id: number; x0: number; y0: number; px: number; py: number } | null = null

function toDevice(e: PointerEvent): { x: number; y: number } | null {
  const el = canvasEl.value
  const d = stats.value
  if (!el || !d || d.width <= 0 || d.height <= 0) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return {
    x: Math.round(((e.clientX - r.left) / r.width) * d.width),
    y: Math.round(((e.clientY - r.top) / r.height) * d.height),
  }
}

function onPointerDown(e: PointerEvent) {
  const p = toDevice(e)
  if (p) pick.value = p
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px: pan.value.x, py: pan.value.y }
  try {
    e.currentTarget instanceof HTMLElement && e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* 合成事件（测试）没有真实 pointerId，捕获失败不影响逻辑 */
  }
}

function onPointerMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  pan.value = clampPan({
    x: drag.px + (e.clientX - drag.x0),
    y: drag.py + (e.clientY - drag.y0),
  })
}

function onPointerUp(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  drag = null
  try {
    e.currentTarget instanceof HTMLElement && e.currentTarget.releasePointerCapture(e.pointerId)
  } catch {
    /* 同上 */
  }
}

onMounted(async () => {
  // ★先恢复上次的视图，再量画布：顺序反了会先按设备视图同步一次 rect，
  //   而恢复成 code 视图时那次同步是白做的（还会让原生画布闪一下）。
  await hydrateWorkspace()
  await nextTick()
  if (view.value === 'device') await syncRect()
  else await setCanvasRect({ x: 0, y: 0, w: 0, h: 0 }).catch(() => {})
  rectTimer = setInterval(syncRect, 1000)
  addEventListener('resize', syncRect)
  addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  if (rectTimer) clearInterval(rectTimer)
  if (rafId) cancelAnimationFrame(rafId)
  removeEventListener('resize', syncRect)
  removeEventListener('keydown', onKey)
})

/** 点击标记的百分比位置（相对设备屏幕，不用关心舞台的像素值与平移） */
const pickStyle = computed(() => {
  const p = pick.value
  const d = stats.value
  if (!p || !d || d.width <= 0 || d.height <= 0) return null
  return { left: `${(p.x / d.width) * 100}%`, top: `${(p.y / d.height) * 100}%` }
})

const running = computed(() => (stats.value?.frames ?? 0) > 0)
const linkText = computed(() => (!hasBridge ? '未连接 IPC' : running.value ? '画布运行中' : '等待首帧'))
const hint = computed(() => {
  if (error.value) return 'stats 调用失败：' + error.value
  if (!hasBridge) return '无 Tauri 桥（浏览器直开时属正常）'
  return running.value ? '原生画布运行中 · 60Hz 调度 · VT 解码' : '等待原生画布…'
})
/** 画面角标：一眼知道"这是什么流"，不用去右栏找 */
const hud = computed(() => {
  const s = stats.value
  if (!s || s.width <= 0 || s.height <= 0) return '无画面'
  return `${s.width}×${s.height} · ${s.hwdec ? '硬解' : '软解'}`
})
</script>

<template>
  <div class="app">
    <div class="top">
      <div class="brand">Proteus <span>Studio</span></div>
      <div class="chip"><span class="dot" :class="{ off: !running }" /><span id="linkChip">{{ linkText }}</span></div>
      <div class="chip">镜像 60fps 上限</div>
      <div style="flex:1" />
      <div class="chip">画布由 HTML 布局驱动 · 等比适配</div>
    </div>

    <div class="rail">
      <button
        :class="{ on: view === 'device' }"
        :aria-pressed="view === 'device'"
        aria-label="设备画布"
        title="设备画布"
        @click="switchView('device')"
      >
        <StudioIcon name="device" :size="18" />
      </button>
      <button
        :class="{ on: view === 'code' }"
        :aria-pressed="view === 'code'"
        aria-label="代码（只读）"
        title="代码（只读）"
        @click="switchView('code')"
      >
        <StudioIcon name="code" :size="18" />
      </button>
      <div class="sep" />
      <button aria-label="断言（未实现）" title="断言（未实现）" disabled><StudioIcon name="assert" :size="18" /></button>
      <button aria-label="录制（未实现）" title="录制（未实现）" disabled><StudioIcon name="record" :size="18" /></button>
    </div>

    <div class="main">
      <template v-if="view === 'device'">
        <!-- 舞台：只负责居中与留白；设备屏幕（#canvas）是它的等比子元素 -->
        <div class="stage" ref="stageEl">
          <div class="screen" :style="screenStyle">
            <!-- ★画布洞：这块必须保持透明——原生 GL 视图就垫在它后面。
                 ★指针事件在这里收（不是原生侧）：GL 视图挂在 webview **下面**，
                   真实点击永远先到 webview ⇒ 前端才是唯一有效的输入源。 -->
            <div
              id="canvas"
              ref="canvasEl"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            />
            <!-- 点击落点标记（输入通路已通的可见证据；元素信息要等设备侧视图树） -->
            <div class="picks">
              <div v-if="pickStyle" class="pick" :style="pickStyle" id="pickMark" />
            </div>
          </div>
          <!-- 空状态：生产 IDE 必须有——不然用户看到纯黑会以为坏了 -->
          <div v-if="!running" class="empty">
            <StudioIcon name="device" :size="28" />
            <p>等待首帧</p>
            <span v-if="!hasBridge">无 Tauri 桥（浏览器直开时属正常）</span>
            <span v-else>没有输入源：接 Android（adb）或 iPhone（--stream）</span>
          </div>
        </div>

        <div class="hud" id="hud">{{ hud }}</div>

        <!-- 缩放：相对的「适应」倍数；比例永远由设备决定，缩放只改大小 -->
        <div class="zoom">
          <button
            aria-label="缩小"
            title="缩小（⌘-）"
            :disabled="ws.zoom <= 0.25"
            @click="setZoom(ws.zoom - 0.25)"
          >
            <StudioIcon name="zoomOut" :size="15" />
          </button>
          <button class="lbl" title="恢复「适应窗口」（⌘0）" @click="setZoom(1)">
            <span id="zoomLabel">{{ zoomLabel }}</span>
          </button>
          <button
            aria-label="放大"
            title="放大（⌘=）"
            :disabled="ws.zoom >= 4"
            @click="setZoom(ws.zoom + 0.25)"
          >
            <StudioIcon name="zoomIn" :size="15" />
          </button>
          <div class="sep" />
          <button aria-label="适应窗口" title="适应窗口（⌘0）" @click="setZoom(1)">
            <StudioIcon name="fit" :size="15" />
          </button>
        </div>
      </template>
      <!-- ★`v-show` 而不是 `v-if`：切到设备视图时**不能卸载**代码面板——
           卸载会销毁 EditorView，未保存的编辑就静默丢了。
           代价：代码面板在设备视图下也保持挂载（display:none），CM 自己的 ResizeObserver
           会在重新可见时重新测量，不需要额外通知。 -->
      <CodePanel v-show="view === 'code'" />
    </div>

    <div class="side">
      <DevicePanel :s="stats" />
      <PipelinePanel :s="stats" />
      <RuntimePanel :s="stats" />
      <InspectorPanel />
    </div>

    <div class="status">
      <span><span class="k">canvas</span> <span id="srect">{{ rect }}</span></span>
      <span><span class="k">frames</span> <span id="sframes">{{ stats?.frames ?? 0 }}</span></span>
      <span><span class="k">fps</span> <span id="sfps">{{ stats ? num(stats.fps, 1) : '—' }}</span></span>
      <span><span class="k">lat</span> <span id="slat">{{ stats ? ms(stats.lat_p50) : '—' }}</span></span>
      <span><span class="k">late</span> <span id="slate">{{ stats?.late ?? 0 }}</span></span>
      <span><span class="k">cpu</span> <span id="scpu">{{ stats ? pct(stats.cpu_pct) : '—' }}</span></span>
      <span><span class="k">zoom</span> <span id="szoom">{{ zoomLabel }}</span></span>
      <span><span class="k">pan</span> <span id="span">{{ Math.round(pan.x) }},{{ Math.round(pan.y) }}</span></span>
      <span title="设备像素坐标"><span class="k">pick</span> <span id="spick">{{ pick ? `${pick.x},${pick.y}` : '—' }}</span></span>
      <span style="flex:1" />
      <span id="shint">{{ hint }}</span>
    </div>
  </div>
</template>
