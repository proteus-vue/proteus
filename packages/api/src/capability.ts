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
  /** 纬度（WGS84，浮点度数） */
  latitude: number
  /** 经度（WGS84，浮点度数） */
  longitude: number
  /** 定位精度（米，半径；越小越准） */
  accuracy?: number
  /** 海拔（米；平台不支持时缺省） */
  altitude?: number
  /** 速度（米/秒；平台不支持时缺省） */
  speed?: number
}

export interface NetworkType {
  /** 是否联网（navigator.onLine / wx.getNetworkType 归一） */
  online: boolean
  /** 网络类型（web 无细分 → unknown；离线 → none） */
  type: 'unknown' | 'wifi' | 'cellular' | 'none'
}

export interface BatteryInfo {
  /** 电量（0-1，浮点） */
  level: number
  /** 是否充电中 */
  charging: boolean
  /** 充满所需秒数（充电中才有；不支持缺省） */
  chargingTime?: number
  /** 剩余可用秒数（放电中才有；不支持缺省） */
  dischargingTime?: number
}

export interface CapDeviceInfo {
  /** 平台标识（ios / android / devtools / desktop …） */
  platform: string
  /** 设备型号（如 iPhone 15 Pro） */
  model: string
  /** 操作系统名（iOS / Android / Windows / macOS） */
  os: string
  /** 系统版本号（如 17.4） */
  version: string
  /** 浏览器/容器名（web 端有；MP 缺省） */
  browser?: string
}

export interface ScreenInfo {
  /** 屏幕宽度（px，CSS 像素） */
  width: number
  /** 屏幕高度（px，CSS 像素） */
  height: number
  /** 设备像素比（物理像素 / CSS 像素） */
  dpr: number
  /** 当前方向 */
  orientation: 'portrait' | 'landscape'
}

export interface ShareOptions {
  /** 分享标题 */
  title?: string
  /** 分享文本（Web navigator.share 用；MP 缺省） */
  text?: string
  /** 分享链接（web 必传 HTTPS URL） */
  url?: string
}

export interface PermissionState {
  /** 权限名（web Permissions API 名，如 geolocation / camera） */
  permission: string
  /** 授权状态（prompt = 未询问） */
  state: 'granted' | 'denied' | 'prompt'
}

export interface OrientationInfo {
  /** 屏幕方向 */
  type: 'portrait' | 'landscape'
  /** 旋转角度（0/90/180/-90 度） */
  angle: number
}

// ★G-32 B3 三期：传感器 / 亮度 / 电话 / 生物识别 / 支付 / 登录 / 扫码 / 认证组合

/** C5 传感器类型（wx onAccelerometer/onCompass/onGyroscope / web DeviceMotion/DeviceOrientation） */
export type SensorKind = 'accelerometer' | 'compass' | 'gyroscope'

/** C5 传感器采样（一次性读取当前值；compass 带 heading） */
export interface SensorSample {
  /** 传感器类型（回显请求的 kind） */
  kind: SensorKind
  /** X 轴加速度/分量（accelerometer/gyroscope） */
  x?: number
  /** Y 轴加速度/分量 */
  y?: number
  /** Z 轴加速度/分量 */
  z?: number
  /** 罗盘方位（0-360°，参考正北；仅 compass） */
  heading?: number
  /** 采样时间戳（ms） */
  timestamp?: number
}

/** C40 支付参数（对齐 wx.requestPayment 核心字段——服务端下单后下发） */
export interface PaymentConfig {
  /** 时间戳（秒级字符串，服务端生成） */
  timeStamp: string
  /** 随机串（服务端生成，32 字符内） */
  nonceStr: string
  /** 统一下单接口返回的 prepay_id（格式 paySign=...） */
  package: string
  /** 签名方式（缺省 MD5/平台默认；建议 RSA） */
  signType?: string
  /** 签名（服务端按商户私钥计算） */
  paySign: string
}

/** C40 支付结果 */
export interface PaymentReceipt {
  /** 支付渠道（wechat / alipay / host …由宿主桥标注） */
  provider: string
  /** 交易单号（渠道返回；不支持缺省） */
  transactionId?: string
}

/** C41 登录结果（wx.login → code；web/其它 provider → token/授权信息） */
export interface LoginResult {
  /** 登录渠道（wechat / host-provider …） */
  provider: string
  /** 登录凭证（wx code，服务端换 session 用） */
  code?: string
  /** 令牌（第三方 provider 直接下发 token 时） */
  token?: string
}

