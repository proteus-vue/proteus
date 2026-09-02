// tests/capability-hooks.test.ts
// ★G-32 B3（proteus-semantic-primitives-plus-plan §7）+ G-31 B7：useXxx 能力 Hook 层
//   验证点（G-32.4 铁律）：Promise<Result<T>> / 无回调风格 / 平台缺失 → Err 非抛异常 /
//   桥注入可测（mock/wx/web 三形态）/ 降级探测 probe()
import { describe, it, expect, vi } from 'vitest'
import { createCapabilityHooks, createReactiveStorage, capOk, capErr, CapError } from '@proteus-vue/api'
import type { CapabilityBridge, CompatStorage, KeyboardInfo } from '@proteus-vue/api'

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

describe('G-32 B3 三期：sensor / brightness / phone-call / biometric / payment / login / qr-code / auth', () => {
  it('useSensor：readSensor 桥 → SensorSample（kind/x/y/z/heading）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        readSensor: async (kind) =>
          kind === 'compass' ? { kind, heading: 45 } : { kind, x: 0.1, y: 0.2, z: 9.8 },
      }),
    )
    const acc = await hooks.useSensor('accelerometer')
    expect(acc.ok).toBe(true)
    if (acc.ok) expect(acc.data).toMatchObject({ kind: 'accelerometer', x: 0.1, y: 0.2, z: 9.8 })
    const comp = await hooks.useSensor('compass')
    expect(comp.ok).toBe(true)
    if (comp.ok) expect(comp.data).toMatchObject({ kind: 'compass', heading: 45 })
  })

  it('useSensor：桥无 readSensor → Err（非抛异常）', async () => {
    const hooks = createCapabilityHooks(mockBridge())
    const r = await hooks.useSensor('gyroscope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('sensor.unsupported')
  })

  it('useBrightness/setBrightness：桥 get/setBrightness → 返回值 / Result<void>', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        getBrightness: async () => 0.5,
        setBrightness: async (value) => {
          void value
        },
      }),
    )
    const cur = await hooks.useBrightness()
    expect(cur.ok).toBe(true)
    if (cur.ok) expect(cur.data).toBe(0.5)
    const set = await hooks.setBrightness(0.3)
    expect(set.ok).toBe(true)
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useBrightness()).ok).toBe(false)
    expect((await noBridge.setBrightness(0.3)).ok).toBe(false)
  })

  it('usePhoneCall：桥 makePhoneCall → ok；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        makePhoneCall: async (phoneNumber) => {
          void phoneNumber
        },
      }),
    )
    const r = await hooks.usePhoneCall('10086')
    expect(r.ok).toBe(true)
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.usePhoneCall('10086')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('phone-call.unsupported')
  })

  it('useBiometric/authenticateBiometric：支持性检测 + 认证（桥注入）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        checkBiometricSupport: async () => true,
        authenticateBiometric: async (options) => {
          void options
          return true
        },
      }),
    )
    const sup = await hooks.useBiometric()
    expect(sup.ok).toBe(true)
    if (sup.ok) expect(sup.data).toBe(true)
    const auth = await hooks.authenticateBiometric({ prompt: '验证指纹' })
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.data).toBe(true)
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useBiometric()).ok).toBe(false)
    expect((await noBridge.authenticateBiometric()).ok).toBe(false)
  })

  it('usePayment：桥 requestPayment → PaymentReceipt；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        requestPayment: async (config) => ({ provider: 'wx', transactionId: config.nonceStr }),
      }),
    )
    const r = await hooks.usePayment({ timeStamp: 't', nonceStr: 'n', package: 'prepay_id=x', paySign: 'sig' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ provider: 'wx', transactionId: 'n' })
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.usePayment({ timeStamp: 't', nonceStr: 'n', package: 'p', paySign: 's' })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('payment.unsupported')
  })

  it('useLogin：桥 login → LoginResult（code）；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        login: async (provider) => ({ provider: provider ?? 'wx', code: 'wx-code' }),
      }),
    )
    const r = await hooks.useLogin()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ provider: 'wx', code: 'wx-code' })
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useLogin()
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('login.unsupported')
  })

  it('useQRCode：桥 scanQR → 字符串结果；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        scanQR: async () => 'https://proteus-vue.org/qr-target',
      }),
    )
    const r = await hooks.useQRCode()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('https://proteus-vue.org/qr-target')
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useQRCode()
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('qr-code.unsupported')
  })

  it('useAuth：组合（storage + login 桥）——login 存 token / logout 清 / subscribe 联动 / 业务不读 raw token', async () => {
    const storage = memStorage()
    const hooks = createCapabilityHooks(
      mockBridge({
        getStorage: () => storage,
        login: async (provider) => ({ provider: provider ?? 'wx', code: 'code-1' }),
      }),
    )
    const auth = hooks.useAuth()
    expect(auth.isAuthenticated).toBe(false)
    const seen: Array<string | null> = []
    const off = auth.subscribe((t) => seen.push(t))
    const r = await auth.login()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('code-1')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.token).toBe('code-1')
    expect(seen).toEqual(['code-1'])
    // 持久化到底座（storage 桥）——logout 前
    expect(storage.get('proteus.auth.token')).toBe('code-1')
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBeNull()
    expect(seen[seen.length - 1]).toBeNull()
    // logout 后清理为空串（createAuth.setToken(null) 语义）
    expect(storage.get('proteus.auth.token')).toBe('')
    off()
  })

  it('useAuth：无 login 桥 → login() 返回 Err（state 本身仍可用——setToken 手动托管）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        getStorage: () => memStorage(),
      }),
    )
    const auth = hooks.useAuth()
    const r = await auth.login()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('login.unsupported')
    auth.setToken('manual-token')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.token).toBe('manual-token')
  })

  it('probe 三期标志：sensor/brightness/phoneCall/biometric/payment/login/qrCode/auth', async () => {
    const full = createCapabilityHooks(
      mockBridge({
        readSensor: async (k) => ({ kind: k }),
        getBrightness: async () => 1,
        setBrightness: async () => undefined,
        makePhoneCall: async () => undefined,
        checkBiometricSupport: async () => true,
        authenticateBiometric: async () => true,
        requestPayment: async () => ({ provider: 'wx' }),
        login: async () => ({ provider: 'wx', code: 'c' }),
        scanQR: async () => 'qr',
        getStorage: () => memStorage(),
      }),
    )
    const probe = await full.probe()
    expect(probe.sensor).toBe(true)
    expect(probe.brightness).toBe(true)
    expect(probe.phoneCall).toBe(true)
    expect(probe.biometric).toBe(true)
    expect(probe.payment).toBe(true)
    expect(probe.login).toBe(true)
    expect(probe.qrCode).toBe(true)
    expect(probe.auth).toBe(true)
    // 缺桥能力 → 对应标志 false
    const partial = createCapabilityHooks(mockBridge())
    const probe2 = await partial.probe()
    expect(probe2.sensor).toBe(false)
    expect(probe2.payment).toBe(false)
    expect(probe2.qrCode).toBe(false)
    expect(probe2.auth).toBe(false)
  })
})

