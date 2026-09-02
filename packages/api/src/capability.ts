// packages/api/src/capability.ts
// ★G-32 B3（proteus-semantic-primitives-plus-plan §7）+ G-31 B7：useXxx 能力 Hook 层
//   能力原语 = 无回调 / 无全局对象 / 全类型 / 返回 Result<T>（G-32.4 铁律）
//   桥接设计：createCapabilityHooks(bridge) —— bridge 注入平台实现（wx / web / mock 可单测），
//   与 createPlatformAPI（request/storage/router/ui 四域）分层：本层是「能力」面（设备/系统/通信/扩展）
//   兼容面：全部 Promise<Result<T>>；平台不支持 → Err('<cap>.unsupported')（G-32.3 降级语义）
//   MP 产物安全（决策 #32/#36）：无 ?. / ?? （显式检查）；无数组解构
import type { HttpMethod, RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'
import { createAuth } from './auth'
import type { AuthStorage } from './auth'

/** ★Result<T> 契约（G-32.4：能力原语全部返回 Result<T>，禁止回调） */
export type CapResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CapError }

export class CapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[proteus-cap] ${code}: ${message}`)
    this.name = 'CapError'
  }
}

export function capOk<T>(data: T): CapResult<T> {
  return { ok: true, data }
}

export function capErr<T = never>(code: string, message: string, cause?: unknown): CapResult<T> {
  return { ok: false, error: new CapError(code, message, cause) }
}

// —— 能力类型（对齐 G-32 §7 返回类型列） ——

export interface Coords {
  latitude: number
  longitude: number
  accuracy?: number
  altitude?: number
  speed?: number
}

export interface NetworkType {
  online: boolean
  type: 'unknown' | 'wifi' | 'cellular' | 'none'
}

export interface BatteryInfo {
  level: number // 0-1
  charging: boolean
  chargingTime?: number
  dischargingTime?: number
}

export interface CapDeviceInfo {
  platform: string
  model: string
  os: string
  version: string
  browser?: string
}

export interface ScreenInfo {
  width: number
  height: number
  dpr: number
  orientation: 'portrait' | 'landscape'
}

export interface ShareOptions {
  title?: string
  text?: string
  url?: string
}

export interface PermissionState {
  permission: string
  state: 'granted' | 'denied' | 'prompt'
}

export interface OrientationInfo {
  type: 'portrait' | 'landscape'
  angle: number
}

// ★G-32 B3 三期：传感器 / 亮度 / 电话 / 生物识别 / 支付 / 登录 / 扫码 / 认证组合

/** C5 传感器类型（wx onAccelerometer/onCompass/onGyroscope / web DeviceMotion/DeviceOrientation） */
export type SensorKind = 'accelerometer' | 'compass' | 'gyroscope'

/** C5 传感器采样（一次性读取当前值；compass 带 heading） */
export interface SensorSample {
  kind: SensorKind
  x?: number
  y?: number
  z?: number
  /** 罗盘方位（0-360°，参考正北；仅 compass） */
  heading?: number
  timestamp?: number
}

/** C40 支付参数（对齐 wx.requestPayment 核心字段） */
export interface PaymentConfig {
  timeStamp: string
  nonceStr: string
  package: string
  signType?: string
  paySign: string
}

/** C40 支付结果 */
export interface PaymentReceipt {
  provider: string
  transactionId?: string
}

/** C41 登录结果（wx.login → code；web/其它 provider → token/授权信息） */
export interface LoginResult {
  provider: string
  code?: string
  token?: string
}

/** C33 认证状态（组合：createAuth 凭证托管 + login 桥 + 存储桥；业务只读 AuthState 不读 raw token——铁律 2） */
export interface AuthState {
  token: string | null
  isAuthenticated: boolean
  /** 登录：调桥 login() → 成功存 token（无 login 桥 → Err<cap>.native 降级） */
  login(provider?: string): Promise<CapResult<string>>
  /** 登出：清 token */
  logout(): Promise<CapResult<void>>
  /** 手动设置 token（第三方登录 / 服务端下发的既有会话） */
  setToken(token: string | null): void
  /** 订阅登录态变化（响应式 UI 联动） */
  subscribe(cb: (token: string | null) => void): () => void
}

/** C38 生物识别认证选项 */
export interface BiometricOptions {
  /** 认证提示（原生系统 UI 展示） */
  prompt?: string
}

/** 能力桥（平台实现注入——wx/web/mock 三形态，可单测） */
export interface CapabilityBridge {
  /** 位置（wx.getLocation / navigator.geolocation / mock） */
  getLocation(): Promise<Coords>
  /** 震动（wx.vibrateShort / navigator.vibrate / mock） */
  vibrate(durationMs: number): Promise<void>
  /** 网络（wx.getNetworkType / navigator.onLine / mock） */
  getNetwork(): Promise<NetworkType>
  /** 剪贴板（wx.getClipboardData / navigator.clipboard.readText / mock） */
  readClipboard(): Promise<string>
  setClipboard(text: string): Promise<void>
  /** 屏幕（wx.getSystemInfo / window.screen + matchMedia / mock） */
  getScreen(): Promise<ScreenInfo>
  /** 设备（wx.getSystemInfo / navigator.userAgent / mock） */
  getDevice(): Promise<CapDeviceInfo>
  /** 电量（wx.getBatteryInfo / navigator.getBattery / mock） */
  getBattery(): Promise<BatteryInfo>
  /** 屏幕方向（wx.onDeviceOrientationChange / matchMedia / mock） */
  getOrientation(): Promise<OrientationInfo>
  /** 通知/分享（wx.shareAppMessage / navigator.share / mock） */
  share(options: ShareOptions): Promise<void>
  // ★G-32 B3 续：通信/网络请求（useFetch——wx.request / fetch / mock；缺省 undefined → useFetch 返回 Err）
  request?(config: RequestConfig): Promise<RequestResponse<unknown>>
  /** 权限（web Permissions API / mock；缺省 undefined → usePermission 返回 Err） */
  getPermission?(permission: string): Promise<PermissionState>
  /** 存储句柄（useStorage——wx sync 存储 / localStorage / mock；缺省 undefined → useStorage 抛错） */
  getStorage?(): CompatStorage
  // ★G-32 B3 三期：新增能力（缺省 undefined → 对应 Hook 返回 Err('<cap>.unsupported')
  /** C5 传感器一次性读取（wx onXxxChange 首个事件 / web DeviceMotion+DeviceOrientation） */
  readSensor?(kind: SensorKind): Promise<SensorSample>
  /** C13 亮度读取（wx.getScreenBrightness；web 无标准 API → 缺省） */
  getBrightness?(): Promise<number>
  /** C13 亮度设置（wx.setScreenBrightness） */
  setBrightness?(value: number): Promise<void>
  /** C21 拨打电话（wx.makePhoneCall；web 无直通 → tel: 需宿主放行/缺省） */
  makePhoneCall?(phoneNumber: string): Promise<void>
  /** C38 生物识别支持性（wx.checkIsSupportFingerPrint / web WebAuthn PublicKeyCredential） */
  checkBiometricSupport?(): Promise<boolean>
  /** C38 生物识别认证（wx.startSoterAuthentication / web navigator.credentials.get） */
  authenticateBiometric?(options?: BiometricOptions): Promise<boolean>
  /** C40 支付（wx.requestPayment；web 无直通 → 缺省） */
  requestPayment?(config: PaymentConfig): Promise<PaymentReceipt>
  /** C41 登录（wx.login → code；web 需集成第三方 provider → 缺省） */
  login?(provider?: string): Promise<LoginResult>
  /** C42 扫码（wx.scanCode / web BarcodeDetector 尽力识别） */
  scanQR?(): Promise<string>
}

/** 存储契约（useStorage / reactive storage 底座） */
export interface CompatStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

/** useFetch 配置（对齐 RequestConfig 高频字段） */
export interface FetchConfig {
  method?: HttpMethod
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeout?: number
}

/** 该能力是否可用（降级探测——G-32.3：缺失 → Err 非抛异常） */
export interface CapabilityProbe {
  location: boolean
  vibrate: boolean
  network: boolean
  clipboardRead: boolean
  clipboardWrite: boolean
  screen: boolean
  device: boolean
  battery: boolean
  orientation: boolean
  share: boolean
  /** ★G-32 B3 续 */
  fetch: boolean
  permission: boolean
  storage: boolean
  /** ★G-32 B3 三期 */
  sensor: boolean
  brightness: boolean
  phoneCall: boolean
  biometric: boolean
  payment: boolean
  login: boolean
  qrCode: boolean
  /** C33 认证组合（需 login 桥 + 存储桥齐备才视为完整） */
  auth: boolean
}

// —— 平台桥实现（双端 + mock） ——

interface WxLike {
  getLocation?: (opt: { success: (r: Coords) => void; fail: (e: unknown) => void }) => void
  vibrateShort?: (opt: { fail: () => void }) => void
  getNetworkType?: (opt: { success: (r: { networkType: string }) => void }) => void
  getClipboardData?: (opt: { success: (r: { data: string }) => void; fail: () => void }) => void
  setClipboardData?: (opt: { data: string; success?: () => void; fail?: () => void }) => void
  getSystemInfoSync?: () => { screenWidth: number; screenHeight: number; pixelRatio: number; platform: string; model: string; system: string }
  getBatteryInfo?: (opt: { success: (r: { level: number; isCharging: boolean }) => void }) => void
  onDeviceOrientationChange?: (cb: (r: { value: string }) => void) => void
  shareAppMessage?: (opt: { title?: string }) => void
  // ★G-32 B3 续：request / 存储
  request?: (opt: {
    url: string
    method?: string
    data?: unknown
    header?: Record<string, string>
    success: (r: { statusCode: number; data: unknown; header?: Record<string, string> }) => void
    fail: (e: unknown) => void
  }) => void
  setStorageSync?: (key: string, value: unknown) => void
  getStorageSync?: (key: string) => unknown
  removeStorageSync?: (key: string) => void
  clearStorageSync?: () => void
  // ★G-32 B3 三期：新增 wx 能力
  onAccelerometerChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void
  onCompassChange?: (cb: (r: { direction: number; accuracy?: number | string }) => void) => void
  onGyroscopeChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void
  getScreenBrightness?: (opt: { success: (r: { value: number }) => void }) => void
  setScreenBrightness?: (opt: { value: number; fail?: () => void }) => void
  makePhoneCall?: (opt: { phoneNumber: string; success?: () => void; fail: () => void }) => void
  checkIsSupportFingerPrint?: (opt: { success: (r: { errMsg: string; isSupported: boolean }) => void; fail?: () => void }) => void
  startSoterAuthentication?: (opt: { requestAuthModes: string[]; success: () => void; fail: () => void }) => void
  requestPayment?: (opt: {
    timeStamp: string
    nonceStr: string
    package: string
    signType?: string
    paySign: string
    success: () => void
    fail: (e: unknown) => void
  }) => void
  login?: (opt: { success: (r: { code: string }) => void; fail?: (e: unknown) => void }) => void
  scanCode?: (opt: {
    scanType?: string[]
    success: (r: { result: string }) => void
    fail: (e: unknown) => void
  }) => void
}

/** 内存存储兜底（wx sync 存储缺失 / Node / SSR） */
function memoryStorage(): CompatStorage {
  const mem = new Map<string, string>()
  return {
    get: <T>(key: string) => {
      const raw = mem.get(key)
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    set: (key, value) => {
      mem.set(key, JSON.stringify(value))
    },
    remove: (key) => {
      mem.delete(key)
    },
    clear: () => {
      mem.clear()
    },
  }
}

/** wx 存储适配（sync 存储缺失 → 内存兜底） */
function wxStorage(wx: WxLike): CompatStorage {
  if (typeof wx.setStorageSync === 'function') {
    return {
      get: <T>(key: string) => wx.getStorageSync ? (wx.getStorageSync(key) as T) : undefined,
      set: (key, value) => {
        if (wx.setStorageSync) wx.setStorageSync(key, value)
      },
      remove: (key) => {
        if (wx.removeStorageSync) wx.removeStorageSync(key)
      },
      clear: () => {
        if (wx.clearStorageSync) wx.clearStorageSync()
      },
    }
  }
  return memoryStorage()
}

function wxBridge(wx: WxLike): CapabilityBridge {
  return {
    getLocation: () =>
      new Promise((resolve, reject) => {
        if (!wx.getLocation) return reject(new CapError('location.unsupported', 'wx.getLocation 缺失'))
        wx.getLocation({
          success: (r) => resolve(r),
          fail: (e) => reject(new CapError('location.failed', 'wx.getLocation 失败', e)),
        })
      }),
    vibrate: (durationMs) =>
      new Promise((resolve, reject) => {
        if (!wx.vibrateShort) return reject(new CapError('vibrate.unsupported', 'wx.vibrateShort 缺失'))
        wx.vibrateShort({ fail: () => reject(new CapError('vibrate.failed', 'wx.vibrateShort 失败')) })
        resolve() // 短震无回调，直接成功（durationMs>0 短震语义）
      }),
    getNetwork: () =>
      new Promise((resolve) => {
        if (!wx.getNetworkType) {
          resolve({ online: true, type: 'unknown' })
          return
        }
        wx.getNetworkType({ success: (r) => resolve({ online: true, type: normalizeNetwork(r.networkType) }) })
      }),
    readClipboard: () =>
      new Promise((resolve, reject) => {
        if (!wx.getClipboardData) return reject(new CapError('clipboard.read.unsupported', 'wx.getClipboardData 缺失'))
        wx.getClipboardData({ success: (r) => resolve(r.data), fail: () => reject(new CapError('clipboard.read.failed', '读取剪贴板失败')) })
      }),
    setClipboard: (text) =>
      new Promise((resolve, reject) => {
        if (!wx.setClipboardData) return reject(new CapError('clipboard.write.unsupported', 'wx.setClipboardData 缺失'))
        wx.setClipboardData({ data: text, success: () => resolve(), fail: () => reject(new CapError('clipboard.write.failed', '写入剪贴板失败')) })
      }),
    getScreen: async () => {
      const info = wx.getSystemInfoSync?.()
      if (!info) throw new CapError('screen.unsupported', 'wx.getSystemInfoSync 缺失')
      return { width: info.screenWidth, height: info.screenHeight, dpr: info.pixelRatio, orientation: 'portrait' }
    },
    getDevice: async () => {
      const info = wx.getSystemInfoSync?.()
      if (!info) throw new CapError('device.unsupported', 'wx.getSystemInfoSync 缺失')
      return { platform: info.platform, model: info.model, os: 'unknown', version: info.system }
    },
    getBattery: () =>
      new Promise((resolve, reject) => {
        if (!wx.getBatteryInfo) return reject(new CapError('battery.unsupported', 'wx.getBatteryInfo 缺失'))
        wx.getBatteryInfo({ success: (r) => resolve({ level: r.level / 100, charging: r.isCharging }) })
      }),
    getOrientation: () =>
      new Promise((resolve) => {
        if (!wx.onDeviceOrientationChange) {
          resolve({ type: 'portrait', angle: 0 })
          return
        }
        wx.onDeviceOrientationChange((r) => resolve({ type: r.value === 'landscape' ? 'landscape' : 'portrait', angle: 0 }))
      }),
    share: async (options) => {
      if (!wx.shareAppMessage) throw new CapError('share.unsupported', 'wx.shareAppMessage 缺失')
      wx.shareAppMessage({ title: options.title })
    },
    // ★G-32 B3 续：request → wx.request 回调桥
    request: (config) =>
      new Promise((resolve, reject) => {
        if (!wx.request) return reject(new CapError('fetch.unsupported', 'wx.request 缺失'))
        wx.request({
          url: config.url,
          method: config.method,
          data: config.data,
          header: config.headers,
          success: (r) =>
            resolve({
              data: r.data,
              status: r.statusCode,
              headers: r.header ?? {},
              config,
            }),
          fail: (e) => reject(new CapError('fetch.failed', 'wx.request 失败', e)),
        })
      }),
    getStorage: () => wxStorage(wx),
    // ★G-32 B3 三期：新增能力（wx → Result；缺能力 → CapError 降级）
    readSensor: (kind) =>
      new Promise((resolve, reject) => {
        if (kind === 'compass') {
          if (!wx.onCompassChange) return reject(new CapError('sensor.compass.unsupported', 'wx.onCompassChange 缺失'))
          wx.onCompassChange((r) =>
            resolve({ kind, heading: typeof r.direction === 'number' ? r.direction : 0, timestamp: Date.now() }),
          )
          return
        }
        const on = kind === 'gyroscope' ? wx.onGyroscopeChange : wx.onAccelerometerChange
        if (!on) return reject(new CapError(`sensor.${kind}.unsupported`, 'wx 传感器监听缺失'))
        on((r) => resolve({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() }))
      }),
    getBrightness: () =>
      new Promise((resolve, reject) => {
        if (!wx.getScreenBrightness) return reject(new CapError('brightness.unsupported', 'wx.getScreenBrightness 缺失'))
        wx.getScreenBrightness({ success: (r) => resolve(r.value) })
      }),
    setBrightness: (value) =>
      new Promise((resolve, reject) => {
        if (!wx.setScreenBrightness) return reject(new CapError('brightness.unsupported', 'wx.setScreenBrightness 缺失'))
        wx.setScreenBrightness({ value, fail: () => reject(new CapError('brightness.failed', 'wx.setScreenBrightness 失败')) })
        resolve()
      }),
    makePhoneCall: (phoneNumber) =>
      new Promise((resolve, reject) => {
        if (!wx.makePhoneCall) return reject(new CapError('phone-call.unsupported', 'wx.makePhoneCall 缺失'))
        wx.makePhoneCall({
          phoneNumber,
          success: () => resolve(),
          fail: () => reject(new CapError('phone-call.failed', 'wx.makePhoneCall 失败')),
        })
      }),
    checkBiometricSupport: () =>
      new Promise((resolve, reject) => {
        if (!wx.checkIsSupportFingerPrint) return reject(new CapError('biometric.unsupported', 'wx.checkIsSupportFingerPrint 缺失'))
        wx.checkIsSupportFingerPrint({
          success: (r) => resolve(r.isSupported === true),
          fail: () => reject(new CapError('biometric.unsupported', 'wx 指纹检测失败')),
        })
      }),
    authenticateBiometric: (options) =>
      new Promise((resolve, reject) => {
        if (!wx.startSoterAuthentication) return reject(new CapError('biometric.unsupported', 'wx.startSoterAuthentication 缺失'))
        wx.startSoterAuthentication({
          requestAuthModes: ['fingerPrint'],
          success: () => resolve(true),
          fail: () => reject(new CapError('biometric.failed', '生物识别认证失败', options)),
        })
      }),
    requestPayment: (config) =>
      new Promise((resolve, reject) => {
        if (!wx.requestPayment) return reject(new CapError('payment.unsupported', 'wx.requestPayment 缺失'))
        wx.requestPayment({
          timeStamp: config.timeStamp,
          nonceStr: config.nonceStr,
          package: config.package,
          signType: config.signType,
          paySign: config.paySign,
          success: () => resolve({ provider: 'wx', transactionId: config.nonceStr }),
          fail: (e) => reject(new CapError('payment.failed', 'wx.requestPayment 失败', e)),
        })
      }),
    login: (provider) =>
      new Promise((resolve, reject) => {
        if (!wx.login) return reject(new CapError('login.unsupported', 'wx.login 缺失'))
        wx.login({
          success: (r) => resolve({ provider: provider ?? 'wx', code: r.code }),
          fail: (e) => reject(new CapError('login.failed', 'wx.login 失败', e)),
        })
      }),
    scanQR: () =>
      new Promise((resolve, reject) => {
        if (!wx.scanCode) return reject(new CapError('qr-code.unsupported', 'wx.scanCode 缺失'))
        wx.scanCode({ success: (r) => resolve(r.result), fail: (e) => reject(new CapError('qr-code.failed', 'wx.scanCode 失败', e)) })
      }),
  }
}

function normalizeNetwork(t: string): NetworkType['type'] {
  if (t === 'wifi') return 'wifi'
  if (t === '2g' || t === '3g' || t === '4g' || t === '5g' || t === 'unknown') return 'cellular'
  return 'unknown'
}

/** Web 桥（navigator / window.screen / matchMedia——SSR/Node 安全探测） */
function webBridge(g: typeof globalThis & { navigator?: Navigator & { getBattery?: () => Promise<unknown> } }): CapabilityBridge {
  const nav = g.navigator as (Navigator & { getBattery?: () => Promise<unknown> }) | undefined
  const sc = (g as { screen?: Screen }).screen
  return {
    getLocation: () =>
      new Promise((resolve, reject) => {
        const geo = nav?.geolocation
        if (!geo) return reject(new CapError('location.unsupported', 'geolocation 不支持'))
        geo.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude ?? undefined,
              speed: pos.coords.speed ?? undefined,
            }),
          (e) => reject(new CapError('location.failed', 'geolocation 失败', e)),
          { timeout: 8000 },
        )
      }),
    vibrate: async (durationMs) => {
      if (!nav?.vibrate) throw new CapError('vibrate.unsupported', 'navigator.vibrate 不支持')
      nav.vibrate(durationMs)
    },
    getNetwork: async () => {
      const online = typeof nav?.onLine === 'boolean' ? nav.onLine : true
      return { online, type: online ? 'unknown' : 'none' }
    },
    readClipboard: async () => {
      const clip = nav?.clipboard
      if (!clip?.readText) throw new CapError('clipboard.read.unsupported', 'navigator.clipboard.readText 不支持')
      try {
        return await clip.readText()
      } catch (e) {
        throw new CapError('clipboard.read.failed', '剪贴板读取被拒（需要权限/聚焦）', e)
      }
    },
    setClipboard: async (text) => {
      const clip = nav?.clipboard
      if (!clip?.writeText) throw new CapError('clipboard.write.unsupported', 'navigator.clipboard.writeText 不支持')
      await clip.writeText(text)
    },
    getScreen: async () => {
      if (!sc) throw new CapError('screen.unsupported', 'window.screen 不存在（SSR）')
      const orientation = typeof matchMedia === 'function' && matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
      return { width: sc.width ?? 0, height: sc.height ?? 0, dpr: g.devicePixelRatio ?? 1, orientation }
    },
    getDevice: async () => {
      const ua = typeof nav?.userAgent === 'string' ? nav.userAgent : ''
      const isIOS = /iPhone|iPad/.test(ua)
      const isAndroid = /Android/.test(ua)
      const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'web'
      return { platform, model: isIOS ? 'iPhone' : isAndroid ? 'Android' : 'Web', os: ua, version: 'unknown', browser: 'web' }
    },
    getBattery: async () => {
      const battery = nav?.getBattery
      if (!battery) throw new CapError('battery.unsupported', 'navigator.getBattery 不支持')
      const info = (await battery.call(nav)) as { level?: number; charging?: boolean; chargingTime?: number; dischargingTime?: number } | null
      if (!info) throw new CapError('battery.failed', 'getBattery 返回空')
      return {
        level: typeof info.level === 'number' ? info.level : 1,
        charging: info.charging === true,
        chargingTime: info.chargingTime,
        dischargingTime: info.dischargingTime,
      }
    },
    getOrientation: async () => {
      if (typeof matchMedia !== 'function') return { type: 'portrait', angle: 0 }
      const mq = matchMedia('(orientation: landscape)')
      return { type: mq.matches ? 'landscape' : 'portrait', angle: 0 }
    },
    share: async (options) => {
      const share = nav?.share
      if (!share) throw new CapError('share.unsupported', 'navigator.share 不支持（需 HTTPS + 用户手势）')
      await share({ title: options.title, text: options.text, url: options.url })
    },
    // ★G-32 B3 续：request → fetch 桥（RequestResponse 契约）
    request: async (config) => {
      if (typeof g.fetch !== 'function') throw new CapError('fetch.unsupported', 'fetch 不支持（Node<18/SSR）')
      const url = encodedUrl(config.url, config.params)
      const resp = await g.fetch(url, {
        method: config.method ?? 'GET',
        headers: config.headers as Record<string, string> | undefined,
        body: config.data !== undefined ? JSON.stringify(config.data) : undefined,
      })
      if (!resp.ok) throw new CapError('fetch.failed', `HTTP ${resp.status}`)
      const text = await resp.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        /* 非 JSON 原样 */
      }
      const headers: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        headers[k] = v
      })
      return { data, status: resp.status, headers, config }
    },
    getPermission: async (permission) => {
      const perms = nav?.permissions
      if (!perms?.query) throw new CapError('permission.unsupported', 'navigator.permissions 不支持')
      let result: PermissionState
      try {
        const st = await perms.query({ name: permission as PermissionName })
        result = { permission, state: st.state as PermissionState['state'] }
      } catch (e) {
        // 未知权限名 → 视为 prompt（非拒绝）
        result = { permission, state: 'prompt' }
        void e
      }
      return result
    },
    getStorage: () => {
      const ls = (g as { localStorage?: Storage }).localStorage
      if (ls && typeof ls.getItem === 'function') {
        return {
          get: <T>(key: string) => {
            const raw = ls.getItem(key)
            if (raw === null) return undefined
            try {
              return JSON.parse(raw) as T
            } catch {
              return undefined
            }
          },
          set: (key, value) => {
            ls.setItem(key, JSON.stringify(value))
          },
          remove: (key) => {
            ls.removeItem(key)
          },
          clear: () => {
            ls.clear()
          },
        }
      }
      return memoryStorage()
    },
    // ★G-32 B3 三期：新增能力（web——无标准 API 的能力（亮度/电话/支付/登录/扫码）缺省 undefined → Hook Err('<cap>.unsupported')
    readSensor: (kind) =>
      new Promise((resolve, reject) => {
        const gany = g as {
          addEventListener?: (t: string, cb: (e: unknown) => void) => void
          removeEventListener?: (t: string, cb: (e: unknown) => void) => void
        }
        if (typeof gany.addEventListener !== 'function') {
          return reject(new CapError('sensor.unsupported', '无事件监听环境（SSR/Node）'))
        }
        // 车内一次性读取：devicemotion（加速/陀螺）或 deviceorientation（罗盘）首个事件即 resolve
        const eventName = kind === 'compass' ? 'deviceorientation' : 'devicemotion'
        let settled = false
        const handler = (e: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          const ev = e as {
            accelerationIncludingGravity?: { x?: number; y?: number; z?: number }
            webkitCompassHeading?: number
            alpha?: number | null
          }
          if (kind === 'compass') {
            const heading = typeof ev.webkitCompassHeading === 'number' ? ev.webkitCompassHeading : typeof ev.alpha === 'number' ? 360 - ev.alpha : 0
            resolve({ kind, heading, timestamp: Date.now() })
            return
          }
          const a = ev.accelerationIncludingGravity
          resolve({ kind, x: a ? a.x : undefined, y: a ? a.y : undefined, z: a ? a.z : undefined, timestamp: Date.now() })
        }
        const cleanup = () => {
          if (typeof gany.removeEventListener === 'function') gany.removeEventListener(eventName, handler)
          clearTimeout(timer)
        }
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          reject(new CapError('sensor.timeout', '传感器事件超时（需设备支持/用户授权）'))
        }, 1500)
        gany.addEventListener(eventName, handler)
      }),
    checkBiometricSupport: async () => {
      // WebAuthn 可用性 = 平台支持指纹/面容的入口（真正硬件支持由系统认证时判定）
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      return typeof cred === 'function'
    },
    authenticateBiometric: async (options) => {
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      if (typeof cred !== 'function') throw new CapError('biometric.unsupported', 'WebAuthn 不支持（需 HTTPS/现代浏览器）')
      const creds = nav?.credentials
      if (!creds || typeof creds.get !== 'function') throw new CapError('biometric.unsupported', 'navigator.credentials.get 缺失')
      try {
        await creds.get({
          publicKey: {
            challenge: new Uint8Array(32),
            rpId: typeof g.location === 'object' && g.location ? g.location.hostname || 'localhost' : 'localhost',
            userVerification: 'required',
            timeout: 60000,
          },
        })
        return true
      } catch (e) {
        throw new CapError('biometric.failed', 'WebAuthn 认证失败/用户取消', e)
      }
    },
  }
}

/** params → query 拼接（useFetch） */
function encodedUrl(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&')
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** 运行时探测：wx 存在 → wx 桥；否则 web 桥（Node/SSR 可注入 mock） */
export function createCapabilityBridge(): CapabilityBridge {
  const g = globalThis as { wx?: WxLike }
  if (g.wx) return wxBridge(g.wx)
  return webBridge(globalThis)
}

// —— useXxx Hook 层（G-32.4：Promise<Result<T>>，无回调，无全局对象） ——

export interface CapabilityHooks {
  useLocation(): Promise<CapResult<Coords>>
  useVibrate(durationMs?: number): Promise<CapResult<void>>
  useNetwork(): Promise<CapResult<NetworkType>>
  useClipboard(): Promise<CapResult<string>>
  setClipboard(text: string): Promise<CapResult<void>>
  useScreen(): Promise<CapResult<ScreenInfo>>
  useDevice(): Promise<CapResult<CapDeviceInfo>>
  useBattery(): Promise<CapResult<BatteryInfo>>
  useOrientation(): Promise<CapResult<OrientationInfo>>
  useShare(options: ShareOptions): Promise<CapResult<void>>
  // ★G-32 B3 续：通信/权限/存储
  /** C26 useFetch：网络请求（成功 .data = 载荷——migration.md `const { data } = await useFetch(url)` 解构兼容） */
  useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<CapResult<T>>
  /** C16 usePermission：权限状态（web Permissions API） */
  usePermission(name: string): Promise<CapResult<PermissionState>>
  /** C15 useStorage：存储句柄（响应式增强见 createReactiveStorage） */
  useStorage(): CompatStorage
  // ★G-32 B3 三期：新增能力 Hook
  /** C5 useSensor：传感器一次性读取（accelerometer/compass/gyroscope） */
  useSensor(kind: SensorKind): Promise<CapResult<SensorSample>>
  /** C13 useBrightness：读取当前亮度（0-1） */
  useBrightness(): Promise<CapResult<number>>
  /** C13 setBrightness：设置亮度（0-1） */
  setBrightness(value: number): Promise<CapResult<void>>
  /** C21 usePhoneCall：拨打电话 */
  usePhoneCall(phoneNumber: string): Promise<CapResult<void>>
  /** C33 useAuth：认证状态组合（token 托管 + 登录/登出 + 订阅）——业务不读 raw token（铁律 2） */
  useAuth(): AuthState
  /** C38 useBiometric：生物识别支持性检测 */
  useBiometric(): Promise<CapResult<boolean>>
  /** C38 authenticateBiometric：发起生物识别认证 */
  authenticateBiometric(options?: BiometricOptions): Promise<CapResult<boolean>>
  /** C40 usePayment：拉起支付（wx.requestPayment 字段） */
  usePayment(config: PaymentConfig): Promise<CapResult<PaymentReceipt>>
  /** C41 useLogin：登录（wx.login → code / 接入第三方 provider） */
  useLogin(provider?: string): Promise<CapResult<LoginResult>>
  /** C42 useQRCode：扫码（wx.scanCode；web 需摄像头取流源 → 降级 Err） */
  useQRCode(): Promise<CapResult<string>>
  /** 能力探测面（降级查询） */
  probe(): Promise<CapabilityProbe>
}

const wrap = <T>(p: Promise<T>): Promise<CapResult<T>> =>
  p.then(
    (data) => capOk(data),
    (e) => capErr<T>(e instanceof CapError ? e.code : 'cap.failed', e instanceof Error ? e.message : String(e), e),
  )

/** ★createCapabilityHooks：能力 Hook 统一实例（bridge 注入可单测） */
export function createCapabilityHooks(bridge: CapabilityBridge = createCapabilityBridge()): CapabilityHooks {
  return {
    useLocation: () => wrap(bridge.getLocation()),
    useVibrate: (durationMs = 15) => wrap(bridge.vibrate(durationMs)),
    useNetwork: () => wrap(bridge.getNetwork()),
    useClipboard: () => wrap(bridge.readClipboard()),
    setClipboard: (text) => wrap(bridge.setClipboard(text)),
    useScreen: () => wrap(bridge.getScreen()),
    useDevice: () => wrap(bridge.getDevice()),
    useBattery: () => wrap(bridge.getBattery()),
    useOrientation: () => wrap(bridge.getOrientation()),
    useShare: (options) => wrap(bridge.share(options)),
    // ★G-32 B3 续：通信/权限/存储（缺桥 → Err 非抛异常——G-32.3 降级语义）
    useFetch: <T>(url: string, config?: FetchConfig) =>
      wrap(
        (() => {
          if (!bridge.request) return Promise.reject(new CapError('fetch.unsupported', '桥未提供 request（useFetch 不可用）'))
          return bridge.request({ url, method: config?.method, data: config?.data, params: config?.params, headers: config?.headers, timeout: config?.timeout }).then((r) => r.data as T)
        })(),
      ),
    usePermission: (name) =>
      wrap(
        (() => {
          if (!bridge.getPermission) return Promise.reject(new CapError('permission.unsupported', '桥未提供 getPermission（usePermission 不可用）'))
          return bridge.getPermission(name)
        })(),
      ),
    useStorage: () => {
      if (!bridge.getStorage) throw new CapError('storage.unsupported', '桥未提供 getStorage（useStorage 不可用）')
      return bridge.getStorage()
    },
    // ★G-32 B3 三期：新增能力 Hook（缺桥 → Err('<cap>.unsupported') 非抛异常——G-32.3 降级语义）
    useSensor: (kind) =>
      wrap(
        (() => {
          if (!bridge.readSensor) return Promise.reject(new CapError('sensor.unsupported', '桥未提供 readSensor（useSensor 不可用）'))
          return bridge.readSensor(kind)
        })(),
      ),
    useBrightness: () =>
      wrap(
        (() => {
          if (!bridge.getBrightness) return Promise.reject(new CapError('brightness.unsupported', '桥未提供 getBrightness（useBrightness 不可用）'))
          return bridge.getBrightness()
        })(),
      ),
    setBrightness: (value) =>
      wrap(
        (() => {
          if (!bridge.setBrightness) return Promise.reject(new CapError('brightness.unsupported', '桥未提供 setBrightness（setBrightness 不可用）'))
          return bridge.setBrightness(value)
        })(),
      ),
    usePhoneCall: (phoneNumber) =>
      wrap(
        (() => {
          if (!bridge.makePhoneCall) return Promise.reject(new CapError('phone-call.unsupported', '桥未提供 makePhoneCall（usePhoneCall 不可用）'))
          return bridge.makePhoneCall(phoneNumber)
        })(),
      ),
    useBiometric: () =>
      wrap(
        (() => {
          if (!bridge.checkBiometricSupport) return Promise.reject(new CapError('biometric.unsupported', '桥未提供 checkBiometricSupport（useBiometric 不可用）'))
          return bridge.checkBiometricSupport()
        })(),
      ),
    authenticateBiometric: (options) =>
      wrap(
        (() => {
          if (!bridge.authenticateBiometric) return Promise.reject(new CapError('biometric.unsupported', '桥未提供 authenticateBiometric 不可用'))
          return bridge.authenticateBiometric(options)
        })(),
      ),
    usePayment: (config) =>
      wrap(
        (() => {
          if (!bridge.requestPayment) return Promise.reject(new CapError('payment.unsupported', '桥未提供 requestPayment（usePayment 不可用）'))
          return bridge.requestPayment(config)
        })(),
      ),
    useLogin: (provider) =>
      wrap(
        (() => {
          if (!bridge.login) return Promise.reject(new CapError('login.unsupported', '桥未提供 login（useLogin 不可用）'))
          return bridge.login(provider)
        })(),
      ),
    useQRCode: () =>
      wrap(
        (() => {
          if (!bridge.scanQR) return Promise.reject(new CapError('qr-code.unsupported', '桥未提供 scanQR（useQRCode 不可用）'))
          return bridge.scanQR()
        })(),
      ),
    // C33 useAuth：认证状态组合（createAuth 凭证托管 + login 桥 + storage 桥）
    useAuth: () => {
      const store = bridge.getStorage ? (bridge.getStorage() as CompatStorage) : undefined
      const authStorage: AuthStorage = {
        getItem: (key) => {
          if (!store) return null
          const v = store.get<string>(key)
          return typeof v === 'string' ? v : null
        },
        setItem: (key, value) => {
          if (store) store.set(key, value)
        },
      }
      const manager = createAuth(authStorage)
      return {
        get token() {
          return manager.getToken()
        },
        get isAuthenticated() {
          return manager.isAuthenticated()
        },
        login: (provider) =>
          wrap(
            (() => {
              if (!bridge.login) return Promise.reject(new CapError('login.unsupported', '桥未提供 login（useAuth.login 不可用）'))
              return bridge.login(provider).then((r) => {
                manager.setToken(r.token ?? r.code ?? null)
                return r.token ?? r.code ?? ''
              })
            })(),
          ),
        logout: () =>
          wrap(
            (() => {
              manager.setToken(null)
              return Promise.resolve()
            })(),
          ),
        setToken: (token) => manager.setToken(token),
        subscribe: (cb) => manager.subscribe(cb),
      }
    },
    probe: async () => ({
      location: bridge.getLocation !== undefined,
      vibrate: bridge.vibrate !== undefined,
      network: bridge.getNetwork !== undefined,
      clipboardRead: bridge.readClipboard !== undefined,
      clipboardWrite: bridge.setClipboard !== undefined,
      screen: bridge.getScreen !== undefined,
      device: bridge.getDevice !== undefined,
      battery: bridge.getBattery !== undefined,
      orientation: bridge.getOrientation !== undefined,
      share: bridge.share !== undefined,
      fetch: bridge.request !== undefined,
      permission: bridge.getPermission !== undefined,
      storage: bridge.getStorage !== undefined,
      sensor: bridge.readSensor !== undefined,
      brightness: bridge.getBrightness !== undefined,
      phoneCall: bridge.makePhoneCall !== undefined,
      biometric: bridge.checkBiometricSupport !== undefined,
      payment: bridge.requestPayment !== undefined,
      login: bridge.login !== undefined,
      qrCode: bridge.scanQR !== undefined,
      auth: bridge.login !== undefined && bridge.getStorage !== undefined,
    }),
  }
}

// —— ★useStorage 响应式增强（注入式 reactivity——api 包零运行时依赖 vue） ——

export interface ReactiveStorage<TState extends Record<string, unknown> = Record<string, unknown>> {
  /** 响应式状态对象（reactive 注入时）；未注入时 = 普通对象（非响应） */
  state: TState
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

/** 注入式 reactivity（消费方传 vue reactive 或任何响应式代理工厂；缺省 = 恒等——非响应但类型一致） */
export type ReactiveFactory = <T extends object>(target: T) => T

/**
 * ★createReactiveStorage：响应式存储（零依赖注入式）
 * @param storage 底座（bridge.getStorage() / platform.storage）
 * @param reactive reactive 工厂（vue reactive / 自定义；缺省恒等——state 为普通对象）
 * 用法：const store = createReactiveStorage(cap.useStorage(), reactive)
 */
export function createReactiveStorage<TState extends Record<string, unknown> = Record<string, unknown>>(
  storage: CompatStorage,
  reactive?: ReactiveFactory,
): ReactiveStorage<TState> {
  const plain: Record<string, unknown> = {}
  const state = (reactive ? reactive<Record<string, unknown>>(plain) : plain) as TState
  return {
    state,
    get: <T = unknown>(key: string) => storage.get<T>(key),
    set: (key, value) => {
      storage.set(key, value)
      // 始终同步 state（新增 + 更新——响应式镜像）= storage 写入
      ;(state as Record<string, unknown>)[key] = value
    },
    remove: (key) => {
      storage.remove(key)
      if (key in state) {
        delete (state as Record<string, unknown>)[key]
      }
    },
    clear: () => {
      storage.clear()
      for (const k of Object.keys(state)) {
        delete (state as Record<string, unknown>)[k]
      }
    },
  }
}