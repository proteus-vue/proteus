// packages/api/src/capability.ts
// ★G-32 B3（proteus-semantic-primitives-plus-plan §7）+ G-31 B7：useXxx 能力 Hook 层
//   能力原语 = 无回调 / 无全局对象 / 全类型 / 返回 Result<T>（G-32.4 铁律）
//   桥接设计：createCapabilityHooks(bridge) —— bridge 注入平台实现（wx / web / mock 可单测），
//   与 createPlatformAPI（request/storage/router/ui 四域）分层：本层是「能力」面（设备/系统/通信/扩展）
//   兼容面：全部 Promise<Result<T>>；平台不支持 → Err('<cap>.unsupported')（G-32.3 降级语义）
//   MP 产物安全（决策 #32/#36）：无 ?. / ?? （显式检查）；无数组解构
import { detectRuntime } from '@proteus-vue/shared'
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

/**
 * ★能力颗粒度对齐：C5 传感器流（原一次性读取且不解除监听 → 显式生命周期 + 多订阅 + 可停）
 *   on() 返回取消函数；stop() 停止底层监听；start() 可选（部分平台自动开始）
 */
export interface SensorStream {
  kind: SensorKind
  /** 开始监听（幂等） */
  start(): Promise<CapResult<void>>
  /** 停止监听（释放底层 on* 订阅） */
  stop(): Promise<CapResult<void>>
  /** 订阅采样（返回取消订阅；多订阅并存） */
  on(cb: (sample: SensorSample) => void): () => void
  /** 是否监听中 */
  active(): boolean
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
  /** ★能力颗粒度对齐：追加写入 */
  appendFile(path: string, data: string): Promise<void>
  /** 复制文件 */
  copyFile(src: string, dest: string): Promise<void>
  /** 重命名/移动 */
  rename(oldPath: string, newPath: string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** 文件/目录信息 */
  stat(path: string): Promise<FileStat>
  /** 创建目录 */
  mkdir(path: string, recursive?: boolean): Promise<void>
  /** 删除目录 */
  rmdir(path: string, recursive?: boolean): Promise<void>
  /** 读目录（返回条目名） */
  readdir(path: string): Promise<string[]>
  /** 文件摘要（size + digest） */
  getFileInfo(path: string, digestAlgorithm?: string): Promise<{ size: number; digest: string }>
  /** 保存临时文件到本地（返回持久路径） */
  saveFile(tempPath: string): Promise<string>
  /** 已保存文件列表 */
  getSavedFileList(): Promise<SavedFileInfo[]>
  /** 删除已保存文件 */
  removeSavedFile(path: string): Promise<void>
  /** 解压 */
  unzip(zipPath: string, targetPath: string): Promise<void>
  // —— Sync 变体（对齐官方 *Sync；同步阻塞，仅小文件/启动期用） ——
  readFileSync(path: string): string
  writeFileSync(path: string, data: string): void
  existsSync(path: string): boolean
  statSync(path: string): FileStat
  readdirSync(path: string): string[]
  mkdirSync(path: string, recursive?: boolean): void
  renameSync(oldPath: string, newPath: string): void
  unlinkSync(path: string): void
  copyFileSync(src: string, dest: string): void
  appendFileSync(path: string, data: string): void
}

/** 文件/目录信息（wx.Stats 子集） */
export interface FileStat {
  size: number
  mode: number
  lastAccessedTime: number
  lastModifiedTime: number
  isDirectory: boolean
  isFile: boolean
}

/** 已保存文件信息（wx.SavedFileInfo 子集） */
export interface SavedFileInfo {
  filePath: string
  size: number
  createTime: number
}

/** C43 FSAdapter（useFileSystem 句柄——方法均返回 Result<T>） */
export interface FSAdapter {
  /** 能力可用性（内存降级也算可用；false = 完全不可用） */
  supported: boolean
  readFile(path: string): Promise<CapResult<string>>
  writeFile(path: string, data: string): Promise<CapResult<void>>
  appendFile(path: string, data: string): Promise<CapResult<void>>
  copyFile(src: string, dest: string): Promise<CapResult<void>>
  rename(oldPath: string, newPath: string): Promise<CapResult<void>>
  remove(path: string): Promise<CapResult<void>>
  exists(path: string): Promise<CapResult<boolean>>
  stat(path: string): Promise<CapResult<FileStat>>
  mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>
  rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>
  readdir(path: string): Promise<CapResult<string[]>>
  getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>
  saveFile(tempPath: string): Promise<CapResult<string>>
  getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>
  removeSavedFile(path: string): Promise<CapResult<void>>
  unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>
  // Sync 变体（对齐官方；返回 CapResult 保持契约一致——同步失败返回 Err 而非抛）
  readFileSync(path: string): CapResult<string>
  writeFileSync(path: string, data: string): CapResult<void>
  existsSync(path: string): CapResult<boolean>
  statSync(path: string): CapResult<FileStat>
  readdirSync(path: string): CapResult<string[]>
  mkdirSync(path: string, recursive?: boolean): CapResult<void>
  renameSync(oldPath: string, newPath: string): CapResult<void>
  unlinkSync(path: string): CapResult<void>
  copyFileSync(src: string, dest: string): CapResult<void>
  appendFileSync(path: string, data: string): CapResult<void>
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

/** 拍照结果（wx.takePhoto 子集） */
export interface PhotoResult {
  /** 临时文件路径 */
  tempImagePath?: string
  width: number
  height: number
  /** web dataURL（blob: / data:） */
  dataUrl?: string
}

/** 录像结果（wx.stopRecord 子集） */
export interface VideoResult {
  tempThumbPath?: string
  tempVideoPath?: string
  duration: number
  size: number
}

/** ★能力颗粒度对齐：C1 相机操作控制器（wx.createCameraContext(id) → 拍照/录像/缩放/帧回调） */
export interface CameraController {
  takePhoto(quality?: 'high' | 'normal' | 'low'): Promise<CapResult<PhotoResult>>
  startRecord(): Promise<CapResult<void>>
  stopRecord(): Promise<CapResult<VideoResult>>
  setZoom(zoom: number): Promise<CapResult<void>>
  /** 订阅相机帧（返回取消函数；web 无对等 → 空订阅） */
  onCameraFrame(cb: (data: { data: ArrayBuffer; width: number; height: number }) => void): () => void
}

/** 录音状态（wx RecorderManager onStart/onStop 等） */
export interface RecordOptions {
  duration?: number
  sampleRate?: number
  numberOfChannels?: number
  encodeBitRate?: number
  format?: 'mp3' | 'aac' | 'wav' | 'PCM'
}

/** ★能力颗粒度对齐：C2 录音操作控制器（wx.getRecorderManager() → start/stop/pause/resume + 事件） */
export interface RecorderController {
  start(options?: RecordOptions): Promise<CapResult<void>>
  stop(): Promise<CapResult<void>>
  pause(): Promise<CapResult<void>>
  resume(): Promise<CapResult<void>>
  /** 订阅录音事件（返回取消函数） */
  on(event: 'start' | 'stop' | 'pause' | 'resume' | 'error', cb: (payload: unknown) => void): () => void
  /** 订阅录音帧（时长/大小） */
  onFrameRecorded(cb: (frame: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void): () => void
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

/** BLE 设备（wx.BluetoothDevice 子集） */
export interface BleDevice {
  deviceId: string
  name: string
  /** 信号强度（发现/连接后可得） */
  RSSI?: number
}

/** BLE 服务（wx.BLEService 子集） */
export interface BleService {
  uuid: string
  isPrimary: boolean
}

/** BLE 特征值（wx.BLECharacteristic 子集） */
export interface BleCharacteristic {
  uuid: string
  properties: { read: boolean; write: boolean; notify: boolean; indicate: boolean }
}

/**
 * ★能力颗粒度对齐（docs/capability-granularity-alignment.md）：C36 蓝牙 BLE 操作接口
 *   计划 BluetoothAPI 的落地——连接/服务/特征值/通知/发现/断开全套（原实现只有状态探测）。
 *   方法统一返回 Promise<CapResult<T>>（G-32.4）；订阅类返回取消函数；不支持 → web/缺桥 Err。
 */
export interface BluetoothAPI extends BluetoothInfo {
  /** 关闭适配器（释放资源） */
  close(): Promise<CapResult<void>>
  /** 适配器状态（available + discovering） */
  getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>
  /** 开始搜索附近设备 */
  startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>
  /** 停止搜索 */
  stopDiscovery(): Promise<CapResult<void>>
  /** 订阅「发现新设备」（返回取消订阅） */
  onDeviceFound(cb: (devices: BleDevice[]) => void): () => void
  /** 已发现设备列表 */
  getDevices(): Promise<CapResult<BleDevice[]>>
  /** 已连接设备列表 */
  getConnectedDevices(): Promise<CapResult<BleDevice[]>>
  /** 连接设备 */
  connect(deviceId: string): Promise<CapResult<void>>
  /** 断开设备 */
  disconnect(deviceId: string): Promise<CapResult<void>>
  /** 订阅「连接状态变化」（返回取消订阅） */
  onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void
  /** 获取设备服务列表 */
  getServices(deviceId: string): Promise<CapResult<BleService[]>>
  /** 获取服务的特征值列表 */
  getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>
  /** 读特征值 */
  read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>
  /** 写特征值 */
  write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>
  /** 订阅/取消订阅特征值通知 */
  setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>
  /** 订阅「特征值变化」（返回取消订阅） */
  onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void
  /** 读取信号强度 */
  getRSSI(deviceId: string): Promise<CapResult<number>>
}

/** C37 NFC 状态（wx.getHCEState / web NDEFReader 特性探测） */
export interface NfcInfo {
  /** 平台是否支持 NFC */
  supported: boolean
  /** NFC 当前可用（已开启） */
  available: boolean
}

/**
 * ★能力颗粒度对齐：C37 NFC 操作接口（原仅 getHCEState 状态探测 → HCE 卡模拟 + 消息收发）
 *   HCE = Host Card Emulation（手机模拟卡）；APDU 收发 + 事件订阅。
 */
export interface NFCAPI extends NfcInfo {
  /** 启动 HCE（模拟卡；aidList 应用标识） */
  startHCE(aidList: string[]): Promise<CapResult<void>>
  /** 停止 HCE */
  stopHCE(): Promise<CapResult<void>>
  /** 发送 APDU 响应（收到 onHCEMessage 后回） */
  sendHCEMessage(data: ArrayBuffer): Promise<CapResult<void>>
  /** 订阅 HCE 消息（返回取消） */
  onHCEMessage(cb: (message: { messageType: number; data?: ArrayBuffer }) => void): () => void
  /** 订阅 HCE 状态变化（返回取消） */
  onHCEStateChange(cb: (available: boolean) => void): () => void
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
/** 地图控制器桥（原始 Promise 层——hook 层包 CapResult） */
export interface MapContextBridge {
  getRegion(): Promise<MapRegion>
  moveTo(latitude: number, longitude: number, scale?: number): Promise<void>
  moveToLocation(): Promise<void>
  includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<void>
  translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<void>
  addMarkers(markers: MapMarker[]): Promise<void>
  removeMarkers(ids: number[]): Promise<void>
  addPolylines(polylines: MapPolyline[]): Promise<void>
  removePolylines(ids: number[]): Promise<void>
  addCircles(circles: MapCircle[]): Promise<void>
  removeCircles(ids: number[]): Promise<void>
  getScale(): Promise<number>
  openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<void>
  on(event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void): () => void
}

/** C4 useMap 句柄（控制器方法返回 Result<T>——G-32.4） */
/** 地图标记（wx.Marker 子集） */
export interface MapMarker {
  id: number
  latitude: number
  longitude: number
  title?: string
  iconPath?: string
  width?: number
  height?: number
  callout?: Record<string, unknown>
}
/** 地图覆盖物/折线/圆（简化） */
export interface MapPolyline { points: Array<{ latitude: number; longitude: number }>; color?: string; width?: number }
export interface MapCircle { latitude: number; longitude: number; radius: number; color?: string; fillColor?: string }

/**
 * ★能力颗粒度对齐：C4 地图控制器（原 2 方法 → 覆盖物/视野/坐标转换/移动标记全套）
 *   方法统一 Promise<CapResult<T>>；上层组件 <map> 通过 id 取控制器。
 */
export interface MapController {
  getRegion(): Promise<CapResult<MapRegion>>
  moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>
  /** 移动到当前定位点 */
  moveToLocation(): Promise<CapResult<void>>
  /** 缩放视野以包含所有点 */
  includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>
  /** 平移（相对当前中心，单位 px 或度数） */
  translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>
  /** 添加/移除标记 */
  addMarkers(markers: MapMarker[]): Promise<CapResult<void>>
  removeMarkers(ids: number[]): Promise<CapResult<void>>
  /** 折线 / 圆 */
  addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>
  removePolylines(ids: number[]): Promise<CapResult<void>>
  addCircles(circles: MapCircle[]): Promise<CapResult<void>>
  removeCircles(ids: number[]): Promise<CapResult<void>>
  /** 获取缩放级别 / 旋转角 */
  getScale(): Promise<CapResult<number>>
  /** 打开地图 App（导航，宿主放行才可用） */
  openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>
  /** 订阅地图事件（regionchange/updated 等；返回取消） */
  on(event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void): () => void
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
  /** C5 传感器一次性读取（wx onXxxChange 首个事件，读到即解除监听；web DeviceMotion+DeviceOrientation） */
  readSensor?(kind: SensorKind): Promise<SensorSample>
  /** ★能力颗粒度对齐：C5 传感器流（持续监听 + 显式启停 + 多订阅） */
  startSensor?(kind: SensorKind): Promise<void>
  stopSensor?(kind: SensorKind): Promise<void>
  /** 持续推送采样（wx on*Change 挂接；返回取消订阅）——缺省 → 流仅收集订阅者无推送（诚实边界） */
  subscribeSensor?(kind: SensorKind, cb: (sample: SensorSample) => void): () => void
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
  /** ★能力颗粒度对齐：C17 设备订阅消息（wx.requestSubscribeDeviceMessage） */
  subscribeDeviceMessage?(templateId: string): Promise<MessageSubscription>
  /** ★能力颗粒度对齐：C17 打开客服会话（wx.openCustomerServiceChat / customer-service 组件） */
  openCustomerService?(corpId: string, url: string): Promise<void>
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
  /** C36 蓝牙（wx.openBluetoothAdapter + BLE 操作 / web navigator.bluetooth 特性探测）——★富接口 */
  getBluetooth?(): Promise<BluetoothAPI>
  /** C37 NFC（wx HCE 卡模拟 + 消息收发 / web NDEFReader 特性探测）——★富接口 */
  getNfc?(): Promise<NFCAPI>
  /** C1 摄像头访问（wx.authorize scope.camera / web getUserMedia） */
  getCamera?(): Promise<MediaAccess>
  /** ★能力颗粒度对齐：C1 相机操作控制器（wx.createCameraContext(id) → 拍照/录像） */
  createCameraContext?(id: string): CameraController
  /** C2 麦克风访问（wx.authorize scope.record / web getUserMedia audio） */
  getMicrophone?(): Promise<MediaAccess>
  /** ★能力颗粒度对齐：C2 录音操作控制器（wx.getRecorderManager() → start/stop/pause/resume） */
  getRecorder?(): RecorderController
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
  // ★能力颗粒度对齐：异步 API（对齐官方 setStorage/getStorage；大值不阻塞主线程）
  setAsync(key: string, value: unknown): Promise<CapResult<void>>
  getAsync<T = unknown>(key: string): Promise<CapResult<T | undefined>>
  removeAsync(key: string): Promise<CapResult<void>>
  clearAsync(): Promise<CapResult<void>>
  /** 存储信息（keys / 已用 / 上限） */
  info(): Promise<CapResult<{ keys: string[]; currentSize: number; limitSize: number }>>
  /** 批量读 */
  batchGet(keys: string[]): Promise<CapResult<Array<{ key: string; value: unknown }>>>
  /** 批量写 */
  batchSet(kvList: Array<{ key: string; value: unknown }>): Promise<CapResult<void>>
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
  appendFile?: (opt: { filePath: string; data: string | ArrayBuffer; encoding?: string; success?: () => void; fail: (e: unknown) => void }) => void
  copyFile?: (opt: { srcPath: string; destPath: string; success?: () => void; fail: (e: unknown) => void }) => void
  rename?: (opt: { oldPath: string; newPath: string; success?: () => void; fail: (e: unknown) => void }) => void
  stat?: (opt: { path: string; success: (r: WxStatsLike) => void; fail: (e: unknown) => void }) => void
  mkdir?: (opt: { dirPath: string; recursive?: boolean; success?: () => void; fail: (e: unknown) => void }) => void
  rmdir?: (opt: { dirPath: string; recursive?: boolean; success?: () => void; fail: (e: unknown) => void }) => void
  readdir?: (opt: { dirPath: string; success: (r: { files: string[] }) => void; fail: (e: unknown) => void }) => void
  getFileInfo?: (opt: { filePath: string; digestAlgorithm?: string; success: (r: { size: number; digest: string }) => void; fail: (e: unknown) => void }) => void
  saveFile?: (opt: { tempFilePath: string; success: (r: { savedFilePath: string }) => void; fail: (e: unknown) => void }) => void
  getSavedFileList?: (opt: { success: (r: { fileList: Array<{ filePath: string; size: number; createTime: number }> }) => void; fail?: (e: unknown) => void }) => void
  removeSavedFile?: (opt: { filePath: string; success?: () => void; fail: (e: unknown) => void }) => void
  unzip?: (opt: { zipFilePath: string; targetPath: string; success?: () => void; fail: (e: unknown) => void }) => void
  readFileSync?: (opt: { filePath: string; encoding?: string }) => string | ArrayBuffer
  writeFileSync?: (opt: { filePath: string; data: string | ArrayBuffer; encoding?: string }) => void
  appendFileSync?: (opt: { filePath: string; data: string | ArrayBuffer; encoding?: string }) => void
  copyFileSync?: (opt: { srcPath: string; destPath: string }) => void
  renameSync?: (opt: { oldPath: string; newPath: string }) => void
  unlinkSync?: (opt: { filePath: string }) => void
  accessSync?: (opt: { path: string }) => void
  statSync?: (opt: { path: string }) => WxStatsLike
  mkdirSync?: (opt: { dirPath: string; recursive?: boolean }) => void
  readdirSync?: (opt: { dirPath: string }) => string[]
}

/** wx.Stats 子集（WxFileSystemManager.stat/statSync 回传） */
interface WxStatsLike {
  size: number
  mode?: number
  lastAccessedTime?: number
  lastModifiedTime?: number
  isDirectory?: () => boolean
  isFile?: () => boolean
}

interface WxLike {
  getLocation?: (opt: { success: (r: Coords) => void; fail: (e: unknown) => void }) => void
  vibrateShort?: (opt: { fail: () => void }) => void
  getNetworkType?: (opt: { success: (r: { networkType: string }) => void; fail?: (e: unknown) => void }) => void
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
  setStorage?: (opt: { key: string; data: unknown; success?: () => void; fail?: (e: unknown) => void }) => void
  getStorage?: (opt: { key: string; success: (r: { data: unknown }) => void; fail?: (e: unknown) => void }) => void
  removeStorage?: (opt: { key: string; success?: () => void; fail?: (e: unknown) => void }) => void
  clearStorage?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  getStorageInfo?: (opt: { success: (r: { keys: string[]; currentSize: number; limitSize: number }) => void; fail?: (e: unknown) => void }) => void
  batchSetStorage?: (opt: { kvList: Array<{ key: string; value: unknown }>; success?: () => void; fail?: (e: unknown) => void }) => void
  batchGetStorage?: (opt: { keyList: string[]; success: (r: { kvList: Array<{ key: string; value: unknown }> }) => void; fail?: (e: unknown) => void }) => void
  removeStorageSync?: (key: string) => void
  clearStorageSync?: () => void
  // ★G-32 B3 三期：新增 wx 能力
  onAccelerometerChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void
  offAccelerometerChange?: (cb?: (r: { x: number; y: number; z: number }) => void) => void
  startAccelerometer?: (opt?: { interval?: string; success?: () => void; fail?: (e: unknown) => void }) => void
  stopAccelerometer?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onCompassChange?: (cb: (r: { direction?: number }) => void) => void
  offCompassChange?: (cb?: (r: { direction?: number }) => void) => void
  startCompass?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  stopCompass?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onGyroscopeChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void
  offGyroscopeChange?: (cb?: (r: { x: number; y: number; z: number }) => void) => void
  startGyroscope?: (opt?: { interval?: string; success?: () => void; fail?: (e: unknown) => void }) => void
  stopGyroscope?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
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
  requestSubscribeDeviceMessage?: (opt: { tmplIds: string[]; success?: (r: Record<string, string>) => void; fail?: (e: unknown) => void }) => void
  openCustomerServiceChat?: (opt: { extInfo: { url: string }; corpId: string; success?: () => void; fail?: (e: unknown) => void }) => void
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
  createCameraContext?: (id?: string) => WxCameraContextLike
  getRecorderManager?: () => WxRecorderManagerLike
  authorize?: (opt: { scope: string; success?: () => void; fail?: (e: unknown) => void }) => void
  openBluetoothAdapter?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  closeBluetoothAdapter?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  getBluetoothAdapterState?: (opt: { success?: (r: { available: boolean; discovering: boolean }) => void; fail?: (e: unknown) => void }) => void
  getBluetoothDevices?: (opt: { success?: (r: { devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }) => void; fail?: (e: unknown) => void }) => void
  getConnectedBluetoothDevices?: (opt: { services?: string[]; success?: (r: { devices?: Array<{ name?: string; deviceId?: string }> }) => void; fail?: (e: unknown) => void }) => void
  startBluetoothDevicesDiscovery?: (opt?: { allowDuplicatesKey?: boolean; success?: () => void; fail?: (e: unknown) => void }) => void
  stopBluetoothDevicesDiscovery?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onBluetoothDeviceFound?: (cb: (r: { devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }) => void) => void
  offBluetoothDeviceFound?: (cb?: (...args: never[]) => void) => void
  createBLEConnection?: (opt: { deviceId: string; success?: () => void; fail?: (e: unknown) => void }) => void
  closeBLEConnection?: (opt: { deviceId: string; success?: () => void; fail?: (e: unknown) => void }) => void
  getBLEDeviceServices?: (opt: { deviceId: string; success?: (r: { services?: Array<{ uuid: string; isPrimary?: boolean }> }) => void; fail?: (e: unknown) => void }) => void
  getBLEDeviceCharacteristics?: (opt: { deviceId: string; serviceId: string; success?: (r: { characteristics?: Array<{ uuid: string; properties?: { read?: boolean; write?: boolean; notify?: boolean; indicate?: boolean } }> }) => void; fail?: (e: unknown) => void }) => void
  readBLECharacteristicValue?: (opt: { deviceId: string; serviceId: string; characteristicId: string; success?: (r: { value?: ArrayBuffer }) => void; fail?: (e: unknown) => void }) => void
  writeBLECharacteristicValue?: (opt: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer; success?: () => void; fail?: (e: unknown) => void }) => void
  notifyBLECharacteristicValueChange?: (opt: { deviceId: string; serviceId: string; characteristicId: string; state: boolean; success?: () => void; fail?: (e: unknown) => void }) => void
  onBLEConnectionStateChange?: (cb: (r: { deviceId: string; connected: boolean }) => void) => void
  offBLEConnectionStateChange?: (cb?: (...args: never[]) => void) => void
  onBLECharacteristicValueChange?: (cb: (r: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void) => void
  offBLECharacteristicValueChange?: (cb?: (...args: never[]) => void) => void
  getBLEDeviceRSSI?: (opt: { deviceId: string; success?: (r: { RSSI: number }) => void; fail?: (e: unknown) => void }) => void
  getHCEState?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  startHCE?: (opt: { aidList: string[]; success?: () => void; fail?: (e: unknown) => void }) => void
  stopHCE?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  sendHCEMessage?: (opt: { data: ArrayBuffer; success?: () => void; fail?: (e: unknown) => void }) => void
  onHCEMessage?: (cb: (r: { messageType: number; data?: ArrayBuffer }) => void) => void
  offHCEMessage?: (cb?: (...args: never[]) => void) => void
  onHCEStateChange?: (cb: (r: { available: boolean }) => void) => void
  getSetting?: (opt: { success?: (r: { authSetting?: Record<string, boolean> }) => void; fail?: (e: unknown) => void }) => void
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
/** wx.CameraContext 子集 */
interface WxCameraContextLike {
  takePhoto?: (opt: { quality?: string; success: (r: { tempImagePath?: string; width: number; height: number }) => void; fail: (e: unknown) => void }) => void
  startRecord?: (opt: { timeoutCallback?: (r: { tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }) => void; success?: () => void; fail: (e: unknown) => void }) => void
  stopRecord?: (opt: { success: (r: { tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }) => void; fail: (e: unknown) => void }) => void
  setZoom?: (opt: { zoom: number; success?: () => void; fail: (e: unknown) => void }) => void
  onCameraFrame?: (cb: (data: { data: ArrayBuffer; width: number; height: number }) => void) => void
}
/** wx.RecorderManager 子集 */
interface WxRecorderManagerLike {
  start?: (opt?: Record<string, unknown>) => void
  stop?: () => void
  pause?: () => void
  resume?: () => void
  onStart?: (cb: () => void) => void
  onStop?: (cb: (r: { tempFilePath: string; duration: number; fileSize: number }) => void) => void
  onPause?: (cb: () => void) => void
  onResume?: (cb: () => void) => void
  onError?: (cb: (e: unknown) => void) => void
  onFrameRecorded?: (cb: (f: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void) => void
}
interface WxMapContextLike {
  getRegion?: (opt: { success: (r: { latitude: number; longitude: number; scale?: number; latitudeSpan?: number; longitudeSpan?: number }) => void; fail?: (e: unknown) => void }) => void
  moveTo?: (opt: { latitude: number; longitude: number; scale?: number; success?: () => void; fail?: (e: unknown) => void }) => void
  moveToLocation?: (opt?: { latitude?: number; longitude?: number; success?: () => void; fail?: (e: unknown) => void }) => void
  includePoints?: (opt: { points: Array<{ latitude: number; longitude: number }>; padding?: number[]; success?: () => void; fail?: (e: unknown) => void }) => void
  translateMarker?: (opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number; success?: () => void; fail?: (e: unknown) => void }) => void
  addMarkers?: (opt: { markers: MapMarker[]; success?: () => void; fail?: (e: unknown) => void }) => void
  removeMarkers?: (opt: { markerIds: number[]; success?: () => void; fail?: (e: unknown) => void }) => void
  addPolylines?: (opt: { polylines: MapPolyline[]; success?: () => void; fail?: (e: unknown) => void }) => void
  removePolylines?: (opt: { polylineIds: number[]; success?: () => void; fail?: (e: unknown) => void }) => void
  addCircles?: (opt: { circles: MapCircle[]; success?: () => void; fail?: (e: unknown) => void }) => void
  removeCircles?: (opt: { circleIds: number[]; success?: () => void; fail?: (e: unknown) => void }) => void
  getScale?: (opt: { success: (r: { scale: number }) => void; fail?: (e: unknown) => void }) => void
  openMapApp?: (opt: { latitude: number; longitude: number; name?: string; success?: () => void; fail?: (e: unknown) => void }) => void
  on?: (event: string, cb: (payload: unknown) => void) => void
  off?: (event: string, cb: (payload: unknown) => void) => void
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
    // ★能力颗粒度对齐：异步/批量/info（内存实现同步语义包装 CapResult）
    setAsync: (key, value) => {
      mem.set(key, JSON.stringify(value))
      return Promise.resolve(capOk(undefined))
    },
    getAsync: <T,>(key: string) => {
      const raw = mem.get(key)
      if (raw === undefined) return Promise.resolve(capOk<T | undefined>(undefined))
      try {
        return Promise.resolve(capOk<T | undefined>(JSON.parse(raw) as T))
      } catch {
        return Promise.resolve(capOk<T | undefined>(undefined))
      }
    },
    removeAsync: (key) => {
      mem.delete(key)
      return Promise.resolve(capOk(undefined))
    },
    clearAsync: () => {
      mem.clear()
      return Promise.resolve(capOk(undefined))
    },
    info: () =>
      Promise.resolve(
        capOk({ keys: [...mem.keys()], currentSize: [...mem.values()].reduce((n, v) => n + v.length, 0), limitSize: 10 * 1024 * 1024 }),
      ),
    batchGet: (keys) =>
      Promise.resolve(
        capOk(
          keys.map((k) => {
            const raw = mem.get(k)
            let value: unknown
            try {
              value = raw === undefined ? undefined : JSON.parse(raw)
            } catch {
              value = undefined
            }
            return { key: k, value }
          }),
        ),
      ),
    batchSet: (kvList) => {
      kvList.forEach((kv) => mem.set(kv.key, JSON.stringify(kv.value)))
      return Promise.resolve(capOk(undefined))
    },
  }
}

/** wx 存储适配（sync 存储缺失 → 内存兜底） */
function wxStorage(wx: WxLike): CompatStorage {
  if (typeof wx.setStorageSync !== 'function') return memoryStorage()
  const sync: Pick<CompatStorage, 'get' | 'set' | 'remove' | 'clear'> = {
    get: <T>(key: string) => (wx.getStorageSync ? (wx.getStorageSync(key) as T) : undefined),
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
  // ★能力颗粒度对齐：异步 API（缺 wx 异步 → 用同步结果包装；保证契约一致不 Err）
  const pAsync = <T>(fn: (resolve: (r: T) => void, reject: (e: unknown) => void) => void, code = 'storage.failed'): Promise<CapResult<T>> =>
    new Promise<CapResult<T>>((resolve) => fn((r) => resolve(capOk(r)), (e) => resolve(capErr<T>(code, (e as { errMsg?: string })?.errMsg || '存储操作失败', e))))
  return {
    ...sync,
    setAsync: (key, value) => (wx.setStorage ? pAsync<void>((res, rej) => wx.setStorage!({ key, data: value, success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.set(key, value)))),
    getAsync: <T,>(key: string) => (wx.getStorage ? pAsync<T | undefined>((res, rej) => wx.getStorage!({ key, success: (r) => res(r.data as T), fail: rej })) : Promise.resolve(capOk(sync.get<T>(key)))),
    removeAsync: (key) => (wx.removeStorage ? pAsync<void>((res, rej) => wx.removeStorage!({ key, success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.remove(key)))),
    clearAsync: () => (wx.clearStorage ? pAsync<void>((res, rej) => wx.clearStorage!({ success: () => res(undefined as never), fail: rej })) : Promise.resolve(capOk(sync.clear()))),
    info: () =>
      wx.getStorageInfo
        ? pAsync<{ keys: string[]; currentSize: number; limitSize: number }>((res, rej) => wx.getStorageInfo!({ success: (r) => res({ keys: r.keys ?? [], currentSize: r.currentSize ?? 0, limitSize: r.limitSize ?? 0 }), fail: rej }))
        : Promise.resolve(capOk({ keys: [], currentSize: 0, limitSize: 0 })),
    batchGet: (keys) =>
      wx.batchGetStorage
        ? pAsync<Array<{ key: string; value: unknown }>>((res, rej) => wx.batchGetStorage!({ keyList: keys, success: (r) => res((r.kvList ?? []).map((kv) => ({ key: kv.key, value: kv.value }))), fail: rej }))
        : Promise.resolve(capOk(keys.map((k) => ({ key: k, value: sync.get(k) })))),
    batchSet: (kvList) =>
      wx.batchSetStorage
        ? pAsync<void>((res, rej) => wx.batchSetStorage!({ kvList, success: () => res(undefined as never), fail: rej }))
        : Promise.resolve(capOk(kvList.forEach((kv) => sync.set(kv.key, kv.value)) as unknown as void)),
  }
}

/** web 内存文件系统（C43 降级：可读写但非持久——无标准同步 FS 时的诚实降级） */
function memoryFileSystem(): FileSystemBridge {
  // ★能力颗粒度对齐：Web/SSR 内存降级——实现完整 FileSystemBridge（目录语义用 '/' 前缀 key 模拟）
  const mem = new Map<string, string>()
  const dirs = new Set<string>()
  const isDir = (path: string): boolean => dirs.has(path)
  const dirPrefix = (path: string): string => (path.endsWith('/') ? path : path + '/')
  const childrenOf = (path: string): string[] => {
    const pfx = dirPrefix(path)
    const out = new Set<string>()
    for (const k of mem.keys()) {
      if (k.startsWith(pfx)) out.add(k.slice(pfx.length).split('/')[0] as string)
    }
    for (const d of dirs) {
      if (d !== path && d.startsWith(pfx)) out.add(d.slice(pfx.length).split('/')[0] as string)
    }
    return [...out]
  }
  const statOf = (path: string): FileStat => {
    const v = mem.get(path)
    const directory = isDir(path)
    return { size: v ? v.length : 0, mode: 0, lastAccessedTime: 0, lastModifiedTime: 0, isDirectory: directory, isFile: !directory }
  }
  const asyncOk = (): Promise<void> => Promise.resolve()
  return {
    readFile: (path) =>
      new Promise((resolve, reject) => {
        const v = mem.get(path)
        if (v === undefined) return reject(new CapError('file-system.read-failed', `内存文件不存在: ${path}`))
        resolve(v)
      }),
    writeFile: (path, data) => {
      mem.set(path, data)
      return asyncOk()
    },
    appendFile: (path, data) => {
      mem.set(path, (mem.get(path) ?? '') + data)
      return asyncOk()
    },
    copyFile: (src, dest) => {
      if (!mem.has(src)) return Promise.reject(new CapError('file-system.copy-failed', `内存文件不存在: ${src}`))
      mem.set(dest, mem.get(src) as string)
      return asyncOk()
    },
    rename: (o, n) => {
      if (!mem.has(o)) return Promise.reject(new CapError('file-system.rename-failed', `内存文件不存在: ${o}`))
      mem.set(n, mem.get(o) as string)
      mem.delete(o)
      return asyncOk()
    },
    remove: (path) => {
      mem.delete(path)
      return asyncOk()
    },
    exists: (path) => Promise.resolve(mem.has(path) || isDir(path)),
    stat: (path) => {
      if (!mem.has(path) && !isDir(path)) return Promise.reject(new CapError('file-system.stat-failed', `不存在: ${path}`))
      return Promise.resolve(statOf(path))
    },
    mkdir: (path) => {
      dirs.add(path)
      return asyncOk()
    },
    rmdir: (path) => {
      dirs.delete(path)
      return asyncOk()
    },
    readdir: (path) => Promise.resolve(childrenOf(path)),
    getFileInfo: (path) => {
      if (!mem.has(path)) return Promise.reject(new CapError('file-system.info-failed', `内存文件不存在: ${path}`))
      const v = mem.get(path) as string
      return Promise.resolve({ size: v.length, digest: String(v.length) })
    },
    saveFile: (temp) => Promise.resolve(temp),
    getSavedFileList: () => Promise.resolve([...mem.keys()].map((p) => ({ filePath: p, size: (mem.get(p) ?? '').length, createTime: 0 }))),
    removeSavedFile: (path) => {
      mem.delete(path)
      return asyncOk()
    },
    unzip: () => Promise.reject(new CapError('file-system.unsupported', 'web 内存降级不支持解压')),
    readFileSync: (path) => {
      const v = mem.get(path)
      if (v === undefined) throw new CapError('file-system.read-failed', `内存文件不存在: ${path}`)
      return v
    },
    writeFileSync: (path, data) => {
      mem.set(path, data)
    },
    existsSync: (path) => mem.has(path) || isDir(path),
    statSync: (path) => {
      if (!mem.has(path) && !isDir(path)) throw new CapError('file-system.stat-failed', `不存在: ${path}`)
      return statOf(path)
    },
    readdirSync: (path) => childrenOf(path),
    mkdirSync: (path) => {
      dirs.add(path)
    },
    renameSync: (o, n) => {
      if (!mem.has(o)) throw new CapError('file-system.rename-failed', `内存文件不存在: ${o}`)
      mem.set(n, mem.get(o) as string)
      mem.delete(o)
    },
    unlinkSync: (path) => {
      mem.delete(path)
    },
    copyFileSync: (src, dest) => {
      if (!mem.has(src)) throw new CapError('file-system.copy-failed', `内存文件不存在: ${src}`)
      mem.set(dest, mem.get(src) as string)
    },
    appendFileSync: (path, data) => {
      mem.set(path, (mem.get(path) ?? '') + data)
    },
  }
}

/** wx 文件系统桥（getFileSystemManager 子集——readFile/writeFile/unlink/access） */
function normStats(st: WxStatsLike): FileStat {
  return {
    size: st.size ?? 0,
    mode: st.mode ?? 0,
    lastAccessedTime: st.lastAccessedTime ?? 0,
    lastModifiedTime: st.lastModifiedTime ?? 0,
    isDirectory: typeof st.isDirectory === 'function' ? st.isDirectory() : false,
    isFile: typeof st.isFile === 'function' ? st.isFile() : true,
  }
}

function wxFileSystem(wx: WxLike): FileSystemBridge {
  const fs = wx.getFileSystemManager?.()
  const need = (fn: unknown, name: string): void => {
    if (typeof fn !== 'function') throw new CapError('file-system.unsupported', 'wx FileSystemManager.' + name + ' 缺失')
  }
  const prom = <T>(fn: (cb: { success: (r: never) => void; fail: (e: unknown) => void }) => void, code = 'file-system.failed'): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      fn({
        success: (r: never) => resolve(r as T),
        fail: (e: unknown) => reject(new CapError(code, (e as { errMsg?: string })?.errMsg || 'wx 文件操作失败', e)),
      })
    })
  const ok = (fn: () => void, code = 'file-system.failed'): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      try {
        fn()
        resolve()
      } catch (e) {
        reject(new CapError(code, (e as { errMsg?: string })?.errMsg || 'wx 文件操作失败', e))
      }
    })
  const guard = <T>(fn: () => T, code = 'file-system.failed'): CapResult<T> => {
    try {
      return capOk(fn())
    } catch (e) {
      return capErr<T>(e instanceof CapError ? e.code : code, e instanceof Error ? e.message : String(e), e)
    }
  }

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

  // 异步操作（缺 API → reject 显式 Err）
  const append = (path: string, data: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.appendFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.appendFile 缺失'))
      fs.appendFile({ filePath: path, data, encoding: 'utf8', success: () => resolve(), fail: (e) => reject(new CapError('file-system.append-failed', '追加失败', e)) })
    })
  const copy = (src: string, dest: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.copyFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.copyFile 缺失'))
      fs.copyFile({ srcPath: src, destPath: dest, success: () => resolve(), fail: (e) => reject(new CapError('file-system.copy-failed', '复制失败', e)) })
    })
  const rename = (o: string, n: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.rename) return reject(new CapError('file-system.unsupported', 'FileSystemManager.rename 缺失'))
      fs.rename({ oldPath: o, newPath: n, success: () => resolve(), fail: (e) => reject(new CapError('file-system.rename-failed', '重命名失败', e)) })
    })
  const stat = (path: string): Promise<FileStat> =>
    new Promise((resolve, reject) => {
      if (!fs?.stat) return reject(new CapError('file-system.unsupported', 'FileSystemManager.stat 缺失'))
      fs.stat({ path, success: (r) => resolve(normStats(r)), fail: (e) => reject(new CapError('file-system.stat-failed', 'stat 失败', e)) })
    })
  const mkdir = (path: string, recursive = false): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.mkdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.mkdir 缺失'))
      fs.mkdir({ dirPath: path, recursive, success: () => resolve(), fail: (e) => reject(new CapError('file-system.mkdir-failed', '创建目录失败', e)) })
    })
  const rmdir = (path: string, recursive = false): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.rmdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.rmdir 缺失'))
      fs.rmdir({ dirPath: path, recursive, success: () => resolve(), fail: (e) => reject(new CapError('file-system.rmdir-failed', '删除目录失败', e)) })
    })
  const readdir = (path: string): Promise<string[]> =>
    new Promise((resolve, reject) => {
      if (!fs?.readdir) return reject(new CapError('file-system.unsupported', 'FileSystemManager.readdir 缺失'))
      fs.readdir({ dirPath: path, success: (r) => resolve(r.files ?? []), fail: (e) => reject(new CapError('file-system.readdir-failed', '读目录失败', e)) })
    })
  const getFileInfo = (path: string, digestAlgorithm = 'md5'): Promise<{ size: number; digest: string }> =>
    new Promise((resolve, reject) => {
      if (!fs?.getFileInfo) return reject(new CapError('file-system.unsupported', 'FileSystemManager.getFileInfo 缺失'))
      fs.getFileInfo({ filePath: path, digestAlgorithm, success: (r) => resolve({ size: r.size, digest: r.digest }), fail: (e) => reject(new CapError('file-system.info-failed', 'getFileInfo 失败', e)) })
    })
  const saveFile = (temp: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!fs?.saveFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.saveFile 缺失'))
      fs.saveFile({ tempFilePath: temp, success: (r) => resolve(r.savedFilePath), fail: (e) => reject(new CapError('file-system.save-failed', 'saveFile 失败', e)) })
    })
  const getSavedFileList = (): Promise<SavedFileInfo[]> =>
    new Promise((resolve, reject) => {
      if (!fs?.getSavedFileList) return reject(new CapError('file-system.unsupported', 'FileSystemManager.getSavedFileList 缺失'))
      fs.getSavedFileList({ success: (r) => resolve((r.fileList ?? []).map((f) => ({ filePath: f.filePath, size: f.size, createTime: f.createTime }))), fail: (e) => reject(new CapError('file-system.list-failed', 'getSavedFileList 失败', e)) })
    })
  const removeSavedFile = (path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.removeSavedFile) return reject(new CapError('file-system.unsupported', 'FileSystemManager.removeSavedFile 缺失'))
      fs.removeSavedFile({ filePath: path, success: () => resolve(), fail: (e) => reject(new CapError('file-system.remove-failed', 'removeSavedFile 失败', e)) })
    })
  const unzip = (zip: string, target: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!fs?.unzip) return reject(new CapError('file-system.unsupported', 'FileSystemManager.unzip 缺失'))
      fs.unzip({ zipFilePath: zip, targetPath: target, success: () => resolve(), fail: (e) => reject(new CapError('file-system.unzip-failed', '解压失败', e)) })
    })

  // Sync 变体（缺 API → 抛，由 FSAdapter 包 CapResult）
  const req = (fn: unknown, name: string): void => need(fn, name)
  return {
    readFile: read,
    writeFile: write,
    appendFile: append,
    copyFile: copy,
    rename,
    remove,
    exists,
    stat,
    mkdir,
    rmdir,
    readdir,
    getFileInfo,
    saveFile,
    getSavedFileList,
    removeSavedFile,
    unzip,
    readFileSync: (path) => {
      req(fs?.readFileSync, 'readFileSync')
      return String((fs!.readFileSync as (o: { filePath: string; encoding?: string }) => string | ArrayBuffer)({ filePath: path, encoding: 'utf8' }))
    },
    writeFileSync: (path, data) => {
      req(fs?.writeFileSync, 'writeFileSync')
      ;(fs!.writeFileSync as (o: { filePath: string; data: string; encoding?: string }) => void)({ filePath: path, data, encoding: 'utf8' })
    },
    existsSync: (path) => {
      if (!fs?.accessSync) throw new CapError('file-system.unsupported', 'FileSystemManager.accessSync 缺失')
      try {
        ;(fs.accessSync as (o: { path: string }) => void)({ path })
        return true
      } catch {
        return false
      }
    },
    statSync: (path) => {
      req(fs?.statSync, 'statSync')
      return normStats((fs!.statSync as (o: { path: string }) => WxStatsLike)({ path }))
    },
    readdirSync: (path) => {
      req(fs?.readdirSync, 'readdirSync')
      return (fs!.readdirSync as (o: { dirPath: string }) => string[])({ dirPath: path }) ?? []
    },
    mkdirSync: (path, recursive = false) => {
      req(fs?.mkdirSync, 'mkdirSync')
      ;(fs!.mkdirSync as (o: { dirPath: string; recursive?: boolean }) => void)({ dirPath: path, recursive })
    },
    renameSync: (o, n) => {
      req(fs?.renameSync, 'renameSync')
      ;(fs!.renameSync as (x: { oldPath: string; newPath: string }) => void)({ oldPath: o, newPath: n })
    },
    unlinkSync: (path) => {
      req(fs?.unlinkSync, 'unlinkSync')
      ;(fs!.unlinkSync as (x: { filePath: string }) => void)({ filePath: path })
    },
    copyFileSync: (src, dest) => {
      req(fs?.copyFileSync, 'copyFileSync')
      ;(fs!.copyFileSync as (x: { srcPath: string; destPath: string }) => void)({ srcPath: src, destPath: dest })
    },
    appendFileSync: (path, data) => {
      req(fs?.appendFileSync, 'appendFileSync')
      ;(fs!.appendFileSync as (x: { filePath: string; data: string; encoding?: string }) => void)({ filePath: path, data, encoding: 'utf8' })
    },
  }
  void prom
  void ok
  void guard
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
      new Promise((resolve, reject) => {
        // ★诚实降级（对齐 G-32.3 显式错误）：能力缺失必须 Err，不虚构在线状态
        if (!wx.getNetworkType) return reject(new CapError('network.unsupported', 'wx.getNetworkType 缺失'))
        wx.getNetworkType({ success: (r) => resolve({ online: true, type: normalizeNetwork(r.networkType) }), fail: () => reject(new CapError('network.failed', 'wx.getNetworkType 失败')) })
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
      new Promise((resolve, reject) => {
        // ★诚实降级：缺失必须 Err，不虚构朝向
        if (!wx.onDeviceOrientationChange) return reject(new CapError('orientation.unsupported', 'wx.onDeviceOrientationChange 缺失'))
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
      // ★修复：读到首帧后解除监听（原实现永久挂 on* → 泄漏；wx.off* 存在则调用）
      new Promise((resolve, reject) => {
        if (kind === 'compass') {
          if (!wx.onCompassChange) return reject(new CapError('sensor.compass.unsupported', 'wx.onCompassChange 缺失'))
          const h = (r: { direction?: number }): void => {
            if (wx.offCompassChange) wx.offCompassChange(h)
            resolve({ kind, heading: typeof r.direction === 'number' ? r.direction : 0, timestamp: Date.now() })
          }
          wx.onCompassChange(h)
          return
        }
        if (kind === 'gyroscope') {
          if (!wx.onGyroscopeChange) return reject(new CapError('sensor.gyroscope.unsupported', 'wx.onGyroscopeChange 缺失'))
          const h = (r: { x: number; y: number; z: number }): void => {
            if (wx.offGyroscopeChange) wx.offGyroscopeChange(h)
            resolve({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
          }
          wx.onGyroscopeChange(h)
          return
        }
        if (!wx.onAccelerometerChange) return reject(new CapError('sensor.accelerometer.unsupported', 'wx.onAccelerometerChange 缺失'))
        const h = (r: { x: number; y: number; z: number }): void => {
          if (wx.offAccelerometerChange) wx.offAccelerometerChange(h)
          resolve({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
        }
        wx.onAccelerometerChange(h)
      }),
    // ★能力颗粒度对齐：传感器流启停（start/stop 显式生命周期）
    startSensor: (kind) =>
      new Promise((resolve, reject) => {
        const start = kind === 'compass' ? wx.startCompass : kind === 'gyroscope' ? wx.startGyroscope : wx.startAccelerometer
        if (typeof start !== 'function') return reject(new CapError('sensor.' + kind + '.unsupported', 'wx.start' + kind + ' 缺失'))
        start({ success: () => resolve(), fail: (e: unknown) => reject(new CapError('sensor.start-failed', '传感器启动失败', e)) })
      }),
    stopSensor: (kind) =>
      new Promise((resolve, reject) => {
        const stop = kind === 'compass' ? wx.stopCompass : kind === 'gyroscope' ? wx.stopGyroscope : wx.stopAccelerometer
        if (typeof stop !== 'function') return reject(new CapError('sensor.' + kind + '.unsupported', 'wx.stop' + kind + ' 缺失'))
        stop({ success: () => resolve(), fail: (e: unknown) => reject(new CapError('sensor.stop-failed', '传感器停止失败', e)) })
      }),
    // ★能力颗粒度对齐：持续推送（on*Change 挂接 → cb；返回取消订阅）
    subscribeSensor: (kind, cb) => {
      if (kind === 'compass') {
        if (!wx.onCompassChange) return () => {}
        const h = (r: { direction?: number }): void => cb({ kind, heading: typeof r.direction === 'number' ? r.direction : 0, timestamp: Date.now() })
        wx.onCompassChange(h)
        return () => {
          if (wx.offCompassChange) wx.offCompassChange(h)
        }
      }
      if (kind === 'gyroscope') {
        if (!wx.onGyroscopeChange) return () => {}
        const h = (r: { x: number; y: number; z: number }): void => cb({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
        wx.onGyroscopeChange(h)
        return () => {
          if (wx.offGyroscopeChange) wx.offGyroscopeChange(h)
        }
      }
      if (!wx.onAccelerometerChange) return () => {}
      const h = (r: { x: number; y: number; z: number }): void => cb({ kind, x: r.x, y: r.y, z: r.z, timestamp: Date.now() })
      wx.onAccelerometerChange(h)
      return () => {
        if (wx.offAccelerometerChange) wx.offAccelerometerChange(h)
      }
    },
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
    subscribeDeviceMessage: (templateId) =>
      new Promise((resolve, reject) => {
        if (!wx.requestSubscribeDeviceMessage) return reject(new CapError('notification.unsupported', 'wx.requestSubscribeDeviceMessage 缺失'))
        wx.requestSubscribeDeviceMessage({
          tmplIds: [templateId],
          success: (r) => {
            const status = (r ?? {})[templateId] ?? 'reject'
            resolve({ templateId, granted: status === 'accept', status })
          },
          fail: (e) => reject(new CapError('notification.failed', 'wx.requestSubscribeDeviceMessage 失败', e)),
        })
      }),
    openCustomerService: (corpId, url) =>
      new Promise((resolve, reject) => {
        if (!wx.openCustomerServiceChat) return reject(new CapError('notification.unsupported', 'wx.openCustomerServiceChat 缺失'))
        wx.openCustomerServiceChat({ corpId, extInfo: { url }, success: () => resolve(), fail: (e) => reject(new CapError('notification.failed', '打开客服失败', e)) })
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
    // ★能力颗粒度对齐：C36 蓝牙 BLE 富接口（连接/服务/特征值/通知/发现——原实现仅状态探测）
    //   打开适配器 → 返回 BluetoothAPI（方法统一 Promise<CapResult<T>>；订阅返回取消函数；缺 API → 方法级 Err）
    getBluetooth: async () => {
      if (!wx.openBluetoothAdapter) throw new CapError('bluetooth.unsupported', 'wx.openBluetoothAdapter 缺失')
      await new Promise<void>((resolve, reject) => {
        wx.openBluetoothAdapter!({
          success: () => resolve(),
          // ★诚实降级：适配器开启失败 = 不可用（不谎报 supported:true）
          fail: (e: unknown) => reject(new CapError('bluetooth.unavailable', (e as { errMsg?: string })?.errMsg || 'wx.openBluetoothAdapter 失败')),
        })
      })
      const need = (fn: unknown, name: string): void => {
        if (typeof fn !== 'function') throw new CapError('bluetooth.unsupported', 'wx.' + name + ' 缺失')
      }
      // 便捷：把 wx 回调式 API 包成 Promise（失败 reject CapError）
      type WxCb<r> = { success?: (res: r) => void; fail?: (e: unknown) => void }
      // opt 宽松（wx 各 API 参数形状各异）；运行时补 success/fail 回调，故用 unknown 断言注入
      const call = <r>(fn: (opt: Record<string, unknown>) => void, opt: Record<string, unknown> = {}, errCode = 'bluetooth.failed'): Promise<r> =>
        new Promise<r>((resolve, reject) => {
          fn({
            ...opt,
            success: (res: r) => resolve(res),
            fail: (e: unknown) => reject(new CapError(errCode, (e as { errMsg?: string })?.errMsg || 'ble 操作失败')),
          })
        })
      const cap = <T>(p: Promise<T>): Promise<CapResult<T>> => p.then((data) => capOk(data), (e) => capErr(e instanceof CapError ? e.code : 'bluetooth.failed', e instanceof Error ? e.message : String(e), e))
      const mapDev = (d: { name?: string; deviceId?: string; RSSI?: number }): BleDevice => ({ deviceId: d.deviceId ?? '', name: d.name ?? 'unnamed', RSSI: d.RSSI })
      const listDevices = async (): Promise<BleDevice[]> => {
        if (!wx.getBluetoothDevices) return []
        const r = await call<{ devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }>((o) => wx.getBluetoothDevices!(o as never))
        return (r.devices ?? []).map(mapDev)
      }
      const api: BluetoothAPI = {
        supported: true,
        available: true,
        devices: (await listDevices()).map((d) => d.name),
        close: () => cap(wx.closeBluetoothAdapter ? call<void>((o) => wx.closeBluetoothAdapter!(o)) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.closeBluetoothAdapter 缺失'))),
        getAdapterState: () =>
          cap(
            wx.getBluetoothAdapterState
              ? call<{ available: boolean; discovering: boolean }>((o) => wx.getBluetoothAdapterState!(o as never))
              : Promise.resolve({ available: true, discovering: false }),
          ),
        startDiscovery: (allowDuplicatesKey = false) =>
          cap(wx.startBluetoothDevicesDiscovery ? call<void>((o) => wx.startBluetoothDevicesDiscovery!({ ...(o as object), allowDuplicatesKey })) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.startBluetoothDevicesDiscovery 缺失'))),
        stopDiscovery: () => cap(wx.stopBluetoothDevicesDiscovery ? call<void>((o) => wx.stopBluetoothDevicesDiscovery!(o)) : Promise.resolve()),
        getDevices: () => cap(listDevices()),
        getConnectedDevices: () =>
          cap(
            wx.getConnectedBluetoothDevices
              ? call<{ devices?: Array<{ name?: string; deviceId?: string }> }>((o) => wx.getConnectedBluetoothDevices!(o as never)).then((r) => (r.devices ?? []).map(mapDev))
              : listDevices(),
          ),
        connect: (deviceId) => cap(wx.createBLEConnection ? call<void>((o) => wx.createBLEConnection!({ ...(o as object), deviceId })) : Promise.reject(new CapError('bluetooth.unsupported', 'wx.createBLEConnection 缺失'))),
        disconnect: (deviceId) => cap(wx.closeBLEConnection ? call<void>((o) => wx.closeBLEConnection!({ ...(o as object), deviceId })) : Promise.resolve()),
        getServices: (deviceId) =>
          cap(
            wx.getBLEDeviceServices
              ? call<{ services?: Array<{ uuid: string; isPrimary?: boolean }> }>((o) => wx.getBLEDeviceServices!({ ...(o as object), deviceId })).then((r) => (r.services ?? []).map((sv) => ({ uuid: sv.uuid, isPrimary: sv.isPrimary ?? true })))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceServices 缺失')),
          ),
        getCharacteristics: (deviceId, serviceId) =>
          cap(
            wx.getBLEDeviceCharacteristics
              ? call<{ characteristics?: Array<{ uuid: string; properties?: { read?: boolean; write?: boolean; notify?: boolean; indicate?: boolean } }> }>((o) => wx.getBLEDeviceCharacteristics!({ ...(o as object), deviceId, serviceId })).then((r) =>
                  (r.characteristics ?? []).map((c) => ({ uuid: c.uuid, properties: { read: !!c.properties?.read, write: !!c.properties?.write, notify: !!c.properties?.notify, indicate: !!c.properties?.indicate } })),
                )
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceCharacteristics 缺失')),
          ),
        read: (deviceId, serviceId, characteristicId) =>
          cap(
            wx.readBLECharacteristicValue
              ? call<{ value?: ArrayBuffer }>((o) => wx.readBLECharacteristicValue!({ ...(o as object), deviceId, serviceId, characteristicId })).then((r) => r.value ?? new ArrayBuffer(0))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.readBLECharacteristicValue 缺失')),
          ),
        write: (deviceId, serviceId, characteristicId, value) =>
          cap(
            wx.writeBLECharacteristicValue
              ? call<void>((o) => wx.writeBLECharacteristicValue!({ ...(o as object), deviceId, serviceId, characteristicId, value }))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.writeBLECharacteristicValue 缺失')),
          ),
        setNotify: (deviceId, serviceId, characteristicId, state) =>
          cap(
            wx.notifyBLECharacteristicValueChange
              ? call<void>((o) => wx.notifyBLECharacteristicValueChange!({ ...(o as object), deviceId, serviceId, characteristicId, state }))
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.notifyBLECharacteristicValueChange 缺失')),
          ),
        getRSSI: (deviceId) =>
          cap(
            wx.getBLEDeviceRSSI
              ? call<{ RSSI: number }>((o) => wx.getBLEDeviceRSSI!({ ...(o as object), deviceId })).then((r) => r.RSSI)
              : Promise.reject(new CapError('bluetooth.unsupported', 'wx.getBLEDeviceRSSI 缺失')),
          ),
        // 订阅：wx 的 on*/off* 成对；返回取消函数（无 API → 空订阅，不抛）
        onDeviceFound: (cb) => {
          if (!wx.onBluetoothDeviceFound) return () => {}
          const h = (r: { devices?: Array<{ name?: string; deviceId?: string; RSSI?: number }> }): void => cb((r.devices ?? []).map(mapDev))
          wx.onBluetoothDeviceFound(h)
          return () => {
            if (wx.offBluetoothDeviceFound) wx.offBluetoothDeviceFound(h)
          }
        },
        onConnectionStateChange: (cb) => {
          if (!wx.onBLEConnectionStateChange) return () => {}
          const h = (r: { deviceId: string; connected: boolean }): void => cb(r.deviceId, r.connected)
          wx.onBLEConnectionStateChange(h)
          return () => {
            if (wx.offBLEConnectionStateChange) wx.offBLEConnectionStateChange(h)
          }
        },
        onCharacteristicValueChange: (cb) => {
          if (!wx.onBLECharacteristicValueChange) return () => {}
          const h = (r: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }): void => cb(r.deviceId, r.serviceId, r.characteristicId, r.value)
          wx.onBLECharacteristicValueChange(h)
          return () => {
            if (wx.offBLECharacteristicValueChange) wx.offBLECharacteristicValueChange(h)
          }
        },
      }
      void need // 语义保留：需要时可显式断言
      return api
    },
    // ★能力颗粒度对齐修复：C16 权限（wxBridge 原缺失 → usePermission 在小程序端恒 Err）
    //   语义映射：wx.getSetting().authSetting[scope] === true → granted；false + 有记录 → denied；无记录 → prompt
    getPermission: (permission) =>
      new Promise((resolve, reject) => {
        if (!wx.getSetting) return reject(new CapError('permission.unsupported', 'wx.getSetting 缺失'))
        wx.getSetting({
          success: (r) => {
            const scope = permission.startsWith('scope.') ? permission : 'scope.' + permission
            const auth = r.authSetting ?? {}
            const has = Object.prototype.hasOwnProperty.call(auth, scope)
            const state: PermissionState['state'] = auth[scope] === true ? 'granted' : has ? 'denied' : 'prompt'
            resolve({ permission, state })
          },
          fail: (e: unknown) => reject(new CapError('permission.failed', (e as { errMsg?: string })?.errMsg || 'wx.getSetting 失败')),
        })
      }),
    // ★能力颗粒度对齐：C37 NFC 富接口（HCE 卡模拟 + 消息收发；原仅状态探测）
    getNfc: () =>
      new Promise((resolve) => {
        const build = (supported: boolean, available: boolean): NFCAPI => {
          const cap = <T,>(p: Promise<T>): Promise<CapResult<T>> => p.then((d) => capOk(d), (e) => capErr<T>(e instanceof CapError ? e.code : 'nfc.failed', e instanceof Error ? e.message : String(e), e))
          const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
            new Promise<void>((res, rej) => {
              if (typeof fn !== 'function') return rej(new CapError('nfc.unsupported', 'wx.' + name + ' 缺失'))
              ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('nfc.failed', 'wx ' + name + ' 失败', e)) })
            })
          return {
            supported,
            available,
            startHCE: (aidList) => cap(run(wx.startHCE, 'startHCE', { aidList })),
            stopHCE: () => cap(run(wx.stopHCE, 'stopHCE')),
            sendHCEMessage: (data) => cap(run(wx.sendHCEMessage, 'sendHCEMessage', { data })),
            onHCEMessage: (cb) => {
              if (!wx.onHCEMessage) return () => {}
              wx.onHCEMessage(cb)
              return () => {
                if (wx.offHCEMessage) wx.offHCEMessage(cb)
              }
            },
            onHCEStateChange: (cb) => {
              if (!wx.onHCEStateChange) return () => {}
              const h = (r: { available: boolean }): void => cb(r.available)
              wx.onHCEStateChange(h)
              return () => {}
            },
          }
        }
        if (!wx.getHCEState) {
          resolve(build(false, false))
          return
        }
        wx.getHCEState({
          success: () => resolve(build(true, true)),
          fail: () => resolve(build(true, false)),
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
    // ★能力颗粒度对齐：C1 相机操作（wx.createCameraContext(id) → takePhoto/startRecord/stopRecord/setZoom/onCameraFrame）
    createCameraContext: (id: string) => {
      if (typeof wx.createCameraContext !== 'function') throw new CapError('camera.unsupported', 'wx.createCameraContext 缺失')
      const ctx = wx.createCameraContext(id)
      const call = <r>(fn: unknown, name: string, opt: Record<string, unknown> = {}): Promise<CapResult<r>> =>
        new Promise<CapResult<r>>((resolve) => {
          if (typeof fn !== 'function') return resolve(capErr<r>('camera.unsupported', 'CameraContext.' + name + ' 缺失'))
          ;(fn as (o: Record<string, unknown>) => void)({ ...opt, success: (res: r) => resolve(capOk(res)), fail: (e: unknown) => resolve(capErr<r>('camera.failed', 'wx 相机 ' + name + ' 失败', e)) })
        })
      return {
        takePhoto: (quality = 'normal') =>
          call<{ tempImagePath?: string; width: number; height: number }>(ctx.takePhoto, 'takePhoto', { quality }).then((r) => (r.ok ? capOk({ tempImagePath: r.data.tempImagePath, width: r.data.width ?? 0, height: r.data.height ?? 0 }) : r)),
        startRecord: () => call<void>(ctx.startRecord, 'startRecord'),
        stopRecord: () =>
          call<{ tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }>(ctx.stopRecord, 'stopRecord').then((r) => (r.ok ? capOk({ tempThumbPath: r.data.tempThumbPath, tempVideoPath: r.data.tempVideoPath, duration: r.data.duration ?? 0, size: r.data.size ?? 0 }) : r)),
        setZoom: (zoom: number) => call<void>(ctx.setZoom, 'setZoom', { zoom }),
        onCameraFrame: (cb) => {
          if (typeof ctx.onCameraFrame !== 'function') return () => {}
          ctx.onCameraFrame(cb)
          return () => {}
        },
      }
    },
    // ★能力颗粒度对齐：C2 录音操作（wx.getRecorderManager() → start/stop/pause/resume + 事件）
    getRecorder: () => {
      if (typeof wx.getRecorderManager !== 'function') throw new CapError('microphone.unsupported', 'wx.getRecorderManager 缺失')
      const mgr = wx.getRecorderManager()
      const okRun = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('microphone.unsupported', 'RecorderManager.' + name + ' 缺失')
          try {
            ;(fn as (o?: Record<string, unknown>) => void)(opt)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('microphone.failed', 'wx 录音 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { start: 'onStart', stop: 'onStop', pause: 'onPause', resume: 'onResume', error: 'onError' }
      return {
        start: (options?: RecordOptions) => okRun(mgr.start, 'start', options as Record<string, unknown> | undefined),
        stop: () => okRun(mgr.stop, 'stop'),
        pause: () => okRun(mgr.pause, 'pause'),
        resume: () => okRun(mgr.resume, 'resume'),
        on: (event: 'start' | 'stop' | 'pause' | 'resume' | 'error', cb: (payload: unknown) => void) => {
          const fn = mgr[evMap[event] as keyof WxRecorderManagerLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb)
          return () => {}
        },
        onFrameRecorded: (cb) => {
          if (typeof mgr.onFrameRecorded !== 'function') return () => {}
          mgr.onFrameRecorded(cb)
          return () => {}
        },
      }
    },
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
      // ★能力颗粒度对齐：C4 地图控制器全量（覆盖物/视野/坐标/移动标记 + 事件）
      //   缺 ctx API → 对应方法 Err（诚实）；事件订阅返回取消函数
      // 桥层返回原始 Promise（MapContextBridge）；CapResult 包装在 hook 层（useMap）
      const call = <r>(fn: unknown, name: string, opt: Record<string, unknown> = {}): Promise<r> =>
        new Promise<r>((resolve, reject) => {
          if (typeof fn !== 'function') return reject(new CapError('map.unsupported', 'MapContext.' + name + ' 缺失'))
          ;(fn as (o: Record<string, unknown>) => void)({
            ...opt,
            success: (res: r) => resolve(res),
            fail: (e: unknown) => reject(new CapError('map.failed', 'wx 地图 ' + name + ' 失败', e)),
          })
        })
      return {
        getRegion: () =>
          call<{ latitude: number; longitude: number; scale?: number }>(ctx.getRegion, 'getRegion').then((r) => ({ latitude: r.latitude, longitude: r.longitude, scale: r.scale })),
        moveTo: (latitude: number, longitude: number, scale?: number) => call<void>(ctx.moveTo, 'moveTo', { latitude, longitude, scale }),
        moveToLocation: () => call<void>(ctx.moveToLocation, 'moveToLocation'),
        includePoints: (points: Array<{ latitude: number; longitude: number }>, padding?: number[]) => call<void>(ctx.includePoints, 'includePoints', { points, padding }),
        translateMarker: (opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }) => call<void>(ctx.translateMarker, 'translateMarker', opt),
        addMarkers: (markers: MapMarker[]) => call<void>(ctx.addMarkers, 'addMarkers', { markers }),
        removeMarkers: (ids: number[]) => call<void>(ctx.removeMarkers, 'removeMarkers', { markerIds: ids }),
        addPolylines: (polylines: MapPolyline[]) => call<void>(ctx.addPolylines, 'addPolylines', { polylines }),
        removePolylines: (ids: number[]) => call<void>(ctx.removePolylines, 'removePolylines', { polylineIds: ids }),
        addCircles: (circles: MapCircle[]) => call<void>(ctx.addCircles, 'addCircles', { circles }),
        removeCircles: (ids: number[]) => call<void>(ctx.removeCircles, 'removeCircles', { circleIds: ids }),
        getScale: () => call<{ scale: number }>(ctx.getScale, 'getScale').then((r) => r.scale),
        openMapApp: (opt: { latitude: number; longitude: number; name?: string }) => call<void>(ctx.openMapApp, 'openMapApp', opt),
        on: (event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void) => {
          if (typeof ctx.on !== 'function') return () => {}
          ctx.on(event, cb)
          return () => {
            if (typeof ctx.off === 'function') ctx.off(event, cb)
          }
        },
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
      if (!ls || typeof ls.getItem !== 'function') return memoryStorage()
      const readOne = <T,>(key: string): T | undefined => {
        const raw = ls.getItem(key)
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      }
      const store: CompatStorage = {
        get: readOne,
        set: (key, value) => ls.setItem(key, JSON.stringify(value)),
        remove: (key) => ls.removeItem(key),
        clear: () => ls.clear(),
        // ★能力颗粒度对齐：异步/批量/info（localStorage 同步语义包装 CapResult）
        setAsync: (key, value) => {
          ls.setItem(key, JSON.stringify(value))
          return Promise.resolve(capOk(undefined))
        },
        getAsync: <T,>(key: string) => Promise.resolve(capOk(readOne<T>(key))),
        removeAsync: (key) => {
          ls.removeItem(key)
          return Promise.resolve(capOk(undefined))
        },
        clearAsync: () => {
          ls.clear()
          return Promise.resolve(capOk(undefined))
        },
        info: () => Promise.resolve(capOk({ keys: Object.keys(ls), currentSize: 0, limitSize: 5 * 1024 * 1024 })),
        batchGet: (keys) => Promise.resolve(capOk(keys.map((k) => ({ key: k, value: readOne(k) })))),
        batchSet: (kvList) => {
          kvList.forEach((kv) => ls.setItem(kv.key, JSON.stringify(kv.value)))
          return Promise.resolve(capOk(undefined))
        },
      }
      return store
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
    // ★能力颗粒度对齐：web 设备订阅消息/客服会话（无标准对等 → 诚实 Err）
    subscribeDeviceMessage: () => Promise.reject(new CapError('notification.unsupported', 'Web 端无设备订阅消息对等')),
    openCustomerService: () => Promise.reject(new CapError('notification.unsupported', 'Web 端无客服会话对等')),
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
      // ★能力颗粒度对齐：返回完整 BluetoothAPI；Web 的 BLE 操作无标准对等 → 每个操作诚实 Err（不虚构）
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('bluetooth.unsupported', 'Web 端 BLE ' + op + ' 无标准对等（需 Web Bluetooth 用户手势）'))
      return {
        supported,
        available: supported,
        devices: [],
        close: () => Promise.resolve(capOk(undefined)),
        getAdapterState: () => Promise.resolve(capOk({ available: supported, discovering: false })),
        startDiscovery: () => noWeb('startDiscovery'),
        stopDiscovery: () => Promise.resolve(capOk(undefined)),
        getDevices: () => Promise.resolve(capOk([])),
        getConnectedDevices: () => Promise.resolve(capOk([])),
        connect: () => noWeb('connect'),
        disconnect: () => noWeb('disconnect'),
        getServices: () => noWeb('getServices'),
        getCharacteristics: () => noWeb('getCharacteristics'),
        read: () => noWeb('read'),
        write: () => noWeb('write'),
        setNotify: () => noWeb('setNotify'),
        getRSSI: () => noWeb('getRSSI'),
        onDeviceFound: () => () => {},
        onConnectionStateChange: () => () => {},
        onCharacteristicValueChange: () => () => {},
      }
    },
    getNfc: async () => {
      const supported = typeof (g as { NDEFReader?: unknown }).NDEFReader === 'function'
      // ★能力颗粒度对齐：web 返完整 NFCAPI（HCE 无标准对等 → 诚实 Err）
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('nfc.unsupported', 'Web 端 HCE ' + op + ' 无标准对等'))
      return {
        supported,
        available: supported,
        startHCE: () => noWeb('startHCE'),
        stopHCE: () => noWeb('stopHCE'),
        sendHCEMessage: () => noWeb('sendHCEMessage'),
        onHCEMessage: () => () => {},
        onHCEStateChange: () => () => {},
      }
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
    // ★能力颗粒度对齐：web 相机操作（诚实 Err——拍照/录像需 canvas/MediaRecorder 后续批次）
    createCameraContext: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('camera.unsupported', 'Web 端相机 ' + op + ' 未实现（需 canvas/MediaRecorder，后续批次）'))
      return {
        takePhoto: () => noWeb<PhotoResult>('takePhoto'),
        startRecord: () => noWeb<void>('startRecord'),
        stopRecord: () => noWeb<VideoResult>('stopRecord'),
        setZoom: () => noWeb<void>('setZoom'),
        onCameraFrame: () => () => {},
      }
    },
    getRecorder: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('microphone.unsupported', 'Web 端录音 ' + op + ' 未实现（需 MediaRecorder，后续批次）'))
      return {
        start: () => noWeb<void>('start'),
        stop: () => noWeb<void>('stop'),
        pause: () => noWeb<void>('pause'),
        resume: () => noWeb<void>('resume'),
        on: () => () => {},
        onFrameRecorded: () => () => {},
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

/** 运行时探测（★SSOT：@proteus-vue/shared.detectRuntime——window 前置守卫）：
 *  真·小程序运行时 → wx 桥；否则 web 桥（含 web 上 @proteus-vue/web 的 wx 模拟层——不误选 wx 窄桥） */
export function createCapabilityBridge(): CapabilityBridge {
  const g = globalThis as { wx?: WxLike }
  if (detectRuntime() === 'mp' && g.wx) return wxBridge(g.wx)
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
  /** ★能力颗粒度对齐：传感器流（持续采样 + 启停 + 多订阅） */
  useSensorStream(kind: SensorKind): CapResult<SensorStream>
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
  /** ★能力颗粒度对齐：设备订阅消息 */
  useDeviceNotification(templateId: string): Promise<CapResult<MessageSubscription>>
  /** ★能力颗粒度对齐：打开客服会话 */
  useCustomerService(corpId: string, url: string): Promise<CapResult<void>>
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
  useBluetooth(): Promise<CapResult<BluetoothAPI>>
  /** C37 useNFC：NFC 状态（wx.getHCEState / web NDEFReader 特性探测） */
  useNFC(): Promise<CapResult<NFCAPI>>
  /** C1 useCamera：摄像头访问（wx.authorize / web getUserMedia） */
  useCamera(): Promise<CapResult<MediaAccess>>
  /** ★能力颗粒度对齐：相机操作控制器（拍照/录像/缩放/帧） */
  useCameraContext(id: string): CapResult<CameraController>
  /** C2 useMicrophone：麦克风访问（wx.authorize / web getUserMedia） */
  useMicrophone(): Promise<CapResult<MediaAccess>>
  /** ★能力颗粒度对齐：录音操作控制器（start/stop/pause/resume + 事件） */
  useRecorder(): CapResult<RecorderController>
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
  // ★传感器流局部状态（useSensorStream 用；订阅经桥 readSensor 轮询——无推送桥的诚实降级）
  const listeners: Array<(s: SensorSample) => void> = []
  let active = false
  let unsubscribe: (() => void) | null = null
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
    // ★能力颗粒度对齐：传感器流（显式启停 + 多订阅；无 start/stop 桥 → 用 readSensor 一次性轮询降级）
    useSensorStream: (kind) => {
      const noBridge = !bridge.startSensor && !bridge.stopSensor
      return capOk<SensorStream>({
        kind,
        active: () => active,
        start: async () => {
          if (active) return capOk(undefined)
          // 挂接持续推送（桥有 subscribeSensor → 每帧转发给全部订阅者）
          if (bridge.subscribeSensor) {
            unsubscribe = bridge.subscribeSensor(kind, (sample) => listeners.forEach((l) => l(sample)))
          }
          if (bridge.startSensor) {
            try {
              await bridge.startSensor(kind)
            } catch (e) {
              return capErr(e instanceof CapError ? e.code : 'sensor.start-failed', e instanceof Error ? e.message : String(e))
            }
          }
          active = true
          return capOk(undefined)
        },
        stop: async () => {
          active = false
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
          if (bridge.stopSensor) {
            try {
              await bridge.stopSensor(kind)
            } catch (e) {
              return capErr(e instanceof CapError ? e.code : 'sensor.stop-failed', e instanceof Error ? e.message : String(e))
            }
          }
          return capOk(undefined)
        },
        on: (cb) => {
          listeners.push(cb)
          return () => {
            const i = listeners.indexOf(cb)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
      })
    },
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
      // ★能力颗粒度对齐：代理完整 FileSystemBridge（异步 wrap CapResult；Sync 捕获 → CapResult）
      const sync = <T>(fn: () => T): CapResult<T> => {
        try {
          return capOk(fn())
        } catch (e) {
          return capErr<T>(e instanceof CapError ? e.code : 'file-system.failed', e instanceof Error ? e.message : String(e), e)
        }
      }
      return {
        supported: true,
        readFile: (path) => wrap(fs.readFile(path)),
        writeFile: (path, data) => wrap(fs.writeFile(path, data)),
        appendFile: (path, data) => wrap(fs.appendFile(path, data)),
        copyFile: (src, dest) => wrap(fs.copyFile(src, dest)),
        rename: (o, n) => wrap(fs.rename(o, n)),
        remove: (path) => wrap(fs.remove(path)),
        exists: (path) => wrap(fs.exists(path)),
        stat: (path) => wrap(fs.stat(path)),
        mkdir: (path, recursive) => wrap(fs.mkdir(path, recursive)),
        rmdir: (path, recursive) => wrap(fs.rmdir(path, recursive)),
        readdir: (path) => wrap(fs.readdir(path)),
        getFileInfo: (path, digestAlgorithm) => wrap(fs.getFileInfo(path, digestAlgorithm)),
        saveFile: (temp) => wrap(fs.saveFile(temp)),
        getSavedFileList: () => wrap(fs.getSavedFileList()),
        removeSavedFile: (path) => wrap(fs.removeSavedFile(path)),
        unzip: (zip, target) => wrap(fs.unzip(zip, target)),
        readFileSync: (path) => sync(() => fs.readFileSync(path)),
        writeFileSync: (path, data) => sync(() => fs.writeFileSync(path, data)),
        existsSync: (path) => sync(() => fs.existsSync(path)),
        statSync: (path) => sync(() => fs.statSync(path)),
        readdirSync: (path) => sync(() => fs.readdirSync(path)),
        mkdirSync: (path, recursive) => sync(() => fs.mkdirSync(path, recursive)),
        renameSync: (o, n) => sync(() => fs.renameSync(o, n)),
        unlinkSync: (path) => sync(() => fs.unlinkSync(path)),
        copyFileSync: (src, dest) => sync(() => fs.copyFileSync(src, dest)),
        appendFileSync: (path, data) => sync(() => fs.appendFileSync(path, data)),
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
    useDeviceNotification: (templateId) =>
      wrap(
        (() => {
          if (!bridge.subscribeDeviceMessage) return Promise.reject(new CapError('notification.unsupported', '桥未提供 subscribeDeviceMessage'))
          return bridge.subscribeDeviceMessage(templateId)
        })(),
      ),
    useCustomerService: (corpId, url) =>
      wrap(
        (() => {
          if (!bridge.openCustomerService) return Promise.reject(new CapError('notification.unsupported', '桥未提供 openCustomerService'))
          return bridge.openCustomerService(corpId, url)
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
    // ★能力颗粒度对齐：相机操作控制器（桥无 → 抛；有 → 返回控制器，方法自带 CapResult）
    useCameraContext: (id: string) => {
      if (!bridge.createCameraContext) throw new CapError('camera.unsupported', '桥未提供 createCameraContext（useCameraContext 不可用）')
      return capOk(bridge.createCameraContext(id))
    },
    // ★能力颗粒度对齐：录音操作控制器
    useRecorder: () => {
      if (!bridge.getRecorder) throw new CapError('microphone.unsupported', '桥未提供 getRecorder（useRecorder 不可用）')
      return capOk(bridge.getRecorder())
    },
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
          // ★能力颗粒度对齐：全量控制器（每个方法包 CapResult）
          const controller: MapController = {
            getRegion: () => wrap(ctx.getRegion()),
            moveTo: (latitude, longitude, scale) => wrap(ctx.moveTo(latitude, longitude, scale)),
            moveToLocation: () => wrap(ctx.moveToLocation()),
            includePoints: (points, padding) => wrap(ctx.includePoints(points, padding)),
            translateMarker: (opt) => wrap(ctx.translateMarker(opt)),
            addMarkers: (markers) => wrap(ctx.addMarkers(markers)),
            removeMarkers: (ids) => wrap(ctx.removeMarkers(ids)),
            addPolylines: (polylines) => wrap(ctx.addPolylines(polylines)),
            removePolylines: (ids) => wrap(ctx.removePolylines(ids)),
            addCircles: (circles) => wrap(ctx.addCircles(circles)),
            removeCircles: (ids) => wrap(ctx.removeCircles(ids)),
            getScale: () => wrap(ctx.getScale()),
            openMapApp: (opt) => wrap(ctx.openMapApp(opt)),
            on: (event, cb) => ctx.on(event, cb),
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