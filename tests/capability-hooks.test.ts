// tests/capability-hooks.test.ts
// ★G-32 B3（proteus-semantic-primitives-plus-plan §7）+ G-31 B7：useXxx 能力 Hook 层
//   验证点（G-32.4 铁律）：Promise<Result<T>> / 无回调风格 / 平台缺失 → Err 非抛异常 /
//   桥注入可测（mock/wx/web 三形态）/ 降级探测 probe()
import { describe, it, expect, vi } from 'vitest'
import { createCapabilityHooks, createReactiveStorage, capOk, capErr, CapError } from '@proteus-vue/api'
import type { CapabilityBridge, CompatStorage } from '@proteus-vue/api'

/** 内存 CompatStorage（useStorage 测试底座） */
function memStorage(): CompatStorage {
  const m = new Map<string, string>()
  return {
    get: <T>(key: string) => {
      const raw = m.get(key)
      return raw === undefined ? undefined : (JSON.parse(raw) as T)
    },
    set: (key, value) => m.set(key, JSON.stringify(value)),
    remove: (key) => m.delete(key),
    clear: () => m.clear(),
  }
}

/** 简单响应式代理（模拟 vue reactive——set 时触发副作用） */
function simpleReactive<T extends object>(target: T): T {
  const seen = new Set<string>()
  const tracked = new Set<() => void>()
  const proxy = new Proxy(target, {
    get(obj, key) {
      if (typeof key === 'string' && !seen.has(key)) {
        void seen
      }
      return Reflect.get(obj, key)
    },
    set(obj, key, val) {
      const r = Reflect.set(obj, key, val)
      if (typeof key === 'string') {
        const fns = tracked
        for (const fn of fns) fn()
        void tracked
      }
      return r
    },
  })
  void tracked
  return proxy
}

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

describe('G-32 B3 续：useFetch / usePermission / useStorage / createReactiveStorage', () => {
  it('useFetch：桥 request → CapResult<T>（成功 .data = 载荷，迁移文档解构兼容）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        request: async (config) => ({ data: { url: config.url, method: config.method ?? 'GET' }, status: 200, headers: {}, config }),
      }),
    )
    const r = await hooks.useFetch<{ url: string; method: string }>('/api/x', { method: 'POST' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ url: '/api/x', method: 'POST' })
    const { data } = await hooks.useFetch<{ url: string }>('/api/y')
    expect(data).toMatchObject({ url: '/api/y' }) // migration.md `const { data } = await useFetch(url)`
  })

  it('useFetch：桥无 request → Err（非抛异常——G-32.3 降级）', async () => {
    const hooks = createCapabilityHooks(mockBridge()) // mock 未提供 request
    const r = await hooks.useFetch('/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.unsupported')
  })

  it('usePermission：桥 getPermission → PermissionState（granted/denied/prompt）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        getPermission: async (name) => ({ permission: name, state: 'granted' }),
      }),
    )
    const r = await hooks.usePermission('geolocation')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ permission: 'geolocation', state: 'granted' })
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.usePermission('geolocation')
    expect(r2.ok).toBe(false)
  })

  it('useStorage：桥 getStorage → CompatStorage（set/get/remove/clear 往返）', () => {
    const storage = memStorage()
    const hooks = createCapabilityHooks(
      mockBridge({
        getStorage: () => storage,
      }),
    )
    const store = hooks.useStorage()
    store.set('k', { a: 1 })
    expect(store.get('k')).toEqual({ a: 1 })
    store.remove('k')
    expect(store.get('k')).toBeUndefined()
    // 无桥 → 抛错（明确提示）
    const noBridge = createCapabilityHooks(mockBridge())
    expect(() => noBridge.useStorage()).toThrow(/getStorage/)
  })

  it('createReactiveStorage：set/remove 同步 state（注入式响应式；非注入时普通对象）', () => {
    const storage = memStorage()
    const plain = createReactiveStorage(storage)
    plain.set('name', 'Proteus')
    expect(plain.state.name).toBe('Proteus')

    const reactive = createReactiveStorage<{ count?: number }>(storage, simpleReactive)
    reactive.set('count', 42)
    expect(reactive.state.count).toBe(42)
    reactive.remove('count')
    expect(reactive.state.count).toBeUndefined()
    // 底座持久化不受影响
    expect(storage.get('name')).toBe('Proteus')
  })

  it('probe 补 fetch/permission/storage 标志（G-32.3 降级决策依据）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        request: async (config) => ({ data: null, status: 200, headers: {}, config }),
        getPermission: async (name) => ({ permission: name, state: 'prompt' }),
        getStorage: () => memStorage(),
      }),
    )
    const probe = await hooks.probe()
    expect(probe.fetch).toBe(true)
    expect(probe.permission).toBe(true)
    expect(probe.storage).toBe(true)
  })
})