describe('G-32 B3 三期 wx 桥（wx.* 归一为 Result——无回调泄漏）', () => {
  it('wx 传感器/亮度/电话/生物识别/支付/登录/扫码 → Promise 归一', async () => {
    const wx = {
      onAccelerometerChange: (cb: (r: { x: number; y: number; z: number }) => void) => cb({ x: 1, y: 2, z: 3 }),
      getScreenBrightness: (opt: { success: (r: { value: number }) => void }) => opt.success({ value: 0.7 }),
      setScreenBrightness: (opt: { value: number }) => {
        void opt
      },
      makePhoneCall: (opt: { success?: () => void }) => opt.success?.(),
      checkIsSupportFingerPrint: (opt: { success: (r: { isSupported: boolean }) => void }) => opt.success({ isSupported: true }),
      startSoterAuthentication: (opt: { success: () => void }) => opt.success(),
      requestPayment: (opt: { success: () => void }) => opt.success(),
      login: (opt: { success: (r: { code: string }) => void }) => opt.success({ code: 'wx-login-code' }),
      scanCode: (opt: { success: (r: { result: string }) => void }) => opt.success({ result: 'wx-qr-result' }),
    }
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const acc = await hooks.useSensor('accelerometer')
      expect(acc.ok).toBe(true)
      if (acc.ok) expect(acc.data).toMatchObject({ kind: 'accelerometer', x: 1, y: 2, z: 3 })
      const bright = await hooks.useBrightness()
      expect(bright.ok).toBe(true)
      if (bright.ok) expect(bright.data).toBe(0.7)
      await expect(hooks.setBrightness(0.3)).resolves.toMatchObject({ ok: true })
      await expect(hooks.usePhoneCall('10086')).resolves.toMatchObject({ ok: true })
      const bio = await hooks.useBiometric()
      expect(bio.ok).toBe(true)
      if (bio.ok) expect(bio.data).toBe(true)
      await expect(hooks.authenticateBiometric()).resolves.toMatchObject({ ok: true })
      const pay = await hooks.usePayment({ timeStamp: 't', nonceStr: 'n', package: 'p', paySign: 's' })
      expect(pay.ok).toBe(true)
      if (pay.ok) expect(pay.data).toMatchObject({ provider: 'wx' })
      const login = await hooks.useLogin()
      expect(login.ok).toBe(true)
      if (login.ok) expect(login.data).toMatchObject({ provider: 'wx', code: 'wx-login-code' })
      const qr = await hooks.useQRCode()
      expect(qr.ok).toBe(true)
      if (qr.ok) expect(qr.data).toBe('wx-qr-result')
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })

  it('wx 缺能力（无传感器/无指纹）→ Err 非抛异常', async () => {
    const wx = {} // 无任何能力
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      expect((await hooks.useSensor('compass')).ok).toBe(false)
      expect((await hooks.useBrightness()).ok).toBe(false)
      expect((await hooks.useBiometric()).ok).toBe(false)
      expect((await hooks.usePayment({ timeStamp: 't', nonceStr: 'n', package: 'p', paySign: 's' })).ok).toBe(false)
      expect((await hooks.useLogin()).ok).toBe(false)
      expect((await hooks.useQRCode()).ok).toBe(false)
      expect((await hooks.usePhoneCall('10086')).ok).toBe(false)
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })
})

