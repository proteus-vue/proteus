// tests/capability-trace.test.ts —— devtools 打通：capability 探测/降级 → TraceBus → 面板 timeline 能力泳道
// 协议（CapabilityRegistry.setTraceBus）：capability.detect point { name, platform, supported, fallback }
// @vitest-environment happy-dom（面板集成断言）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CapabilityRegistry, registerAdapter, clearCapabilities, setCapabilityTraceBus, useCapability } from '@proteus-vue/capabilities'
import type { CapabilityTraceBus, CapabilityAdapter } from '@proteus-vue/capabilities'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import { createDevtoolsPanel, createTraceBusSource } from '@proteus-vue/devtools'

interface Recorded {
  source: string
  phase: string
  name: string
  payload: unknown
}

function mockBus() {
  const events: Recorded[] = []
  const emit = vi.fn((source: string, phase: string, name: string, payload?: unknown) => {
    events.push({ source, phase, name, payload })
  })
  return { emit, events }
}

function adapterFor(id: string, supported = true): CapabilityAdapter {
  return {
    capability: id,
    platform: 'web',
    isSupported: () => supported,
    create: () => ({ isSupported: () => supported }),
  }
}

afterEach(() => {
  clearCapabilities()
  vi.restoreAllMocks()
})

describe('capability → TraceBus 协议', () => {
  it('探测命中 → capability.detect point（supported: true + platform）', () => {
    const bus = mockBus()
    const registry = new CapabilityRegistry()
    registry.setTraceBus(bus as unknown as CapabilityTraceBus)
    registry.register(adapterFor('clipboard'))
    const cap = registry.resolveSync('clipboard', 'web')
    expect(cap).toBeDefined()
    expect(bus.events.length).toBe(1)
    expect(bus.events[0]).toMatchObject({ source: 'capability', phase: 'point', name: 'capability.detect' })
    expect(bus.events[0].payload).toMatchObject({ name: 'clipboard', platform: 'web', supported: true })
  })

  it('探测未命中 → capability.detect（supported: false + fallback 指向）+ 降级能力命中', () => {
    const bus = mockBus()
    const registry = new CapabilityRegistry()
    registry.setTraceBus(bus as unknown as CapabilityTraceBus)
    registry.register(adapterFor('login.wechat', false))
    registry.register(adapterFor('login.phone'))
    registry.registerFallback('login.wechat', 'login.phone')
    registry.resolveSync('login.wechat', 'web')
    const events = bus.events.map((e) => e.payload as { name: string; supported: boolean })
    // 探测顺序：wechat 不支持（降级到 phone）→ phone 命中
    expect(events).toContainEqual({ name: 'login.wechat', platform: 'web', supported: false, fallback: 'login.phone' })
    expect(events).toContainEqual({ name: 'login.phone', platform: 'web', supported: true, fallback: undefined })
    expect(events[0].name).toBe('login.wechat')
    expect(events[1].name).toBe('login.phone')
  })

  it('全局 registry：setCapabilityTraceBus + useCapability 探测事件；无 bus 不发射', () => {
    clearCapabilities()
    registerAdapter(adapterFor('clipboard'))
    const bus = mockBus()
    setCapabilityTraceBus(bus as unknown as CapabilityTraceBus)
    const cap = useCapability('clipboard')
    expect(cap?.isSupported()).toBe(true)
    expect(bus.events.length).toBe(1)
    // 无 bus → 探测正常不发射
    setCapabilityTraceBus(undefined)
    bus.events.length = 0
    useCapability('clipboard')
    expect(bus.events.length).toBe(0)
  })
})

describe('capability → 面板（集成）', () => {
  it('探测事件 → 面板 timeline 出现 capability 泳道', async () => {
    const root = document.createElement('div')
    const bus = createTraceBus({ enabled: true })
    const panel = createDevtoolsPanel(root, { source: createTraceBusSource(bus) })
    const registry = new CapabilityRegistry()
    registry.setTraceBus(bus)
    registry.register(adapterFor('clipboard'))
    registry.resolveSync('clipboard', 'web')
    await new Promise((r) => setTimeout(r, 40)) // 16ms 节流渲染
    const timelineView = root.querySelector('.pd-view[data-view="timeline"]') as HTMLElement
    const labels = Array.from(timelineView.querySelectorAll('.pd-lane-label')).map((l) => l.textContent)
    expect(labels).toContain('capability')
    panel.destroy()
  })
})
