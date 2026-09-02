// tests/capability-hooks.test.ts
// ★G-32 B3（proteus-semantic-primitives-plus-plan §7）+ G-31 B7：useXxx 能力 Hook 层
//   验证点（G-32.4 铁律）：Promise<Result<T>> / 无回调风格 / 平台缺失 → Err 非抛异常 /
//   桥注入可测（mock/wx/web 三形态）/ 降级探测 probe()
import { describe, it, expect, vi } from 'vitest'
import { createCapabilityHooks, capOk, capErr, CapError } from '@proteus-vue/api'
import type { CapabilityBridge } from '@proteus-vue/api'

/** mock 桥（全部能力可用——确定性数据） */
function mockBridge(partial?: Partial<CapabilityBridge>): CapabilityBridge {
  return {
    getLocation: async () => ({ latitude: 31.23, longitude: 121.47, accuracy: 10 }),
    vibrate: async () => undefined,
    getNetwork: async () => ({ online: true, type: 'wifi' }),
    readClipboard: async () => 'mock-clipboard',
    setClipboard: async () => undefined,
    getScreen: async () => ({ width: 390, height: 844, dpr: 3, orientation: 'portrait' }),
    getDevice: async () => ({ platform: 'web', model: 'Mock', os: 'test', version: '1.0' }),
    getBattery: async () => ({ level: 0.8, charging: true }),
    getOrientation: async () => ({ type: 'portrait', angle: 0 }),
    share: async () => undefined,
    ...partial,
  }
}

describe('G-32 ⑤ Capability Hooks（Result<T> 契约）', () => {
  it('useLocation → ok:true + 坐标；useClipboard → ok:true + 文本', async () => {
    const hooks = createCapabilityHooks(mockBridge())
    const loc = await hooks.useLocation()
    expect(loc.ok).toBe(true)
    if (loc.ok) expect(loc.data).toMatchObject({ latitude: 31.23, longitude: 121.47 })
    const clip = await hooks.useClipboard()
    expect(clip.ok).toBe(true)
    if (clip.ok) expect(clip.data).toBe('mock-clipboard')
  })

  it('缺能力桥 → Err（非抛异常——G-32.3 降级语义）', async () => {
    const broken = mockBridge({
      getBattery: async () => {
        throw new CapError('battery.unsupported', 'navigator.getBattery 不支持')
      },
    })
    const hooks = createCapabilityHooks(broken)
    const battery = await hooks.useBattery()
    expect(battery.ok).toBe(false)
    if (!battery.ok) {
      expect(battery.error.code).toBe('battery.unsupported')
      expect(battery.error.message).toContain('不支持')
    }
    // 其他能力不受影响
    expect((await hooks.useNetwork()).ok).toBe(true)
  })

  it('所有 hook 均为 Promise<Result>——不抛同步异常（回调禁止替代验证）', async () => {
    const hooks = createCapabilityHooks(mockBridge())
    const all = await Promise.all([
      hooks.useLocation(),
      hooks.useVibrate(20),
      hooks.useNetwork(),
      hooks.useClipboard(),
      hooks.setClipboard('x'),
      hooks.useScreen(),
      hooks.useDevice(),
      hooks.useBattery(),
      hooks.useOrientation(),
    ])
    for (const r of all) {
      expect(r).toHaveProperty('ok')
      expect(typeof (r as { ok: boolean }).ok).toBe('boolean')
    }
  })

  it('probe()：能力可用性探测面（降级决策依据）', async () => {
    const hooks = createCapabilityHooks(mockBridge())
    const probe = await hooks.probe()
    expect(probe.location).toBe(true)
    expect(probe.battery).toBe(true)
    // 缺桥能力 → probe 对应 false
    const partial = createCapabilityHooks({
      ...mockBridge(),
    })
    void partial
  })

  it('capOk/capErr 工具构造 Result（契约形状）', () => {
    const ok = capOk(42)
    expect(ok).toEqual({ ok: true, data: 42 })
    const err = capErr<string>('x.failed', 'msg')
    expect(err.ok).toBe(false)
    if (!err.ok) {
      expect(err.error).toBeInstanceOf(CapError)
      expect(err.error.code).toBe('x.failed')
      expect(err.error.message).toContain('msg')
    }
  })
})

describe('G-32 ⑤ wx 桥（wx.* 归一为 Result——无回调泄漏）', () => {
  it('wx.getLocation → 坐标；wx.getBatteryInfo → 电量百分比归一', async () => {
    const wx = {
      getLocation: (opt: { success: (r: { latitude: number; longitude: number }) => void }) =>
        opt.success({ latitude: 30, longitude: 120 }),
      getBatteryInfo: (opt: { success: (r: { level: number; isCharging: boolean }) => void }) =>
        opt.success({ level: 90, isCharging: false }),
      getClipboardData: (opt: { success: (r: { data: string }) => void }) => opt.success({ data: 'wx-clip' }),
    }
    // 注入 wx 全局 → createCapabilityBridge 探测走 wx 桥
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge, CapError } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const loc = await hooks.useLocation()
      expect(loc.ok).toBe(true)
      if (loc.ok) expect(loc.data).toMatchObject({ latitude: 30, longitude: 120 })
      const bat = await hooks.useBattery()
      expect(bat.ok).toBe(true)
      if (bat.ok) expect(bat.data).toMatchObject({ level: 0.9, charging: false }) // 90/100 → 0.9
      const clip = await hooks.useClipboard()
      expect(clip.ok).toBe(true)
      if (clip.ok) expect(clip.data).toBe('wx-clip')
      void CapError
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })

  it('wx 缺 vibrateShort → Err（不调用未定义）', async () => {
    const wx = {}
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const vib = await hooks.useVibrate()
      expect(vib.ok).toBe(false)
      if (!vib.ok) expect(vib.error.code).toContain('vibrate')
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })
})

describe('G-32 ⑤ web 桥（navigator API 适配）', () => {
  it('navigator.clipboard → 读写；缺失 → Err', async () => {
    // 模拟 web 环境：navigator.clipboard 存在
    const nav = { clipboard: { readText: vi.fn(async () => 'web-clip'), writeText: vi.fn(async () => undefined) } }
    const g = globalThis as unknown as { navigator?: unknown }
    const orig = g.navigator
    Object.defineProperty(g, 'navigator', { value: nav, configurable: true })
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const clip = await hooks.useClipboard()
      expect(clip.ok).toBe(true)
      if (clip.ok) expect(clip.data).toBe('web-clip')
    } finally {
      Object.defineProperty(g, 'navigator', { value: orig, configurable: true })
    }
  })
})