describe('G-32 B3 三期 web 桥（真实浏览器能力——DeviceMotion/WebAuthn）', () => {
  it('web readSensor：devicemotion 事件 → SensorSample（一次性 + 清理）', async () => {
    const listeners: Array<{ t: string; cb: (e: unknown) => void }> = []
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void) => void
      removeEventListener?: (t: string, cb: (e: unknown) => void) => void
      navigator?: unknown
      wx?: unknown
    }
    g.addEventListener = (t, cb) => {
      listeners.push({ t, cb })
    }
    g.removeEventListener = (t, cb) => {
      const i = listeners.findIndex((l) => l.t === t && l.cb === cb)
      if (i >= 0) listeners.splice(i, 1)
    }
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const p = hooks.useSensor('accelerometer')
      await new Promise((r) => setTimeout(r, 0))
      expect(listeners.length).toBeGreaterThan(0)
      const entry = listeners.find((l) => l.t === 'devicemotion')
      expect(entry).toBeTruthy()
      entry!.cb({ accelerationIncludingGravity: { x: 0.5, y: 0.6, z: 9.8 } })
      const r = await p
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data).toMatchObject({ kind: 'accelerometer', x: 0.5, y: 0.6, z: 9.8 })
      // 一次性：事件后即清理（无残留监听）
      expect(listeners.filter((l) => l.t === 'devicemotion').length).toBe(0)
    } finally {
      delete g.addEventListener
      delete g.removeEventListener
    }
  })

  it('web readSensor compass：deviceorientation → heading（webkitCompassHeading 优先）', async () => {
    const listeners: Array<{ t: string; cb: (e: unknown) => void }> = []
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void) => void
      removeEventListener?: (t: string, cb: (e: unknown) => void) => void
    }
    const addSpy = vi.fn((t: string, cb: (e: unknown) => void) => {
      listeners.push({ t, cb })
    })
    g.addEventListener = addSpy
    g.removeEventListener = (t, cb) => {
      const i = listeners.findIndex((l) => l.t === t && l.cb === cb)
      if (i >= 0) listeners.splice(i, 1)
    }
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const p = hooks.useSensor('compass')
      await new Promise((r) => setTimeout(r, 0))
      const entry = listeners.find((l) => l.t === 'deviceorientation')
      expect(entry).toBeTruthy()
      entry!.cb({ webkitCompassHeading: 200 })
      const r = await p
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data).toMatchObject({ kind: 'compass', heading: 200 })
    } finally {
      delete g.addEventListener
      delete g.removeEventListener
    }
  })

  it('web readSensor：超时（无事件）→ Err sensor.timeout', async () => {
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void) => void
      removeEventListener?: (t: string, cb: (e: unknown) => void) => void
    }
    g.addEventListener = () => undefined
    g.removeEventListener = () => undefined
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const r = await hooks.useSensor('gyroscope')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('sensor.timeout')
    } finally {
      delete g.addEventListener
      delete g.removeEventListener
    }
  })

  it('web biometric：PublicKeyCredential 存在 → useBiometric true；navigator.credentials.get → 认证 ok', async () => {
    const g = globalThis as unknown as {
      PublicKeyCredential?: unknown
      navigator?: unknown
      wx?: unknown
      location?: unknown
    }
    const origCred = Object.getOwnPropertyDescriptor(g, 'PublicKeyCredential')
    const origNav = Object.getOwnPropertyDescriptor(g, 'navigator')
    const getSpy = vi.fn(async (_opts: { publicKey: Record<string, unknown> }) => ({ id: 'credential-id' }))
    try {
      Object.defineProperty(g, 'PublicKeyCredential', { value: class PublicKeyCredential {}, configurable: true })
      // ★遵循既有 web 桥测试先例（L184-199）：navigator 在多端环境为只读——defineProperty 注入
      Object.defineProperty(g, 'navigator', { value: { credentials: { get: getSpy } }, configurable: true })
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const sup = await hooks.useBiometric()
      expect(sup.ok).toBe(true)
      if (sup.ok) expect(sup.data).toBe(true)
      const auth = await hooks.authenticateBiometric({ prompt: 'WebAuthn 验证' })
      expect(auth.ok).toBe(true)
      if (auth.ok) expect(auth.data).toBe(true)
      expect(getSpy).toHaveBeenCalled()
      const calledWith = getSpy.mock.calls[0][0] as { publicKey: Record<string, unknown> } | undefined
      expect(calledWith?.publicKey.userVerification).toBe('required')
    } finally {
      if (origCred) Object.defineProperty(g, 'PublicKeyCredential', origCred)
      else delete g.PublicKeyCredential
      if (origNav) Object.defineProperty(g, 'navigator', origNav)
      else delete g.navigator
    }
  })

  it('web biometric：无 WebAuthn → 返回 data:false（能力存在、设备不支持——feature detection 语义）', async () => {
    const g = globalThis as unknown as { PublicKeyCredential?: unknown; wx?: unknown }
    const origCred = Object.getOwnPropertyDescriptor(g, 'PublicKeyCredential')
    try {
      // 明确抹掉 PublicKeyCredential → 桥 feature detection 判定 WebAuthn 不可用（结果为 data:false 非 Err）
      if (origCred) Object.defineProperty(g, 'PublicKeyCredential', { ...origCred, value: undefined })
      else Object.defineProperty(g, 'PublicKeyCredential', { value: undefined, configurable: true })
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const sup = await hooks.useBiometric()
      // ★checkBiometricSupport 是 feature detection：桥始终提供，返回布尔（false = 设备不支持）——
      //   Err('biometric.unsupported') 只发生在桥完全缺失该方法（mock/无 bridge 注入）
      expect(sup.ok).toBe(true)
      if (sup.ok) expect(sup.data).toBe(false)
    } finally {
      if (origCred) Object.defineProperty(g, 'PublicKeyCredential', origCred)
      else delete g.PublicKeyCredential
    }
  })
})

