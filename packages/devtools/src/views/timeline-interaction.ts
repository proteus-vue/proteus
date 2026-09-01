// packages/devtools/src/views/timeline-interaction.ts
// Timeline 时间窗口交互（对标 Vue DevTools Timeline 缩放/平移）：wheel 以光标为锚点缩放 + 拖拽平移 + 双击重置
// 纯 DOM 逻辑（happy-dom 可单测）；窗口状态本模块持有，变更经 onWindowChange 通知（panel 统一 16ms 节流 rerender）
import type { TimelineSpan } from '@proteus-vue/devtools-runtime'
import type { TimelineWindow } from './timeline'

export interface TimelineZoomOptions {
  /** 窗口变更回调（panel 触发节流 rerender） */
  onWindowChange?: (w: TimelineWindow) => void
}

export interface TimelineZoom {
  /** 当前窗口（未交互过 → null，panel 传 undefined 让渲染函数自算全窗） */
  getWindow(): TimelineWindow | null
  destroy(): void
}

const ZOOM_STEP = 1.2
/** 缩放最小窗口（防无限放大） */
const MIN_SPAN = 1

/** 全量 span 的时间范围（初始窗口/双击重置/缩放钳制基准） */
function fullWindow(spans: TimelineSpan[]): TimelineWindow {
  let start = Infinity
  let end = -Infinity
  for (const s of spans) {
    if (s.start < start) start = s.start
    const e = s.end !== undefined ? s.end : s.start
    if (e > end) end = e
  }
  return { start, end }
}

export function createTimelineZoom(container: HTMLElement, getSpans: () => TimelineSpan[], opts: TimelineZoomOptions = {}): TimelineZoom {
  const { onWindowChange } = opts
  let window: TimelineWindow | null = null
  let dragging = false
  let dragStartX = 0
  let dragStartWindow: TimelineWindow | null = null

  function apply(w: TimelineWindow): void {
    window = w
    onWindowChange?.(w)
  }

  /** 钳制到全量范围：不超出数据边界 + 不缩小到 MIN_SPAN 以下 */
  function clamp(w: TimelineWindow): TimelineWindow {
    const full = fullWindow(getSpans())
    const maxSpan = Math.max(1, full.end - full.start)
    const span = Math.min(maxSpan, Math.max(MIN_SPAN, w.end - w.start))
    let start = w.start
    if (start < full.start) start = full.start
    if (start + span > full.end) start = Math.max(full.start, full.end - span)
    return { start, end: start + span }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!window) window = fullWindow(getSpans())
    const span = window.end - window.start
    if (span <= 0) return
    // 光标锚点时间（光标所在时刻缩放后保持不动）；clientX 缺失（happy-dom WheelEvent 无坐标）→ 以中心为锚
    const rect = container.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const cx = Number.isFinite(e.clientX) ? e.clientX : rect.left + width / 2
    const f = Math.min(1, Math.max(0, (cx - rect.left) / width))
    const cursorTime = window.start + f * span
    // 上滚（deltaY<0）放大；下滚缩小
    const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP
    const newSpan = span * factor
    const start = cursorTime - f * newSpan
    apply(clamp({ start, end: start + newSpan }))
  }

  function onDown(e: MouseEvent): void {
    if (e.button !== 0) return
    if (!window) window = fullWindow(getSpans())
    dragging = true
    dragStartX = e.clientX
    dragStartWindow = { ...window }
    e.preventDefault()
  }

  function onMove(e: MouseEvent): void {
    if (!dragging || !dragStartWindow) return
    const span = dragStartWindow.end - dragStartWindow.start
    if (span <= 0) return
    const rect = container.getBoundingClientRect()
    const dt = ((e.clientX - dragStartX) / Math.max(1, rect.width)) * span
    apply(clamp({ start: dragStartWindow.start - dt, end: dragStartWindow.end - dt }))
  }

  function onUp(): void {
    dragging = false
    dragStartWindow = null
  }

  function onDblClick(): void {
    apply(fullWindow(getSpans()))
  }

  container.addEventListener('wheel', onWheel, { passive: false })
  container.addEventListener('mousedown', onDown)
  container.addEventListener('mousemove', onMove)
  container.addEventListener('mouseup', onUp)
  container.addEventListener('dblclick', onDblClick)

  return {
    getWindow: () => window,
    destroy() {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('mousedown', onDown)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseup', onUp)
      container.removeEventListener('dblclick', onDblClick)
      dragging = false
      dragStartWindow = null
      window = null
    },
  }
}
