// tests/devtools-budget.test.ts —— ★M10 性能预算（M7.4）：关键路径耗时烟测（宽松上界防 CI 抖动，抓病态回归）
//   · bus.emit 单条：预算 < 0.1ms（plan）→ 烟测上界 1ms（CI 机器差异 10 倍余量）
//   · 火焰图 5000 span ingest + roots()：预算 < 100ms（plan）→ 烟测上界 1000ms
//   · 万级 span timeline ingest：预算首屏 < 200ms（plan，渲染侧）→ ingest 烟测上界 1000ms
import { describe, it, expect } from 'vitest'
import { createTraceBus, createTimelineCollector, createFlamegraphCollector } from '@proteus-vue/devtools-runtime'
import type { TraceEvent } from '@proteus-vue/devtools-runtime'

function perfNow(): number {
  return (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now()
}

/** 构造 N 个重叠 start/end 事件对（火焰图嵌套测试用；source 轮转 4 种） */
function nestedEvents(n: number): TraceEvent[] {
  const out: TraceEvent[] = []
  const sources = ['router', 'api', 'lifecycle', 'component'] as const
  let t = 0
  let seq = 0
  for (let i = 0; i < n; i++) {
    const source = sources[i % sources.length] as TraceEvent['source']
    const traceId = 't' + i
    out.push({ source, phase: 'start', name: 'op' + i, timestamp: t, traceId })
    out.push({ source, phase: 'end', name: 'op' + i, timestamp: t + 10, traceId })
    t += 10
    seq += 2
  }
  return out
}

describe('★M10 性能预算（M7.4，宽松烟测）', () => {
  it('bus.emit 单条耗时 < 1ms（plan 预算 0.1ms；万次平均）', () => {
    const bus = createTraceBus({ enabled: true })
    const handler = () => {} // 空订阅者（emit 主链路：脱敏 + 缓冲 + 分发）
    bus.on(handler)
    const N = 10000
    const start = perfNow()
    for (let i = 0; i < N; i++) bus.emit('api', 'point', 'req', { url: '/x', token: 'secret' })
    const avg = (perfNow() - start) / N
    expect(avg).toBeLessThan(1) // ms
  })

  it('火焰图 5000 span ingest + roots() < 1000ms（plan 预算 100ms）', () => {
    const flame = createFlamegraphCollector()
    const events = nestedEvents(5000)
    flame.start()
    const start = perfNow()
    for (const e of events) flame.ingest(e)
    const roots = flame.roots()
    const elapsed = perfNow() - start
    expect(elapsed).toBeLessThan(1000)
    expect(roots.length).toBeGreaterThan(0)
  })

  it('万级 span timeline ingest < 1000ms（plan 首屏 200ms 的 ingest 侧烟测）', () => {
    const tl = createTimelineCollector()
    const events = nestedEvents(10000)
    const start = perfNow()
    for (const e of events) tl.ingest(e)
    const spans = tl.spans()
    const elapsed = perfNow() - start
    expect(elapsed).toBeLessThan(1000)
    expect(spans.length).toBeGreaterThan(0)
  })
})