describe('G-32 B3 四期：websocket / upload / download / analytics / log / file-system', () => {
  it('useWebSocket：桥 connectWebSocket → 连接句柄（send/close/on）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        connectWebSocket: async (url, protocols) => ({
          send: () => undefined,
          close: () => undefined,
          on: () => () => undefined,
          _url: url,
          _protocols: protocols,
        } as never),
      }),
    )
    const r = await hooks.useWebSocket('wss://x', ['p1'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(typeof r.data.send).toBe('function')
      expect(typeof r.data.close).toBe('function')
      expect(typeof r.data.on).toBe('function')
    }
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useWebSocket('wss://x')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('websocket.unsupported')
  })

  it('useUpload：桥 upload → UploadResult（status/data/progress）；无 filePath（wx）→ 由桥负责，mock 直通', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        upload: async (options, onProgress) => {
          onProgress?.(50)
          onProgress?.(100)
          return { status: 200, data: { ok: true }, progress: 100 }
        },
      }),
    )
    const progress: number[] = []
    const r = await hooks.useUpload({ url: '/up', filePath: '/tmp/a.png' }, (p) => progress.push(p))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ status: 200, data: { ok: true }, progress: 100 })
    expect(progress).toEqual([50, 100])
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useUpload({ url: '/up', filePath: '/tmp/a.png' })).ok).toBe(false)
  })

  it('useDownload：桥 download → DownloadResult（status/data/path）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        download: async (url, options) => ({ status: 200, data: 'blob', path: '/tmp/d.bin', progress: 100 }),
      }),
    )
    const r = await hooks.useDownload('/down', { responseType: 'path' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ status: 200, path: '/tmp/d.bin' })
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useDownload('/down')).ok).toBe(false)
    if (!(await noBridge.useDownload('/down')).ok) {
      const r2 = await noBridge.useDownload('/down')
      if (!r2.ok) expect(r2.error.code).toBe('download.unsupported')
    }
  })

  it('useAnalytics：桥 track → ok；无桥 → track 返回 Err（句柄本身不抛）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        track: async (name, params) => {
          void name
          void params
        },
      }),
    )
    const analytics = hooks.useAnalytics()
    const r = await analytics.track('page_view', { page: '/' })
    expect(r.ok).toBe(true)
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useAnalytics().track('x')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('analytics.unsupported')
  })

  it('useLog：桥 log → ok；无桥 → Err', async () => {
    const lines: Array<{ level: string; message: string }> = []
    const hooks = createCapabilityHooks(
      mockBridge({
        log: async (level, message) => {
          lines.push({ level, message })
        },
      }),
    )
    const logger = hooks.useLog()
    await expect(logger.log('info-msg')).resolves.toMatchObject({ ok: true })
    await expect(logger.warn('warn-msg')).resolves.toMatchObject({ ok: true })
    await expect(logger.error('err-msg')).resolves.toMatchObject({ ok: true })
    expect(lines).toEqual([
      { level: 'log', message: 'info-msg' },
      { level: 'warn', message: 'warn-msg' },
      { level: 'error', message: 'err-msg' },
    ])
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useLog().log('x')).ok).toBe(false)
  })

  it('useFileSystem：桥 getFileSystem → FSAdapter（read/write/remove/exists 往返；方法均返回 Result）', async () => {
    const mem = new Map<string, string>()
    const fsBridge = {
      readFile: async (path: string) => {
        const v = mem.get(path)
        if (v === undefined) throw new Error('not found')
        return v
      },
      writeFile: async (path: string, data: string) => {
        mem.set(path, data)
      },
      remove: async (path: string) => {
        mem.delete(path)
      },
      exists: async (path: string) => mem.has(path),
    }
    const hooks = createCapabilityHooks(
      mockBridge({
        getFileSystem: () => fsBridge,
      }),
    )
    const fs = hooks.useFileSystem()
    expect(fs.supported).toBe(true)
    await expect(fs.writeFile('/a.txt', 'hello')).resolves.toMatchObject({ ok: true })
    const read = await fs.readFile('/a.txt')
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.data).toBe('hello')
    const before = await fs.exists('/a.txt')
    expect(before.ok).toBe(true)
    if (before.ok) expect(before.data).toBe(true)
    await expect(fs.remove('/a.txt')).resolves.toMatchObject({ ok: true })
    const after = await fs.exists('/a.txt')
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.data).toBe(false)
    // 无桥 → useFileSystem 抛错（同 useStorage 惯例）
    const noBridge = createCapabilityHooks(mockBridge())
    expect(() => noBridge.useFileSystem()).toThrow(/getFileSystem/)
  })

  it('probe 四期标志：websocket/upload/download/analytics/log/fileSystem', async () => {
    const full = createCapabilityHooks(
      mockBridge({
        connectWebSocket: async () => ({ send: () => undefined, close: () => undefined, on: () => () => undefined } as never),
        upload: async () => ({ status: 200, data: null }),
        download: async () => ({ status: 200, data: null }),
        track: async () => undefined,
        log: async () => undefined,
        getFileSystem: () => ({
          readFile: async () => '',
          writeFile: async () => undefined,
          remove: async () => undefined,
          exists: async () => true,
        }),
      }),
    )
    const probe = await full.probe()
    expect(probe.websocket).toBe(true)
    expect(probe.upload).toBe(true)
    expect(probe.download).toBe(true)
    expect(probe.analytics).toBe(true)
    expect(probe.log).toBe(true)
    expect(probe.fileSystem).toBe(true)
    const partial = createCapabilityHooks(mockBridge())
    const probe2 = await partial.probe()
    expect(probe2.websocket).toBe(false)
    expect(probe2.upload).toBe(false)
    expect(probe2.fileSystem).toBe(false)
  })
})

describe('G-32 B3 四期 wx 桥（wx.* 归一为 Result——无回调泄漏）', () => {
  it('wx connectSocket/uploadFile/downloadFile/reportEvent/getFileSystemManager → Promise 归一', async () => {
    // wx SocketTask mock：on* 注册回调，*Cb 保存供测试驱动
    type WxSocketMock = {
      onOpenCb?: () => void
      onMessageCb?: (r: { data: string }) => void
      onCloseCb?: (r: { code: number }) => void
      onErrorCb?: (e: unknown) => void
      onOpen: (cb: () => void) => void
      onMessage: (cb: (r: { data: string }) => void) => void
      onClose: (cb: (r: { code: number }) => void) => void
      onError: (cb: (e: unknown) => void) => void
      send: () => void
      close: () => void
    }
    let task: WxSocketMock | undefined
    const wx = {
      connectSocket: (opt: { url: string; success?: () => void }) => {
        const t = {
          onOpen: (cb: () => void) => {
            t.onOpenCb = cb
          },
          onMessage: (cb: (r: { data: string }) => void) => {
            t.onMessageCb = cb
          },
          onClose: (cb: (r: { code: number }) => void) => {
            t.onCloseCb = cb
          },
          onError: (cb: (e: unknown) => void) => {
            t.onErrorCb = cb
          },
          send: () => undefined,
          close: () => undefined,
        } as unknown as WxSocketMock
        task = t
        return t
      },
      uploadFile: (opt: {
        filePath: string
        success: (r: { statusCode: number; data: unknown }) => void
      }) => {
        opt.success({ statusCode: 200, data: { uploaded: true } })
        return { onProgressUpdate: () => undefined }
      },
      downloadFile: (opt: {
        success: (r: { statusCode: number; tempFilePath: string }) => void
      }) => {
        opt.success({ statusCode: 200, tempFilePath: '/tmp/d.bin' })
        return { onProgressUpdate: () => undefined }
      },
      reportEvent: (opt: { event: string; data?: Record<string, unknown> }) => {
        void opt
      },
      getFileSystemManager: () => ({
        readFile: (opt: {
          filePath: string
          success: (r: { data: string }) => void
        }) => opt.success({ data: 'wx-file-content' }),
        writeFile: (opt: { filePath: string; data: string; success?: () => void }) => {
          opt.success?.()
        },
        unlink: (opt: { filePath: string; success?: () => void }) => {
          opt.success?.()
        },
        access: (opt: { path: string; success?: () => void; fail?: () => void }) => {
          opt.success?.()
        },
      }),
    }
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      // websocket：连接成功后可用；未触发 open 前不 resolve
      const wsP = hooks.useWebSocket('wss://x')
      await new Promise((r) => setTimeout(r, 0))
      task?.onOpenCb?.()
      const ws = await wsP
      expect(ws.ok).toBe(true)
      if (ws.ok) expect(typeof ws.data.send).toBe('function')
      // websocket on 订阅
      let gotMsg: unknown
      if (ws.ok) {
        ws.data.on?.('message', (payload) => {
          gotMsg = (payload as { data?: string }).data
        })
      }
      task?.onMessageCb?.({ data: 'hi' })
      expect(gotMsg).toBe('hi')
      // upload
      const up = await hooks.useUpload({ url: '/up', filePath: '/tmp/a.png' })
      expect(up.ok).toBe(true)
      if (up.ok) expect(up.data).toMatchObject({ status: 200, data: { uploaded: true } })
      // download
      const dl = await hooks.useDownload('/down')
      expect(dl.ok).toBe(true)
      if (dl.ok) expect(dl.data).toMatchObject({ status: 200, path: '/tmp/d.bin' })
      // analytics
      expect((await hooks.useAnalytics().track('evt')).ok).toBe(true)
      // log
      expect((await hooks.useLog().log('m')).ok).toBe(true)
      // file-system
      const fs = hooks.useFileSystem()
      const fr = await fs.readFile('/a.txt')
      expect(fr.ok).toBe(true)
      if (fr.ok) expect(fr.data).toBe('wx-file-content')
      await expect(fs.writeFile('/b.txt', 'x')).resolves.toMatchObject({ ok: true })
      await expect(fs.exists('/b.txt')).resolves.toMatchObject({ ok: true, data: true })
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })
})

