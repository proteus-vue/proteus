// tests/capability-hooks-7th.test.ts
// ★G-32 B3 七期/八期（proteus-semantic-primitives-plus-plan §7）：剩余 12 能力收口——Capability 39/50 → 50/50
//   C4 地图（wx.createMapContext）/ C22 短信（无开放 API 诚实降级）/ C25 后台（wx onAppHide/Show · web visibilitychange）
//   C28 SocketTask（wx.connectSocket→SocketTask · web WebSocket）/ C31 数据通道（宿主桥）/ C32 Cookie（web document.cookie · wx storage）
//   C39 人脸（wx startSoterAuthentication · web WebAuthn）/ C46 内购（宿主桥）/ C47 跳小程序（wx.navigateToMiniProgram）
//   C48 宿主嵌入 / C49 直播 / C50 扩展（宿主桥——缺省 Err 诚实降级）
import { describe, it, expect, vi } from 'vitest'
import type { CapabilityBridge } from '@proteus-vue/api'

/** ★注入式 mock 桥（全 12 新能力可用 + 旧能力齐备——满足 CapabilityBridge 必填面） */
function fullMockBridge(): CapabilityBridge {
  return {
    // 既有能力（mock 常量——旧能力已由既有测试覆盖，这里仅满足接口）
    getLocation: async () => ({ latitude: 31.2, longitude: 121.5 }),
    vibrate: async () => undefined,
    getNetwork: async () => ({ online: true, type: 'wifi' }),
    readClipboard: async () => 'clip',
    setClipboard: async () => undefined,
    getScreen: async () => ({ width: 390, height: 844, dpr: 3, orientation: 'portrait' }),
    getDevice: async () => ({ platform: 'web', model: 'M', os: 't', version: '1' }),
    getBattery: async () => ({ level: 0.8, charging: true }),
    getOrientation: async () => ({ type: 'portrait', angle: 0 }),
    share: async () => undefined,
    // 新能力（12）
    createMap: (id) => ({
      getRegion: async () => ({ latitude: 39.9, longitude: 116.4, scale: 14 }),
      moveTo: async () => undefined,
    }),
    sendSMS: async () => undefined,
    getBackground: () => ({
      onEvent: () => () => undefined,
    }),
    createSocketTask: (url) => ({
      send: async () => undefined,
      close: async () => undefined,
      onMessage: () => () => undefined,
      isConnected: () => true,
    }),
    getCookieJar: () => ({
      get: (n) => (n === 'theme' ? 'dark' : undefined),
      set: () => undefined,
      remove: () => undefined,
      list: () => ({ theme: 'dark' }),
    }),
    authenticateFaceID: async () => true,
    requestIAP: async (productId) => ({ productId, state: 'purchased' }),
    navigateMiniProgram: async () => undefined,
    openDataChannel: () => ({
      send: async () => undefined,
      onMessage: () => () => undefined,
    }),
    getHostContext: () => ({ provider: 'host-app', version: '1.0.0' }),
    joinLiveRoom: () => ({ leave: async () => undefined, status: () => 'joined' }),
    loadExtension: async () => ({ name: 'ext-kit' }),
  }
}

/** 裸桥：只满足 CapabilityBridge 必填面，**不含**任何新能力方法（验证缺桥 → Err） */
function bareBridge(): CapabilityBridge {
  return {
    getLocation: async () => ({ latitude: 0, longitude: 0 }),
    vibrate: async () => undefined,
    getNetwork: async () => ({ online: true, type: 'unknown' }),
    readClipboard: async () => '',
    setClipboard: async () => undefined,
    getScreen: async () => ({ width: 0, height: 0, dpr: 1, orientation: 'portrait' }),
    getDevice: async () => ({ platform: '', model: '', os: '', version: '' }),
    getBattery: async () => ({ level: 1, charging: true }),
    getOrientation: async () => ({ type: 'portrait', angle: 0 }),
    share: async () => undefined,
  }
}

