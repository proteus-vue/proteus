// tests/module-orchestrator.test.ts
// ★module-plan B2（M2 ModuleOrchestrator）：拓扑序初始化 / 生命周期状态机 / 版本协商 / 事件总线
import { describe, it, expect } from 'vitest'
import { createModuleSystem, createModuleEventBus, satisfies, VersionMismatchError, CycleError } from '../packages/module/src'
import type { ModuleDefinition } from '../packages/module/src'

/** 记录钩子调用的 mock 模块 */
function mockModule(name: string, deps: Record<string, string> = {}, log: string[] = [], hooks?: Partial<ModuleDefinition['lifecycle']>): ModuleDefinition {
  return {
    name,
    version: '1.0.0',
    dependencies: deps,
    services: () => ({ name }),
    lifecycle: {
      onInit: () => { log.push(`init:${name}`) },
      onReady: () => { log.push(`ready:${name}`) },
      onDestroy: () => { log.push(`destroy:${name}`) },
      ...hooks,
    },
  }
}

describe('createModuleSystem：拓扑序初始化 + 生命周期', () => {
  it('按拓扑序初始化（被依赖者先 init；依赖者后 ready）', async () => {
    const log: string[] = []
    const ms = createModuleSystem({
      modules: [
        mockModule('trade', { user: '^1.0.0', payment: '^1.0.0' }, log),
        mockModule('user', {}, log),
        mockModule('payment', {}, log),
      ],
    })
    await ms.init()
    expect(log.indexOf('init:user')).toBeLessThan(log.indexOf('init:trade'))
    expect(log.indexOf('init:payment')).toBeLessThan(log.indexOf('init:trade'))
    expect(ms.getState('trade')).toBe('ready')
    expect(ms.getState('user')).toBe('ready')
  })

  it('services 懒创建（工厂在 init 时调用）+ getModule 实例访问', async () => {
    const ms = createModuleSystem({
      modules: [{ name: 'user', version: '1.0.0', services: () => ({ greet: 'hi' }) }],
    })
    await ms.init()
    const user = ms.getModule('user')
    expect(user.services.greet).toBe('hi')
    expect(user.name).toBe('user')
    expect(() => ms.getModule('ghost')).toThrow(/未注册/)
  })

  it('active / inactive 生命周期切换', async () => {
    const log: string[] = []
    const ms = createModuleSystem({
      modules: [mockModule('user', {}, log, { onActive: () => { log.push('active:user') }, onInactive: () => { log.push('inactive:user') } })],
    })
    await ms.init()
    await ms.activate('user')
    expect(ms.getState('user')).toBe('active')
    expect(log).toContain('active:user')
    await ms.deactivate('user')
    expect(ms.getState('user')).toBe('inactive')
    expect(log).toContain('inactive:user')
  })

  it('destroy：逆拓扑序 + state 置 destroyed', async () => {
    const log: string[] = []
    const ms = createModuleSystem({
      modules: [mockModule('trade', { user: '^1.0.0' }, log), mockModule('user', {}, log)],
    })
    await ms.init()
    await ms.destroy()
    // 被依赖者后销毁（逆拓扑）
    expect(log.indexOf('destroy:trade')).toBeLessThan(log.indexOf('destroy:user'))
    expect(ms.getState('trade')).toBe('destroyed')
    expect(ms.getState('user')).toBe('destroyed')
  })

  it('重复注册 / 未注册依赖 / 环 → 抛错（透明化）', async () => {
    expect(() =>
      createModuleSystem({ modules: [mockModule('a', {}), mockModule('a', {})] }),
    ).toThrow(/重复注册/)
    expect(() =>
      createModuleSystem({ modules: [mockModule('a', { ghost: '^1.0.0' })] }),
    ).toThrow(/未注册/)
    expect(() =>
      createModuleSystem({ modules: [mockModule('a', { b: '^1.0.0' }), mockModule('b', { a: '^1.0.0' })] }),
    ).toThrow(CycleError)
  })
})

describe('版本协商（satisfies）', () => {
  it('^ / ~ / 精确 / 范围 匹配', () => {
    expect(satisfies('1.5.0', '^1.2.0')).toBe(true)
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfies('0.2.5', '^0.2.0')).toBe(true)
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false)
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true)
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false)
    expect(satisfies('1.2.5', '~1.2.0')).toBe(true)
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false)
    expect(satisfies('1.2.0', '1.2.0')).toBe(true)
    expect(satisfies('1.2.1', '1.2.0')).toBe(false)
    expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true)
    expect(satisfies('2.1.0', '1.0.0 - 2.0.0')).toBe(false)
  })

  it('版本不匹配 → VersionMismatchError（含冲突链，resolve 阶段当场抛）', () => {
    expect(() =>
      createModuleSystem({
        modules: [
          { name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' } },
          { name: 'b', version: '2.0.0' },
        ],
      }),
    ).toThrow(VersionMismatchError)
    expect(() =>
      createModuleSystem({
        modules: [
          { name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' } },
          { name: 'b', version: '2.0.0' },
        ],
      }),
    ).toThrow(/a 依赖 "b@\^1\.0\.0"，实际解析 b@2\.0\.0/)
  })
})

describe('ModuleEventBus', () => {
  it('on/emit/取消订阅', () => {
    const bus = createModuleEventBus()
    const seen: unknown[] = []
    const off = bus.on('order:created', (p) => seen.push(p))
    bus.emit('order:created', { id: 1 })
    off()
    bus.emit('order:created', { id: 2 })
    expect(seen).toEqual([{ id: 1 }])
  })
})

describe('★B7c：懒加载 loadModule（M7.3）', () => {
  it('动态注册 + 初始化（钩子执行 + state ready + getModule 可用）', async () => {
    const log: string[] = []
    const ms = createModuleSystem({ modules: [mockModule('user', {}, log)] })
    await ms.init()
    const trade = await ms.loadModule(mockModule('trade', { user: '^1.0.0' }, log, { onInit: () => { log.push('init:trade') } }))
    expect(log).toContain('init:trade')
    expect(ms.getState('trade')).toBe('ready')
    expect(ms.getModule('trade')).toBe(trade)
    expect(ms.modules()).toContain('trade')
  })

  it('重复加载 → 返回已有实例（幂等，不二次 init）', async () => {
    let initCount = 0
    const ms = createModuleSystem({ modules: [] })
    await ms.init()
    const def = { name: 'a', version: '1.0.0', lifecycle: { onInit: () => { initCount++ } } }
    const inst1 = await ms.loadModule(def)
    const inst2 = await ms.loadModule(def)
    expect(inst1).toBe(inst2)
    expect(initCount).toBe(1)
  })

  it('依赖未注册 / 版本不匹配 → 报错（懒加载模块依赖须已注册）', async () => {
    const ms = createModuleSystem({ modules: [{ name: 'b', version: '2.0.0' }] })
    await ms.init()
    await expect(ms.loadModule({ name: 'a', version: '1.0.0', dependencies: { ghost: '^1.0.0' } })).rejects.toThrow(/未注册/)
    await expect(ms.loadModule({ name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' } })).rejects.toThrow(VersionMismatchError)
  })
})
