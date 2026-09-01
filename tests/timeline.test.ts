// tests/timeline.test.ts —— @proteus-vue/devtools-runtime 时间轴收集器（devtools-plan B3 数据层）
// start/end 配对 → Span + durationMs；同 source 嵌套 → children 树；孤儿 end → duration 0；
// point/error → 竖线；flushOpen → pending；query 过滤（source/name/minDuration/traceId）；缓冲上限；stats
import { describe, it, expect } from 'vitest'
import { createTimelineCollector, createTraceBus } from '@proteus-vue/devtools-runtime'
import type { TraceEvent, TraceSource } from '@proteus-vue/devtools-runtime'

function ev(
  source: TraceSource,
  phase: 'start' | 'end' | 'point' | 'error',
  name: string,
  timestamp: number,
  traceId?: string,
): TraceEvent {
  return { source, phase, name, timestamp, traceId }
}

describe('时间轴收集器：配对与结构', () => {
  it('start/end 配对 → span + durationMs + traceId', () => {
    const c = createTimelineCollector()
    c.ingest(ev('router', 'start', 'navigate', 1000, 't1'))
    c.ingest(ev('router', 'end', 'navigate', 1040, 't1'))
    const spans = c.spans()
    expect(spans.length).toBe(1)
    expect(spans[0]).toMatchObject({ source: 'router', name: 'navigate', start: 1000, end: 1040, durationMs: 40, traceId: 't1' })
    expect(c.stats).toMatchObject({ total: 2, completed: 1, open: 0 })
  })

  it('同 source 连续 start → 嵌套 children 树（LIFO 配对）', () => {
    const c = createTimelineCollector()
    c.ingest(ev('api', 'start', 'request', 100))
    c.ingest(ev('api', 'start', 'retry', 110))
    c.ingest(ev('api', 'end', 'retry', 120))
    c.ingest(ev('api', 'end', 'request', 130))
    const spans = c.spans()
    expect(spans.length).toBe(1)
    expect(spans[0].name).toBe('request')
    expect(spans[0].durationMs).toBe(30)
    expect(spans[0].children.length).toBe(1)
    expect(spans[0].children[0]).toMatchObject({ name: 'retry', start: 110, end: 120, durationMs: 10 })
  })

  it('孤儿 end → 耗时 0 的 span；point/error → 竖线（duration 0）', () => {
    const c = createTimelineCollector()
    c.ingest(ev('router', 'end', 'orphan', 500))
    c.ingest(ev('lifecycle', 'point', 'mounted', 600))
    c.ingest(ev('api', 'error', 'timeout', 700))
    const spans = c.spans()
    expect(spans.length).toBe(3)
    expect(spans[0]).toMatchObject({ name: 'orphan', durationMs: 0 })
    expect(spans[1]).toMatchObject({ name: 'mounted', durationMs: 0 })
    expect(spans[2]).toMatchObject({ name: 'timeout', durationMs: 0 })
    expect(c.stats.completed).toBe(3)
  })

  it('跨 source 独立栈（router 嵌套不影响 api）', () => {
    const c = createTimelineCollector()
    c.ingest(ev('router', 'start', 'nav', 100))
    c.ingest(ev('api', 'start', 'req', 105))
    c.ingest(ev('api', 'end', 'req', 110))
    c.ingest(ev('router', 'end', 'nav', 120))
    const spans = c.spans()
    expect(spans.length).toBe(2) // router nav + api req 平行（根序 = 完成序）
    expect(spans[0].name).toBe('req') // req 先完成
    expect(spans[1].name).toBe('nav')
    expect(spans[1].children.length).toBe(0)
  })

  it('未结束 span → flushOpen 标记 pending + 完成', () => {
    const c = createTimelineCollector()
    c.ingest(ev('compiler', 'start', 'build', 100))
    expect(c.stats.open).toBe(1)
    const n = c.flushOpen()
    expect(n).toBe(1)
    const spans = c.spans()
    expect(spans[0].pending).toBe(true)
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(c.stats.open).toBe(0)
  })

  it('sources 白名单过滤摄入', () => {
    const c = createTimelineCollector({ sources: ['router'] })
    c.ingest(ev('router', 'start', 'nav', 100))
    c.ingest(ev('api', 'start', 'req', 200))
    c.ingest(ev('router', 'end', 'nav', 150))
    expect(c.spans().length).toBe(1)
    expect(c.stats.total).toBe(2) // 只摄入 router 两条
  })
})

describe('时间轴收集器：查询 / 缓冲 / 生命周期', () => {
  it('query 过滤：source / name / minDurationMs / traceId', () => {
    const c = createTimelineCollector()
    c.ingest(ev('router', 'start', 'nav', 100, 'a'))
    c.ingest(ev('router', 'end', 'nav', 200, 'a')) // 100ms
    c.ingest(ev('api', 'start', 'req', 300, 'b'))
    c.ingest(ev('api', 'end', 'req', 310, 'b')) // 10ms
    expect(c.query({ sources: ['router'] }).length).toBe(1)
    expect(c.query({ names: ['req'] }).length).toBe(1)
    expect(c.query({ minDurationMs: 50 }).length).toBe(1) // 只有 nav 100ms
    expect(c.query({ traceId: 'b' }).length).toBe(1)
    expect(c.query({ sources: ['router'], minDurationMs: 50 }).length).toBe(1)
    expect(c.query({ minDurationMs: 200 }).length).toBe(0)
  })

  it('query 递归 children（嵌套 span 也可匹配）', () => {
    const c = createTimelineCollector()
    c.ingest(ev('api', 'start', 'request', 100))
    c.ingest(ev('api', 'start', 'retry', 110))
    c.ingest(ev('api', 'end', 'retry', 120))
    c.ingest(ev('api', 'end', 'request', 130))
    const retries = c.query({ names: ['retry'] })
    expect(retries.length).toBe(1)
    expect(retries[0].children.length).toBe(0)
  })

  it('缓冲上限：超限丢最旧根 span', () => {
    const c = createTimelineCollector({ bufferSize: 2 })
    for (let i = 0; i < 5; i++) {
      c.ingest(ev('lifecycle', 'start', `boot-${i}`, i * 10))
      c.ingest(ev('lifecycle', 'end', `boot-${i}`, i * 10 + 5))
    }
    const spans = c.spans()
    expect(spans.length).toBe(2)
    expect(spans[0].name).toBe('boot-3')
    expect(spans[1].name).toBe('boot-4')
  })

  it('clear 重置全部状态', () => {
    const c = createTimelineCollector()
    c.ingest(ev('lifecycle', 'start', 'boot', 100))
    c.clear()
    expect(c.spans().length).toBe(0)
    expect(c.stats.total).toBe(0)
    expect(c.stats.open).toBe(0)
  })

  it('★与 TraceBus 集成：on() 订阅直喂收集器', () => {
    const bus = createTraceBus()
    bus.setEnabled(true)
    const c = createTimelineCollector()
    const off = bus.on((e) => c.ingest(e))
    bus.emit('router', 'start', 'nav', undefined, 't9')
    bus.emit('router', 'end', 'nav', undefined, 't9')
    off()
    expect(c.spans().length).toBe(1)
    expect(c.spans()[0].durationMs).toBeGreaterThanOrEqual(0)
  })
})
