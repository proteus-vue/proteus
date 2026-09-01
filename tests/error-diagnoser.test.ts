// tests/error-diagnoser.test.ts —— @proteus-vue/devtools-runtime 异常根因分析（devtools-plan M7/B7）
// error 收集 + traceId 聚合 + 归因规则（最早 timestamp 为根因 / 模式库 401/ChunkLoadError/unsupported）+ 影响范围 + 复现脚本 + 无 error 不误报
import { describe, it, expect } from 'vitest'
import { createErrorDiagnoser } from '@proteus-vue/devtools-runtime'
import type { TraceEvent, TraceSource } from '@proteus-vue/devtools-runtime'

function ev(source: TraceSource, phase: 'start' | 'end' | 'point' | 'error', name: string, timestamp: number, traceId?: string, payload?: unknown): TraceEvent {
  return { source, phase, name, timestamp, traceId, payload }
}

/** 构造验收场景：coreReady token 刷新失败(401) → 守卫取消导航 */
function runScenario(d: ReturnType<typeof createErrorDiagnoser>): void {
  // lifecycle.coreReady 发起 token 刷新（trace t1）
  d.ingest(ev('lifecycle', 'start', 'coreReady', 1000, 't1'))
  d.ingest(ev('api', 'start', 'refreshToken', 1010, 't1'))
  d.ingest(ev('api', 'error', 'refreshToken', 1030, 't1', { status: 401 }))
  d.ingest(ev('api', 'end', 'refreshToken', 1030, 't1'))
  d.ingest(ev('lifecycle', 'end', 'coreReady', 1040, 't1'))
  // router 导航被守卫取消（同 traceId 第二个 error——更晚）
  d.ingest(ev('router', 'start', 'navigate /admin', 2000, 't1'))
  d.ingest(ev('router', 'error', 'guard requiresAuth', 2020, 't1'))
}

describe('异常根因：归因规则', () => {
  it('验收场景：401 根因准确定位到最早 error（coreReady 的 token 刷新失败）', () => {
    const d = createErrorDiagnoser()
    runScenario(d)
    const reports = d.diagnose()
    expect(reports.length).toBe(1)
    const r = reports[0]
    expect(r.rootCause).toMatchObject({ source: 'api', name: 'refreshToken', timestamp: 1030 })
    expect(r.attribution).toContain('token 失效')
    // 影响范围：lifecycle/api/router
    expect(r.impactSources).toEqual(['lifecycle', 'api', 'router'])
    // 调用链时间序（含 error 前的调用）
    expect(r.chain.map((c) => c.source)).toEqual(['lifecycle', 'api', 'api', 'api', 'lifecycle', 'router', 'router'])
  })

  it('规则 ②：同 traceId 多 error → 最早 timestamp 为根因', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('store', 'error', 'action-fail', 500, 't2'))
    d.ingest(ev('api', 'error', 'timeout', 600, 't2'))
    const r = d.diagnose()[0]
    expect(r.rootCause).toMatchObject({ source: 'store', name: 'action-fail', timestamp: 500 })
  })

  it('规则 ③：ChunkLoadError 模式归因', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('compiler', 'error', 'ChunkLoadError: pages/order', 700, 't3'))
    const r = d.diagnose()[0]
    expect(r.attribution).toContain('分包加载失败')
  })

  it('规则 ③：capability.unsupported 模式归因', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('capability', 'error', 'unsupported: share', 800))
    const r = d.diagnose()[0]
    expect(r.attribution).toContain('当前平台不支持')
  })

  it('模式库可扩展（自定义 pattern 优先）', () => {
    const d = createErrorDiagnoser({
      patterns: [{ match: (e) => e.name === 'boom', attribution: '自定义：boom' }],
    })
    d.ingest(ev('api', 'error', 'boom', 100))
    expect(d.diagnose()[0].attribution).toBe('自定义：boom')
  })
})

describe('异常根因：影响范围 / 复现脚本 / 边界', () => {
  it('复现脚本：同 traceId 导航步骤序列', () => {
    const d = createErrorDiagnoser()
    runScenario(d)
    const r = d.diagnose()[0]
    expect(r.repro[0]).toContain('导航 navigate /admin')
  })

  it('无 router 导航 → 复现脚本降级为触发根因', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('api', 'error', 'timeout', 100, 't4'))
    const r = d.diagnose()[0]
    expect(r.repro[0]).toContain('触发 api.timeout')
  })

  it('无 error 事件 → 空数组不误报', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('api', 'start', 'ok', 100))
    d.ingest(ev('api', 'end', 'ok', 200))
    expect(d.diagnose()).toEqual([])
  })

  it('多个独立 traceId → 各一条报告；clear 重置', () => {
    const d = createErrorDiagnoser()
    d.ingest(ev('api', 'error', 'a', 100, 'x'))
    d.ingest(ev('api', 'error', 'b', 200, 'y'))
    expect(d.diagnose().length).toBe(2)
    d.clear()
    expect(d.diagnose()).toEqual([])
  })

  it('错误缓冲上限裁剪（最旧 error 丢弃）', () => {
    const d = createErrorDiagnoser({ bufferSize: 2 })
    for (let i = 0; i < 4; i++) d.ingest(ev('api', 'error', 'e' + i, i * 10, 't' + i))
    const reports = d.diagnose()
    expect(reports.length).toBe(2)
    expect(reports[0].rootCause.name).toBe('e2')
  })
})