/** C33 认证状态（组合：createAuth 凭证托管 + login 桥 + 存储桥；业务只读 AuthState 不读 raw token——铁律 2） */
export interface AuthState {
  /** 当前令牌（未登录 null；响应式——UI 直接绑定） */
  token: string | null
  /** 是否已登录（token 非空即真） */
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

// ★G-32 B3 四期：websocket / upload / download / analytics / log / file-system

/** C27 WebSocket 连接句柄（wx SocketTask / web WebSocket 适配） */
export interface WebSocketConnection {
  /** 发送消息（字符串或二进制） */
  send(data: string | ArrayBuffer): void
  /** 关闭连接 */
  close(code?: number, reason?: string): void
  /** 订阅事件（返回取消订阅函数）——open/message/close/error */
  on(event: 'open' | 'message' | 'close' | 'error', handler: (payload?: unknown) => void): () => void
}

/** C29/C30 传输进度回调（0-100） */
export type ProgressCallback = (pct: number) => void

/** C29 上传选项（wx.uploadFile / web fetch FormData） */
export interface UploadOptions {
  /** 上传目标 URL（HTTPS） */
  url: string
  /** wx 临时文件路径（wx.chooseMedia/chooseImage 等产出） */
  filePath?: string
  /** web 文件对象 */
  file?: Blob
  /** 表单字段名（缺省 'file'） */
  name?: string
  /** 附加表单字段 */
  formData?: Record<string, string>
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 超时（ms；超时 → Err） */
  timeout?: number
}

/** C29 上传结果 */
export interface UploadResult {
  /** HTTP 状态码 */
  status: number
  /** 响应体（文本/JSON 由服务端决定） */
  data: unknown
  /** 进度（0-100，若平台支持 onProgressUpdate） */
  progress?: number
}

/** C30 下载选项 */
export interface DownloadOptions {
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 超时（ms；超时 → Err） */
  timeout?: number
  /** 返回数据类型：blob（web）/ path（wx tempFilePath）/ text / json */
  responseType?: 'blob' | 'path' | 'text' | 'json'
}

/** C30 下载结果 */
export interface DownloadResult {
  /** HTTP 状态码 */
  status: number
  /** 响应体（形态由 responseType 决定） */
  data: unknown
  /** wx tempFilePath（responseType=path） */
  path?: string
  /** 进度（0-100） */
  progress?: number
}

/** C34 分析事件（wx.reportEvent / web 无标准 → 缺省降级） */
export interface AnalyticsEvent {
  /** 事件名（埋点埋点约定，如 page_view / button_click） */
  name: string
  /** 事件参数（自由键值对） */
  params?: Record<string, unknown>
}

/** C34 TrackAPI（useAnalytics 句柄） */
export interface TrackAPI {
  track(name: string, params?: Record<string, unknown>): Promise<CapResult<void>>
}

/** C35 日志级别 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error'

/** C35 Logger（useLog 句柄——console + 上报） */
export interface Logger {
  log(message: string, data?: unknown): Promise<CapResult<void>>
  warn(message: string, data?: unknown): Promise<CapResult<void>>
  error(message: string, data?: unknown): Promise<CapResult<void>>
}

/** C43 文件系统桥（wx.getFileSystemManager / web 内存降级） */
export interface FileSystemBridge {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** C43 FSAdapter（useFileSystem 句柄——方法均返回 Result<T>） */
export interface FSAdapter {
  /** 能力可用性（内存降级也算可用；false = 完全不可用） */
  supported: boolean
  readFile(path: string): Promise<CapResult<string>>
  writeFile(path: string, data: string): Promise<CapResult<void>>
  remove(path: string): Promise<CapResult<void>>
  exists(path: string): Promise<CapResult<boolean>>
}

// ★G-32 B3 五期：notification / contact / calendar / app-lifecycle / archive / shortcut

/** C17 可订阅的消息模板（wx.requestSubscribeMessage / web Notification） */
export interface MessageSubscription {
  /** 模板 id（wx 需要先在公众平台申请） */
  templateId: string
  /** 是否获得授权（wx 为 tmplIds 中该模板的状态；web 为 Notification.requestPermission granted） */
  granted: boolean
  /** 原始状态文案（wx: 'accept'/'reject'/'ban'；web: 'granted'/'denied'/'default'） */
  status?: string
}

/** web Notification 构造器形态（注入式——可单测） */
interface NotificationConstructor {
  new (title: string, options?: { body?: string }): unknown
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
  permission?: string
}

/** C19 联系人（wx.chooseContact / web 无标准 → 降级 undefined） */
export interface Contact {
  /** 联系人姓名 */
  name: string
  /** 电话号码 */
  phone?: string
  /** 邮箱 */
  email?: string
}

/** C23 应用生命周期句柄（wx App 钩子 / web visibilitychange+load 订阅） */
export interface AppLifecycle {
  /** 当前阶段：launch/show/hide */
  phase: 'PENDING' | 'LAUNCH' | 'SHOW' | 'HIDE'
  onLaunch(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
}

/** C44 压缩选项（wx.compressFile / web 无标准 → 降级 undefined） */
export interface ArchiveOptions {
  /** 源文件路径 */
  src: string
  /** 目标路径（缺省同目录） */
  dest?: string
  /** 图片压缩质量 0-100（wx 支持） */
  quality?: number
}

/** C20 日历事件（wx.addPhoneCalendar / web 无标准 → 降级 undefined） */
export interface CalendarEvent {
  /** 日历事件标题 */
  title: string
  /** 开始时间戳（ms） */
  startTime: number
  /** 结束时间戳（ms） */
  endTime?: number
  /** 提前提醒（分钟） */
  alarms?: number[]
  /** 地点 */
  location?: string
  /** 备注/描述 */
  description?: string
}

// ★G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard

/** C24 页面生命周期句柄（wx Page 钩子 / web load+visibilitychange） */
export interface PageLifecycle {
  /** 页面当前阶段（LOAD 加载 / SHOW 显示 / HIDE 隐藏） */
  phase: 'IDLE' | 'LOAD' | 'SHOW' | 'HIDE'
  onLoad(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
}

/** C1/C2 媒体访问（camera/microphone——wx authorize / web getUserMedia） */
export interface MediaAccess {
  /** 媒体设备类型 */
  kind: 'camera' | 'microphone'
  /** 平台能力/设备存在 */
  supported: boolean
  /** 用户已授权 */
  granted: boolean
}

/** C36 蓝牙状态（wx.openBluetoothAdapter / web Web Bluetooth 特性探测） */
export interface BluetoothInfo {
  /** 平台是否支持蓝牙 */
  supported: boolean
  /** 适配器已打开（可用） */
  available: boolean
  /** 已配对/发现的设备名（wx.getBluetoothDevices；web 需用户手势不列） */
  devices: string[]
}

/** C37 NFC 状态（wx.getHCEState / web NDEFReader 特性探测） */
export interface NfcInfo {
  /** 平台是否支持 NFC */
  supported: boolean
  /** NFC 当前可用（已开启） */
  available: boolean
}

/** C14 键盘信息（高度 px + 可见性） */
export interface KeyboardInfo {
  /** 键盘高度（px） */
  height: number
  /** 键盘是否可见 */
  visible: boolean
}

/** C14 键盘生命周期句柄（wx.onKeyboardHeightChange / web visualViewport） */
export interface KeyboardLifecycle {
  /** 当前键盘状态（高度/可见性快照） */
  info: KeyboardInfo
  onChange(cb: (info: KeyboardInfo) => void): () => void
}

// —— G-32 B3 七期/八期：剩余能力类型（C4 地图 / C22 SMS / C25 后台 / C28 SocketTask / C31 数据通道 / C32 Cookie / C39 人脸 / C46 内购 / C47 小程序 / C48 宿主嵌入 / C49 直播 / C50 扩展） ——

/** C4 地图区域（wx.createMapContext 语义） */
export interface MapRegion {
  /** 中心纬度 */
  latitude: number
  /** 中心经度 */
  longitude: number
  /** 缩放级别（4-20，越大越细） */
  scale?: number
}

/** C4 地图上下文桥（wx MapContext / web 宿主集成） */
export interface MapContextBridge {
  getRegion(): Promise<MapRegion>
  moveTo(latitude: number, longitude: number, scale?: number): Promise<void>
}

/** C4 useMap 句柄（控制器方法返回 Result<T>——G-32.4） */
export interface MapController {
  getRegion(): Promise<CapResult<MapRegion>>
  moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>
}

/** C25 后台事件（wx onAppHide/onAppShow / web visibilitychange） */
export interface BackgroundEvent {
  /** 事件类型（退后台 / 回前台） */
  type: 'enter-background' | 'enter-foreground'
  /** 事件时间戳（ms） */
  time: number
}

/** C25 useBackground 句柄（后台/前台切换订阅） */
export interface BackgroundAPI {
  onEvent(cb: (e: BackgroundEvent) => void): () => void
}

/** C28 底层 SocketTask（wx.SocketTask 语义——send/close/onMessage 低层句柄；与 C27 上层连接互补） */
export interface SocketTaskBridge {
  send(data: string): Promise<void>
  close(code?: number, reason?: string): Promise<void>
  onMessage(cb: (data: string) => void): () => void
  isConnected(): boolean
}

/** C28 useSocketTask 句柄（Hook 层——方法包 CapResult，G-32.4） */
export interface SocketTaskHandle {
  send(data: string): Promise<CapResult<void>>
  close(code?: number, reason?: string): Promise<CapResult<void>>
  onMessage(cb: (data: string) => void): () => void
  isConnected(): boolean
}

/** C31 数据通道（直播/实时——宿主桥接；缺省 Err 诚实降级） */
export interface DataChannelOptions {
  /** 通道标识（业务自定义，跨端路由用） */
  channelId: string
}

export interface DataChannelBridge {
  send(data: string): Promise<void>
  onMessage(cb: (data: string) => void): () => void
}

export interface DataChannelHandle {
  send(data: string): Promise<CapResult<void>>
  onMessage(cb: (data: string) => void): () => void
}

/** C32 Cookie 罐（web document.cookie / wx storage 兜底） */
export interface CookieJar {
  get(name: string): string | undefined
  set(name: string, value: string, maxAge?: number): void
  remove(name: string): void
  list(): Record<string, string>
}

/** C46 内购回执（wx 无公开 IAP API——宿主桥接；web 无标准 → Err） */
export interface IAPReceipt {
  /** 内购商品 ID（应用商店登记） */
  productId: string
  /** 交易单号（商店返回） */
  transactionId?: string
  /** 交易状态（purchased 新购 / restored 恢复购买） */
  state: 'purchased' | 'restored'
}

/** C47 小程序跳转（wx.navigateToMiniProgram） */
export interface MiniProgramNavOptions {
  /** 目标小程序 appId */
  appId: string
  /** 目标页路径（缺省首页） */
  path?: string
  /** 传递给目标小程序的数据（target app onLoad options.extraData） */
  extraData?: Record<string, unknown>
}

export interface MiniProgramAPI {
  navigate(options: MiniProgramNavOptions): Promise<CapResult<void>>
}

/** C48 被宿主嵌入（HostContext——宿主桥注入；缺省 Err 诚实降级） */
export interface HostContext {
  /** 宿主渠道标识（wechat / web / studio …） */
  provider: string
  /** 宿主/基础库版本 */
  version?: string
  /** 宿主声明的能力名集合 */
  capabilities?: string[]
}

/** C49 直播房间（wx live 组件形态/宿主桥——缺省 Err） */
export interface LiveRoomOptions {
  /** 直播间 ID */
  roomId: string
  /** 拉流模式 */
  mode?: 'video' | 'audio'
}

export interface LiveRoomBridge {
  leave(): Promise<void>
  status(): 'joined' | 'left'
}

export interface LiveRoomHandle {
  leave(): Promise<CapResult<void>>
  status(): 'joined' | 'left'
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
  // ★G-32 B3 四期：新增能力（websocket/upload/download/analytics/log/file-system——缺省 undefined → 对应 Hook 返回 Err('<cap>.unsupported')
  /** C27 WebSocket 连接（wx.connectSocket / web WebSocket） */
  connectWebSocket?(url: string, protocols?: string[]): Promise<WebSocketConnection>
  /** C29 上传（wx.uploadFile / web fetch FormData） */
  upload?(options: UploadOptions, onProgress?: ProgressCallback): Promise<UploadResult>
  /** C30 下载（wx.downloadFile / web fetch blob） */
  download?(url: string, options?: DownloadOptions, onProgress?: ProgressCallback): Promise<DownloadResult>
  /** C34 埋点/上报（wx.reportEvent；web 无标准 → 缺省 → Err） */
  track?(name: string, params?: Record<string, unknown>): Promise<void>
  /** C35 日志（console + 上报；wx/web 同 console，错误可上报） */
  log?(level: LogLevel, message: string, data?: unknown): Promise<void>
  /** C43 文件系统（wx.getFileSystemManager / web 内存降级） */
  getFileSystem?(): FileSystemBridge
  // ★G-32 B3 五期：new capabilities（缺省 undefined → 对应 Hook 返回 Err('<cap>.unsupported')
  /** C17 消息订阅授权（wx.requestSubscribeMessage / web Notification.requestPermission） */
  subscribeMessage?(templateId: string): Promise<MessageSubscription>
  /** C19 联系人选择（wx.chooseContact / web 无标准 → 缺省） */
  chooseContact?(): Promise<Contact[]>
  /** C20 日历事件添加（wx.addPhoneCalendar / web 无标准 → 缺省） */
  addCalendarEvent?(event: CalendarEvent): Promise<void>
  /** C23 应用生命周期订阅（wx App 钩子 / web visibilitychange+load） */
  getAppLifecycle?(): AppLifecycle
  /** C44 压缩（wx.compressFile / web 无标准 → 缺省） */
  compressFile?(options: ArchiveOptions): Promise<void>
  /** C45 桌面快捷方式（wx.addToDesktop / web 无标准 → 缺省） */
  addShortcut?(): Promise<void>
  // ★G-32 B3 六期：new capabilities（缺省 undefined → Hook 返回 Err / 句柄抛错）
  /** C24 页面生命周期订阅（wx Page 钩子 / web load+visibilitychange） */
  getPageLifecycle?(): PageLifecycle
  /** C36 蓝牙状态（wx.openBluetoothAdapter / web navigator.bluetooth 特性探测） */
  getBluetooth?(): Promise<BluetoothInfo>
  /** C37 NFC 状态（wx.getHCEState / web NDEFReader 特性探测） */
  getNfc?(): Promise<NfcInfo>
  /** C1 摄像头访问（wx.authorize scope.camera / web getUserMedia） */
  getCamera?(): Promise<MediaAccess>
  /** C2 麦克风访问（wx.authorize scope.record / web getUserMedia audio） */
  getMicrophone?(): Promise<MediaAccess>
  /** C14 键盘生命周期（wx.onKeyboardHeightChange / web visualViewport） */
  getKeyboard?(): KeyboardLifecycle
  // ★G-32 B3 七期：剩余能力（缺省 undefined → 对应 Hook 返回 Err('<cap>.unsupported')——G-32.3 降级语义）
  /** C4 地图上下文（wx.createMapContext / web 宿主集成；无 → Err） */
  createMap?(id: string): MapContextBridge
  /** C22 短信（wx 受限无开放 API / web 无标准 → 缺省 Err） */
  sendSMS?(phone: string, message: string): Promise<void>
  /** C25 后台生命周期（wx onAppHide/onAppShow / web visibilitychange） */
  getBackground?(): BackgroundAPI
  /** C28 底层 SocketTask（wx.connectSocket → SocketTask / web WebSocket） */
  createSocketTask?(url: string): SocketTaskBridge
  /** C32 Cookie 罐（web document.cookie / wx storage 兜底） */
  getCookieJar?(): CookieJar
  /** C39 人脸识别认证（wx startSoterAuthentication facial / web WebAuthn） */
  authenticateFaceID?(prompt?: string): Promise<boolean>
  /** C46 内购（wx/无公开 API / web 无标准 → 缺省 Err） */
  requestIAP?(productId: string): Promise<IAPReceipt>
  /** C47 跳小程序（wx.navigateToMiniProgram） */
  navigateMiniProgram?(options: MiniProgramNavOptions): Promise<void>
  // ★G-32 B3 八期：平台私有/宿主桥（缺省 undefined → Err 诚实降级）
  /** C31 数据通道（直播/实时——宿主桥接） */
  openDataChannel?(options: DataChannelOptions): DataChannelBridge
  /** C48 宿主上下文（被嵌入场景——宿主注入） */
  getHostContext?(): HostContext
  /** C49 直播房间（wx live 组件形态/宿主桥） */
  joinLiveRoom?(options: LiveRoomOptions): LiveRoomBridge
  /** C50 扩展/插件（G-21 扩展点——宿主 loadPlugin 桥） */
  loadExtension?(extensionId: string): Promise<unknown>
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
  /** HTTP 方法（缺省 GET） */
  method?: HttpMethod
  /** 请求体（POST/PUT；对象自动 JSON 序列化） */
  data?: unknown
  /** URL 查询参数（拼接到 query string） */
  params?: Record<string, unknown>
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 超时（ms；超时 → Err） */
  timeout?: number
}

/** 该能力是否可用（降级探测——G-32.3：缺失 → Err 非抛异常） */
/** 运行时能力探测（probe() 返回——降级查询面：业务预判能力可用性，无需 try/catch） */
export interface CapabilityProbe {
  /** 定位（wx.getLocation / geolocation） */
  location: boolean
  /** 震动 */
  vibrate: boolean
  /** 网络状态 */
  network: boolean
  /** 剪贴板读取 */
  clipboardRead: boolean
  /** 剪贴板写入 */
  clipboardWrite: boolean
  /** 屏幕信息 */
  screen: boolean
  /** 设备信息 */
  device: boolean
  /** 电池 */
  battery: boolean
  /** 屏幕方向 */
  orientation: boolean
  /** 分享 */
  share: boolean
  /** ★G-32 B3 续 */
  fetch: boolean
  /** 权限状态查询 */
  permission: boolean
  /** 键值存储 */
  storage: boolean
  /** ★G-32 B3 三期 */
  sensor: boolean
  /** 屏幕亮度读取/设置 */
  brightness: boolean
  /** 拨打电话 */
  phoneCall: boolean
  /** 生物识别 */
  biometric: boolean
  /** 支付 */
  payment: boolean
  /** 登录 */
  login: boolean
  /** 扫码 */
  qrCode: boolean
  /** C33 认证组合（需 login 桥 + 存储桥齐备才视为完整） */
  auth: boolean
  /** ★G-32 B3 四期 */
  websocket: boolean
  /** 文件上传 */
  upload: boolean
  /** 文件下载 */
  download: boolean
  /** 埋点上报 */
  analytics: boolean
  /** 日志 */
  log: boolean
  /** 文件系统 */
  fileSystem: boolean
  /** ★G-32 B3 五期 */
  notification: boolean
  /** 联系人 */
  contact: boolean
  /** 日历 */
  calendar: boolean
  /** App 生命周期 */
  appLifecycle: boolean
  /** 文件压缩/解压 */
  archive: boolean
  /** 桌面快捷方式 */
  shortcut: boolean
  /** ★G-32 B3 六期 */
  pageLifecycle: boolean
  /** 蓝牙 */
  bluetooth: boolean
  /** NFC */
  nfc: boolean
  /** 相机 */
  camera: boolean
  /** 麦克风 */
  microphone: boolean
  /** 键盘 */
  keyboard: boolean
  /** ★G-32 B3 七期/八期 */
  map: boolean
  /** 短信 */
  sms: boolean
  /** 后台事件 */
  background: boolean
  /** SocketTask 句柄 */
  socketTask: boolean
  /** 数据通道 */
  dataChannel: boolean
  /** Cookie */
  cookie: boolean
  /** 人脸识别 */
  faceId: boolean
  /** 应用内购 */
  inAppPurchase: boolean
  /** 小程序互跳/开放能力 */
  miniProgram: boolean
  /** 内嵌 web/混合容器 */
  embedded: boolean
  /** 直播 */
  live: boolean
  /** 扩展/插件 */
  extension: boolean
}

// —— 平台桥实现（双端 + mock） ——

/** wx SocketTask（wx.connectSocket 返回） */
interface WxSocketTask {
  send?: (opt: { data: string | ArrayBuffer }) => void
  close?: (opt?: { code?: number; reason?: string }) => void
  onOpen?: (cb: () => void) => void
  onMessage?: (cb: (r: { data: string | ArrayBuffer }) => void) => void
  onClose?: (cb: (r: { code?: number; reason?: string }) => void) => void
  onError?: (cb: (e: unknown) => void) => void
}

/** wx UploadTask（wx.uploadFile 返回） */
interface WxUploadTask {
  onProgressUpdate?: (cb: (r: { progress: number }) => void) => void
}

/** wx DownloadTask（wx.downloadFile 返回） */
interface WxDownloadTask {
  onProgressUpdate?: (cb: (r: { progress: number }) => void) => void
}

/** wx FileSystemManager（wx.getFileSystemManager 返回——子集） */
interface WxFileSystemManager {
  readFile?: (opt: {
    filePath: string
    encoding?: string
    success: (r: { data: string | ArrayBuffer }) => void
    fail: (e: unknown) => void
  }) => void
  writeFile?: (opt: {
    filePath: string
    data: string | ArrayBuffer
    encoding?: string
    success?: () => void
    fail: (e: unknown) => void
  }) => void
  unlink?: (opt: { filePath: string; success?: () => void; fail: (e: unknown) => void }) => void
  access?: (opt: { path: string; success?: () => void; fail?: (e: unknown) => void }) => void
}

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
  startSoterAuthentication?: (opt: {
    requestAuthModes: string[]
    challenge?: string
    authContent?: string
    success: (r: { authResult?: unknown }) => void
    fail?: ((e: unknown) => void) | (() => void)
  }) => void
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
  // ★G-32 B3 四期：新增 wx 能力
  connectSocket?: (opt: {
    url: string
    protocols?: string[]
    success?: () => void
    fail?: (e: unknown) => void
  }) => WxSocketTask
  uploadFile?: (opt: {
    url: string
    filePath: string
    name?: string
    formData?: Record<string, string>
    header?: Record<string, string>
    timeout?: number
    success: (r: { statusCode: number; data: unknown }) => void
    fail: (e: unknown) => void
  }) => WxUploadTask
  downloadFile?: (opt: {
    url: string
    header?: Record<string, string>
    timeout?: number
    success: (r: { statusCode: number; tempFilePath: string }) => void
    fail: (e: unknown) => void
  }) => WxDownloadTask
  reportEvent?: (opt: { event: string; data?: Record<string, unknown> }) => void
  getFileSystemManager?: () => WxFileSystemManager
  // ★G-32 B3 五期：新增 wx 能力
  requestSubscribeMessage?: (opt: {
    tmplIds: string[]
    success: (r: { [tmplId: string]: string }) => void
    fail?: (e: unknown) => void
  }) => void
  chooseContact?: (opt: {
    success: (r: { contactList?: Array<{ name: string; phone?: string; email?: string }> }) => void
    fail?: (e: unknown) => void
  }) => void
  addPhoneCalendar?: (opt: {
    title: string
    startTime: number
    endTime?: number
    alarms?: number[]
    location?: string
    description?: string
    success?: () => void
    fail?: (e: unknown) => void
  }) => void
  onAppShow?: (cb: () => void) => void
  onAppHide?: (cb: () => void) => void
  compressFile?: (opt: {
    src: string
    dest?: string
    quality?: number
    success?: (r: { tempFilePath?: string }) => void
    fail?: (e: unknown) => void
  }) => void
  addToDesktop?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  // ★G-32 B3 六期：新增 wx 能力
  createCameraContext?: () => unknown
  getRecorderManager?: () => unknown
  authorize?: (opt: { scope: string; success?: () => void; fail?: (e: unknown) => void }) => void
  openBluetoothAdapter?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  getBluetoothDevices?: (opt: { success: (r: { devices?: Array<{ name?: string }> }) => void; fail?: (e: unknown) => void }) => void
  getHCEState?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  onKeyboardHeightChange?: (cb: (r: { height: number }) => void) => void
  onPageShow?: (cb: () => void) => void
  onPageHide?: (cb: () => void) => void
  // ★G-32 B3 七期：新增 wx 能力（地图 / 人脸 / 跳小程序）
  createMapContext?: (id: string) => WxMapContextLike
  navigateToMiniProgram?: (opt: {
    appId: string
    path?: string
    extraData?: Record<string, unknown>
    success?: () => void
    fail?: (e: unknown) => void
  }) => void
}

/** wx MapContext（wx.createMapContext 返回——C4 子集） */
interface WxMapContextLike {
  getRegion?: (opt: {
    success: (r: { latitude: number; longitude: number; scale?: number; latitudeSpan?: number; longitudeSpan?: number }) => void
    fail?: (e: unknown) => void
  }) => void
  moveTo?: (opt: { latitude: number; longitude: number; scale?: number; success?: () => void; fail?: (e: unknown) => void }) => void
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

/** web 内存文件系统（C43 降级：可读写但非持久——无标准同步 FS 时的诚实降级） */
function memoryFileSystem(): FileSystemBridge {
  const mem = new Map<string, string>()
  return {
    readFile: (path) =>
      new Promise((resolve, reject) => {
        const v = mem.get(path)
        if (v === undefined) return reject(new CapError('file-system.read-failed', `内存文件不存在: ${path}`))
        resolve(v)
      }),
    writeFile: (path, data) =>
      new Promise((resolve) => {
        mem.set(path, data)
        resolve()
      }),
    remove: (path) =>
      new Promise((resolve) => {
        mem.delete(path)
        resolve()
      }),
    exists: (path) =>
      new Promise((resolve) => {
        resolve(mem.has(path))
      }),
  }
}

/** wx 文件系统桥（getFileSystemManager 子集——readFile/writeFile/unlink/access） */
function wxFileSystem(wx: WxLike): FileSystemBridge {
  const fs = wx.getFileSystemManager?.()
  const read = (path: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!fs?.readFile) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.readFile 缺失'))
      fs.readFile({ filePath: path, encoding: 'utf8', success: (r) => resolve(String(r.data)), fail: (e) => reject(new CapError('file-system.read-failed', 'wx 读文件失败', e)) })
    })
  const write = (path: string, data: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.writeFile) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.writeFile 缺失'))
      fs.writeFile({ filePath: path, data, encoding: 'utf8', success: () => resolve(), fail: (e) => reject(new CapError('file-system.write-failed', 'wx 写文件失败', e)) })
    })
  const remove = (path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.unlink) return reject(new CapError('file-system.unsupported', 'wx FileSystemManager.unlink 缺失'))
      fs.unlink({ filePath: path, success: () => resolve(), fail: (e) => reject(new CapError('file-system.remove-failed', 'wx unlink 失败', e)) })
    })
  const exists = (path: string): Promise<boolean> =>
    new Promise((resolve) => {
      if (!fs?.access) {
        resolve(false)
        return
      }
      fs.access({ path, success: () => resolve(true), fail: () => resolve(false) })
    })
  return { readFile: read, writeFile: write, remove, exists }
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
    // ★G-32 B3 四期：websocket / upload / download / analytics / log / file-system
    connectWebSocket: (url, protocols) =>
      new Promise((resolve, reject) => {
        if (!wx.connectSocket) return reject(new CapError('websocket.unsupported', 'wx.connectSocket 缺失'))
        const task = wx.connectSocket({ url, protocols: protocols ?? [] })
        if (!task) return reject(new CapError('websocket.failed', 'wx.connectSocket 返回空'))
        let settled = false
        task.onError?.(() => {
          if (!settled) {
            settled = true
            reject(new CapError('websocket.failed', 'wx.connectSocket 连接失败'))
          }
        })
        task.onOpen?.(() => {
          if (settled) return
          settled = true
          resolve({
            send: (data) => task.send?.({ data }),
            close: (code, reason) => task.close?.({ code, reason }),
            on: (event, handler) => {
              if (event === 'open') task.onOpen?.(() => handler())
              else if (event === 'message') task.onMessage?.((r) => handler({ data: r.data }))
              else if (event === 'close') task.onClose?.((r) => handler({ code: r.code, reason: r.reason }))
              else if (event === 'error') task.onError?.((e) => handler(e))
              return () => undefined
            },
          })
        })
      }),
    upload: (options, onProgress) =>
      new Promise((resolve, reject) => {
        if (!wx.uploadFile) return reject(new CapError('upload.unsupported', 'wx.uploadFile 缺失'))
        if (!options.filePath) return reject(new CapError('upload.failed', 'wx 上传缺少 filePath'))
        const task = wx.uploadFile({
          url: options.url,
          filePath: options.filePath,
          name: options.name ?? 'file',
          formData: options.formData,
          header: options.headers,
          timeout: options.timeout,
          success: (r) => resolve({ status: r.statusCode, data: r.data }),
          fail: (e) => reject(new CapError('upload.failed', 'wx.uploadFile 失败', e)),
        })
        task?.onProgressUpdate?.((r) => onProgress?.(r.progress))
      }),
    download: (url, options, onProgress) =>
      new Promise((resolve, reject) => {
        if (!wx.downloadFile) return reject(new CapError('download.unsupported', 'wx.downloadFile 缺失'))
        const task = wx.downloadFile({
          url,
          header: options?.headers,
          timeout: options?.timeout,
          success: (r) => resolve({ status: r.statusCode, path: r.tempFilePath, data: r.tempFilePath }),
          fail: (e) => reject(new CapError('download.failed', 'wx.downloadFile 失败', e)),
        })
        task?.onProgressUpdate?.((r) => onProgress?.(r.progress))
      }),
    track: (name, params) =>
      new Promise((resolve) => {
        if (!wx.reportEvent) {
          resolve()
          return
        }
        wx.reportEvent({ event: name, data: params })
        resolve()
      }),
    log: (level, message, data) =>
      new Promise((resolve) => {
        const fn = console[level]
        if (typeof fn === 'function') fn(message, data !== undefined ? data : '')
        resolve()
      }),
    getFileSystem: () => wxFileSystem(wx),
    // ★G-32 B3 五期：notification / contact / calendar / app-lifecycle / archive / shortcut
    subscribeMessage: (templateId) =>
      new Promise((resolve, reject) => {
        if (!wx.requestSubscribeMessage) return reject(new CapError('notification.unsupported', 'wx.requestSubscribeMessage 缺失'))
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: (r) => {
            const status = r[templateId] ?? 'reject'
            resolve({ templateId, granted: status === 'accept', status })
          },
          fail: (e) => reject(new CapError('notification.failed', 'wx.requestSubscribeMessage 失败', e)),
        })
      }),
    chooseContact: () =>
      new Promise((resolve, reject) => {
        if (!wx.chooseContact) return reject(new CapError('contact.unsupported', 'wx.chooseContact 缺失'))
        wx.chooseContact({
          success: (r) => resolve((r.contactList ?? []).map((c) => ({ name: c.name, phone: c.phone, email: c.email }))),
          fail: (e) => reject(new CapError('contact.failed', 'wx.chooseContact 失败', e)),
        })
      }),
    addCalendarEvent: (event) =>
      new Promise((resolve, reject) => {
        if (!wx.addPhoneCalendar) return reject(new CapError('calendar.unsupported', 'wx.addPhoneCalendar 缺失'))
        wx.addPhoneCalendar({
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          alarms: event.alarms,
          location: event.location,
          description: event.description,
          success: () => resolve(),
          fail: (e) => reject(new CapError('calendar.failed', 'wx.addPhoneCalendar 失败', e)),
        })
      }),
    getAppLifecycle: () => ({
      phase: 'PENDING',
      onLaunch: (cb) => {
        cb()
        return () => undefined
      },
      onShow: (cb) => {
        wx.onAppShow?.(cb)
        return () => undefined
      },
      onHide: (cb) => {
        wx.onAppHide?.(cb)
        return () => undefined
      },
    }),
    compressFile: (options) =>
      new Promise((resolve, reject) => {
        if (!wx.compressFile) return reject(new CapError('archive.unsupported', 'wx.compressFile 缺失'))
        wx.compressFile({
          src: options.src,
          dest: options.dest,
          quality: options.quality,
          success: () => resolve(),
          fail: (e) => reject(new CapError('archive.failed', 'wx.compressFile 失败', e)),
        })
      }),
    addShortcut: () =>
      new Promise((resolve, reject) => {
        if (!wx.addToDesktop) return reject(new CapError('shortcut.unsupported', 'wx.addToDesktop 缺失'))
        wx.addToDesktop({ success: () => resolve(), fail: (e) => reject(new CapError('shortcut.failed', 'wx.addToDesktop 失败', e)) })
      }),
    // ★G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard
    getPageLifecycle: () => ({
      phase: 'IDLE' as const,
      onLoad: (cb) => {
        cb()
        return () => undefined
      },
      onShow: (cb) => {
        wx.onPageShow?.(cb)
        return () => undefined
      },
      onHide: (cb) => {
        wx.onPageHide?.(cb)
        return () => undefined
      },
    }),
    getBluetooth: () =>
      new Promise((resolve, reject) => {
        if (!wx.openBluetoothAdapter) return reject(new CapError('bluetooth.unsupported', 'wx.openBluetoothAdapter 缺失'))
        wx.openBluetoothAdapter({
          success: () => {
            const devices: string[] = []
            if (wx.getBluetoothDevices) {
              wx.getBluetoothDevices({
                success: (r) => {
                  resolve({ supported: true, available: true, devices: (r.devices ?? []).map((d) => d.name ?? 'unnamed') })
                },
                fail: () => resolve({ supported: true, available: true, devices }),
              })
            } else {
              resolve({ supported: true, available: true, devices })
            }
          },
          fail: () => resolve({ supported: true, available: false, devices: [] }),
        })
      }),
    getNfc: () =>
      new Promise((resolve) => {
        if (!wx.getHCEState) {
          resolve({ supported: false, available: false })
          return
        }
        wx.getHCEState({
          success: () => resolve({ supported: true, available: true }),
          fail: () => resolve({ supported: true, available: false }),
        })
      }),
    getCamera: () =>
      new Promise((resolve, reject) => {
        if (!wx.authorize && !wx.createCameraContext) {
          return reject(new CapError('camera.unsupported', 'wx 摄像头能力缺失'))
        }
        const supported = !!wx.createCameraContext || !!wx.authorize
        if (!wx.authorize) {
          resolve({ kind: 'camera', supported, granted: true })
          return
        }
        wx.authorize({ scope: 'scope.camera', success: () => resolve({ kind: 'camera', supported: true, granted: true }), fail: () => resolve({ kind: 'camera', supported, granted: false }) })
      }),
    getMicrophone: () =>
      new Promise((resolve, reject) => {
        if (!wx.authorize && !wx.getRecorderManager) {
          return reject(new CapError('microphone.unsupported', 'wx 录音能力缺失'))
        }
        const supported = !!wx.getRecorderManager || !!wx.authorize
        if (!wx.authorize) {
          resolve({ kind: 'microphone', supported, granted: true })
          return
        }
        wx.authorize({ scope: 'scope.record', success: () => resolve({ kind: 'microphone', supported: true, granted: true }), fail: () => resolve({ kind: 'microphone', supported, granted: false }) })
      }),
    getKeyboard: () => {
      let info: KeyboardInfo = { height: 0, visible: false }
      const cbs: Array<(i: KeyboardInfo) => void> = []
      if (typeof wx.onKeyboardHeightChange === 'function') {
        wx.onKeyboardHeightChange((r) => {
          info = { height: r.height, visible: r.height > 0 }
          cbs.forEach((cb) => cb(info))
        })
      }
      return {
        info,
        onChange: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    // ★G-32 B3 七期：wx 桥新增能力（map / background / socket-task / cookie / face-id / mini-program；
    //   sms / iap / data-channel / embedded / live / extension 无 wx 开放 API → 缺省 undefined → Hook Err 诚实降级）
    createMap: (id) => {
      if (typeof wx.createMapContext !== 'function') throw new CapError('map.unsupported', 'wx.createMapContext 缺失')
      const ctx = wx.createMapContext(id)
      return {
        getRegion: () =>
          new Promise((resolve, reject) => {
            if (!ctx.getRegion) return reject(new CapError('map.unsupported', 'MapContext.getRegion 缺失'))
            ctx.getRegion({
              success: (r) => resolve({ latitude: r.latitude, longitude: r.longitude, scale: r.scale }),
              fail: (e) => reject(new CapError('map.failed', 'wx 地图区域获取失败', e)),
            })
          }),
        moveTo: (latitude, longitude, scale) =>
          new Promise((resolve, reject) => {
            if (!ctx.moveTo) return reject(new CapError('map.unsupported', 'MapContext.moveTo 缺失'))
            ctx.moveTo({ latitude, longitude, scale, success: () => resolve(), fail: (e) => reject(new CapError('map.failed', 'wx 地图移动失败', e)) })
          }),
      }
    },
    getBackground: () => {
      const cbs: Array<(e: BackgroundEvent) => void> = []
      const emit = (type: BackgroundEvent['type']) => cbs.forEach((cb) => cb({ type, time: Date.now() }))
      if (typeof wx.onAppHide === 'function') wx.onAppHide(() => emit('enter-background'))
      if (typeof wx.onAppShow === 'function') wx.onAppShow(() => emit('enter-foreground'))
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    createSocketTask: (url) => {
      if (typeof wx.connectSocket !== 'function') throw new CapError('socket-task.unsupported', 'wx.connectSocket 缺失')
      const task = wx.connectSocket({ url })
      let connected = false
      if (task && typeof task.onOpen === 'function') task.onOpen(() => (connected = true))
      const messageCbs: Array<(data: string) => void> = []
      if (task && typeof task.onMessage === 'function') {
        task.onMessage((r) => {
          const data = typeof r.data === 'string' ? r.data : ''
          messageCbs.forEach((cb) => cb(data))
        })
      }
      return {
        send: (data) =>
          new Promise<void>((resolve, reject) => {
            if (!task || typeof task.send !== 'function') return reject(new CapError('socket-task.unsupported', 'SocketTask.send 缺失'))
            task.send({ data })
            resolve()
          }),
        close: (code, reason) =>
          new Promise<void>((resolve, reject) => {
            if (!task || typeof task.close !== 'function') return reject(new CapError('socket-task.unsupported', 'SocketTask.close 缺失'))
            task.close({ code, reason })
            resolve()
          }),
        onMessage: (cb) => {
          messageCbs.push(cb)
          return () => {
            const i = messageCbs.indexOf(cb)
            if (i >= 0) messageCbs.splice(i, 1)
          }
        },
        isConnected: () => connected,
      }
    },
    getCookieJar: () => {
      const store = wxStorage(wx)
      const COOKIE_KEY = '__proteus_cookies'
      const load = (): Record<string, string> => {
        const raw = store.get<Record<string, string>>(COOKIE_KEY)
        return raw !== undefined ? raw : {}
      }
      return {
        get: (name) => load()[name],
        set: (name, value) => {
          const all = load()
          all[name] = value
          store.set(COOKIE_KEY, all)
        },
        remove: (name) => {
          const all = load()
          delete all[name]
          store.set(COOKIE_KEY, all)
        },
        list: () => load(),
      }
    },
    authenticateFaceID: (prompt) =>
      new Promise((resolve, reject) => {
        if (typeof wx.startSoterAuthentication !== 'function') return reject(new CapError('face-id.unsupported', 'wx.startSoterAuthentication 缺失'))
        wx.startSoterAuthentication({
          requestAuthModes: ['facial'],
          authContent: prompt,
          success: () => resolve(true),
          fail: () => resolve(false),
        })
      }),
    navigateMiniProgram: (options) =>
      new Promise((resolve, reject) => {
        if (typeof wx.navigateToMiniProgram !== 'function') return reject(new CapError('mini-program.unsupported', 'wx.navigateToMiniProgram 缺失'))
        wx.navigateToMiniProgram({
          appId: options.appId,
          path: options.path,
          extraData: options.extraData,
          success: () => resolve(),
          fail: (e) => reject(new CapError('mini-program.failed', 'wx 跳小程序失败', e)),
        })
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
    // ★G-32 B3 四期：web 实现（websocket=WebSocket / upload=fetch FormData / download=fetch blob / log=console；analytics 无标准 API → 缺省；file-system=内存降级）
    connectWebSocket: (url, protocols) =>
      new Promise((resolve, reject) => {
        const WS = (g as { WebSocket?: new (u: string, p?: string[]) => unknown }).WebSocket
        if (typeof WS !== 'function') return reject(new CapError('websocket.unsupported', 'WebSocket 不支持'))
        let ws
        try {
          ws = new WS(url, protocols && protocols.length ? protocols : undefined)
        } catch (e) {
          return reject(new CapError('websocket.failed', 'WebSocket 构造失败', e))
        }
        const target = ws as {
          send?: (d: string | ArrayBuffer) => void
          close?: (code?: number, reason?: string) => void
          addEventListener?: (t: string, cb: (e?: unknown) => void) => void
          removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
        }
        let settled = false
        target.addEventListener?.('open', () => {
          if (settled) return
          settled = true
          resolve({
            send: (data) => target.send?.(data),
            close: (code, reason) => target.close?.(code, reason),
            on: (event, handler) => {
              const cb = (e?: unknown) => handler(e)
              if (event === 'message') target.addEventListener?.('message', cb)
              else if (event === 'error') target.addEventListener?.('error', cb)
              else if (event === 'close') target.addEventListener?.('close', cb)
              else target.addEventListener?.(event, cb)
              return () => target.removeEventListener?.(event, cb)
            },
          })
        })
        target.addEventListener?.('error', () => {
          if (!settled) {
            settled = true
            reject(new CapError('websocket.failed', 'WebSocket 连接失败'))
          }
        })
      }),
    upload: async (options, onProgress) => {
      const form = new FormData()
      const file = options.file ?? new Blob([''], { type: 'application/octet-stream' })
      form.append(options.name ?? 'file', file)
      if (options.formData) {
        for (const k of Object.keys(options.formData)) form.append(k, options.formData[k])
      }
      const headers = { ...(options.headers ?? {}) }
      const resp = await g.fetch(options.url, { method: 'POST', headers, body: form })
      const text = await resp.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        /* 非 JSON 原样 */
      }
      onProgress?.(100)
      return { status: resp.status, data, progress: 100 }
    },
    download: async (url, options, onProgress) => {
      const resp = await g.fetch(url, { headers: options?.headers })
      const rt = options?.responseType ?? 'blob'
      if (rt === 'text') {
        const text = await resp.text()
        onProgress?.(100)
        return { status: resp.status, data: text, progress: 100 }
      }
      if (rt === 'json') {
        const text = await resp.text()
        let data: unknown = text
        try {
          data = JSON.parse(text)
        } catch {
          /* 非 JSON 原样 */
        }
        onProgress?.(100)
        return { status: resp.status, data, progress: 100 }
      }
      const blob = await resp.blob()
      onProgress?.(100)
      return { status: resp.status, data: blob, progress: 100 }
    },
    // C34 analytics：web 无标准事件上报 API（sendBeacon 需服务端约定）→ 缺省（useAnalytics 返回 Err）
    log: async (level, message, data) => {
      const fn = console[level]
      if (typeof fn === 'function') fn(message, data !== undefined ? data : '')
    },
    // C43 file-system：web 无标准同步 FS（OPFS 受限/需安全上下文）→ 内存降级（可读写，非持久）
    getFileSystem: () => memoryFileSystem(),
    // ★G-32 B3 五期：web 实现（notification=Notification API / app-lifecycle=visibilitychange+load；contact/calendar/archive/shortcut 无标准 → 缺省降级 Err）
    subscribeMessage: async (templateId) => {
      const N = (g as { Notification?: NotificationConstructor }).Notification
      if (typeof N !== 'function') throw new CapError('notification.unsupported', 'Notification API 不支持（需 HTTPS/现代浏览器）')
      if (!N.requestPermission) throw new CapError('notification.unsupported', 'Notification.requestPermission 缺失')
      const status = await N.requestPermission()
      return { templateId, granted: status === 'granted', status }
    },
    getAppLifecycle: () => {
      let phase: 'PENDING' | 'LAUNCH' | 'SHOW' | 'HIDE' = 'PENDING'
      const launchCbs: Array<() => void> = []
      const showCbs: Array<() => void> = []
      const hideCbs: Array<() => void> = []
      const gany = g as {
        addEventListener?: (t: string, cb: (e?: unknown) => void) => void
        removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
        document?: { visibilityState?: string }
      }
      const onVischange = () => {
        const hidden = gany.document ? gany.document.visibilityState === 'hidden' : false
        phase = hidden ? 'HIDE' : 'SHOW'
        if (hidden) hideCbs.forEach((cb) => cb())
        else showCbs.forEach((cb) => cb())
      }
      const onLoad = () => {
        phase = 'SHOW'
        launchCbs.forEach((cb) => cb())
        showCbs.forEach((cb) => cb())
      }
      if (typeof gany.addEventListener === 'function') {
        gany.addEventListener('visibilitychange', onVischange)
        gany.addEventListener('load', onLoad)
      }
      return {
        phase,
        onLaunch: (cb) => {
          launchCbs.push(cb)
          return () => {
            const i = launchCbs.indexOf(cb)
            if (i >= 0) launchCbs.splice(i, 1)
          }
        },
        onShow: (cb) => {
          showCbs.push(cb)
          return () => {
            const i = showCbs.indexOf(cb)
            if (i >= 0) showCbs.splice(i, 1)
          }
        },
        onHide: (cb) => {
          hideCbs.push(cb)
          return () => {
            const i = hideCbs.indexOf(cb)
            if (i >= 0) hideCbs.splice(i, 1)
          }
        },
      }
    },
    // ★G-32 B3 六期：web 实现（page-lifecycle=visibilitychange / bluetooth·nfc=特性探测 / camera·mic=getUserMedia / keyboard=visualViewport 启发式）
    getPageLifecycle: () => {
      let phase: 'IDLE' | 'LOAD' | 'SHOW' | 'HIDE' = 'IDLE'
      const loadCbs: Array<() => void> = []
      const showCbs: Array<() => void> = []
      const hideCbs: Array<() => void> = []
      const gany = g as {
        addEventListener?: (t: string, cb: (e?: unknown) => void) => void
        removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
        document?: { visibilityState?: string }
      }
      const onVis = () => {
        const hidden = gany.document ? gany.document.visibilityState === 'hidden' : false
        phase = hidden ? 'HIDE' : 'SHOW'
        if (hidden) hideCbs.forEach((cb) => cb())
        else showCbs.forEach((cb) => cb())
      }
      const onLoad = () => {
        phase = 'SHOW'
        loadCbs.forEach((cb) => cb())
        showCbs.forEach((cb) => cb())
      }
      if (typeof gany.addEventListener === 'function') {
        gany.addEventListener('visibilitychange', onVis)
        gany.addEventListener('load', onLoad)
      }
      const unsub = (arr: Array<() => void>, cb: () => void) => {
        const i = arr.indexOf(cb)
        if (i >= 0) arr.splice(i, 1)
      }
      return {
        phase,
        onLoad: (cb) => {
          loadCbs.push(cb)
          return () => unsub(loadCbs, cb)
        },
        onShow: (cb) => {
          showCbs.push(cb)
          return () => unsub(showCbs, cb)
        },
        onHide: (cb) => {
          hideCbs.push(cb)
          return () => unsub(hideCbs, cb)
        },
      }
    },
    getBluetooth: async () => {
      // Web Bluetooth：仅特性探测（真实请求需用户手势 + 权限）——诚实降级
      const nav = g.navigator as { bluetooth?: unknown } | undefined
      const supported = typeof nav?.bluetooth === 'object' && nav.bluetooth !== null
      return { supported, available: supported, devices: [] }
    },
    getNfc: async () => {
      const supported = typeof (g as { NDEFReader?: unknown }).NDEFReader === 'function'
      return { supported, available: supported }
    },
    getCamera: async () => {
      const nav = g.navigator as (Navigator & { mediaDevices?: { getUserMedia?: (c: Record<string, unknown>) => Promise<{ getTracks(): Array<{ stop(): void }> }> } }) | undefined
      const gu = nav?.mediaDevices?.getUserMedia
      if (typeof gu !== 'function') return { kind: 'camera' as const, supported: false, granted: false }
      try {
        const stream = await gu({ video: { facingMode: 'user' } })
        stream.getTracks().forEach((t) => t.stop())
        return { kind: 'camera' as const, supported: true, granted: true }
      } catch {
        return { kind: 'camera' as const, supported: true, granted: false }
      }
    },
    getMicrophone: async () => {
      const nav = g.navigator as (Navigator & { mediaDevices?: { getUserMedia?: (c: Record<string, unknown>) => Promise<{ getTracks(): Array<{ stop(): void }> }> } }) | undefined
      const gu = nav?.mediaDevices?.getUserMedia
      if (typeof gu !== 'function') return { kind: 'microphone' as const, supported: false, granted: false }
      try {
        const stream = await gu({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
        return { kind: 'microphone' as const, supported: true, granted: true }
      } catch {
        return { kind: 'microphone' as const, supported: true, granted: false }
      }
    },
    getKeyboard: () => {
      let info: KeyboardInfo = { height: 0, visible: false }
      const cbs: Array<(i: KeyboardInfo) => void> = []
      const vv = (g as { visualViewport?: { height?: number; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } }).visualViewport
      const ih = (g as { innerHeight?: number }).innerHeight ?? 0
      if (vv && typeof vv.addEventListener === 'function') {
        const onresize = () => {
          const vh = vv.height ?? 0
          const visible = vh > 0 && vh < ih * 0.6
          info = { height: visible ? ih - vh : 0, visible }
          cbs.forEach((cb) => cb(info))
        }
        vv.addEventListener('resize', onresize)
      }
      return {
        info,
        onChange: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    // ★G-32 B3 七期：web 桥新增能力（background=visibilitychange / socket-task=WebSocket / cookie=document.cookie /
    //   face-id=WebAuthn；map / sms / iap / mini-program / data-channel / embedded / live / extension 无 web 标准 →
    //   缺省 undefined → Hook Err 诚实降级）
    getBackground: () => {
      const cbs: Array<(e: BackgroundEvent) => void> = []
      const doc = (g as { document?: { hidden?: boolean; addEventListener?: (t: string, cb: () => void) => void } }).document
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => {
          cbs.forEach((cb) => cb({ type: doc.hidden ? 'enter-background' : 'enter-foreground', time: Date.now() }))
        })
      }
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
      }
    },
    createSocketTask: (url) => {
      const WS = (g as { WebSocket?: new (u: string) => unknown }).WebSocket
      if (typeof WS !== 'function') throw new CapError('socket-task.unsupported', 'WebSocket 不支持')
      const ws = new WS(url) as {
        send?: (d: string) => void
        close?: (code?: number, reason?: string) => void
        addEventListener?: (t: string, cb: (e?: unknown) => void) => void
        removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
      }
      let connected = false
      const messageCbs: Array<(data: string) => void> = []
      ws.addEventListener?.('open', () => (connected = true))
      ws.addEventListener?.('message', (e) => {
        const payload = e ? (e as { data?: unknown }).data : ''
        const data = typeof payload === 'string' ? payload : ''
        messageCbs.forEach((cb) => cb(data))
      })
      return {
        send: (data) =>
          new Promise<void>((resolve, reject) => {
            if (!ws.send) return reject(new CapError('socket-task.unsupported', 'WebSocket.send 缺失'))
            ws.send(data)
            resolve()
          }),
        close: (code, reason) =>
          new Promise<void>((resolve, reject) => {
            if (!ws.close) return reject(new CapError('socket-task.unsupported', 'WebSocket.close 缺失'))
            ws.close(code, reason)
            resolve()
          }),
        onMessage: (cb) => {
          messageCbs.push(cb)
          return () => {
            const i = messageCbs.indexOf(cb)
            if (i >= 0) messageCbs.splice(i, 1)
          }
        },
        isConnected: () => connected,
      }
    },
    getCookieJar: () => {
      const doc = (g as { document?: { cookie?: string } }).document
      const readAll = (): Record<string, string> => {
        const out: Record<string, string> = {}
        if (doc && typeof doc.cookie === 'string') {
          for (const part of doc.cookie.split(';')) {
            const idx = part.indexOf('=')
            if (idx > 0) {
              const name = part.slice(0, idx).trim()
              const value = part.slice(idx + 1).trim()
              if (name) out[name] = decodeURIComponent(value)
            }
          }
        }
        return out
      }
      return {
        get: (name) => readAll()[name],
        set: (name, value, maxAge) => {
          if (doc) doc.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}` + (maxAge !== undefined ? `; max-age=${maxAge}` : '') + '; path=/'
        },
        remove: (name) => {
          if (doc) doc.cookie = `${encodeURIComponent(name)}=; max-age=0; path=/`
        },
        list: () => readAll(),
      }
    },
    authenticateFaceID: async (prompt) => {
      const cred = (g as { PublicKeyCredential?: unknown }).PublicKeyCredential
      if (typeof cred !== 'function') return false
      const creds = nav?.credentials
      if (!creds || typeof creds.get !== 'function') return false
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
      } catch {
        void prompt
        return false
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
  // ★G-32 B3 四期：新增能力 Hook
  /** C27 useWebSocket：WebSocket 连接句柄（wx.connectSocket / web WebSocket） */
  useWebSocket(url: string, protocols?: string[]): Promise<CapResult<WebSocketConnection>>
  /** C29 useUpload：上传文件（wx.uploadFile / web fetch FormData） */
  useUpload(options: UploadOptions, onProgress?: ProgressCallback): Promise<CapResult<UploadResult>>
  /** C30 useDownload：下载文件（wx.downloadFile / web fetch blob） */
  useDownload(url: string, options?: DownloadOptions, onProgress?: ProgressCallback): Promise<CapResult<DownloadResult>>
  /** C34 useAnalytics：埋点句柄（wx.reportEvent；web 无标准 → track 返回 Err） */
  useAnalytics(): TrackAPI
  /** C35 useLog：日志句柄（console + 上报） */
  useLog(): Logger
  /** C43 useFileSystem：文件系统句柄（wx.getFileSystemManager / web 内存降级） */
  useFileSystem(): FSAdapter
  // ★G-32 B3 五期：新增能力 Hook
  /** C17 useNotification：消息订阅授权（wx.requestSubscribeMessage / web Notification） */
  useNotification(templateId: string): Promise<CapResult<MessageSubscription>>
  /** C19 useContact：联系人选择（wx.chooseContact；web 无标准 → Err 降级） */
  useContact(): Promise<CapResult<Contact[]>>
  /** C20 useCalendar：添加日历事件（wx.addPhoneCalendar；web → Err） */
  useCalendar(event: CalendarEvent): Promise<CapResult<void>>
  /** C23 useAppLifecycle：应用生命周期订阅句柄（wx App 钩子 / web visibilitychange+load） */
  useAppLifecycle(): AppLifecycle
  /** C44 useArchive：压缩文件（wx.compressFile；web → Err） */
  useArchive(options: ArchiveOptions): Promise<CapResult<void>>
  /** C45 useShortcut：添加桌面快捷方式（wx.addToDesktop；web → Err） */
  useShortcut(): Promise<CapResult<void>>
  // ★G-32 B3 六期：新增能力 Hook
  /** C24 usePageLifecycle：页面生命周期订阅句柄（wx Page 钩子 / web load+visibilitychange） */
  usePageLifecycle(): PageLifecycle
  /** C36 useBluetooth：蓝牙状态（wx.openBluetoothAdapter / web 特性探测） */
  useBluetooth(): Promise<CapResult<BluetoothInfo>>
  /** C37 useNFC：NFC 状态（wx.getHCEState / web NDEFReader 特性探测） */
  useNFC(): Promise<CapResult<NfcInfo>>
  /** C1 useCamera：摄像头访问（wx.authorize / web getUserMedia） */
  useCamera(): Promise<CapResult<MediaAccess>>
  /** C2 useMicrophone：麦克风访问（wx.authorize / web getUserMedia） */
  useMicrophone(): Promise<CapResult<MediaAccess>>
  /** C14 useKeyboard：键盘生命周期句柄（wx.onKeyboardHeightChange / web visualViewport） */
  useKeyboard(): KeyboardLifecycle
  // ★G-32 B3 七期：剩余能力 Hook（C4 地图 / C22 短信 / C25 后台 / C28 SocketTask / C31 数据通道 / C32 Cookie / C39 人脸 / C46 内购 / C47 小程序 / C48 宿主嵌入 / C49 直播 / C50 扩展）
  /** C4 useMap：地图上下文句柄（wx.createMapContext / web 宿主集成；无 → Err） */
  useMap(id: string): Promise<CapResult<MapController>>
  /** C22 useSMS：发送短信（wx 受限无开放 API / web 无标准 → Err） */
  useSMS(phone: string, message: string): Promise<CapResult<void>>
  /** C25 useBackground：后台/前台切换订阅（wx onAppHide/onAppShow / web visibilitychange） */
  useBackground(): Promise<CapResult<BackgroundAPI>>
  /** C28 useSocketTask：底层 SocketTask 句柄（wx.connectSocket→SocketTask / web WebSocket） */
  useSocketTask(url: string): Promise<CapResult<SocketTaskHandle>>
  /** C31 useDataChannel：数据通道（直播/实时——宿主桥接；缺省 Err 诚实降级） */
  useDataChannel(options: DataChannelOptions): Promise<CapResult<DataChannelHandle>>
  /** C32 useCookie：Cookie 罐（web document.cookie / wx storage 兜底） */
  useCookie(): Promise<CapResult<CookieJar>>
  /** C39 useFaceID：人脸识别认证（wx startSoterAuthentication facial / web WebAuthn） */
  useFaceID(prompt?: string): Promise<CapResult<boolean>>
  /** C46 useInAppPurchase：内购（wx/无公开 API → Err 诚实降级） */
  useInAppPurchase(productId: string): Promise<CapResult<IAPReceipt>>
  /** C47 useMiniProgram：跳小程序（wx.navigateToMiniProgram / web → Err） */
  useMiniProgram(): Promise<CapResult<MiniProgramAPI>>
  /** C48 useEmbedded：宿主嵌入上下文（被嵌入场景——宿主桥；缺省 Err） */
  useEmbedded(): Promise<CapResult<HostContext>>
  /** C49 useLive：直播房间（wx live 组件形态/宿主桥——缺省 Err） */
  useLive(options: LiveRoomOptions): Promise<CapResult<LiveRoomHandle>>
  /** C50 useExtension：扩展/插件（G-21 扩展点——宿主 loadPlugin 桥；缺省 Err） */
  useExtension(extensionId: string): Promise<CapResult<unknown>>
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
    // ★G-32 B3 四期：websocket / upload / download / analytics / log / file-system（缺桥 → Err('<cap>.unsupported') 非抛异常）
    useWebSocket: (url, protocols) =>
      wrap(
        (() => {
          if (!bridge.connectWebSocket) return Promise.reject(new CapError('websocket.unsupported', '桥未提供 connectWebSocket（useWebSocket 不可用）'))
          return bridge.connectWebSocket(url, protocols)
        })(),
      ),
    useUpload: (options, onProgress) =>
      wrap(
        (() => {
          if (!bridge.upload) return Promise.reject(new CapError('upload.unsupported', '桥未提供 upload（useUpload 不可用）'))
          return bridge.upload(options, onProgress)
        })(),
      ),
    useDownload: (url, options, onProgress) =>
      wrap(
        (() => {
          if (!bridge.download) return Promise.reject(new CapError('download.unsupported', '桥未提供 download（useDownload 不可用）'))
          return bridge.download(url, options, onProgress)
        })(),
      ),
    // C34 useAnalytics：埋点句柄（缺桥 → track 返回 Err）
    useAnalytics: () => ({
      track: (name, params) =>
        wrap(
          (() => {
            if (!bridge.track) return Promise.reject(new CapError('analytics.unsupported', '桥未提供 track（useAnalytics 不可用）'))
            return bridge.track(name, params)
          })(),
        ),
    }),
    // C35 useLog：日志句柄（console + 上报）
    useLog: () => ({
      log: (message, data) =>
        wrap(
          (() => {
            if (!bridge.log) return Promise.reject(new CapError('log.unsupported', '桥未提供 log（useLog 不可用）'))
            return bridge.log('log', message, data)
          })(),
        ),
      warn: (message, data) =>
        wrap(
          (() => {
            if (!bridge.log) return Promise.reject(new CapError('log.unsupported', '桥未提供 log（useLog 不可用）'))
            return bridge.log('warn', message, data)
          })(),
        ),
      error: (message, data) =>
        wrap(
          (() => {
            if (!bridge.log) return Promise.reject(new CapError('log.unsupported', '桥未提供 log（useLog 不可用）'))
            return bridge.log('error', message, data)
          })(),
        ),
    }),
    // C43 useFileSystem：文件系统句柄（缺桥 → 抛错，同 useStorage 惯例）
    useFileSystem: () => {
      if (!bridge.getFileSystem) throw new CapError('file-system.unsupported', '桥未提供 getFileSystem（useFileSystem 不可用）')
      const fs = bridge.getFileSystem()
      return {
        supported: true,
        readFile: (path) => wrap(fs.readFile(path)),
        writeFile: (path, data) => wrap(fs.writeFile(path, data)),
        remove: (path) => wrap(fs.remove(path)),
        exists: (path) => wrap(fs.exists(path)),
      }
    },
    // ★G-32 B3 五期：notification / contact / calendar / app-lifecycle / archive / shortcut（缺桥 → Err 非抛异常）
    useNotification: (templateId) =>
      wrap(
        (() => {
          if (!bridge.subscribeMessage) return Promise.reject(new CapError('notification.unsupported', '桥未提供 subscribeMessage（useNotification 不可用）'))
          return bridge.subscribeMessage(templateId)
        })(),
      ),
    useContact: () =>
      wrap(
        (() => {
          if (!bridge.chooseContact) return Promise.reject(new CapError('contact.unsupported', '桥未提供 chooseContact（useContact 不可用）'))
          return bridge.chooseContact()
        })(),
      ),
    useCalendar: (event) =>
      wrap(
        (() => {
          if (!bridge.addCalendarEvent) return Promise.reject(new CapError('calendar.unsupported', '桥未提供 addCalendarEvent（useCalendar 不可用）'))
          return bridge.addCalendarEvent(event)
        })(),
      ),
    useAppLifecycle: () => {
      if (!bridge.getAppLifecycle) throw new CapError('app-lifecycle.unsupported', '桥未提供 getAppLifecycle（useAppLifecycle 不可用）')
      return bridge.getAppLifecycle()
    },
    useArchive: (options) =>
      wrap(
        (() => {
          if (!bridge.compressFile) return Promise.reject(new CapError('archive.unsupported', '桥未提供 compressFile（useArchive 不可用）'))
          return bridge.compressFile(options)
        })(),
      ),
    useShortcut: () =>
      wrap(
        (() => {
          if (!bridge.addShortcut) return Promise.reject(new CapError('shortcut.unsupported', '桥未提供 addShortcut（useShortcut 不可用）'))
          return bridge.addShortcut()
        })(),
      ),
    // ★G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard（缺桥 → Err 非抛异常 / 句柄抛错）
    usePageLifecycle: () => {
      if (!bridge.getPageLifecycle) throw new CapError('page-lifecycle.unsupported', '桥未提供 getPageLifecycle（usePageLifecycle 不可用）')
      return bridge.getPageLifecycle()
    },
    useBluetooth: () =>
      wrap(
        (() => {
          if (!bridge.getBluetooth) return Promise.reject(new CapError('bluetooth.unsupported', '桥未提供 getBluetooth（useBluetooth 不可用）'))
          return bridge.getBluetooth()
        })(),
      ),
    useNFC: () =>
      wrap(
        (() => {
          if (!bridge.getNfc) return Promise.reject(new CapError('nfc.unsupported', '桥未提供 getNfc（useNFC 不可用）'))
          return bridge.getNfc()
        })(),
      ),
    useCamera: () =>
      wrap(
        (() => {
          if (!bridge.getCamera) return Promise.reject(new CapError('camera.unsupported', '桥未提供 getCamera（useCamera 不可用）'))
          return bridge.getCamera()
        })(),
      ),
    useMicrophone: () =>
      wrap(
        (() => {
          if (!bridge.getMicrophone) return Promise.reject(new CapError('microphone.unsupported', '桥未提供 getMicrophone（useMicrophone 不可用）'))
          return bridge.getMicrophone()
        })(),
      ),
    useKeyboard: () => {
      if (!bridge.getKeyboard) throw new CapError('keyboard.unsupported', '桥未提供 getKeyboard（useKeyboard 不可用）')
      return bridge.getKeyboard()
    },
    // ★G-32 B3 七期：剩余能力 Hook（缺桥 → Err('<cap>.unsupported') 非抛异常——G-32.3 降级语义；C4/C25/C28/C32/C47 有 wx/web 原生可接，其余诚实降级）
    useMap: (id) =>
      wrap(
        (() => {
          if (!bridge.createMap) return Promise.reject(new CapError('map.unsupported', '桥未提供 createMap（useMap 不可用）'))
          const ctx = bridge.createMap(id)
          const controller: MapController = {
            getRegion: () => wrap(ctx.getRegion()),
            moveTo: (latitude, longitude, scale) => wrap(ctx.moveTo(latitude, longitude, scale)),
          }
          return Promise.resolve(controller)
        })(),
      ),
    useSMS: (phone, message) =>
      wrap(
        (() => {
          if (!bridge.sendSMS) return Promise.reject(new CapError('sms.unsupported', '桥未提供 sendSMS（useSMS 不可用）'))
          return bridge.sendSMS(phone, message)
        })(),
      ),
    useBackground: () =>
      wrap(
        (() => {
          if (!bridge.getBackground) return Promise.reject(new CapError('background.unsupported', '桥未提供 getBackground（useBackground 不可用）'))
          return Promise.resolve(bridge.getBackground())
        })(),
      ),
    useSocketTask: (url) =>
      wrap(
        (() => {
          if (!bridge.createSocketTask) return Promise.reject(new CapError('socket-task.unsupported', '桥未提供 createSocketTask（useSocketTask 不可用）'))
          const task = bridge.createSocketTask(url)
          const handle: SocketTaskHandle = {
            send: (data) => wrap(task.send(data)),
            close: (code, reason) => wrap(task.close(code, reason)),
            onMessage: (cb) => task.onMessage(cb),
            isConnected: () => task.isConnected(),
          }
          return Promise.resolve(handle)
        })(),
      ),
    useDataChannel: (options) =>
      wrap(
        (() => {
          if (!bridge.openDataChannel) return Promise.reject(new CapError('data-channel.unsupported', '桥未提供 openDataChannel（useDataChannel 不可用）'))
          const channel = bridge.openDataChannel(options)
          const handle: DataChannelHandle = {
            send: (data) => wrap(channel.send(data)),
            onMessage: (cb) => channel.onMessage(cb),
          }
          return Promise.resolve(handle)
        })(),
      ),
    useCookie: () =>
      wrap(
        (() => {
          if (!bridge.getCookieJar) return Promise.reject(new CapError('cookie.unsupported', '桥未提供 getCookieJar（useCookie 不可用）'))
          return Promise.resolve(bridge.getCookieJar())
        })(),
      ),
    useFaceID: (prompt) =>
      wrap(
        (() => {
          if (!bridge.authenticateFaceID) return Promise.reject(new CapError('face-id.unsupported', '桥未提供 authenticateFaceID（useFaceID 不可用）'))
          return bridge.authenticateFaceID(prompt)
        })(),
      ),
    useInAppPurchase: (productId) =>
      wrap(
        (() => {
          if (!bridge.requestIAP) return Promise.reject(new CapError('in-app-purchase.unsupported', '桥未提供 requestIAP（useInAppPurchase 不可用）'))
          return bridge.requestIAP(productId)
        })(),
      ),
    useMiniProgram: () =>
      wrap(
        (() => {
          if (!bridge.navigateMiniProgram) return Promise.reject(new CapError('mini-program.unsupported', '桥未提供 navigateMiniProgram（useMiniProgram 不可用）'))
          const nav = bridge.navigateMiniProgram
          const api: MiniProgramAPI = {
            navigate: (options) => wrap(nav(options)),
          }
          return Promise.resolve(api)
        })(),
      ),
    useEmbedded: () =>
      wrap(
        (() => {
          if (!bridge.getHostContext) return Promise.reject(new CapError('embedded.unsupported', '桥未提供 getHostContext（useEmbedded 不可用）'))
          return Promise.resolve(bridge.getHostContext())
        })(),
      ),
    useLive: (options) =>
      wrap(
        (() => {
          if (!bridge.joinLiveRoom) return Promise.reject(new CapError('live.unsupported', '桥未提供 joinLiveRoom（useLive 不可用）'))
          const room = bridge.joinLiveRoom(options)
          const handle: LiveRoomHandle = {
            leave: () => wrap(room.leave()),
            status: () => room.status(),
          }
          return Promise.resolve(handle)
        })(),
      ),
    useExtension: (extensionId) =>
      wrap(
        (() => {
          if (!bridge.loadExtension) return Promise.reject(new CapError('extension.unsupported', '桥未提供 loadExtension（useExtension 不可用）'))
          return bridge.loadExtension(extensionId)
        })(),
      ),
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
      websocket: bridge.connectWebSocket !== undefined,
      upload: bridge.upload !== undefined,
      download: bridge.download !== undefined,
      analytics: bridge.track !== undefined,
      log: bridge.log !== undefined,
      fileSystem: bridge.getFileSystem !== undefined,
      notification: bridge.subscribeMessage !== undefined,
      contact: bridge.chooseContact !== undefined,
      calendar: bridge.addCalendarEvent !== undefined,
      appLifecycle: bridge.getAppLifecycle !== undefined,
      archive: bridge.compressFile !== undefined,
      shortcut: bridge.addShortcut !== undefined,
      pageLifecycle: bridge.getPageLifecycle !== undefined,
      bluetooth: bridge.getBluetooth !== undefined,
      nfc: bridge.getNfc !== undefined,
      camera: bridge.getCamera !== undefined,
      microphone: bridge.getMicrophone !== undefined,
      keyboard: bridge.getKeyboard !== undefined,
      map: bridge.createMap !== undefined,
      sms: bridge.sendSMS !== undefined,
      background: bridge.getBackground !== undefined,
      socketTask: bridge.createSocketTask !== undefined,
      dataChannel: bridge.openDataChannel !== undefined,
      cookie: bridge.getCookieJar !== undefined,
      faceId: bridge.authenticateFaceID !== undefined,
      inAppPurchase: bridge.requestIAP !== undefined,
      miniProgram: bridge.navigateMiniProgram !== undefined,
      embedded: bridge.getHostContext !== undefined,
      live: bridge.joinLiveRoom !== undefined,
      extension: bridge.loadExtension !== undefined,
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