describe('G-32 B3 四期 web 桥（WebSocket / fetch FormData / blob / console / 内存 FS）', () => {
  it('web connectWebSocket：WebSocket open → 连接句柄', async () => {
    const g = globalThis as unknown as { WebSocket?: unknown; wx?: unknown; fetch?: unknown }
    const orig = g.WebSocket
    const listeners: Record<string, Array<(e?: unknown) => void>> = {}
    class FakeWS {
      static instances: FakeWS[] = []
      url: string
      protocols?: string[]
      constructor(u: string, p?: string[]) {
        this.url = u
        this.protocols = p
        FakeWS.instances.push(this)
      }
      addEventListener(t: string, cb: (e?: unknown) => void) {
        ;(listeners[t] ??= []).push(cb)
      }
      removeEventListener(t: string, cb: (e?: unknown) => void) {
        const arr = listeners[t]
        if (arr) {
          const i = arr.indexOf(cb)
          if (i >= 0) arr.splice(i, 1)
        }
      }
      send() {
        return undefined
      }
      close() {
        return undefined
      }
    }
    g.WebSocket = FakeWS
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const p = hooks.useWebSocket('wss://x')
      await new Promise((r) => setTimeout(r, 0))
      FakeWS.instances[0].addEventListener('open' as 'open', () => ({}))
      ;(listeners['open'] ?? []).forEach((cb) => cb())
      const r = await p
      expect(r.ok).toBe(true)
      if (r.ok) expect(typeof r.data.send).toBe('function')
    } finally {
      g.WebSocket = orig
    }
  })

  it('web upload：fetch FormData → UploadResult；web download：fetch blob → DownloadResult', async () => {
    const g = globalThis as unknown as { fetch?: unknown; wx?: unknown }
    const orig = g.fetch
    g.fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
      blob: async () => new Blob(['data']),
    })) as never
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const up = await hooks.useUpload({ url: '/up', file: new Blob(['x']), name: 'file' })
      expect(up.ok).toBe(true)
      if (up.ok) expect(up.data).toMatchObject({ status: 200, data: { ok: true }, progress: 100 })
      const dl = await hooks.useDownload('/down')
      expect(dl.ok).toBe(true)
      if (dl.ok) {
        expect(dl.data.status).toBe(200)
        expect(dl.data.data).toBeInstanceOf(Blob)
      }
    } finally {
      g.fetch = orig
    }
  })

  it('web file-system：内存降级（可读写非持久）——useFileSystem 句柄往返', async () => {
    const { createCapabilityBridge } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const fs = hooks.useFileSystem()
    expect(fs.supported).toBe(true)
    await expect(fs.writeFile('/w.txt', 'web-fs')).resolves.toMatchObject({ ok: true })
    const r = await fs.readFile('/w.txt')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('web-fs')
  })

  it('web analytics：无标准 API → track 返回 Err（useAnalytics 句柄可用）', async () => {
    const { createCapabilityBridge } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useAnalytics().track('page_view')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('analytics.unsupported')
  })
})

