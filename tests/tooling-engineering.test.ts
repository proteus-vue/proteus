// tests/tooling-engineering.test.ts
// ★G-32 B5 续三（proteus-semantic-primitives-plus-plan §8 ④）：E24-E28 工程化语义面——注入式 createToolingEngineering
//   验证点：E24 useDevTools（dev 事件面）· E25 useInspector（组件树快照）· E26 usePerformance（wx.reportPerformance
//   语义）· E27 defineComponent + validateComponentMeta（类型化定义 + 声明期验证）· E28 defineCapability +
//   resolveCapabilityChain（G-30 降级链解析）
import { describe, it, expect, vi } from 'vitest'
import {
  createToolingEngineering,
  defineComponent,
  defineCapability,
  resolveCapabilityChain,
  validateComponentMeta,
  validateCapabilityContract,
} from '@proteus-vue/api'
import type { CapabilityContract, Reactivity } from '@proteus-vue/api'

/** 简单 reactivity mock（ref：{value} 可写；computed/watch 静态）——既有测试同构 */
function mockReactivity(): Reactivity {
  return {
    ref: <T>(initial: T) => {
      let v = initial
      return {
        get value() {
          return v
        },
        set value(nv: T) {
          v = nv
        },
      }
    },
    computed: <T>(getter: () => T) => ({ value: getter() }),
    watch: <T>(getter: () => T, cb: (v: T, o: T) => void) => {
      void getter
      void cb
      return () => undefined
    },
  }
}