describe('G-32 B3 七/八期：剩余 12 能力（mock 桥 happy path——Capability 50/50）', () => {
  it('C4 useMap：createMap 桥 → 控制器句柄（getRegion/moveTo 包 Result）', async () => {
    const { createCapabilityHooks } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(fullMockBridge())
    const r = await hooks.useMap('main-map')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(typeof r.data.getRegion).toBe('function')
      const region = await r.data.getRegion()
      expect(region.ok && region.data.latitude).toBe(39.9)
      await expect(r.data.moveTo(30, 120)).resolves.toMatchObject({ ok: true })
    }
  })

  it('C25 useBackground / C32 useCookie / C28 useSocketTask / C47 useMiniProgram：句柄形态', async () => {
    const { createCapabilityHooks } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(fullMockBridge())
    const bg = await hooks.useBackground()
    expect(bg.ok && typeof bg.data.onEvent).toBe('function')
    const cookies = await hooks.useCookie()
    expect(cookies.ok && cookies.data.get('theme')).toBe('dark')
    const task = await hooks.useSocketTask('wss://x')
    expect(task.ok && task.data.isConnected()).toBe(true)
    if (task.ok) await expect(task.data.send('hi')).resolves.toMatchObject({ ok: true })
    const mp = await hooks.useMiniProgram()
    expect(mp.ok && typeof mp.data.navigate).toBe('function')
    if (mp.ok) await expect(mp.data.navigate({ appId: 'wx000' })).resolves.toMatchObject({ ok: true })
  })

  it('C22/C46/C48/C49/C50/C31：宿主桥能力 → 句柄/直值；C39 useFaceID → Result<boolean>', async () => {
    const { createCapabilityHooks } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(fullMockBridge())
    await expect(hooks.useSMS('13900000000', 'hi')).resolves.toMatchObject({ ok: true })
    const iap = await hooks.useInAppPurchase('pro-pack')
    expect(iap.ok && iap.data).toMatchObject({ productId: 'pro-pack', state: 'purchased' })
    const emb = await hooks.useEmbedded()
    expect(emb.ok && emb.data.provider).toBe('host-app')
    const live = await hooks.useLive({ roomId: 'r1' })
    expect(live.ok && live.data.status()).toBe('joined')
    const ext = await hooks.useExtension('kit')
    expect(ext.ok && ext.data).toMatchObject({ name: 'ext-kit' })
    const chan = await hooks.useDataChannel({ channelId: 'dc' })
    expect(chan.ok && typeof chan.data.send).toBe('function')
    const face = await hooks.useFaceID('验证')
    expect(face.ok && face.data).toBe(true)
  })

  it('缺桥（裸桥无新能力方法）→ 全部 Err("<cap>.unsupported") 非抛异常——G-32.3 降级语义', async () => {
    const { createCapabilityHooks } = await import('@proteus-vue/api')
    const hooks = createCapabilityHooks(bareBridge())
    const results = await Promise.all([
      hooks.useMap('x'),
      hooks.useSMS('1', 'm'),
      hooks.useBackground(),
      hooks.useSocketTask('wss://'),
      hooks.useDataChannel({ channelId: 'c' }),
      hooks.useCookie(),
      hooks.useFaceID(),
      hooks.useInAppPurchase('p'),
      hooks.useMiniProgram(),
      hooks.useEmbedded(),
      hooks.useLive({ roomId: 'r' }),
      hooks.useExtension('e'),
    ])
    for (const r of results) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toMatch(/unsupported$/)
    }
  })
})

