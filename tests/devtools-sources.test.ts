// tests/devtools-sources.test.ts
// ★devtools-plan B2：六源接入示范——lifecycle orchestrator + componentRender → TraceBus（type-only 注入，运行时零依赖）
import { describe, it, expect, afterEach } from 'vitest'
import { createTraceBus } from '../packages/devtools-runtime/src'
import { LifecycleOrchestrator } from '../packages/runtime/src/lifecycle'
import type { LifecycleContext } from '../packages/runtime/src/lifecycle'
import { componentRender, setTraceBus, setObservabilityEnabled } from '../src/components/runtime/observability'

function makeCtx(): LifecycleContext {
  return { launchType: 'cold', network: 'wifi', platform: 'web', isMinimalMode: false }
}

describe('lifecycle 源 → TraceBus（结构化事件）', () => {
  it('正常执行：start/end 事件入流（lifecycle.<phase> 命名 + payload）', async () => {
    const bus = createTraceBus({ enabled: true })
    const ctx = makeCtx()
    const o = new LifecycleOrchestrator(ctx, { traceBus: bus })
    o.register({ name: 'bootstrap', handler: () => undefined, timeout: 100, fallback: 'warn' })
    o.register({ name: 'coreReady', handler: () => undefined, timeout: 100, fallback: 'minimal' })
    await o.run()
    const names = bus.buffer.map((e) => e.name)
    expect(names).toContain('lifecycle.bootstrap')
    expect(names).toContain('lifecycle.coreReady')
    const starts = bus.buffer.filter((e) => e.phase === 'start')
    const ends = bus.buffer.filter((e) => e.phase === 'end')
    expect(starts.length).toBe(2)
    expect(ends.length).toBe(2)
    expect(ends[0].payload).toHaveProperty('duration')
    expect(bus.buffer.every((e) => e.source === 'lifecycle')).toBe(true)
  })

  it('阶段失败 → error 事件（含 message）', async () => {
    const bus = createTraceBus({ enabled: true })
    const ctx = makeCtx()
    const o = new LifecycleOrchestrator(ctx, { traceBus: bus })
    o.register({
      name: 'coreReady',
      handler: () => {
        throw new Error('boom')
      },
      timeout: 100,
      fallback: 'minimal',
    })
    await o.run()
    const errs = bus.buffer.filter((e) => e.phase === 'error')
    expect(errs.length).toBe(1)
    expect(errs[0].name).toBe('lifecycle.coreReady')
    expect((errs[0].payload as Record<string, string>).message).toBe('boom')
  })

  it('未注入 traceBus → 零事件（解耦）', async () => {
    const bus = createTraceBus({ enabled: true })
    const o = new LifecycleOrchestrator(makeCtx())
    o.register({ name: 'bootstrap', handler: () => undefined, timeout: 100, fallback: 'warn' })
    await o.run()
    expect(bus.buffer.length).toBe(0)
  })
})

describe('component 源 → TraceBus（component.render）', () => {
  afterEach(() => {
    setTraceBus(null)
    setObservabilityEnabled(false)
  })

  it('setTraceBus 后 componentRender 汇入事件流（tag/itemCount/strategy）', () => {
    const bus = createTraceBus({ enabled: true })
    setTraceBus(bus)
    componentRender('p-list-view', { durationMs: 1.2, itemCount: 12, strategy: 'virtual' })
    expect(bus.buffer.length).toBe(1)
    const e = bus.buffer[0]
    expect(e.source).toBe('component')
    expect(e.name).toBe('component.render')
    expect((e.payload as Record<string, unknown>).tag).toBe('p-list-view')
    expect((e.payload as Record<string, unknown>).itemCount).toBe(12)
  })

  it('bus 未启用 → 不汇入（零开销门控在 bus 侧）', () => {
    const bus = createTraceBus({ enabled: false })
    setTraceBus(bus)
    componentRender('p-list-view', { durationMs: 1.2, itemCount: 12, strategy: 'virtual' })
    expect(bus.buffer.length).toBe(0)
  })

  it('未注入 bus → 零事件；console 埋点行为不变', () => {
    const bus = createTraceBus({ enabled: true })
    const logs: string[] = []
    const origLog = console.log
    console.log = (...a: unknown[]) => { logs.push(String(a[0])) }
    try {
      setObservabilityEnabled(true)
      componentRender('p-view', { durationMs: 0.5 })
    } finally {
      console.log = origLog
      setObservabilityEnabled(false)
    }
    expect(bus.buffer.length).toBe(0)
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('[proteus][render] p-view')
  })
})