describe('G-32 B5 续三 工程化语义（E24-E28）', () => {
  it('E24 useDevTools：log 记录事件到响应式队列 + 转发注入 sink；disabled 关闭不发射', () => {
    let now = 1000
    const sink = vi.fn()
    const tool = createToolingEngineering({ reactivity: mockReactivity() })
    const dev = tool.useDevTools({ enabled: true, sink, now: () => now })
    dev.log('render', { count: 1 })
    expect(dev.events.value.length).toBe(1)
    expect(dev.events.value[0].type).toBe('render')
    expect(dev.events.value[0].time).toBe(1000)
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'render' }))
    now = 1500
    dev.log('api')
    expect(dev.events.value.length).toBe(2)
    expect(dev.events.value[1].time).toBe(1500)
    dev.clear()
    expect(dev.events.value.length).toBe(0)
    // disabled → no-op（不记录不转发）
    const off = tool.useDevTools({ enabled: false, sink })
    off.log('render')
    expect(off.events.value.length).toBe(0)
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('E25 useInspector：register 组件树 → snapshot 树结构；覆盖登记；unregister 子树', () => {
    const tool = createToolingEngineering({ reactivity: mockReactivity() })
    const inspector = tool.useInspector()
    inspector.register({ id: 'page-1', name: 'p-page', semantic: 'shell.page' })
    inspector.register({ id: 'btn-1', name: 'p-button', semantic: 'ui.button', parentId: 'page-1', props: { variant: 'primary' } })
    inspector.register({ id: 'btn-2', name: 'p-button', semantic: 'ui.button', parentId: 'page-1', props: { variant: 'ghost' } })
    // 覆盖登记（同 id 更新 props）
    inspector.register({ id: 'btn-2', name: 'p-button', semantic: 'ui.button', parentId: 'page-1', props: { variant: 'danger' } })
    let tree = inspector.snapshot()
    expect(tree.length).toBe(1)
    expect(tree[0].semantic).toBe('shell.page')
    expect(tree[0].children.length).toBe(2)
    expect(tree[0].children[1].props.variant).toBe('danger')
    // unregister 子树（btn-1 移除 → btn-2 不受影响）
    inspector.unregister('btn-1')
    tree = inspector.snapshot()
    expect(tree[0].children.length).toBe(1)
  })

  it('E26 usePerformance：mark/measure 时长（注入 now）+ report 委托 reporter + 响应式 metrics + reset', () => {
    let t = 0
    const reporter = vi.fn()
    const tool = createToolingEngineering({ reactivity: mockReactivity() })
    const perf = tool.usePerformance({ now: () => t, reporter })
    perf.mark('start')
    t = 120
    const d1 = perf.measure('render', 'start')
    expect(d1).toBe(120)
    expect(reporter).toHaveBeenCalledWith('render', 120)
    expect(perf.metrics.value).toEqual([{ name: 'render', value: 120 }])
    t = 220
    perf.report('frame', 100)
    expect(perf.metrics.value.length).toBe(2)
    // 缺省 startMark → 上一个 mark
    perf.mark('frame-start')
    t = 300
    const d2 = perf.measure('frame')
    expect(d2).toBe(80)
    // 无关的 startMark → undefined
    expect(perf.measure('x', 'nope')).toBeUndefined()
    perf.reset()
    expect(perf.metrics.value.length).toBe(0)
  })

  it('E27 defineComponent：类型化透传定义（含 C-IR 元信息）+ validateComponentMeta 声明期校验', () => {
    const def = defineComponent({
      name: 'p-my',
      semantic: 'layout.box',
      props: { label: { type: 'String', required: true }, count: { type: 'Number', default: 0 } },
      emits: ['update:modelValue'],
      slots: ['default'],
    })
    // 类型化透传：原对象返回（定义即声明，零拷贝）
    expect(def.name).toBe('p-my')
    expect(def.semantic).toBe('layout.box')
    expect(def.props?.label.required).toBe(true)
    // 合法定义 → 零错误
    expect(validateComponentMeta(def)).toEqual([])
    // 非法：空 name / 缺 semantic / 非法 prop type / 空 emits 项
    expect(validateComponentMeta({ name: '', semantic: 'layout.box' })).toContain('name 必填（组件名）')
    expect(validateComponentMeta({ name: 'p-x', semantic: '' })).toContain('semantic 必填（C-IR 语义）')
    const bad = validateComponentMeta({ name: 'p-x', semantic: 'layout.box', props: { a: { type: 'Nope' } } })
    expect(bad.some((e) => e.includes('type 非法'))).toBe(true)
    const badEmits = validateComponentMeta({ name: 'p-x', semantic: 'layout.box', emits: [''] })
    expect(badEmits.some((e) => e.includes('emits'))).toBe(true)
  })

  it('E28 validateCapabilityContract + resolveCapabilityChain：降级链校验与解析（G-30）', () => {
    // 校验：重复 / 自引用 / 空 / 合法
    const dup: CapabilityContract = { name: 'scan-qr', fallback: ['a', 'a'] }
    expect(validateCapabilityContract(dup).some((e) => e.includes('重复'))).toBe(true)
    const self: CapabilityContract = { name: 'scan-qr', fallback: ['scan-qr'] }
    expect(validateCapabilityContract(self).some((e) => e.includes('等于自身'))).toBe(true)
    const badName: CapabilityContract = { name: '', fallback: ['a'] }
    expect(validateCapabilityContract(badName).some((e) => e.includes('name 必填'))).toBe(true)
    const ok: CapabilityContract = { name: 'scan-qr', fallback: ['scan-qr-input', 'manual'], required: false }
    expect(validateCapabilityContract(ok)).toEqual([])
    // 解析：自身可用 → 自身；降级 → 链上第一个可用；全不可用 → undefined
    const avail = (impl: string) => impl !== 'scan-qr' && impl !== 'scan-qr-input'
    expect(resolveCapabilityChain('scan-qr', ['scan-qr-input', 'manual'], avail)).toBe('manual')
    expect(resolveCapabilityChain('scan-qr', ['scan-qr-input', 'manual'], () => true)).toBe('scan-qr')
    expect(resolveCapabilityChain('scan-qr', ['scan-qr-input'], () => false)).toBeUndefined()
  })

  it('E28 defineCapability：probe 注入 → check 可用性；resolve 降级解析；isDegraded 语义', async () => {
    const probe = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const tool = createToolingEngineering({ reactivity: mockReactivity() })
    const cap = tool.defineCapability({ name: 'scan-qr', fallback: ['manual'], required: false }, { probe })
    expect(await cap.check()).toBe(false)
    expect(probe).toHaveBeenCalled()
    // resolve 无 availability 表 → 自身
    expect(cap.resolve()).toBe('scan-qr')
    // resolve 带 availability 表（自身不可用 → manual 可用）→ 降级
    const chosen = cap.resolve([
      { name: 'scan-qr', available: false },
      { name: 'manual', available: true },
    ])
    expect(chosen).toBe('manual')
    expect(cap.isDegraded(chosen)).toBe(true)
    expect(cap.isDegraded('scan-qr')).toBe(false)
    expect(cap.isDegraded(undefined)).toBe(false)
    // 链全不可用 → undefined
    expect(
      cap.resolve([
        { name: 'scan-qr', available: false },
        { name: 'manual', available: false },
      ]),
    ).toBeUndefined()
    // 缺省 probe → 恒 true（声明面信任宿主）
    const trusty = defineCapability({ name: 'x', fallback: [] })
    expect(await trusty.check()).toBe(true)
  })
})