describe('G-32 B3 七/八期 wx 桥（wx 原生能力归一）', () => {
  it('C4 createMapContext → useMap 控制器；C25 onAppHide/onAppShow → useBackground 订阅', async () => {
    const appHideCbs: Array<() => void> = []
    const appShowCbs: Array<() => void> = []
    const wx = {
      createMapContext: (id: string) => ({
        getRegion: (opt: { success: (r: { latitude: number; longitude: number; scale?: number }) => void }) =>
          opt.success({ latitude: 30.1, longitude: 120.2, scale: 12 }),
        moveTo: (opt: { latitude: number; longitude: number; success?: () => void }) => opt.success?.(),
      }),
      onAppHide: (cb: () => void) => {
        appHideCbs.push(cb)
      },
      onAppShow: (cb: () => void) => {
        appShowCbs.push(cb)
      },
    }
    const g = globalThis as { wx?: unknown }
    const orig = g.wx
    g.wx = wx
    try {
      const { createCapabilityBridge, createCapabilityHooks } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const map = await hooks.useMap('demo')
      expect(map.ok).toBe(true)
      if (map.ok) {
        const region = await map.data.getRegion()
        expect(region.ok && region.data).toMatchObject({ latitude: 30.1, longitude: 120.2 })
        await expect(map.data.moveTo(31, 121)).resolves.toMatchObject({ ok: true })
      }
      const bg = await hooks.useBackground()
      expect(bg.ok).toBe(true)
      if (bg.ok) {
        const events: string[] = []
        bg.data.onEvent((e) => events.push(e.type))
        appShowCbs.forEach((cb) => cb())
        appHideCbs.forEach((cb) => cb())
        expect(events).toEqual(['enter-foreground', 'enter-background'])
      }
    } finally {
      g.wx = orig
    }
  })

  it('C28 connectSocket→SocketTask；C32 storage Cookie 罐；C39 startSoterAuthentication facial；C47 navigateToMiniProgram', async () => {
    const openCbs: Array<() => void> = []
    const msgCbs: Array<(r: { data: string | ArrayBuffer }) => void> = []
    const sent: string[] = []
    const navAppIds: string[] = []
    const wx = {
      connectSocket: () => ({
        onOpen: (cb: () => void) => {
          openCbs.push(cb)
        },
        onMessage: (cb: (r: { data: string | ArrayBuffer }) => void) => {
          msgCbs.push(cb)
        },
        send: (opt: { data: string | ArrayBuffer }) => {
          sent.push(String(opt.data))
        },
        close: () => undefined,
      }),
      getStorageSync: (k: string) => (k === '__proteus_cookies' ? { theme: 'wx-dark' } : undefined),
      setStorageSync: vi.fn(),
      startSoterAuthentication: (opt: { requestAuthModes: string[]; success: () => void }) => {
        expect(opt.requestAuthModes).toContain('facial')
        opt.success()
      },
      navigateToMiniProgram: (opt: { appId: string; success?: () => void }) => {
        navAppIds.push(opt.appId)
        opt.success?.()
      },
    }
    const g = globalThis as { wx?: unknown }
    const orig = g.wx
    g.wx = wx
    try {
      const { createCapabilityBridge, createCapabilityHooks } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      // socket task（wx SocketTask 低层句柄）
      const task = await hooks.useSocketTask('wss://x')
      expect(task.ok).toBe(true)
      if (task.ok) {
        const messages: string[] = []
        task.data.onMessage((d) => messages.push(d))
        await expect(task.data.send('ping')).resolves.toMatchObject({ ok: true })
        expect(sent).toEqual(['ping'])
        openCbs.forEach((cb) => cb())
        expect(task.data.isConnected()).toBe(true)
        msgCbs.forEach((cb) => cb({ data: 'pong' }))
        expect(messages).toEqual(['pong'])
      }
      // cookie（wx storage 兜底）
      const jar = await hooks.useCookie()
      expect(jar.ok && jar.data.get('theme')).toBe('wx-dark')
      // face id（requestAuthModes ['facial']）
      const face = await hooks.useFaceID()
      expect(face.ok && face.data).toBe(true)
      // mini program
      const mp = await hooks.useMiniProgram()
      expect(mp.ok).toBe(true)
      if (mp.ok) await expect(mp.data.navigate({ appId: 'wxabc' })).resolves.toMatchObject({ ok: true })
      expect(navAppIds).toEqual(['wxabc'])
    } finally {
      g.wx = orig
    }
  })
})

