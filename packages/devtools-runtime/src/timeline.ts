// packages/devtools-runtime/src/timeline.ts
// devtools-plan B3：时间轴收集器（TraceBus 事件流 → 泳道时间轴模型，UI 无关纯逻辑）
//   · start/end 配对构建 Span（同 source 嵌套栈 → children 树）
//   · 孤儿 end → 耗时 0 的 span；point/error → 竖线（duration 0）
//   · flushOpen()：未结束 span 标记 pending（面板刷新时可见）
//   · query() 过滤（source / name / minDurationMs / traceId）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块进 MP 产物）
import type { TraceEvent } from './index'

/** 时间轴 Span（一条横向线段 = start/end 配对；竖线 = duration 0） */
export interface TimelineSpan {
  id: string
  source: string
  name: string
  start: number
  end?: number
  /** 耗时 ms（start-end 差；未结束 span flushOpen 时补算） */
  durationMs?: number
  traceId?: string
  /** start 事件 payload */
  meta?: Record<string, unknown>
  /** 嵌套子 span（同 source 连续 start） */
  children: TimelineSpan[]
  /** flushOpen 时未结束 → 标记（面板区分显示） */
  pending?: boolean
}

export interface TimelineCollectorOptions {
  /** 完成 span 缓冲上限（缺省 10000——超出丢最旧根 span，对齐 TraceBus 环形缓冲） */
  bufferSize?: number
  /** 事件来源白名单（缺省全部） */
  sources?: string[]
}

export interface TimelineFilter {
  sources?: string[]
  names?: string[]
  minDurationMs?: number
  traceId?: string
}

export interface TimelineCollector {
  /** 摄入一个 TraceEvent（start/end/point/error） */
  ingest(event: TraceEvent): void
  /** 已完成根 span 列表（含 pending） */
  spans(): TimelineSpan[]
  /** 过滤查询（递归含 children；返回所有匹配 span） */
  query(filter: TimelineFilter): TimelineSpan[]
  /** 把所有进行中 span 标记 pending 并完成（返回数量）——面板刷新/快照时调用 */
  flushOpen(): number
  clear(): void
  readonly stats: { total: number; open: number; completed: number }
}

let seq = 0
function nextId(): string {
  seq += 1
  return 'span-' + seq
}

export function createTimelineCollector(options: TimelineCollectorOptions = {}): TimelineCollector {
  const bufferSize = options.bufferSize ?? 10000
  const allowedSources: string[] | null = options.sources ?? null
  const roots: TimelineSpan[] = []
  /** source → 进行中 span 栈（同 source 嵌套） */
  const stacks = new Map<string, TimelineSpan[]>()
  let total = 0
  let completed = 0

  function accepted(source: string): boolean {
    if (!allowedSources) return true
    return allowedSources.indexOf(source) >= 0
  }

  function pushRoot(span: TimelineSpan): void {
    roots.push(span)
    if (roots.length > bufferSize) roots.shift()
  }

  function finish(span: TimelineSpan, end: number): void {
    span.end = end
    span.durationMs = Math.max(0, end - span.start)
    completed += 1
  }

  function attachOrRoot(stack: TimelineSpan[] | undefined, span: TimelineSpan): void {
    if (stack && stack.length) stack[stack.length - 1].children.push(span)
    else pushRoot(span)
  }

  function ingest(event: TraceEvent): void {
    if (!accepted(event.source)) return
    total += 1
    const phase = event.phase
    if (phase === 'start') {
      const span: TimelineSpan = {
        id: nextId(),
        source: event.source,
        name: event.name,
        start: event.timestamp,
        traceId: event.traceId,
        meta: event.payload as Record<string, unknown> | undefined,
        children: [],
      }
      let stack = stacks.get(event.source)
      if (!stack) {
        stack = []
        stacks.set(event.source, stack)
      }
      stack.push(span)
      return
    }
    if (phase === 'end') {
      const stack = stacks.get(event.source)
      if (stack && stack.length) {
        const span = stack.pop()
        if (span) {
          finish(span, event.timestamp)
          attachOrRoot(stack, span)
        }
      } else {
        // 孤儿 end：耗时 0 的 span
        const orphan: TimelineSpan = {
          id: nextId(),
          source: event.source,
          name: event.name,
          start: event.timestamp,
          end: event.timestamp,
          durationMs: 0,
          traceId: event.traceId,
          children: [],
        }
        completed += 1
        pushRoot(orphan)
      }
      return
    }
    // point / error：竖线（duration 0）
    const dot: TimelineSpan = {
      id: nextId(),
      source: event.source,
      name: event.name,
      start: event.timestamp,
      end: event.timestamp,
      durationMs: 0,
      traceId: event.traceId,
      children: [],
    }
    completed += 1
    pushRoot(dot)
  }

  function flushOpen(): number {
    let n = 0
    for (const entry of stacks) {
      const stack = entry[1]
      while (stack.length) {
        const span = stack.pop()
        if (!span) break
        span.pending = true
        finish(span, Date.now())
        attachOrRoot(stack, span)
        n += 1
      }
    }
    stacks.clear()
    return n
  }

  function matches(span: TimelineSpan, f: TimelineFilter): boolean {
    if (f.sources && f.sources.indexOf(span.source) < 0) return false
    if (f.names && f.names.indexOf(span.name) < 0) return false
    if (f.minDurationMs !== undefined && span.durationMs !== undefined && span.durationMs < f.minDurationMs) return false
    if (f.traceId && span.traceId !== f.traceId) return false
    return true
  }

  function collectAll(spans: TimelineSpan[], f: TimelineFilter, out: TimelineSpan[]): void {
    for (const span of spans) {
      if (matches(span, f)) out.push(span)
      if (span.children.length) collectAll(span.children, f, out)
    }
  }

  function openCount(): number {
    let n = 0
    for (const entry of stacks) n += entry[1].length
    return n
  }

  return {
    ingest,
    spans: () => roots,
    query: (f: TimelineFilter) => {
      const out: TimelineSpan[] = []
      collectAll(roots, f, out)
      return out
    },
    flushOpen,
    clear: () => {
      roots.length = 0
      stacks.clear()
      total = 0
      completed = 0
    },
    get stats() {
      return { total, open: openCount(), completed }
    },
  }
}