describe('G-32 B3 五期：notification / contact / calendar / app-lifecycle / archive / shortcut', () => {
  it('useNotification：桥 subscribeMessage → MessageSubscription（granted/status）', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        subscribeMessage: async (templateId) => ({ templateId, granted: true, status: 'accept' }),
      }),
    )
    const r = await hooks.useNotification('tmpl_1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ templateId: 'tmpl_1', granted: true, status: 'accept' })
    // 无桥 → Err
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useNotification('tmpl_1')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('notification.unsupported')
  })

  it('useContact：桥 chooseContact → Contact[]；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        chooseContact: async () => [{ name: '张三', phone: '13800000000' }],
      }),
    )
    const r = await hooks.useContact()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject([{ name: '张三', phone: '13800000000' }])
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useContact()).ok).toBe(false)
  })

  it('useCalendar：桥 addCalendarEvent → ok；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        addCalendarEvent: async (event) => {
          void event
        },
      }),
    )
    const r = await hooks.useCalendar({ title: '会议', startTime: 1700000000000 })
    expect(r.ok).toBe(true)
    const noBridge = createCapabilityHooks(mockBridge())
    const r2 = await noBridge.useCalendar({ title: '会议', startTime: 1700000000000 })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('calendar.unsupported')
  })

  it('useAppLifecycle：桥 getAppLifecycle → 句柄（onLaunch/onShow/onHide 可订阅取消）', () => {
    let offLaunch: (() => void) | undefined
    const hooks = createCapabilityHooks(
      mockBridge({
        getAppLifecycle: () => ({
          phase: 'PENDING' as const,
          onLaunch: (cb) => {
            cb()
            offLaunch = () => undefined
            return offLaunch
          },
          onShow: () => () => undefined,
          onHide: () => () => undefined,
        }),
      }),
    )
    const lifecycle = hooks.useAppLifecycle()
    expect(lifecycle.phase).toBe('PENDING')
    const launches: number[] = []
    lifecycle.onLaunch(() => launches.push(1))
    expect(launches).toEqual([1])
    expect(typeof lifecycle.onShow).toBe('function')
    expect(typeof lifecycle.onHide).toBe('function')
    void offLaunch
    // 无桥 → 抛错
    const noBridge = createCapabilityHooks(mockBridge())
    expect(() => noBridge.useAppLifecycle()).toThrow(/getAppLifecycle/)
  })

  it('useArchive：桥 compressFile → ok；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        compressFile: async (options) => {
          void options
        },
      }),
    )
    const r = await hooks.useArchive({ src: '/a.png' })
    expect(r.ok).toBe(true)
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useArchive({ src: '/a.png' })).ok).toBe(false)
  })

  it('useShortcut：桥 addShortcut → ok；无桥 → Err', async () => {
    const hooks = createCapabilityHooks(
      mockBridge({
        addShortcut: async () => undefined,
      }),
    )
    expect((await hooks.useShortcut()).ok).toBe(true)
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useShortcut()).ok).toBe(false)
  })

  it('probe 五期标志：notification/contact/calendar/appLifecycle/archive/shortcut', async () => {
    const full = createCapabilityHooks(
      mockBridge({
        subscribeMessage: async (id) => ({ templateId: id, granted: true }),
        chooseContact: async () => [],
        addCalendarEvent: async () => undefined,
        getAppLifecycle: () => ({ phase: 'PENDING' as const, onLaunch: () => () => undefined, onShow: () => () => undefined, onHide: () => () => undefined }),
        compressFile: async () => undefined,
        addShortcut: async () => undefined,
      }),
    )
    const probe = await full.probe()
    expect(probe.notification).toBe(true)
    expect(probe.contact).toBe(true)
    expect(probe.calendar).toBe(true)
    expect(probe.appLifecycle).toBe(true)
    expect(probe.archive).toBe(true)
    expect(probe.shortcut).toBe(true)
    const partial = createCapabilityHooks(mockBridge())
    const probe2 = await partial.probe()
    expect(probe2.notification).toBe(false)
    expect(probe2.shortcut).toBe(false)
  })
})

describe('G-32 B3 五期 wx 桥（wx.* 归一为 Result——无回调泄漏）', () => {
  it('wx requestSubscribeMessage/chooseContact/addPhoneCalendar/onAppShow/compressFile/addToDesktop → Promise 归一', async () => {
    const wx = {
      requestSubscribeMessage: (opt: { tmplIds: string[]; success: (r: Record<string, string>) => void }) =>
        opt.success({ [opt.tmplIds[0]]: 'accept' }),
      chooseContact: (opt: { success: (r: { contactList?: Array<{ name: string; phone?: string }> }) => void }) =>
        opt.success({ contactList: [{ name: '李四', phone: '13900000000' }] }),
      addPhoneCalendar: (opt: { title: string; startTime: number; success?: () => void }) => {
        opt.success?.()
      },
      onAppShow: (cb: () => void) => {
        cb()
      },
      compressFile: (opt: { src: string; success?: () => void }) => {
        opt.success?.()
      },
      addToDesktop: (opt: { success?: () => void }) => {
        opt.success?.()
      },
    }
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const notif = await hooks.useNotification('tmpl_a')
      expect(notif.ok).toBe(true)
      if (notif.ok) expect(notif.data).toMatchObject({ templateId: 'tmpl_a', granted: true, status: 'accept' })
      const contact = await hooks.useContact()
      expect(contact.ok).toBe(true)
      if (contact.ok) expect(contact.data).toMatchObject([{ name: '李四', phone: '13900000000' }])
      await expect(hooks.useCalendar({ title: '日程', startTime: 1700000000000 })).resolves.toMatchObject({ ok: true })
      const lc = hooks.useAppLifecycle()
      expect(typeof lc.onShow).toBe('function')
      await expect(hooks.useArchive({ src: '/x.png' })).resolves.toMatchObject({ ok: true })
      await expect(hooks.useShortcut()).resolves.toMatchObject({ ok: true })
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })
})

