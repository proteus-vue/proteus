// packages/devtools/src/views/timeline.ts
// DevTools 时间轴视图（泳道）：按 source 分组渲染 span（线段宽度 ∝ 耗时 + 相对定位）
// 纯函数：data → DOM（jsdom 可单测）；★UI 只消费数据层（铁律 1：TraceBus 唯一入口）
import type { TimelineSpan } from '@proteus-vue/devtools-runtime'

export interface TimelineViewData {
  spans: TimelineSpan[]
  /** 时间轴窗口（缺省自动取 min start ~ max end） */
  window?: { start: number; end: number }
}

export function renderTimeline(container: HTMLElement, data: TimelineViewData): void {
  container.replaceChildren()
  const spans = data.spans
  if (spans.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无事件（TraceBus 未上报）'
    container.appendChild(empty)
    return
  }
  let winStart = data.window?.start ?? Infinity
  let winEnd = data.window?.end ?? -Infinity
  for (const s of spans) {
    if (s.start < winStart) winStart = s.start
    const end = s.end !== undefined ? s.end : s.start
    if (end > winEnd) winEnd = end
  }
  const total = Math.max(1, winEnd - winStart)
  // 泳道：按 source 分组
  const lanes = new Map<string, TimelineSpan[]>()
  for (const s of spans) {
    const list = lanes.get(s.source)
    if (list) list.push(s)
    else lanes.set(s.source, [s])
  }
  for (const entry of lanes) {
    const lane = document.createElement('div')
    lane.className = 'pd-lane'
    const label = document.createElement('div')
    label.className = 'pd-lane-label'
    label.textContent = entry[0]
    lane.appendChild(label)
    const track = document.createElement('div')
    track.className = 'pd-lane-track'
    for (const s of entry[1]) {
      const seg = document.createElement('div')
      const left = ((s.start - winStart) / total) * 100
      const end = s.end !== undefined ? s.end : s.start
      const width = Math.max(0.5, ((end - s.start) / total) * 100)
      seg.className = 'pd-span' + (s.pending ? ' pd-span-pending' : '') + (s.durationMs === 0 ? ' pd-span-dot' : '')
      seg.style.left = left.toFixed(2) + '%'
      seg.style.width = width.toFixed(2) + '%'
      seg.title = `${s.source}.${s.name} ${s.durationMs !== undefined ? s.durationMs + 'ms' : ''}`
      const text = document.createElement('span')
      text.textContent = s.name + (s.durationMs !== undefined ? ' ' + s.durationMs + 'ms' : '')
      seg.appendChild(text)
      track.appendChild(seg)
    }
    lane.appendChild(track)
    container.appendChild(lane)
  }
}