describe('G-32 B3 七期 web 桥（真实浏览器能力）', () => {
  it('C25 visibilitychange → useBackground 事件；C32 document.cookie → useCookie 读写', async () => {
    const g = globalThis as { document?: { cookie?: string; hidden?: boolean; addEventListener?: (t: string, cb: () => void) => void }; wx?: unknown }
    const origDoc = Object.getOwnPropertyDescriptor(g, 'document')
    const viCbs: Array<() => void> = []
    Object.defineProperty(g, 'document', {
      value: {
        cookie: 'a=1; theme=web-dark',
        hidden: false,
        addEventListener: (t: string, cb: () => void) => {
          if (t === 'visibilitychange') viCbs.push(cb)
        },
      },
      configurable: true,
    })
    const origWx = g.wx
    g.wx = undefined
    try {
      const { createCapabilityBridge, createCapabilityHooks } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const cookies = await hooks.useCookie()
      expect(cookies.ok).toBe(true)
      if (cookies.ok) {
        expect(cookies.data.get('theme')).toBe('web-dark')
        cookies.data.set('token', 'abc', 60)
        expect(g.document?.cookie).toContain('token=abc')
        expect(g.document?.cookie).toContain('max-age=60')
        cookies.data.remove('token')
        expect(g.document?.cookie).toContain('max-age=0')
      }
      const bg = await hooks.useBackground()
      expect(bg.ok).toBe(true)
      if (bg.ok) {
        const events: string[] = []
        bg.data.onEvent((e) => events.push(e.type))
        expect(viCbs.length).toBeGreaterThan(0)
        if (g.document) g.document.hidden = true
        viCbs.forEach((cb) => cb())
        expect(events).toContain('enter-background')
      }
    } finally {
      if (origDoc) Object.defineProperty(g, 'document', origDoc)
      else delete g.document
      g.wx = origWx
    }
  })

  it('C28 WebSocket → SocketTask 句柄（open/message/send/close）；C39 WebAuthn → useFaceID', async () => {
    const g = globalThis as { WebSocket?: unknown; wx?: unknown; navigator?: unknown; PublicKeyCredential?: unknown }
    const origWS = Object.getOwnPropertyDescriptor(g, 'WebSocket')
    const origNav = Object.getOwnPropertyDescriptor(g, 'navigator')
    const origCred = Object.getOwnPropertyDescriptor(g, 'PublicKeyCredential')
    const listeners: Record<string, Array<(e?: { data?: string }) => void>> = {}
    class FakeWS {
      static instances: FakeWS[] = []
      constructor(public url: string) {
        FakeWS.instances.push(this)
      }
      addEventListener(t: string, cb: (e?: { data?: string }) => void) {
        const arr = listeners[t] ?? []
        arr.push(cb)
        listeners[t] = arr
      }
      send = vi.fn()
      close = vi.fn()
    }
    Object.defineProperty(g, 'WebSocket', { value: FakeWS, configurable: true })
    Object.defineProperty(g, 'navigator', {
      value: { credentials: { get: vi.fn(async () => ({ id: 'facial-cred' })) } },
      configurable: true,
    })
    Object.defineProperty(g, 'PublicKeyCredential', { value: class PublicKeyCredential {}, configurable: true })
    const origWx = g.wx
    g.wx = undefined
    try {
      const { createCapabilityBridge, createCapabilityHooks } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      const task = await hooks.useSocketTask('wss://x')
      expect(task.ok).toBe(true)
      if (task.ok) {
        const messages: string[] = []
        task.data.onMessage((d) => messages.push(d))
        ;(listeners['open'] ?? []).forEach((cb) => cb())
        expect(task.data.isConnected()).toBe(true)
        await expect(task.data.send('web-ping')).resolves.toMatchObject({ ok: true })
        expect(FakeWS.instances[0].send).toHaveBeenCalledWith('web-ping')
        ;(listeners['message'] ?? []).forEach((cb) => cb({ data: 'web-pong' }))
        expect(messages).toEqual(['web-pong'])
      }
      const face = await hooks.useFaceID()
      expect(face.ok && face.data).toBe(true)
    } finally {
      if (origWS) Object.defineProperty(g, 'WebSocket', origWS)
      else delete g.WebSocket
      if (origNav) Object.defineProperty(g, 'navigator', origNav)
      else delete g.navigator
      if (origCred) Object.defineProperty(g, 'PublicKeyCredential', origCred)
      else delete g.PublicKeyCredential
      g.wx = origWx
    }
  })

  it('C4/C22/C46/C47 无 web 标准 → 诚实 Err（unsupported）', async () => {
    const g = globalThis as { wx?: unknown }
    const orig = g.wx
    g.wx = undefined
    try {
      const { createCapabilityBridge, createCapabilityHooks } = await import('@proteus-vue/api')
      const hooks = createCapabilityHooks(createCapabilityBridge())
      await expect(hooks.useMap('m')).resolves.toMatchObject({ ok: false })
      await expect(hooks.useSMS('1', 'm')).resolves.toMatchObject({ ok: false })
      await expect(hooks.useInAppPurchase('p')).resolves.toMatchObject({ ok: false })
      await expect(hooks.useMiniProgram()).resolves.toMatchObject({ ok: false })
    } finally {
      g.wx = orig
    }
  })
})

describe('G-32 B3 七/八期 probe 探测面', () => {
  it('12 个新能力标志：桥提供 → true；裸桥 → false', async () => {
    const { createCapabilityHooks } = await import('@proteus-vue/api')
    const full = await createCapabilityHooks(fullMockBridge()).probe()
    expect(full.map).toBe(true)
    expect(full.sms).toBe(true)
    expect(full.background).toBe(true)
    expect(full.socketTask).toBe(true)
    expect(full.dataChannel).toBe(true)
    expect(full.cookie).toBe(true)
    expect(full.faceId).toBe(true)
    expect(full.inAppPurchase).toBe(true)
    expect(full.miniProgram).toBe(true)
    expect(full.embedded).toBe(true)
    expect(full.live).toBe(true)
    expect(full.extension).toBe(true)
    const bare = await createCapabilityHooks(bareBridge()).probe()
    expect(bare.map).toBe(false)
    expect(bare.sms).toBe(false)
    expect(bare.background).toBe(false)
    expect(bare.socketTask).toBe(false)
    expect(bare.dataChannel).toBe(false)
    expect(bare.cookie).toBe(false)
    expect(bare.faceId).toBe(false)
    expect(bare.inAppPurchase).toBe(false)
    expect(bare.miniProgram).toBe(false)
    expect(bare.embedded).toBe(false)
    expect(bare.live).toBe(false)
    expect(bare.extension).toBe(false)
  })
})