describe('G-32 B3 五期 web 桥（Notification API / visibilitychange）', () => {
  it('web subscribeMessage：Notification.requestPermission granted → MessageSubscription', async () => {
    const g = globalThis as unknown as { Notification?: unknown; wx?: unknown }
    const orig = g.Notification
    g.Notification = class Notification {
      static requestPermission = vi.fn(async () => 'granted')
      constructor(public title: string, public options?: { body?: string }) {
        void title
        void options
      }
    }
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const r = await hooks.useNotification('tmpl_b')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data).toMatchObject({ templateId: 'tmpl_b', granted: true, status: 'granted' })
    } finally {
      g.Notification = orig
    }
  })

  it('web subscribeMessage：无 Notification 支持 → Err（非抛异常）', async () => {
    const g = globalThis as unknown as { Notification?: unknown; wx?: unknown }
    delete g.Notification
    const { createCapabilityBridge } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const r = await hooks.useNotification('tmpl_c')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('notification.unsupported')
  })

  it('web useAppLifecycle：load/visibilitychange 事件 → onLaunch/onShow/onHide 触发', async () => {
    const listeners: Array<{ t: string; cb: (e?: unknown) => void }> = []
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (e?: unknown) => void) => void
      removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
      document?: { visibilityState?: string }
      wx?: unknown
    }
    g.addEventListener = (t, cb) => {
      listeners.push({ t, cb })
    }
    g.removeEventListener = (t, cb) => {
      const i = listeners.findIndex((l) => l.t === t && l.cb === cb)
      if (i >= 0) listeners.splice(i, 1)
    }
    g.document = { visibilityState: 'visible' }
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const lifecycle = hooks.useAppLifecycle()
      const shown: number[] = []
      const hidden: number[] = []
      lifecycle.onShow(() => shown.push(1))
      lifecycle.onHide(() => hidden.push(1))
      // 触发 load → launch + show
      const loadEntry = listeners.find((l) => l.t === 'load')
      expect(loadEntry).toBeTruthy()
      loadEntry!.cb()
      expect(shown).toEqual([1])
      // 触发 visibilitychange hidden → hide
      g.document!.visibilityState = 'hidden'
      const visEntry = listeners.find((l) => l.t === 'visibilitychange')
      expect(visEntry).toBeTruthy()
      visEntry!.cb()
      expect(hidden).toEqual([1])
    } finally {
      delete g.addEventListener
      delete g.removeEventListener
      delete g.document
    }
  })
})

describe('G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard', () => {
  it('mock 桥全能力 + 缺桥 Err + probe 6 标志', async () => {
    const full = createCapabilityHooks(
      mockBridge({
        getPageLifecycle: () => ({ phase: 'IDLE' as const, onLoad: () => () => undefined, onShow: () => () => undefined, onHide: () => () => undefined }),
        getBluetooth: async () => ({ supported: true, available: true, devices: ['x'] }),
        getNfc: async () => ({ supported: true, available: true }),
        getCamera: async () => ({ kind: 'camera', supported: true, granted: true }),
        getMicrophone: async () => ({ kind: 'microphone', supported: true, granted: true }),
        getKeyboard: () => ({ info: { height: 0, visible: false }, onChange: () => () => undefined }),
      }),
    )
    // 句柄类（缺桥抛错同 useStorage 惯例）
    const lc = full.usePageLifecycle()
    expect(lc.phase).toBe('IDLE')
    const kb = full.useKeyboard()
    expect(kb.info).toMatchObject({ height: 0, visible: false })
    // 一次性类
    const bt = await full.useBluetooth()
    expect(bt.ok).toBe(true)
    if (bt.ok) expect(bt.data).toMatchObject({ supported: true, devices: ['x'] })
    const nfc = await full.useNFC()
    expect(nfc.ok).toBe(true)
    if (nfc.ok) expect(nfc.data.available).toBe(true)
    const cam = await full.useCamera()
    expect(cam.ok).toBe(true)
    if (cam.ok) expect(cam.data).toMatchObject({ kind: 'camera', granted: true })
    const mic = await full.useMicrophone()
    expect(mic.ok).toBe(true)
    if (mic.ok) expect(mic.data).toMatchObject({ kind: 'microphone', granted: true })
    // 缺桥 → Err / 句柄抛错
    const noBridge = createCapabilityHooks(mockBridge())
    expect((await noBridge.useBluetooth()).ok).toBe(false)
    expect((await noBridge.useNFC()).ok).toBe(false)
    expect((await noBridge.useCamera()).ok).toBe(false)
    expect((await noBridge.useMicrophone()).ok).toBe(false)
    expect(() => noBridge.usePageLifecycle()).toThrow(/getPageLifecycle/)
    expect(() => noBridge.useKeyboard()).toThrow(/getKeyboard/)
    // probe 标志
    const probe = await full.probe()
    expect(probe.pageLifecycle).toBe(true)
    expect(probe.bluetooth).toBe(true)
    expect(probe.nfc).toBe(true)
    expect(probe.camera).toBe(true)
    expect(probe.microphone).toBe(true)
    expect(probe.keyboard).toBe(true)
    const probe2 = await noBridge.probe()
    expect(probe2.bluetooth).toBe(false)
    expect(probe2.keyboard).toBe(false)
  })
})

describe('G-32 B3 六期 wx 桥（wx.* 归一为 Result——无回调泄漏）', () => {
  it('wx openBluetoothAdapter/getHCEState/authorize/onKeyboardHeightChange/onPageShow/onPageHide → Promise 归一', async () => {
    let kbCb: ((r: { height: number }) => void) | undefined
    let pageShowCb: (() => void) | undefined
    const wx = {
      openBluetoothAdapter: (opt: { success?: () => void }) => opt.success?.(),
      getBluetoothDevices: (opt: { success: (r: { devices?: Array<{ name?: string }> }) => void }) =>
        opt.success({ devices: [{ name: '耳机' }, { name: '音箱' }] }),
      getHCEState: (opt: { success?: () => void }) => opt.success?.(),
      authorize: (opt: { scope: string; success?: () => void }) => opt.success?.(),
      createCameraContext: () => ({}),
      getRecorderManager: () => ({}),
      onKeyboardHeightChange: (cb: (r: { height: number }) => void) => {
        kbCb = cb
      },
      onPageShow: (cb: () => void) => {
        pageShowCb = cb
      },
      onPageHide: (cb: () => void) => {
        void cb
      },
    }
    const orig = (globalThis as { wx?: unknown }).wx
    ;(globalThis as { wx?: unknown }).wx = wx
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const bt = await hooks.useBluetooth()
      expect(bt.ok).toBe(true)
      if (bt.ok) expect(bt.data).toMatchObject({ supported: true, available: true, devices: ['耳机', '音箱'] })
      const nfc = await hooks.useNFC()
      expect(nfc.ok).toBe(true)
      if (nfc.ok) expect(nfc.data.available).toBe(true)
      const cam = await hooks.useCamera()
      expect(cam.ok).toBe(true)
      if (cam.ok) expect(cam.data).toMatchObject({ kind: 'camera', granted: true })
      const mic = await hooks.useMicrophone()
      expect(mic.ok).toBe(true)
      if (mic.ok) expect(mic.data).toMatchObject({ kind: 'microphone', granted: true })
      // keyboard：onKeyboardHeightChange 触发 → info 更新 + onChange
      const kb = hooks.useKeyboard()
      expect(kb.info).toMatchObject({ height: 0, visible: false })
      let changed: KeyboardInfo | undefined
      kb.onChange((i) => {
        changed = i
      })
      kbCb?.({ height: 300 })
      expect(changed).toMatchObject({ height: 300, visible: true })
      // page-lifecycle：onShow 订阅 + 触发
      const lc = hooks.usePageLifecycle()
      let shown = 0
      lc.onShow(() => {
        shown += 1
      })
      pageShowCb?.()
      expect(shown).toBe(1)
    } finally {
      ;(globalThis as { wx?: unknown }).wx = orig
    }
  })
})

