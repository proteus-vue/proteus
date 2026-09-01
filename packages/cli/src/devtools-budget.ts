// packages/cli/src/devtools-budget.ts
// ★M10 性能预算（M7.4）：proteus audit devtools-budget —— DevTools 关键路径耗时门禁（CI 用）
//   对齐 devtools-plan 预算：bus.emit < 0.1ms / 火焰图 5000 span < 100ms / 万级 span ingest < 200ms
//   ★CI 稳定性：以 10 倍余量做烟测上界（1s/1s/1s），抓病态回归不抓机器抖动
//   复用 vitest 烟测同一组测量（tests/devtools-budget.test.ts 的 node 形态）
import { performance } from 'node:perf_hooks'
import { createTraceBus, createFlamegraphCollector, createTimelineCollector } from '@proteus-vue/devtools-runtime'
import type { TraceEvent } from '@proteus-vue/devtools-runtime'

export interface DevtoolsBudgetMetric {
  name: string
  /** plan 预算 */
  budgetMs: number
  /** 烟测上界（CI 机器 10 倍余量） */
  limitMs: number
  /** 实测 */
  ms: number
  ok: boolean
}

export interface DevtoolsBudgetResult {
  ok: boolean
  metrics: DevtoolsBudgetMetric[]
}

/** 构造 N 个顺序 start/end 事件对（source 轮转） */
function events(n: number): TraceEvent[] {
  const out: TraceEvent[] = []
  const sources = ['router', 'api', 'lifecycle', 'component'] as const
  let t = 0
  for (let i = 0; i < n; i++) {
    const source = sources[i % sources.length] as TraceEvent['source']
    const traceId = 't' + i
    out.push({ source, phase: 'start', name: 'op' + i, timestamp: t, traceId })
    out.push({ source, phase: 'end', name: 'op' + i, timestamp: t + 10, traceId })
    t += 10
  }
  return out
}

function ms(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

/** 运行 DevTools 性能预算烟测（node 环境直测 devtools-runtime） */
export function runDevtoolsBudget(): DevtoolsBudgetResult {
  const metrics: DevtoolsBudgetMetric[] = []

  // bus.emit 万次平均（plan < 0.1ms → 烟测上界 1ms）
  {
    const bus = createTraceBus({ enabled: true })
    bus.on(() => {})
    const avg = ms(() => {
      for (let i = 0; i < 10000; i++) bus.emit('api', 'point', 'req', { url: '/x', token: 'secret' })
    }) / 10000
    metrics.push({ name: 'bus.emit 单条', budgetMs: 0.1, limitMs: 1, ms: Math.round(avg * 1000) / 1000, ok: avg < 1 })
  }

  // 火焰图 5000 span ingest + roots（plan < 100ms → 烟测上界 1000ms）
  {
    const flame = createFlamegraphCollector()
    const list = events(5000)
    flame.start()
    const elapsed = ms(() => {
      for (const e of list) flame.ingest(e)
      flame.roots()
    })
    metrics.push({ name: '火焰图 5000 span ingest+roots', budgetMs: 100, limitMs: 1000, ms: Math.round(elapsed * 10) / 10, ok: elapsed < 1000 })
  }

  // 万级 span timeline ingest（plan 首屏 < 200ms 的 ingest 侧 → 烟测上界 1000ms）
  {
    const tl = createTimelineCollector()
    const list = events(10000)
    const elapsed = ms(() => {
      for (const e of list) tl.ingest(e)
      tl.spans()
    })
    metrics.push({ name: '万级 span timeline ingest', budgetMs: 200, limitMs: 1000, ms: Math.round(elapsed * 10) / 10, ok: elapsed < 1000 })
  }

  return { ok: metrics.every((m) => m.ok), metrics }
}

export function formatDevtoolsBudget(result: DevtoolsBudgetResult): string {
  const lines = ['[proteus] audit devtools-budget —— DevTools 性能预算烟测（plan 预算 → 10 倍余量 CI 上界）：']
  for (const m of result.metrics) {
    lines.push(`  ${m.ok ? '✅' : '✗'} ${m.name}：${m.ms}ms（plan ${m.budgetMs}ms / CI 上界 ${m.limitMs}ms${m.ok ? '' : '，超限' }）`)
  }
  lines.push(result.ok ? '[proteus] ✅ devtools-budget 通过' : '[proteus] ✗ devtools-budget 超限（请检查 devtools-runtime 病态回归）')
  return lines.join('\n')
}
