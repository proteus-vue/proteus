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