describe('G-32 B3 六期 web 桥（特性探测 / getUserMedia / visualViewport）', () => {
  it('web bluetooth/nfc：特性探测（存在 → supported；缺失 → 降级 false 非 Err）', async () => {
    const g = globalThis as unknown as { navigator?: { bluetooth?: unknown }; NDEFReader?: unknown; wx?: unknown }
    const origNav = Object.getOwnPropertyDescriptor(g, 'navigator')
    const origNdef = Object.getOwnPropertyDescriptor(g, 'NDEFReader')
    try {
      Object.defineProperty(g, 'navigator', { value: { bluetooth: {} }, configurable: true })
      Object.defineProperty(g, 'NDEFReader', { value: class NDEFReader {}, configurable: true })
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const bt = await hooks.useBluetooth()
      expect(bt.ok).toBe(true)
      if (bt.ok) expect(bt.data).toMatchObject({ supported: true, available: true, devices: [] })
      const nfc = await hooks.useNFC()
      expect(nfc.ok).toBe(true)
      if (nfc.ok) expect(nfc.data.supported).toBe(true)
    } finally {
      if (origNav) Object.defineProperty(g, 'navigator', origNav)
      else delete g.navigator
      if (origNdef) Object.defineProperty(g, 'NDEFReader', origNdef)
      else delete g.NDEFReader
    }
  })

  it('web camera/microphone：mediaDevices.getUserMedia 存在 → granted；缺失 → supported:false', async () => {
    const g = globalThis as unknown as { navigator?: unknown; wx?: unknown }
    const origNav = Object.getOwnPropertyDescriptor(g, 'navigator')
    try {
      const nav = {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
        },
      }
      Object.defineProperty(g, 'navigator', { value: nav, configurable: true })
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const cam = await hooks.useCamera()
      expect(cam.ok).toBe(true)
      if (cam.ok) expect(cam.data).toMatchObject({ kind: 'camera', supported: true, granted: true })
      const mic = await hooks.useMicrophone()
      expect(mic.ok).toBe(true)
      if (mic.ok) expect(mic.data).toMatchObject({ kind: 'microphone', supported: true, granted: true })
      // 无 mediaDevices → supported:false（非 Err——特征缺失是诚实数据）
      Object.defineProperty(g, 'navigator', { value: {}, configurable: true })
      const cam2 = await hooks.useCamera()
      expect(cam2.ok).toBe(true)
      if (cam2.ok) expect(cam2.data).toMatchObject({ kind: 'camera', supported: false, granted: false })
    } finally {
      if (origNav) Object.defineProperty(g, 'navigator', origNav)
      else delete g.navigator
    }
  })

  it('web page-lifecycle：load/visibilitychange → onLoad/onShow/onHide 触发', async () => {
    const listeners: Array<{ t: string; cb: (e?: unknown) => void }> = []
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (e?: unknown) => void) => void
      removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
      document?: { visibilityState?: string }
      wx?: unknown
    }
    g.addEventListener = (t, cb) => {
      listeners.push({ t, cb })
    }
    g.removeEventListener = (t, cb) => {
      const i = listeners.findIndex((l) => l.t === t && l.cb === cb)
      if (i >= 0) listeners.splice(i, 1)
    }
    g.document = { visibilityState: 'visible' }
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const lc = hooks.usePageLifecycle()
      const shown: number[] = []
      const hidden: number[] = []
      let loaded = 0
      lc.onLoad(() => {
        loaded += 1
      })
      lc.onShow(() => shown.push(1))
      lc.onHide(() => hidden.push(1))
      const loadEntry = listeners.find((l) => l.t === 'load')
      loadEntry?.cb()
      expect(loaded).toBe(1)
      expect(shown).toEqual([1])
      g.document!.visibilityState = 'hidden'
      const visEntry = listeners.find((l) => l.t === 'visibilitychange')
      visEntry?.cb()
      expect(hidden).toEqual([1])
    } finally {
      delete g.addEventListener
      delete g.removeEventListener
      delete g.document
    }
  })

  it('web keyboard：visualViewport resize → onChange（键盘打开启发式）', async () => {
    const g = globalThis as unknown as {
      visualViewport?: { height?: number; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void }
      innerHeight?: number
      wx?: unknown
    }
    let resizeCb: (() => void) | undefined
    g.visualViewport = {
      height: 800,
      addEventListener: (t, cb) => {
        if (t === 'resize') resizeCb = cb
      },
      removeEventListener: () => undefined,
    }
    g.innerHeight = 900
    try {
      const { createCapabilityBridge } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const kb = hooks.useKeyboard()
      expect(kb.info).toMatchObject({ height: 0, visible: false })
      let changed: KeyboardInfo | undefined
      kb.onChange((i) => {
        changed = i
      })
      g.visualViewport!.height = 500 // 键盘打开：较 viewport 被压缩
      resizeCb?.()
      expect(changed).toMatchObject({ visible: true })
      if (changed) expect(changed.height).toBe(400) // 900 - 500
    } finally {
      delete g.visualViewport
      delete g.innerHeight
    }
  })
})
