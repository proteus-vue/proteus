// tests/lifecycle.test.ts
// ★lifecycle-plan B1+B2：defineApp 五阶段 + LifecycleOrchestrator（顺序/超时降级/错误隔离/trace）
import { describe, it, expect, vi } from 'vitest'
import { defineApp, LifecycleOrchestrator, PhaseTimeoutError, PHASE_ORDER } from '../packages/runtime/src/lifecycle'
import type { LifecycleContext } from '../packages/runtime/src/lifecycle'

describe('LifecycleOrchestrator（B2：顺序执行 + 超时 + 错误隔离 + trace）', () => {
  it('按固定顺序执行 5 个阶段（PHASE_ORDER）', async () => {
    const order: string[] = []
    const ctx: LifecycleContext = { launchType: 'cold', network: 'wifi', platform: 'web', isMinimalMode: false }
    const o = new LifecycleOrchestrator(ctx)
    for (const name of PHASE_ORDER) {
      o.register({ name, handler: () => { order.push(name) }, timeout: 1000, fallback: 'warn' })
    }
    const traces = await o.run()
    expect(order).toEqual([...PHASE_ORDER])
    expect(o.getStatus()).toBe('completed')
    expect(traces.every((t) => t.status === 'success')).toBe(true)
  })

  it('阶段超时 → fallback 应用（trace status timeout）+ 后续继续', async () => {
    const ctx: LifecycleContext = { launchType: 'cold', network: 'wifi', platform: 'web', isMinimalMode: false }
    const o = new LifecycleOrchestrator(ctx)
    o.register({ name: 'bootstrap', handler: () => new Promise((r) => setTimeout(r, 500)), timeout: 50, fallback: 'warn' })
    o.register({ name: 'coreReady', handler: () => undefined, timeout: 100, fallback: 'minimal' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const traces = await o.run()
      expect(traces[0].status).toBe('timeout')
      expect(traces[0].fallback).toBe('warn')
      expect(traces[1].status).toBe('success') // 后续继续（错误隔离）
      expect(o.getStatus()).toBe('degraded')
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('阶段失败 → onError + 继续；coreReady 失败 → minimal 标记', async () => {
    const ctx: LifecycleContext = { launchType: 'cold', network: 'wifi', platform: 'web', isMinimalMode: false }
    const errs: Array<{ err: Error; phase: string }> = []
    const o = new LifecycleOrchestrator(ctx, { onError: (err, phase) => errs.push({ err, phase }) })
    o.register({ name: 'coreReady', handler: () => { throw new Error('boom') }, timeout: 100, fallback: 'warn' })
    o.register({ name: 'navigationReady', handler: () => undefined, timeout: 100, fallback: 'warn' })
    const traces = await o.run()
    expect(errs.length).toBe(1)
    expect(traces[0].status).toBe('error')
    expect(ctx.isMinimalMode).toBe(true) // coreReady 失败 → minimal
    expect(traces[1].status).toBe('success') // 后续继续
  })

  it('PhaseTimeoutError 类型', () => {
    const err = new PhaseTimeoutError(50)
    expect(err.ms).toBe(50)
    expect(err.message).toContain('超时')
  })

  it('重复注册阶段 → 报错；getTrace 完整', async () => {
    const ctx: LifecycleContext = { launchType: 'cold', network: 'wifi', platform: 'web', isMinimalMode: false }
    const o = new LifecycleOrchestrator(ctx)
    o.register({ name: 'bootstrap', handler: () => undefined, timeout: 100, fallback: 'warn' })
    expect(() => o.register({ name: 'bootstrap', handler: () => undefined, timeout: 100, fallback: 'warn' })).toThrow(/重复注册/)
    await o.run()
    expect(o.getTrace().length).toBe(1)
    expect(o.getTrace()[0].phase).toBe('bootstrap')
  })
})

describe('defineApp（B1：五阶段声明 + 校验 + 运行时钩子）', () => {
  it('五阶段按顺序执行（含 async handler）', async () => {
    const order: string[] = []
    const app = defineApp({
      bootstrap: () => { order.push('bootstrap') },
      coreReady: async () => { order.push('coreReady') },
      navigationReady: () => { order.push('navigationReady') },
      beforeFirstPaint: () => { order.push('beforeFirstPaint') },
      interactive: () => { order.push('interactive') },
    })
    await app.run()
    expect(order).toEqual([...PHASE_ORDER])
    expect(app.orchestrator.getStatus()).toBe('completed')
  })

  it('阶段超时/降级配置可覆盖（phases 段）', async () => {
    const app = defineApp({
      bootstrap: () => new Promise((r) => setTimeout(r, 500)),
      phases: { bootstrap: { timeout: 50, fallback: 'warn' } },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const traces = await app.run()
      expect(traces[0].status).toBe('timeout')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('未知配置键 / 未知阶段配置 → 报错（透明化）', () => {
    expect(() => defineApp({ bogus: () => undefined } as never)).toThrow(/未知配置键/)
    expect(() => defineApp({ phases: { bogus: {} } } as never)).toThrow(/未知阶段/)
  })

  it('运行时钩子：emit 触发 onShow/onNetworkChange（trace 可观察）', () => {
    const shown: string[] = []
    const app = defineApp({
      onShow: () => { shown.push('show') },
      onNetworkChange: (_ctx, info) => { shown.push(`net:${(info as { network: string }).network}`) },
    })
    app.emit('onShow')
    app.emit('onNetworkChange', { network: '4g' })
    expect(shown).toEqual(['show', 'net:4g'])
  })

  it('launchType 透传（cold/warm/recover 上下文）', async () => {
    let type = ''
    const app = defineApp({
      bootstrap: (ctx) => { type = ctx.launchType },
    })
    await app.run({ launchType: 'recover' })
    expect(type).toBe('recover')
  })
})
