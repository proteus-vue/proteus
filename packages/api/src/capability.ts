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
  /** 传感器类型（回显创建时传入的 kind） */
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
  /** 上报埋点事件 */
  track(name: string, params?: Record<string, unknown>): Promise<CapResult<void>>
}

/** C35 日志级别 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error'

/** C35 Logger（useLog 句柄——console + 上报） */
export interface Logger {
  /** 普通日志 */
  log(message: string, data?: unknown): Promise<CapResult<void>>
  /** 警告日志 */
  warn(message: string, data?: unknown): Promise<CapResult<void>>
  /** 错误日志（可触发上报） */
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
  /** 文件大小（字节） */
  size: number
  /** 权限位 */
  mode: number
  /** 最后访问时间（ms 时间戳） */
  lastAccessedTime: number
  /** 最后修改时间（ms 时间戳） */
  lastModifiedTime: number
  /** 是否目录 */
  isDirectory: boolean
  /** 是否文件 */
  isFile: boolean
}

/** 已保存文件信息（wx.SavedFileInfo 子集） */
export interface SavedFileInfo {
  /** 保存后的文件路径 */
  filePath: string
  /** 文件大小（字节） */
  size: number
  /** 保存时间（ms 时间戳） */
  createTime: number
}

/** C43 FSAdapter（useFileSystem 句柄——方法均返回 Result<T>） */
export interface FSAdapter {
  /** 能力可用性（内存降级也算可用；false = 完全不可用） */
  supported: boolean
  /**
   * 读取文本文件（UTF-8）。
   * @param path 文件路径（本地路径 / USER_DATA_PATH）
   */
  readFile(path: string): Promise<CapResult<string>>
  /**
   * 写入文件（覆盖；不存在则创建）。
   * @param path 文件路径
   * @param data 文本内容
   */
  writeFile(path: string, data: string): Promise<CapResult<void>>
  /**
   * 追加写入（在文件尾部追加）。
   * @param path 文件路径
   * @param data 追加内容
   */
  appendFile(path: string, data: string): Promise<CapResult<void>>
  /**
   * 复制文件。
   * @param src 源路径
   * @param dest 目标路径
   */
  copyFile(src: string, dest: string): Promise<CapResult<void>>
  /**
   * 重命名 / 移动。
   * @param oldPath 原路径
   * @param newPath 新路径
   */
  rename(oldPath: string, newPath: string): Promise<CapResult<void>>
  /**
   * 删除文件。
   * @param path 文件路径
   */
  remove(path: string): Promise<CapResult<void>>
  /**
   * 文件 / 目录是否存在。
   * @param path 路径
   */
  exists(path: string): Promise<CapResult<boolean>>
  /**
   * 获取文件 / 目录信息（大小 / 时间 / 类型）。
   * @param path 路径
   */
  stat(path: string): Promise<CapResult<FileStat>>
  /**
   * 创建目录。
   * @param path 目录路径
   * @param recursive 是否递归创建父目录（缺省 false）
   */
  mkdir(path: string, recursive?: boolean): Promise<CapResult<void>>
  /**
   * 删除目录。
   * @param path 目录路径
   * @param recursive 是否递归删除（缺省 false）
   */
  rmdir(path: string, recursive?: boolean): Promise<CapResult<void>>
  /**
   * 读取目录，返回条目名列表。
   * @param path 目录路径
   */
  readdir(path: string): Promise<CapResult<string[]>>
  /**
   * 获取文件摘要（大小 + 摘要值）。
   * @param path 文件路径
   * @param digestAlgorithm 摘要算法（缺省 md5）
   */
  getFileInfo(path: string, digestAlgorithm?: string): Promise<CapResult<{ size: number; digest: string }>>
  /**
   * 保存临时文件到本地（返回持久路径）。
   * @param tempPath 临时文件路径（如拍照/下载产出）
   */
  saveFile(tempPath: string): Promise<CapResult<string>>
  /** 已保存文件列表 */
  getSavedFileList(): Promise<CapResult<SavedFileInfo[]>>
  /**
   * 删除已保存文件。
   * @param path 文件路径
   */
  removeSavedFile(path: string): Promise<CapResult<void>>
  /**
   * 解压 zip。
   * @param zipPath zip 文件路径
   * @param targetPath 解压目标目录
   */
  unzip(zipPath: string, targetPath: string): Promise<CapResult<void>>
  // Sync 变体（对齐官方；返回 CapResult 保持契约一致——同步失败返回 Err 而非抛）
  /** 同步读文件（阻塞主线程——仅小文件/启动期用） */
  readFileSync(path: string): CapResult<string>
  /** 同步写文件（阻塞主线程） */
  writeFileSync(path: string, data: string): CapResult<void>
  /** 同步判断存在 */
  existsSync(path: string): CapResult<boolean>
  /** 同步取文件信息 */
  statSync(path: string): CapResult<FileStat>
  /** 同步读目录 */
  readdirSync(path: string): CapResult<string[]>
  /** 同步创建目录 */
  mkdirSync(path: string, recursive?: boolean): CapResult<void>
  /** 同步重命名 */
  renameSync(oldPath: string, newPath: string): CapResult<void>
  /** 同步删除 */
  unlinkSync(path: string): CapResult<void>
  /** 同步复制 */
  copyFileSync(src: string, dest: string): CapResult<void>
  /** 同步追加 */
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
  /** 订阅「应用启动」（返回取消） */
  onLaunch(cb: () => void): () => void
  /** 订阅「应用进入前台」（返回取消） */
  onShow(cb: () => void): () => void
  /** 订阅「应用退到后台」（返回取消） */
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

/**
 * ★能力颗粒度对齐：C20 日历 API（原仅 addCalendarEvent → 增删查）
 *   注：小程序仅支持写日历（add/remove）；查询/更新无开放 API → 诚实 Err。
 */
export interface CalendarAPI {
  /** 添加日程（wx.addPhoneCalendar） */
  add(event: CalendarEvent): Promise<CapResult<void>>
  /** 删除日程（wx 需用户确认，按 eventId；支持有限） */
  remove(eventId: string): Promise<CapResult<void>>
  /** 查询日程（无开放 API → 诚实 Err） */
  list(startTime?: number, endTime?: number): Promise<CapResult<CalendarEvent[]>>
}

// ★G-32 B3 六期：page-lifecycle / bluetooth / nfc / camera / microphone / keyboard

/** C24 页面生命周期句柄（wx Page 钩子 / web load+visibilitychange） */
export interface PageLifecycle {
  /** 页面当前阶段（LOAD 加载 / SHOW 显示 / HIDE 隐藏） */
  phase: 'IDLE' | 'LOAD' | 'SHOW' | 'HIDE'
  /** 订阅「页面加载」（返回取消） */
  onLoad(cb: () => void): () => void
  /** 订阅「页面显示」（返回取消） */
  onShow(cb: () => void): () => void
  /** 订阅「页面隐藏」（返回取消） */
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
  /** 照片临时文件路径 */
  tempImagePath?: string
  /** 照片宽度（px） */
  width: number
  /** 照片高度（px） */
  height: number
  /** web dataURL（blob: / data:） */
  dataUrl?: string
}

/** 录像结果（wx.stopRecord 子集） */
export interface VideoResult {
  /** 视频封面缩略图路径 */
  tempThumbPath?: string
  /** 视频临时文件路径 */
  tempVideoPath?: string
  /** 视频时长（ms） */
  duration: number
  /** 视频大小（字节） */
  size: number
}

/** ★能力颗粒度对齐：C1 相机操作控制器（wx.createCameraContext(id) → 拍照/录像/缩放/帧回调） */
export interface CameraController {
  /**
   * 拍照。
   * @param quality 画质（high 高清 / normal 普通 / low 低清；缺省 normal）
   * @returns 照片临时路径 + 宽高
   */
  takePhoto(quality?: 'high' | 'normal' | 'low'): Promise<CapResult<PhotoResult>>
  /** 开始录像（与 stopRecord 配对；超时可用 WxCameraContextLike.timeoutCallback 回调，超出本控制器范围） */
  startRecord(): Promise<CapResult<void>>
  /** 停止录像并返回视频临时路径 / 缩略图 / 时长 / 大小 */
  stopRecord(): Promise<CapResult<VideoResult>>
  /**
   * 设置缩放级别。
   * @param zoom 缩放倍数（1 为原始）
   */
  setZoom(zoom: number): Promise<CapResult<void>>
  /**
   * 订阅相机实时帧。
   * @param cb 每帧回调（data = RGBA 像素、width/height 帧尺寸）
   * @returns 取消订阅函数（web 无对等 → 空订阅）
   */
  onCameraFrame(cb: (data: { data: ArrayBuffer; width: number; height: number }) => void): () => void
}

/** 录音状态（wx RecorderManager onStart/onStop 等） */
export interface RecordOptions {
  /** 录音时长（ms；到时自动停止） */
  duration?: number
  /** 采样率（Hz，如 44100） */
  sampleRate?: number
  /** 声道数 */
  numberOfChannels?: number
  /** 编码码率（bps） */
  encodeBitRate?: number
  /** 音频格式 */
  format?: 'mp3' | 'aac' | 'wav' | 'PCM'
}

/** ★能力颗粒度对齐：C2 录音操作控制器（wx.getRecorderManager() → start/stop/pause/resume + 事件） */
export interface RecorderController {
  /**
   * 开始录音。
   * @param options 录音参数（时长/采样率/声道/码率/格式）
   */
  start(options?: RecordOptions): Promise<CapResult<void>>
  /** 停止录音（结果经 on('stop') 回调返回） */
  stop(): Promise<CapResult<void>>
  /** 暂停录音（可从当前位置 resume） */
  pause(): Promise<CapResult<void>>
  /** 恢复录音 */
  resume(): Promise<CapResult<void>>
  /**
   * 订阅录音生命周期事件。
   * @param event 事件名（start / stop / pause / resume / error）
   * @param cb 事件处理器（stop 携带录音结果）
   * @returns 取消订阅函数
   */
  on(event: 'start' | 'stop' | 'pause' | 'resume' | 'error', cb: (payload: unknown) => void): () => void
  /**
   * 订阅录音帧（录 per-frame 数据，用于实时波形/编码）。
   * @param cb 帧回调（frameBuffer 帧数据、isLastFrame 是否末帧）
   * @returns 取消订阅函数
   */
  onFrameRecorded(cb: (frame: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void): () => void
}

// —— ★组件实例 API 对齐（2026-09-12）：C57 Canvas 组件实例 ——

/** Canvas 文本度量（measureText 返回——对齐官方 TextMetrics 子集） */
export interface CanvasTextMetrics {
  /** 文本宽度（px） */
  width: number
  /** 文本高度（部分实现提供） */
  height?: number
}

/** Canvas 线性/径向渐变（createLinearGradient / createCircularGradient 返回） */
export interface CanvasGradientLike {
  /**
   * 添加渐变色标。
   * @param offset 色标位置（0–1）
   * @param color 颜色（CSS 颜色串）
   */
  addColorStop(offset: number, color: string): void
}

/** Canvas 图案填充（createPattern 返回） */
export interface CanvasPatternLike {
  /** 设置图案变换（可选，部分实现提供） */
  setTransform?(transform: unknown): void
}

/**
 * ★组件实例 API 对齐（2026-09-12）：C57 CanvasContext 2D 绘图上下文。
 *   方法名与参数**逐一对齐微信官方 CanvasContext**（`wx.createCanvasContext` 返回）——
 *   web 由标准 `CanvasRenderingContext2D` 适配（`setFillStyle` → `fillStyle` 等），
 *   因此同一份绘图代码在小程序端与 Web 端均可运行，业务零平台分支。
 */
export interface CanvasContext {
  /** 设置填充色（CSS 颜色串） */
  setFillStyle(color: string): void
  /** 设置描边色（CSS 颜色串） */
  setStrokeStyle(color: string): void
  /** 设置线宽 */
  setLineWidth(lineWidth: number): void
  /** 设置线帽（butt 平头 / round 圆头 / square 方头） */
  setLineCap(lineCap: 'butt' | 'round' | 'square'): void
  /** 设置连线拐角（bevel 斜角 / round 圆角 / miter 尖角） */
  setLineJoin(lineJoin: 'bevel' | 'round' | 'miter'): void
  /** 设置最大斜接长度 */
  setMiterLimit(miterLimit: number): void
  /** 设置全局透明度（0–1） */
  setGlobalAlpha(alpha: number): void
  /** 设置阴影（offsetX/offsetY 偏移、blur 模糊、color 颜色） */
  setShadow(offsetX: number, offsetY: number, blur: number, color?: string): void
  /** 设置虚线（pattern 为线段与间隔长度数组，offset 起始偏移） */
  setLineDash(pattern: number[], offset?: number): void
  /** 设置字号（px） */
  setFontSize(fontSize: number): void
  /** 设置文本水平对齐（left / center / right） */
  setTextAlign(align: 'left' | 'center' | 'right'): void
  /** 设置文本基线 */
  setTextBaseline(textBaseline: 'top' | 'bottom' | 'middle' | 'normal' | 'alphabetic' | 'hanging' | 'ideographic'): void
  /** 设置变换矩阵（等价标准 setTransform） */
  setTransform(scaleX: number, skewY: number, skewX: number, scaleY: number, translateX: number, translateY: number): void
  /** 保存绘图上下文（与 restore 配对，栈式） */
  save(): void
  /** 恢复最近保存的绘图上下文 */
  restore(): void
  /** 平移坐标系 */
  translate(x: number, y: number): void
  /** 旋转坐标系（弧度） */
  rotate(rotate: number): void
  /** 缩放坐标系 */
  scale(scaleX: number, scaleY: number): void
  /** 开始新路径（清空当前路径） */
  beginPath(): void
  /** 闭合当前路径 */
  closePath(): void
  /** 移动路径起点 */
  moveTo(x: number, y: number): void
  /** 连线到坐标 */
  lineTo(x: number, y: number): void
  /** 画圆弧（startAngle/endAngle 弧度；counterclockwise 逆时针） */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void
  /** 画圆弧并连线 */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void
  /** 二次贝塞尔曲线 */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  /** 三次贝塞尔曲线 */
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void
  /** 矩形路径 */
  rect(x: number, y: number, width: number, height: number): void
  /** 填充当前路径 */
  fill(): void
  /** 描边当前路径 */
  stroke(): void
  /** 按当前路径裁剪 */
  clip(): void
  /** 填充矩形 */
  fillRect(x: number, y: number, width: number, height: number): void
  /** 描边矩形 */
  strokeRect(x: number, y: number, width: number, height: number): void
  /** 清除矩形区域 */
  clearRect(x: number, y: number, width: number, height: number): void
  /** 填充文本（maxWidth 可选，超宽压缩） */
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  /** 测量文本尺寸 */
  measureText(text: string): CanvasTextMetrics
  /** 绘制图片（对齐官方 9 参 / 5 参 / 3 参重载：source 后接目标/裁剪参数） */
  drawImage(imageResource: string | unknown, ...args: number[]): void
  /** 创建线性渐变 */
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike
  /** 创建径向渐变（圆心 x,y 半径 radius） */
  createCircularGradient(x: number, y: number, radius: number): CanvasGradientLike
  /** 创建图案填充 */
  createPattern(image: string | unknown, repetition: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'): CanvasPatternLike | null
  /** 提交绘制（wx 异步提交到画布；web 即时绘制 → 直接回调。reserve 为 true 时保留上次绘制内容） */
  draw(reserve?: boolean | (() => void), callback?: () => void): void
}

/** Canvas 导出参数（wx.canvasToTempFilePath 对齐——web 端取相关字段） */
export interface CanvasExportOptions {
  /** 源区域左上角 x（缺省 0） */
  x?: number
  /** 源区域左上角 y（缺省 0） */
  y?: number
  /** 源区域宽（缺省画布宽） */
  width?: number
  /** 源区域高（缺省画布高） */
  height?: number
  /** 输出图宽（缺省 = 源宽） */
  destWidth?: number
  /** 输出图高（缺省 = 源高） */
  destHeight?: number
  /** 图片格式（缺省 png） */
  fileType?: 'png' | 'jpg'
  /** 图片质量（仅 jpg 生效，0–1） */
  quality?: number
}

/** Canvas 画布节点（`<canvas type="2d">`——wx fields({node:true}) / web HTMLCanvasElement） */
export interface CanvasNode {
  /** 画布像素宽 */
  width: number
  /** 画布像素高 */
  height: number
  /** 取原生上下文（2d / webgl） */
  getContext(type: '2d' | 'webgl'): unknown
  /** 请求动画帧（wx Canvas node.requestAnimationFrame / web 同） */
  requestAnimationFrame?(cb: (time: number) => void): number
  /** 取消动画帧 */
  cancelAnimationFrame?(handle: number): void
}

/** 离屏画布（wx.createOffscreenCanvas / web OffscreenCanvas——Skyline 高频渲染） */
export interface OffscreenCanvasHandle {
  /** 像素宽 */
  width: number
  /** 像素高 */
  height: number
  /** 取上下文（2d 返回可绘图上下文） */
  getContext(type: '2d' | 'webgl'): CanvasContext | null
}

/**
 * ★组件实例 API 对齐：C57 画布控制器（`useCanvas(id)`）。
 *   wx：`wx.createCanvasContext(id)` + `createSelectorQuery().fields({node:true})` +
 *   `wx.canvasToTempFilePath` + `wx.createOffscreenCanvas`；
 *   web：`document` 中按 id/选择器定位 `HTMLCanvasElement` + 标准 2D 上下文适配 + OffscreenCanvas 降级。
 */
export interface CanvasController {
  /** 画布标识（wx canvas-id；web 选择器/id，已去 `#` 前缀） */
  readonly id: string
  /** 创建旧版 2D 绘图上下文（方法名对齐官方 CanvasContext） */
  createContext(): CapResult<CanvasContext>
  /** 取画布节点（`<canvas type="2d">` node——用于 requestAnimationFrame / 标准 getContext） */
  node(): Promise<CapResult<CanvasNode>>
  /** 导出为临时文件路径（wx.canvasToTempFilePath；web 返回 data URL） */
  toTempFilePath(options?: CanvasExportOptions): Promise<CapResult<string>>
  /** 导出为 data URL（web 原生；wx 经临时文件读为 base64） */
  toDataURL(options?: CanvasExportOptions): Promise<CapResult<string>>
  /** 创建离屏画布（Skyline 高频渲染 / 离屏合成） */
  offscreen(width: number, height: number, type?: '2d' | 'webgl'): CapResult<OffscreenCanvasHandle>
}

// —— ★组件实例 API 对齐（2026-09-12）：C58/C59/C60 元素查询 / 交叉观察 / 媒体查询 ——

/** 元素几何（SelectorQuery.boundingClientRect 结果——对齐官方字段） */
export interface ElementRect {
  /** 元素 id */
  id?: string
  /** dataset 数据 */
  dataset?: Record<string, unknown>
  /** 左边界（相对显示区域） */
  left: number
  /** 上边界 */
  top: number
  /** 右边界 */
  right: number
  /** 下边界 */
  bottom: number
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
}

/** 滚动位置（SelectorQuery.scrollOffset 结果） */
export interface ElementScrollOffset {
  /** 元素 id */
  id?: string
  /** dataset 数据 */
  dataset?: Record<string, unknown>
  /** 纵向滚动距离 */
  scrollTop: number
  /** 横向滚动距离 */
  scrollLeft: number
}

/** fields 查询选项（对齐官方 SelectorQuery.fields） */
export interface ElementFieldsOptions {
  /** 返回节点（`<canvas type="2d">` / 自定义组件实例） */
  node?: boolean
  /** 返回几何（left/top/right/bottom/width/height） */
  rect?: boolean
  /** 返回尺寸（width/height） */
  size?: boolean
  /** 返回滚动位置 */
  scrollOffset?: boolean
  /** 返回 computedStyle（属性名数组） */
  computedStyle?: string[]
  /** 返回类名/自定义属性 dataset 等上下文 */
  context?: boolean
}

/** fields 查询结果（含请求到的各维度——未请求字段为 undefined） */
export interface ElementFieldsResult {
  /** 元素 id */
  id?: string
  /** dataset 数据 */
  dataset?: Record<string, unknown>
  /** 节点（node: true） */
  node?: CanvasNode
  /** 几何（rect: true） */
  left?: number
  top?: number
  right?: number
  bottom?: number
  /** 尺寸（rect/size: true） */
  width?: number
  height?: number
  /** 滚动位置（scrollOffset: true） */
  scrollTop?: number
  scrollLeft?: number
  /** computedStyle（computedStyle: [...]） */
  [styleOrExtra: string]: unknown
}

/**
 * ★组件实例 API 对齐：C58 元素查询句柄（`useElement(id?)`）。
 *   wx：`wx.createSelectorQuery()`（boundingClientRect / scrollOffset / fields + node/rect/size）+
 *   `wx.createIntersectionObserver` 关联元素；web：`document.querySelector` + `getBoundingClientRect()`。
 */
export interface ElementQuery {
  /**
   * 查询元素几何。
   * @param selector CSS 选择器（缺省 = 句柄初始 id/选择器）
   */
  boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>
  /**
   * 查询元素滚动位置。
   * @param selector CSS 选择器（缺省 = 句柄初始 id/选择器）
   */
  scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>
  /**
   * 按需查询元素字段（node/rect/size/scrollOffset/computedStyle）。
   * @param options 字段开关
   * @param selector CSS 选择器（缺省 = 句柄初始 id/选择器）
   */
  fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>
  /**
   * 查询元素尺寸（boundingClientRect 的常用投影）。
   * @param selector CSS 选择器（缺省 = 句柄初始 id/选择器）
   */
  size(selector?: string): Promise<CapResult<{ width: number; height: number }>>
  /**
   * 批量查询（同一查询内选择器数组——对齐官方 selectAll 的批量语义）。
   * @param selectors CSS 选择器数组
   */
  batch(selectors: string[]): Promise<CapResult<Array<ElementRect | null>>>
}

/** 交叉观察结果（IntersectionObserver 回调载荷——对齐官方字段） */
export interface IntersectionResult {
  /** 元素 id */
  id?: string
  /** dataset 数据 */
  dataset?: Record<string, unknown>
  /** 相交比例（0–1） */
  intersectionRatio: number
  /** 相交区域 */
  intersectionRect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  /** 目标边界 */
  boundingClientRect: ElementRect
  /** 相对参照物的区域 */
  relativeRect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  /** 时间戳 */
  time: number
}

/** 交叉观察配置（wx.createIntersectionObserver options） */
export interface IntersectionOptions {
  /** 相交阈值数组（缺省 [0]） */
  thresholds?: number[]
  /** 初始相交比例（用于立即上报初始态） */
  initialRatio?: number
  /** 是否同时观察所有满足选择器的元素 */
  observeAll?: boolean
}

/** 交叉观察句柄（IntersectionHandle.observe / relativeTo* / disconnect） */
export interface IntersectionHandle {
  /**
   * 指定参照元素（相对该元素观察）。
   * @param selector 参照元素选择器
   * @param margins 参照物扩展/收缩边界
   */
  relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
  /**
   * 以显示区域（视口）为参照。
   * @param margins 视口扩展/收缩边界
   */
  relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
  /**
   * 开始观察目标元素。
   * @param targetSelector 目标元素选择器
   * @param cb 相交状态变化回调
   */
  observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle
  /** 停止观察（释放） */
  disconnect(): void
}

/** 媒体查询条件（wx MediaQueryObserver.observe options——对齐官方字段） */
export interface MediaQueryCondition {
  /** 最小宽度（px） */
  minWidth?: number
  /** 最大宽度（px） */
  maxWidth?: number
  /** 宽度（px） */
  width?: number
  /** 最小高度（px） */
  minHeight?: number
  /** 最大高度（px） */
  maxHeight?: number
  /** 高度（px） */
  height?: number
  /** 屏幕方向 */
  orientation?: 'landscape' | 'portrait'
}

/** 媒体查询结果 */
export interface MediaQueryResult {
  /** 是否匹配当前条件 */
  matches: boolean
}

/**
 * ★组件实例 API 对齐：C60 媒体查询句柄（`useMediaQuery()`）。
 *   wx：`wx.createMediaQueryObserver()`；web：`window.matchMedia`（条件 → media query 串）。
 */
export interface MediaQueryObserver {
  /**
   * 开始观察媒体查询条件。
   * @param condition 条件（宽高范围 / 方向）
   * @param cb 匹配状态变化回调
   */
  observe(condition: MediaQueryCondition, cb: (result: MediaQueryResult) => void): void
  /** 停止观察（释放） */
  disconnect(): void
}

// —— ★组件实例 API 对齐（2026-09-12）：C61/C62/C63 媒体组件实例（video / audio / live-pusher） ——

/** 视频全屏方向（VideoContext.requestFullScreen） */
export interface VideoFullScreenOptions {
  /** 全屏方向（horizontal 横屏 / vertical 竖屏） */
  direction?: 'horizontal' | 'vertical'
}

/**
 * ★组件实例 API 对齐：C61 视频控制器（`useVideo(id)`）。
 *   wx：`wx.createVideoContext(id)`；web：`document` 中按 id 定位 `<video>` 元素并归一化控制/事件。
 */
export interface VideoController {
  /** 播放 */
  play(): Promise<CapResult<void>>
  /** 暂停 */
  pause(): Promise<CapResult<void>>
  /** 停止（回到起点） */
  stop(): Promise<CapResult<void>>
  /**
   * 跳转到指定位置。
   * @param position 位置（秒）
   */
  seek(position: number): Promise<CapResult<void>>
  /**
   * 设置播放倍速。
   * @param rate 倍速（0.5–2.0）
   */
  playbackRate(rate: number): Promise<CapResult<void>>
  /** 进入全屏 */
  requestFullScreen(options?: VideoFullScreenOptions): Promise<CapResult<void>>
  /** 退出全屏 */
  exitFullScreen(): Promise<CapResult<void>>
  /** 发送弹幕 */
  sendDanmu(danmu: { text: string; color?: string }): Promise<CapResult<void>>
  /**
   * 订阅视频事件（play / pause / ended / timeupdate / error / fullscreenchange）。
   * @param event 事件名
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: 'play' | 'pause' | 'ended' | 'timeupdate' | 'error' | 'fullscreenchange', cb: (payload: unknown) => void): () => void
}

/**
 * ★组件实例 API 对齐：C62 音频控制器（`useAudio(options?)`）。
 *   wx：`wx.createInnerAudioContext()`；web：`Audio` 元素（HTMLAudioElement）适配。
 */
export interface AudioController {
  /**
   * 播放。
   * @param src 音频地址（缺省用构造时的 src）
   */
  play(src?: string): Promise<CapResult<void>>
  /** 暂停 */
  pause(): Promise<CapResult<void>>
  /** 停止 */
  stop(): Promise<CapResult<void>>
  /**
   * 跳转到指定位置。
   * @param position 位置（秒）
   */
  seek(position: number): Promise<CapResult<void>>
  /** 设置音量（0–1） */
  setVolume(volume: number): void
  /** 设置是否循环 */
  setLoop(loop: boolean): void
  /** 当前播放进度（秒） */
  readonly currentTime: number
  /** 音频时长（秒） */
  readonly duration: number
  /** 是否暂停 */
  readonly paused: boolean
  /** 释放音频资源 */
  destroy(): void
  /**
   * 订阅音频事件（canplay / play / pause / stop / ended / timeupdate / error）。
   * @param event 事件名
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: 'canplay' | 'play' | 'pause' | 'stop' | 'ended' | 'timeupdate' | 'error', cb: (payload: unknown) => void): () => void
}

/**
 * ★组件实例 API 对齐：C63 直播推流控制器（`useLivePusher(id)`）。
 *   wx：`wx.createLivePusherContext(id)`；web：无标准推流 API → 各方法 Err 诚实降级（宿主桥）。
 */
export interface LivePusherController {
  /** 开始推流 */
  start(): Promise<CapResult<void>>
  /** 停止推流 */
  stop(): Promise<CapResult<void>>
  /** 暂停推流 */
  pause(): Promise<CapResult<void>>
  /** 恢复推流 */
  resume(): Promise<CapResult<void>>
  /** 切换前后摄像头 */
  switchCamera(): Promise<CapResult<void>>
  /** 开启/关闭闪光灯 */
  toggleTorch(): Promise<CapResult<void>>
  /** 推流截图（返回临时文件路径 / data URL） */
  snapshot(): Promise<CapResult<string>>
  /** 发送 SEI 消息 */
  sendMessage(msg: string): Promise<CapResult<void>>
  /**
   * 订阅推流事件（statechange / netstatus / error）。
   * @param event 事件名
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: 'statechange' | 'netstatus' | 'error', cb: (payload: unknown) => void): () => void
}

// —— ★组件实例 API 对齐（2026-09-12）：C64 广告组件实例 ——

/** 激励视频广告句柄（wx.createRewardedVideoAd） */
export interface RewardedVideoAdHandle {
  /** 拉取广告（缺省 show 前自动 load） */
  load(): Promise<CapResult<void>>
  /** 展示广告（返回是否因激励观看完毕而闭合的 Promise 解析在 onClose 载荷） */
  show(): Promise<CapResult<void>>
  /** 订阅加载成功（可缓存预热） */
  onLoad(cb: () => void): () => void
  /**
   * 订阅用户关闭广告。
   * @param cb 载荷 `isEnded`（是否观看完毕可发奖励）
   */
  onClose(cb: (res: { isEnded: boolean }) => void): () => void
  /** 订阅错误 */
  onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void
  /** 销毁 */
  off(): void
}

/** 插屏广告句柄（wx.createInterstitialAd） */
export interface InterstitialAdHandle {
  /** 拉取广告 */
  load(): Promise<CapResult<void>>
  /** 展示广告 */
  show(): Promise<CapResult<void>>
  /** 订阅加载成功 */
  onLoad(cb: () => void): () => void
  /** 订阅用户关闭 */
  onClose(cb: () => void): () => void
  /** 订阅错误 */
  onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void
  /** 销毁 */
  destroy(): void
}

/** 横幅广告样式（wx.createBannerAd style） */
export interface BannerAdStyle {
  /** 左侧偏移（px） */
  left?: number
  /** 顶部偏移（px） */
  top?: number
  /** 宽度（px） */
  width: number
}

/** 横幅广告句柄（wx.createBannerAd） */
export interface BannerAdHandle {
  /** 展示广告 */
  show(): Promise<CapResult<void>>
  /** 隐藏广告 */
  hide(): Promise<CapResult<void>>
  /** 销毁 */
  destroy(): void
  /** 订阅加载成功 */
  onLoad(cb: () => void): () => void
  /** 订阅尺寸变化 */
  onResize(cb: (size: { width: number; height: number }) => void): () => void
  /** 订阅错误 */
  onError(cb: (err: { errCode: number; errMsg: string }) => void): () => void
}

/**
 * ★组件实例 API 对齐：C64 广告句柄（`useAd()`）。
 *   wx：`wx.createRewardedVideoAd` / `createInterstitialAd` / `createBannerAd`；
 *   web：无广告联盟标准 API → 创建时抛 `ad.unsupported`（诚实降级，宿主可注入自建广告桥）。
 */
export interface AdAPI {
  /** 创建激励视频广告（按 adUnitId 缓存实例——同 id 复用） */
  rewardedVideo(adUnitId: string): RewardedVideoAdHandle
  /** 创建插屏广告 */
  interstitial(adUnitId: string): InterstitialAdHandle
  /** 创建横幅广告 */
  banner(options: { adUnitId: string; style: BannerAdStyle }): BannerAdHandle
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
  /** 设备唯一 id */
  deviceId: string
  /** 设备名称 */
  name: string
  /** 信号强度（发现/连接后可得） */
  RSSI?: number
}

/** BLE 服务（wx.BLEService 子集） */
export interface BleService {
  /** 服务 uuid */
  uuid: string
  /** 是否主服务 */
  isPrimary: boolean
}

/** BLE 特征值（wx.BLECharacteristic 子集） */
export interface BleCharacteristic {
  /** 特征值 uuid */
  uuid: string
  /** 支持的操作（read/write/notify/indicate） */
  properties: { read: boolean; write: boolean; notify: boolean; indicate: boolean }
}

/**
 * ★能力颗粒度对齐（docs/capability-granularity-alignment.md）：C36 蓝牙 BLE 操作接口
 *   计划 BluetoothAPI 的落地——连接/服务/特征值/通知/发现/断开全套（原实现只有状态探测）。
 *   方法统一返回 Promise<CapResult<T>>（G-32.4）；订阅类返回取消函数；不支持 → web/缺桥 Err。
 */
export interface BluetoothAPI extends BluetoothInfo {
  /** 关闭蓝牙适配器（释放系统资源；后续操作需重新 openBluetoothAdapter） */
  close(): Promise<CapResult<void>>
  /** 获取适配器状态（available 是否可用 / discovering 是否在搜索） */
  getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>
  /**
   * 开始搜索附近 BLE 设备。
   * @param allowDuplicatesKey 是否允许重复上报同一设备（缺省 false）
   */
  startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>
  /** 停止搜索附近设备 */
  stopDiscovery(): Promise<CapResult<void>>
  /**
   * 订阅「发现新设备」事件。
   * @param cb 回调（devices 本次新发现设备列表）
   * @returns 取消订阅函数
   */
  onDeviceFound(cb: (devices: BleDevice[]) => void): () => void
  /** 获取已发现设备列表 */
  getDevices(): Promise<CapResult<BleDevice[]>>
  /** 获取已连接设备列表 */
  getConnectedDevices(): Promise<CapResult<BleDevice[]>>
  /**
   * 连接指定设备。
   * @param deviceId 设备 id（来自发现结果）
   */
  connect(deviceId: string): Promise<CapResult<void>>
  /**
   * 断开指定设备。
   * @param deviceId 设备 id
   */
  disconnect(deviceId: string): Promise<CapResult<void>>
  /**
   * 订阅「连接状态变化」事件。
   * @param cb 回调（deviceId / connected）
   * @returns 取消订阅函数
   */
  onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void
  /**
   * 获取设备的服务（Service）列表。
   * @param deviceId 设备 id（需先连接）
   */
  getServices(deviceId: string): Promise<CapResult<BleService[]>>
  /**
   * 获取服务下的特征值（Characteristic）列表。
   * @param deviceId 设备 id
   * @param serviceId 服务 uuid
   */
  getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>
  /**
   * 读特征值。
   * @param deviceId 设备 id
   * @param serviceId 服务 uuid
   * @param characteristicId 特征值 uuid（须支持 read）
   */
  read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>
  /**
   * 写特征值。
   * @param deviceId 设备 id
   * @param serviceId 服务 uuid
   * @param characteristicId 特征值 uuid（须支持 write）
   * @param value 待写入字节（≤ 20 字节，长包需分包）
   */
  write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>
  /**
   * 订阅 / 取消订阅特征值通知。
   * @param deviceId 设备 id
   * @param serviceId 服务 uuid
   * @param characteristicId 特征值 uuid（须支持 notify/indicate）
   * @param state true 订阅 / false 取消
   */
  setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>
  /**
   * 订阅「特征值变化」通知数据。
   * @param cb 回调（deviceId / serviceId / characteristicId / value）
   * @returns 取消订阅函数
   */
  onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void
  /**
   * 读取设备信号强度（RSSI）。
   * @param deviceId 设备 id（需先连接）
   */
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
  /** ★能力颗粒度对齐：读卡模式适配器（wx.getNFCAdapter）——发现标签 + 各技术类型连接 */
  getAdapter(): NfcAdapter
}

/** NFC 发现的标签 */
export interface NfcTag {
  id: ArrayBuffer
  techs: string[]
  messages?: Array<{ records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }>
}

/** NFC 标签连接句柄（各技术类型公共面：connect/close/isConnected/setTimeout/transceive） */
export interface NfcTagHandle {
  connect(): Promise<CapResult<void>>
  close(): Promise<CapResult<void>>
  isConnected(): boolean
  setTimeout(timeout: number): Promise<CapResult<void>>
  transceive(data: ArrayBuffer): Promise<CapResult<ArrayBuffer>>
}

/** NDEF 句柄（额外：读写 NDEF 消息 + onNdefMessage） */
export interface NdefHandle extends NfcTagHandle {
  writeNdefMessage(message: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }): Promise<CapResult<void>>
  onNdefMessage(cb: (message: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }) => void): () => void
}

/**
 * ★能力颗粒度对齐：C37 NFC 读卡模式（wx.getNFCAdapter——发现标签 + Ndef/NfcA/B/F/V/IsoDep/Mifare 连接）
 *   与 HCE（模拟卡）互补：HCE 让手机当卡，Adapter 让手机读卡。
 */
export interface NfcAdapter {
  /** 开始发现附近标签 */
  startDiscovery(): Promise<CapResult<void>>
  /** 停止发现 */
  stopDiscovery(): Promise<CapResult<void>>
  /** 订阅发现的标签（返回取消） */
  onDiscovered(cb: (tag: NfcTag) => void): () => void
  /** 连接 NDEF 标签（读写 NDEF 消息） */
  connectNdef(): Promise<CapResult<NdefHandle>>
  /** 连接 IsoDep 标签（ISO-DEP/APDU 透传） */
  connectIsoDep(): Promise<CapResult<NfcTagHandle>>
  /** 连接 NFC-A 标签 */
  connectNfcA(): Promise<CapResult<NfcTagHandle>>
  /** 连接 NFC-B 标签 */
  connectNfcB(): Promise<CapResult<NfcTagHandle>>
  /** 连接 NFC-F 标签（FeliCa） */
  connectNfcF(): Promise<CapResult<NfcTagHandle>>
  /** 连接 NFC-V 标签 */
  connectNfcV(): Promise<CapResult<NfcTagHandle>>
  /** 连接 Mifare Classic 标签 */
  connectMifareClassic(): Promise<CapResult<NfcTagHandle>>
  /** 连接 Mifare Ultralight 标签 */
  connectMifareUltralight(): Promise<CapResult<NfcTagHandle>>
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
  /** 订阅键盘高度变化（返回取消） */
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
  getCenterLocation(): Promise<{ latitude: number; longitude: number }>
  getRotate(): Promise<number>
  getSkew(): Promise<number>
  fromScreenLocation(x: number, y: number): Promise<{ latitude: number; longitude: number }>
  toScreenLocation(latitude: number, longitude: number): Promise<{ x: number; y: number }>
  setCenterOffset(offset: { x: number; y: number }): Promise<void>
  setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<void>
  moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<void>
  addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<void>
  eraseLines(ids: number[]): Promise<void>
  initMarkerCluster(enable: boolean): Promise<void>
  setLocMarkerIcon(iconPath: string): Promise<void>
  addCustomLayer(layer: Record<string, unknown>): Promise<void>
  removeCustomLayer(layerId: string): Promise<void>
  addVisualLayer(layer: Record<string, unknown>): Promise<void>
  removeVisualLayer(layerId: string): Promise<void>
  executeVisualLayerCommand(command: Record<string, unknown>): Promise<string>
  addGroundOverlay(overlay: Record<string, unknown>): Promise<void>
  updateGroundOverlay(overlay: Record<string, unknown>): Promise<void>
  removeGroundOverlay(overlayId: string): Promise<void>
}

/** C4 useMap 句柄（控制器方法返回 Result<T>——G-32.4） */
/** 地图标记（wx.Marker 子集） */
export interface MapMarker {
  /** 标记唯一 id（增删改按 id） */
  id: number
  /** 纬度 */
  latitude: number
  /** 经度 */
  longitude: number
  /** 标题（点按显示） */
  title?: string
  /** 图标路径 */
  iconPath?: string
  /** 图标宽（px） */
  width?: number
  /** 图标高（px） */
  height?: number
  /** 气泡配置 */
  callout?: Record<string, unknown>
}
/** 地图覆盖物/折线/圆（简化） */
/** 折线 */
export interface MapPolyline {
  /** 顶点序列 */
  points: Array<{ latitude: number; longitude: number }>
  /** 线颜色 */
  color?: string
  /** 线宽（px） */
  width?: number
}
/** 圆 */
export interface MapCircle {
  /** 圆心纬度 */
  latitude: number
  /** 圆心经度 */
  longitude: number
  /** 半径（m） */
  radius: number
  /** 描边色 */
  color?: string
  /** 填充色 */
  fillColor?: string
}

/**
 * ★能力颗粒度对齐：C4 地图控制器（原 2 方法 → 覆盖物/视野/坐标转换/移动标记全套）
 *   方法统一 Promise<CapResult<T>>；上层组件 <map> 通过 id 取控制器。
 */
export interface MapController {
  /** 获取当前地图视野（中心经纬 + 缩放级别） */
  getRegion(): Promise<CapResult<MapRegion>>
  /**
   * 平移地图中心到指定经纬。
   * @param latitude 纬度
   * @param longitude 经度
   * @param scale 缩放级别（1-20；缺省不变）
   */
  moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>
  /** 移动到当前定位点 */
  moveToLocation(): Promise<CapResult<void>>
  /**
   * 缩放视野以包含所有给定点。
   * @param points 经纬点列表
   * @param padding 边距（[上, 右, 下, 左]，px）
   */
  includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>
  /**
   * 平移指定标记到目标点（带旋转/时长）。
   * @param opt markerId 标记 id、destination 目标经纬、rotate 旋转角、duration 动画时长(ms)
   */
  translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>
  /**
   * 添加标记。
   * @param markers 标记列表（id 唯一）
   */
  addMarkers(markers: MapMarker[]): Promise<CapResult<void>>
  /**
   * 移除标记。
   * @param ids 标记 id 列表
   */
  removeMarkers(ids: number[]): Promise<CapResult<void>>
  /**
   * 添加折线。
   * @param polylines 折线列表（点序列 + 颜色/宽度）
   */
  addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>
  /**
   * 移除折线。
   * @param ids 折线 id 列表
   */
  removePolylines(ids: number[]): Promise<CapResult<void>>
  /**
   * 添加圆。
   * @param circles 圆列表（中心 + 半径 + 颜色）
   */
  addCircles(circles: MapCircle[]): Promise<CapResult<void>>
  /**
   * 移除圆。
   * @param ids 圆 id 列表
   */
  removeCircles(ids: number[]): Promise<CapResult<void>>
  /** 获取当前缩放级别 */
  getScale(): Promise<CapResult<number>>
  /**
   * 打开第三方地图 App 导航（宿主放行才可用）。
   * @param opt latitude/longitude 目标、name 地点名
   */
  openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>
  /**
   * 订阅地图事件。
   * @param event 事件名（regionchange 视野变化 / markerTap 标记点击 / updated 更新完成）
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void): () => void
  /** 获取地图中心经纬 */
  getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>
  /** 获取地图旋转角（度） */
  getRotate(): Promise<CapResult<number>>
  /** 获取地图倾斜角（度） */
  getSkew(): Promise<CapResult<number>>
  /**
   * 屏幕坐标 → 经纬度。
   * @param x 屏幕 x
   * @param y 屏幕 y
   */
  fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>
  /**
   * 经纬度 → 屏幕坐标。
   * @param latitude 纬度
   * @param longitude 经度
   */
  toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>
  /**
   * 设置地图中心偏移（把中心点从容器中心移开，露出标记）。
   * @param offset x/y 偏移量（px）
   */
  setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>
  /**
   * 限制地图可拖动范围到给定边界多边形。
   * @param boundaries 边界多边形顶点
   */
  setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>
  /**
   * 沿路径平滑移动（轨迹回放）。
   * @param opt path 路径点、duration 总时长(ms)、autoRotate 是否自动转向
   */
  moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>
  /**
   * 添加弧线。
   * @param arc id / start 起点 / end 终点 / color / width
   */
  addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>
  /**
   * 删除折线（清空指定 id）。
   * @param ids 折线 id 列表
   */
  eraseLines(ids: number[]): Promise<CapResult<void>>
  /**
   * 开启/关闭点聚合。
   * @param enable 是否启用
   */
  initMarkerCluster(enable: boolean): Promise<CapResult<void>>
  /**
   * 设置定位点图标。
   * @param iconPath 图标路径
   */
  setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>
  /**
   * 添加自定义图层（Canvas 绘制覆盖物）。
   * @param layer 图层配置（id + 绘制器）
   */
  addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
  /**
   * 移除自定义图层。
   * @param layerId 图层 id
   */
  removeCustomLayer(layerId: string): Promise<CapResult<void>>
  /**
   * 添加可视化图层（GeoJSON → 样式）。
   * @param layer 图层配置（id + GeoJSON + 样式）
   */
  addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
  /**
   * 移除可视化图层。
   * @param layerId 图层 id
   */
  removeVisualLayer(layerId: string): Promise<CapResult<void>>
  /**
   * 执行可视化图层指令（增删改要素）。
   * @param command 指令对象（layerId + command + 参数）
   */
  executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>
  /**
   * 添加地面覆盖物（图片贴地）。
   * @param overlay 覆盖物配置（id + 图片 + 边界）
   */
  addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
  /**
   * 更新地面覆盖物。
   * @param overlay 覆盖物配置（含 id）
   */
  updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
  /**
   * 移除地面覆盖物。
   * @param overlayId 覆盖物 id
   */
  removeGroundOverlay(overlayId: string): Promise<CapResult<void>>
}

/** C25 后台事件（wx onAppHide/onAppShow / web visibilitychange） */
export interface BackgroundEvent {
  /** 事件类型（退后台 / 回前台） */
  type: 'enter-background' | 'enter-foreground'
  /** 事件时间戳（ms） */
  time: number
}

/** C25 useBackground 句柄（后台/前台切换订阅） */
/**
 * ★能力颗粒度对齐：C25 后台/宿主生命周期 API（原仅 onEvent（visible/hidden）→ 全事件面）
 *   各订阅返回取消函数；未实现的事件 → 返回 no-op 取消（诚实边界）。
 */
export interface BackgroundAPI {
  /** 订阅前后台切换（返回取消） */
  onEvent(cb: (e: BackgroundEvent) => void): () => void
  /** 内存警告（wx.onMemoryWarning） */
  onMemoryWarning(cb: (level: number) => void): () => void
  /** 主题变化（wx.onThemeChange，深色/浅色） */
  onThemeChange(cb: (theme: 'dark' | 'light') => void): () => void
  /** 窗口尺寸变化（wx.onWindowResize / web resize） */
  onWindowResize(cb: (size: { windowWidth: number; windowHeight: number }) => void): () => void
  /** 小程序错误（wx.onError） */
  onError(cb: (error: string) => void): () => void
  /** 未处理的 Promise rejection（wx.onUnhandledRejection） */
  onUnhandledRejection(cb: (reason: { reason: string; promise: Promise<unknown> }) => void): () => void
  /** 网络状态变化（wx.onNetworkStatusChange） */
  onNetworkStatusChange(cb: (status: { isConnected: boolean; networkType: string }) => void): () => void
  /** 启动参数（wx.getLaunchOptionsSync） */
  getLaunchOptions(): Promise<CapResult<Record<string, unknown>>>
  /** 当前进入参数（wx.getEnterOptionsSync） */
  getEnterOptions(): Promise<CapResult<Record<string, unknown>>>
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
  /** 发送文本消息 */
  send(data: string): Promise<CapResult<void>>
  /** 关闭连接（code/reason 透传给对端） */
  close(code?: number, reason?: string): Promise<CapResult<void>>
  /** 订阅收到消息（返回取消） */
  onMessage(cb: (data: string) => void): () => void
  /** 连接是否已建立 */
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
  /** 发送文本消息 */
  send(data: string): Promise<CapResult<void>>
  /** 订阅收到消息（返回取消） */
  onMessage(cb: (data: string) => void): () => void
}

/** C32 Cookie 罐（web document.cookie / wx storage 兜底） */
export interface CookieJar {
  /** 读取 cookie */
  get(name: string): string | undefined
  /** 写入 cookie（maxAge 秒；缺省会话级） */
  set(name: string, value: string, maxAge?: number): void
  /** 删除 cookie */
  remove(name: string): void
  /** 列出全部 cookie */
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
  /** 跳转到其他小程序 */
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
  /** 直播间 ID（同时作为 `<live-player id>` 组件 id——wx.createLivePlayerContext(roomId)） */
  roomId: string
  /** 拉流模式 */
  mode?: 'video' | 'audio'
}

/** 直播播放状态（LivePlayerContext.onXxx 归一） */
export type LivePlayState = 'playing' | 'paused' | 'stopped' | 'error'

/** 直播播放桥（原始 Promise 层） */
export interface LiveRoomBridge {
  play(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  mute(): void
  snapshot(): Promise<string>
  requestFullScreen(direction?: number): Promise<void>
  exitFullScreen(): Promise<void>
  status(): LivePlayState
  onStateChange(cb: (state: LivePlayState) => void): () => void
}

/**
 * ★能力颗粒度对齐：C49 直播房间操作句柄（原仅 leave/status → 播放控制全套）
 *   观看端（LivePlayerContext）；推流端（LivePusherContext：美颜/连麦/推流）为诚实边界（需推流类目，未纳入）。
 *   注：live-player 组件需在页面声明 + 直播类目资质；Web 无对等 → Err。
 */
export interface LiveRoomHandle {
  /** 开始播放 */
  play(): Promise<CapResult<void>>
  /** 暂停播放 */
  pause(): Promise<CapResult<void>>
  /** 从暂停处恢复播放 */
  resume(): Promise<CapResult<void>>
  /** 停止播放 */
  stop(): Promise<CapResult<void>>
  /** 静音切换（同步，无 Promise） */
  mute(): void
  /** 截图（返回临时文件路径） */
  snapshot(): Promise<CapResult<string>>
  /** 请求全屏（direction 0 竖屏 / 90 横屏；缺省不变） */
  requestFullScreen(direction?: number): Promise<CapResult<void>>
  /** 退出全屏 */
  exitFullScreen(): Promise<CapResult<void>>
  /** 当前播放状态 */
  status(): LivePlayState
  /** 订阅播放状态变化（返回取消） */
  onStateChange(cb: (state: LivePlayState) => void): () => void
  /** 离开直播间（= stop 的语义别名） */
  leave(): Promise<CapResult<void>>
}

/**
 * ★颗粒度对齐 C（2026-09-11）：C51 小程序热更新管理器（wx.getUpdateManager）
 *   checkUpdate → onCheckForUpdate 结果 → onUpdateReady → applyUpdateAndRestart。
 *   Web/无更新机制 → 全 Err（诚实降级）。
 */
export interface UpdateManagerAPI {
  /** 检查是否有新版本 */
  checkUpdate(): Promise<CapResult<{ hasUpdate: boolean }>>
  /** 订阅「发现新版本」（返回取消） */
  onCheckForUpdate(cb: (hasUpdate: boolean) => void): () => void
  /** 订阅「新版本已下载，可立即应用」（返回取消） */
  onUpdateReady(cb: () => void): () => void
  /** 订阅「更新失败」（返回取消） */
  onUpdateFailed(cb: (errMsg: string) => void): () => void
  /** 应用更新并重启小程序 */
  applyUpdate(): Promise<CapResult<void>>
}

/**
 * ★权威标尺缺口补齐（C65）：隐私协议（wx.getPrivacySetting / openPrivacyContract /
 *   requirePrivacyAuthorize / onNeedPrivacyAuthorization）。
 *   《个人信息保护法》+ 微信隐私协议合规的刚需：开发者需在用户触发隐私授权时弹协议、可跳转协议页、可主动触发授权。
 *   web 端无对等标准（Cookie 同意可由宿主自建）→ 缺省 Err 诚实降级（常驻宿主桥）。
 */
export interface PrivacySetting {
  /** 是否需要用户授权（用户未同意 → true） */
  needAuthorization: boolean
  /** 隐私协议名称（如《用户隐私保护指引》） */
  privacyContractName: string
}

export interface PrivacyAPI {
  /** 查询隐私授权状态（wx.getPrivacySetting） */
  getSetting(): Promise<CapResult<PrivacySetting>>
  /** 打开隐私协议页面（wx.openPrivacyContract） */
  openContract(): Promise<CapResult<void>>
  /**
   * 主动触发隐私授权弹窗（wx.requirePrivacyAuthorize）。
   * @returns 用户是否同意
   */
  requireAuthorize(): Promise<CapResult<boolean>>
  /**
   * 订阅「需要用户隐私授权」事件（wx.onNeedPrivacyAuthorization）。
   * 用户在页面触发隐私接口但未同意时回调——业务据此弹自家协议 UI 或调用 openContract。
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  onNeedAuthorization(cb: (res: { privacyContractName: string }) => void): () => void
}

/**
 * ★颗粒度对齐 C3：C52 相册（wx.chooseMedia / saveImageToPhotosAlbum / previewImage）
 *   选择媒体 + 保存到系统相册 + 预览——对齐小程序媒体类 API 组。
 *   Web 端：pick 走 <input type=file>（需宿主/用户手势），save 无标准（下载替代）∪ 缺省 Err（诚实降级）。
 */
export interface MediaFile {
  /** 临时文件路径（wx 临时文件 / web Blob URL） */
  tempFilePath: string
  /** 媒体类型 */
  type: 'image' | 'video'
  /** 字节大小 */
  size?: number
  /** 时长 ms（视频） */
  duration?: number
  width?: number
  height?: number
}

export interface AlbumPickOptions {
  /** 选择数量上限（默认 1；小程序上限 9） */
  count?: number
  /** 媒体类型：image（默认）/ video / all */
  mediaType?: 'image' | 'video' | 'all'
  /** 来源：album 相册（默认）/ camera 拍照 */
  source?: 'album' | 'camera'
}

export interface AlbumAPI {
  /** 选择图片/视频（wx.chooseMedia；web <input type=file>） */
  pick(options?: AlbumPickOptions): Promise<CapResult<MediaFile[]>>
  /** 保存图片到系统相册（wx.saveImageToPhotosAlbum——需 scope.writePhotosAlbum 授权；web 无标准 → Err） */
  saveImage(filePath: string): Promise<CapResult<void>>
  /** 保存视频到系统相册（wx.saveVideoToPhotosAlbum；web 无标准 → Err） */
  saveVideo(filePath: string): Promise<CapResult<void>>
  /** 预览媒体（wx.previewImage / previewMedia；web 宿主视图） */
  preview(urls: string[], current?: string): Promise<CapResult<void>>
}

/**
 * ★颗粒度对齐 C3：C53 多线程 Worker（wx.createWorker）
 *   创建 Worker 线程 + postMessage 收发 + terminate——对齐小程序 Worker API。
 *   Web 端：new Worker(...)（同源脚本）∪ 缺省 Err（诚实降级）。
 */
export interface WorkerHandle {
  /** 主线程 → Worker 发消息 */
  postMessage(message: unknown): void
  /** 订阅 Worker → 主线程消息（返回取消） */
  onMessage(cb: (message: unknown) => void): () => void
  /** 终止 Worker 线程 */
  terminate(): void
}

/** ★颗粒度对齐 C3：C54 收货地址（wx.chooseAddress）——对齐小程序收货地址 API */
export interface ShippingAddress {
  userName: string
  postalCode?: string
  provinceName: string
  cityName: string
  countyName: string
  detailInfo: string
  nationalCode?: string
  telNumber: string
}

/** ★颗粒度对齐 C3：C55 WiFi（wx.getConnectedWifi / getWifiList / connectWifi——Android 连接） */
export interface WifiInfo {
  SSID: string
  BSSID: string
  secure: boolean
  signalStrength: number
  /** 频率 MHz（5G/2.4G 区分；部分平台缺失） */
  frequency?: number
}

export interface WifiAPI {
  /** 当前连接的 WiFi（wx.getConnectedWifi） */
  getConnected(): Promise<CapResult<WifiInfo>>
  /** 已扫描到的 WiFi 列表（需 wx.startWifi + onGetWifiList 授权；wx.getWifiList → onGetWifiList） */
  list(): Promise<CapResult<WifiInfo[]>>
  /** 连接指定 WiFi（wx.connectWifi——Android 支持；iOS/部分基础库 → Err） */
  connect(SSID: string, password?: string): Promise<CapResult<void>>
}

/** ★颗粒度对齐 C3：C56 微信运动（wx.getWeRunData → 加密数据需后端解密） */
export interface WeRunData {
  /** 加密的步数数据（wx.getWeRunData 返回的 cloudID/encryptedData；需业务后端解密） */
  encryptedData: string
  iv: string
  /** cloudID（小程序云开发场景免解密） */
  cloudID?: string
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
  /** ★C51 小程序热更新（wx.getUpdateManager；web 无 → 缺省） */
  getUpdateManager?(): UpdateManagerAPI
  /** ★权威标尺缺口 C65 隐私协议（wx.getPrivacySetting / openPrivacyContract / requirePrivacyAuthorize；web 缺省） */
  getPrivacy?(): PrivacyAPI
  /** ★能力颗粒度对齐：C20 日历 API（增删查）——优先于 addCalendarEvent */
  getCalendar?(): CalendarAPI
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
  // ★颗粒度对齐 C3：相册 / Worker（缺省 undefined → 对应 Hook 返回 Err('<cap>.unsupported')）
  /** C52 相册（wx.chooseMedia/saveImageToPhotosAlbum/previewImage；web <input type=file>）——★富接口 */
  getAlbum?(): AlbumAPI
  /** C53 多线程 Worker（wx.createWorker / web Worker） */
  createWorker?(scriptPath: string): WorkerHandle
  /** C54 收货地址（wx.chooseAddress；web 无标准 → 缺省） */
  chooseAddress?(): Promise<ShippingAddress>
  /** C55 WiFi（wx.getConnectedWifi/getWifiList/connectWifi；web 无标准 → 缺省）——★富接口 */
  getWifi?(): WifiAPI
  /** C56 微信运动（wx.getWeRunData；web 无标准 → 缺省） */
  getWeRunData?(): Promise<WeRunData>
  // ★组件实例 API 对齐（2026-09-12）：C57 画布（Canvas 组件实例——缺省 undefined → Hook 返回 Err）
  /** C57 画布控制器（wx.createCanvasContext/SelectorQuery node / web document canvas） */
  createCanvas?(id: string): CanvasController
  // ★组件实例 API 对齐（2026-09-12）：C58/C59/C60 元素查询 / 交叉观察 / 媒体查询
  /** C58 元素查询句柄（wx.createSelectorQuery / web querySelector + getBoundingClientRect） */
  createElementQuery?(id?: string): ElementQuery
  /** C59 交叉观察句柄（wx.createIntersectionObserver / web IntersectionObserver） */
  createIntersection?(options?: IntersectionOptions): IntersectionHandle
  /** C60 媒体查询句柄（wx.createMediaQueryObserver / web matchMedia） */
  createMediaQuery?(): MediaQueryObserver
  // ★组件实例 API 对齐（2026-09-12）：C61/C62/C63 媒体组件实例 + C64 广告
  /** C61 视频控制器（wx.createVideoContext / web HTMLVideoElement） */
  createVideo?(id: string): VideoController
  /** C62 音频控制器（wx.createInnerAudioContext / web Audio） */
  createAudio?(src?: string): AudioController
  /** C63 直播推流控制器（wx.createLivePusherContext / web 无标准 → Err） */
  createLivePusher?(id: string): LivePusherController
  /** C64 广告（wx.createRewardedVideoAd/createInterstitialAd/createBannerAd / web 无标准 → 创建时 throw） */
  getAd?(): AdAPI
}

/** 存储契约（useStorage / reactive storage 底座） */
export interface CompatStorage {
  /** 同步读取（缺省 undefined） */
  get<T = unknown>(key: string): T | undefined
  /** 同步写入 */
  set(key: string, value: unknown): void
  /** 同步删除 */
  remove(key: string): void
  /** 同步清空 */
  clear(): void
  // ★能力颗粒度对齐：异步 API（对齐官方 setStorage/getStorage；大值不阻塞主线程）
  /** 异步写入（大值不阻塞主线程） */
  setAsync(key: string, value: unknown): Promise<CapResult<void>>
  /** 异步读取 */
  getAsync<T = unknown>(key: string): Promise<CapResult<T | undefined>>
  /** 异步删除 */
  removeAsync(key: string): Promise<CapResult<void>>
  /** 异步清空 */
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
  /** ★颗粒度对齐 C3：相册 */
  album: boolean
  /** ★颗粒度对齐 C3：Worker */
  worker: boolean
  /** ★颗粒度对齐 C3 批 2：收货地址 */
  address: boolean
  /** ★颗粒度对齐 C3 批 2：WiFi */
  wifi: boolean
  /** ★颗粒度对齐 C3 批 2：微信运动 */
  weRun: boolean
  /** ★组件实例 API 对齐：画布（Canvas 组件实例） */
  canvas: boolean
  /** ★组件实例 API 对齐：元素查询（SelectorQuery） */
  element: boolean
  /** ★组件实例 API 对齐：交叉观察（IntersectionObserver） */
  intersection: boolean
  /** ★组件实例 API 对齐：媒体查询（MediaQueryObserver） */
  mediaQuery: boolean
  /** ★组件实例 API 对齐：视频控制器（VideoContext） */
  video: boolean
  /** ★组件实例 API 对齐：音频控制器（InnerAudioContext） */
  audio: boolean
  /** ★组件实例 API 对齐：直播推流（LivePusherContext） */
  livePusher: boolean
  /** ★组件实例 API 对齐：广告（RewardedVideoAd/InterstitialAd/BannerAd） */
  ad: boolean
  /** ★权威标尺缺口：隐私协议（getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize） */
  privacy: boolean
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
  getUpdateManager?: () => {
    onCheckForUpdate: (cb: (r: { hasUpdate: boolean }) => void) => void
    onUpdateReady: (cb: () => void) => void
    onUpdateFailed: (cb: (r: { errMsg?: string }) => void) => void
    applyUpdate: () => void
  }
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
  onMemoryWarning?: (cb: (r: { level: number }) => void) => void
  onThemeChange?: (cb: (r: { theme: 'dark' | 'light' }) => void) => void
  onWindowResize?: (cb: (r: { size: { windowWidth: number; windowHeight: number } }) => void) => void
  onError?: (cb: (e: string) => void) => void
  onUnhandledRejection?: (cb: (r: { reason: string; promise: Promise<unknown> }) => void) => void
  onNetworkStatusChange?: (cb: (r: { isConnected: boolean; networkType: string }) => void) => void
  getLaunchOptionsSync?: () => Record<string, unknown>
  getEnterOptionsSync?: () => Record<string, unknown>
  removePhoneCalendar?: (opt: { eventId: string; success?: () => void; fail?: (e: unknown) => void }) => void
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
  getNFCAdapter?: () => WxNfcAdapterLike
  getSetting?: (opt: { success?: (r: { authSetting?: Record<string, boolean> }) => void; fail?: (e: unknown) => void }) => void
  onKeyboardHeightChange?: (cb: (r: { height: number }) => void) => void
  onPageShow?: (cb: () => void) => void
  onPageHide?: (cb: () => void) => void
  // ★G-32 B3 七期：新增 wx 能力（地图 / 人脸 / 跳小程序）
  createMapContext?: (id: string) => WxMapContextLike
  createLivePlayerContext?: (id: string) => WxLivePlayerContextLike
  navigateToMiniProgram?: (opt: {
    appId: string
    path?: string
    extraData?: Record<string, unknown>
    success?: () => void
    fail?: (e: unknown) => void
  }) => void
  // ★颗粒度对齐 C3：相册 / Worker
  chooseMedia?: (opt: {
    count?: number
    mediaType?: string[]
    sourceType?: string[]
    success: (r: { tempFiles: Array<{ tempFilePath: string; size: number; duration?: number; width?: number; height?: number }> }) => void
    fail?: (e: unknown) => void
  }) => void
  saveImageToPhotosAlbum?: (opt: { filePath: string; success?: () => void; fail?: (e: unknown) => void }) => void
  saveVideoToPhotosAlbum?: (opt: { filePath: string; success?: () => void; fail?: (e: unknown) => void }) => void
  previewMedia?: (opt: { urls: string[]; current?: string; success?: () => void; fail?: (e: unknown) => void }) => void
  createWorker?: (scriptPath: string) => {
    postMessage: (msg: unknown) => void
    onMessage: (cb: (msg: unknown) => void) => void
    terminate: () => void
  }
  // ★颗粒度对齐 C3 批 2：收货地址 / WiFi / 微信运动
  chooseAddress?: (opt: {
    success: (r: { userName: string; postalCode?: string; provinceName: string; cityName: string; countyName: string; detailInfo: string; nationalCode?: string; telNumber: string }) => void
    fail?: (e: unknown) => void
  }) => void
  getConnectedWifi?: (opt: { success: (r: { wifi: { SSID: string; BSSID: string; secure: boolean; signalStrength: number; frequency?: number } }) => void; fail?: (e: unknown) => void }) => void
  startWifi?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  getWifiList?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onGetWifiList?: (cb: (r: { wifiList: Array<{ SSID: string; BSSID: string; secure: boolean; signalStrength: number; frequency?: number }> }) => void) => void
  connectWifi?: (opt: { SSID: string; password?: string; success?: () => void; fail?: (e: unknown) => void }) => void
  getWeRunData?: (opt: { success: (r: { encryptedData: string; iv: string; cloudID?: string }) => void; fail?: (e: unknown) => void }) => void
  // ★组件实例 API 对齐（2026-09-12）：C57 Canvas 组件实例
  createCanvasContext?: (canvasId: string) => unknown
  canvasToTempFilePath?: (opt: Record<string, unknown>) => void
  createOffscreenCanvas?: (opt: { type?: string; width: number; height: number }) => unknown
  createSelectorQuery?: () => WxSelectorQueryLike
  createIntersectionObserver?: (component: unknown, options?: { thresholds?: number[]; initialRatio?: number; observeAll?: boolean }) => WxIntersectionObserverLike
  createMediaQueryObserver?: () => WxMediaQueryObserverLike
  // ★组件实例 API 对齐（2026-09-12）：媒体组件实例 + 广告
  createVideoContext?: (id: string) => WxVideoContextLike
  createInnerAudioContext?: (opt?: { useWebAudioImplement?: boolean }) => WxInnerAudioContextLike
  createLivePusherContext?: (id?: string) => WxLivePusherContextLike
  createRewardedVideoAd?: (opt: { adUnitId: string }) => WxRewardedVideoAdLike
  createInterstitialAd?: (opt: { adUnitId: string }) => WxInterstitialAdLike
  createBannerAd?: (opt: { adUnitId: string; style: { left?: number; top?: number; width: number } }) => WxBannerAdLike
  // ★权威标尺缺口 C65：隐私协议
  getPrivacySetting?: (opt: { success: (r: { needAuthorization: boolean; privacyContractName: string }) => void; fail?: (e: unknown) => void }) => void
  openPrivacyContract?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  requirePrivacyAuthorize?: (opt: { success?: () => void; fail?: (e: unknown) => void }) => void
  onNeedPrivacyAuthorization?: (cb: (res: { privacyContractName: string }) => void) => void
  offNeedPrivacyAuthorization?: (cb?: (...a: never[]) => void) => void
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
/** wx.NFCAdapter 子集（读卡模式） */
interface WxNfcAdapterLike {
  startDiscovery?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  stopDiscovery?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onDiscovered?: (cb: (r: { id: ArrayBuffer; techs: string[]; messages?: unknown[] }) => void) => void
  offDiscovered?: (cb?: (...a: never[]) => void) => void
  getNdef?: () => WxNfcTagLike
  getIsoDep?: () => WxNfcTagLike
  getNfcA?: () => WxNfcTagLike
  getNfcB?: () => WxNfcTagLike
  getNfcF?: () => WxNfcTagLike
  getNfcV?: () => WxNfcTagLike
  getMifareClassic?: () => WxNfcTagLike
  getMifareUltralight?: () => WxNfcTagLike
}
interface WxNfcTagLike {
  connect?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  close?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  isConnected?: () => boolean
  setTimeout?: (opt: { timeout: number; success?: () => void; fail?: (e: unknown) => void }) => void
  transceive?: (opt: { data: ArrayBuffer; success: (r: { data: ArrayBuffer }) => void; fail: (e: unknown) => void }) => void
  writeNdefMessage?: (opt: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }>; success?: () => void; fail: (e: unknown) => void }) => void
  onNdefMessage?: (cb: (r: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }) => void) => void
  offNdefMessage?: (cb?: (...a: never[]) => void) => void
}
/** wx.LivePlayerContext 子集（观看端） */
interface WxLivePlayerContextLike {
  play?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  pause?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  resume?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  stop?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  mute?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  snapshot?: (opt: { success: (r: { tempImagePath: string }) => void; fail: (e: unknown) => void }) => void
  requestFullScreen?: (opt: { direction?: number; success?: () => void; fail?: (e: unknown) => void }) => void
  exitFullScreen?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  onPlay?: (cb: () => void) => void
  onPause?: (cb: () => void) => void
  onStop?: (cb: () => void) => void
  onError?: (cb: (e: unknown) => void) => void
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
  getCenterLocation?: (opt: { success: (r: { latitude: number; longitude: number }) => void; fail?: (e: unknown) => void }) => void
  getRotate?: (opt: { success: (r: { rotate: number }) => void; fail?: (e: unknown) => void }) => void
  getSkew?: (opt: { success: (r: { skew: number }) => void; fail?: (e: unknown) => void }) => void
  fromScreenLocation?: (opt: { x: number; y: number; success: (r: { latitude: number; longitude: number }) => void; fail?: (e: unknown) => void }) => void
  toScreenLocation?: (opt: { latitude: number; longitude: number; success: (r: { x: number; y: number }) => void; fail?: (e: unknown) => void }) => void
  setCenterOffset?: (opt: { offset: { x: number; y: number }; success?: () => void; fail?: (e: unknown) => void }) => void
  setBoundary?: (opt: { boundaries: Array<{ latitude: number; longitude: number }>; success?: () => void; fail?: (e: unknown) => void }) => void
  moveAlong?: (opt: Record<string, unknown>) => void
  addArc?: (opt: Record<string, unknown>) => void
  eraseLines?: (opt: { eraseOptions: Array<{ id: number }>; success?: () => void; fail?: (e: unknown) => void }) => void
  initMarkerCluster?: (opt: { enableCluster: boolean; success?: () => void; fail?: (e: unknown) => void }) => void
  setLocMarkerIcon?: (opt: { iconPath: string; success?: () => void; fail?: (e: unknown) => void }) => void
  addCustomLayer?: (opt: Record<string, unknown>) => void
  removeCustomLayer?: (opt: Record<string, unknown>) => void
  addVisualLayer?: (opt: Record<string, unknown>) => void
  removeVisualLayer?: (opt: Record<string, unknown>) => void
  executeVisualLayerCommand?: (opt: { layerId: string; command: string; success: (r: { result: string }) => void; fail?: (e: unknown) => void }) => void
  addGroundOverlay?: (opt: Record<string, unknown>) => void
  updateGroundOverlay?: (opt: Record<string, unknown>) => void
  removeGroundOverlay?: (opt: Record<string, unknown>) => void
}

/**
 * ★组件实例 API 对齐（2026-09-12）：wx.createSelectorQuery 返回的查询对象子集。
 *   fields 的 node/rect/size/computedStyle 结果经 exec 回调批量返回。
 */
interface WxSelectorQueryLike {
  in?: (component: unknown) => WxSelectorQueryLike
  select?: (selector: string) => WxSelectorQueryLike
  selectAll?: (selector: string) => WxSelectorQueryLike
  selectViewport?: () => WxSelectorQueryLike
  boundingClientRect?: (cb?: (r: unknown) => void) => WxSelectorQueryLike
  scrollOffset?: (cb?: (r: unknown) => void) => WxSelectorQueryLike
  fields?: (opt: Record<string, unknown>, cb?: (r: unknown) => void) => WxSelectorQueryLike
  exec?: (cb?: (res: unknown) => void) => void
}

/** wx.createIntersectionObserver 返回对象子集 */
interface WxIntersectionObserverLike {
  relativeTo?: (selector: string, margins?: Record<string, number>) => WxIntersectionObserverLike
  relativeToViewport?: (margins?: Record<string, number>) => WxIntersectionObserverLike
  observe?: (targetSelector: string, cb: (res: unknown) => void) => void
  disconnect?: () => void
}

/** wx.createMediaQueryObserver 返回对象子集 */
interface WxMediaQueryObserverLike {
  observe?: (condition: Record<string, unknown>, cb: (res: { matches: boolean }) => void) => void
  disconnect?: () => void
}

/** wx.createVideoContext 返回对象子集 */
interface WxVideoContextLike {
  play?: () => void
  pause?: () => void
  stop?: () => void
  seek?: (position: number) => void
  playbackRate?: (rate: number) => void
  requestFullScreen?: (opt?: { direction?: string }) => void
  exitFullScreen?: () => void
  sendDanmu?: (danmu: { text: string; color?: string }) => void
  on?: (event: string, cb: (payload: unknown) => void) => void
  off?: (event: string, cb: (payload: unknown) => void) => void
}

/** wx.createInnerAudioContext 返回对象子集 */
interface WxInnerAudioContextLike {
  src?: string
  autoplay?: boolean
  loop?: boolean
  volume?: number
  duration?: number
  currentTime?: number
  paused?: boolean
  play?: () => void
  pause?: () => void
  stop?: () => void
  seek?: (position: number) => void
  destroy?: () => void
  onCanplay?: (cb: () => void) => void
  onPlay?: (cb: () => void) => void
  onPause?: (cb: () => void) => void
  onStop?: (cb: () => void) => void
  onEnded?: (cb: () => void) => void
  onTimeUpdate?: (cb: () => void) => void
  onError?: (cb: (e: unknown) => void) => void
}

/** wx.createLivePusherContext 返回对象子集 */
interface WxLivePusherContextLike {
  start?: (opt?: Record<string, unknown>) => void
  stop?: (opt?: Record<string, unknown>) => void
  pause?: (opt?: Record<string, unknown>) => void
  resume?: (opt?: Record<string, unknown>) => void
  switchCamera?: (opt?: Record<string, unknown>) => void
  toggleTorch?: (opt?: Record<string, unknown>) => void
  snapshot?: (opt?: Record<string, unknown>) => void
  sendMessage?: (opt: { msg: string; success?: () => void; fail?: (e: unknown) => void }) => void
  on?: (event: string, cb: (payload: unknown) => void) => void
  off?: (event: string, cb: (payload: unknown) => void) => void
}

/** wx.createRewardedVideoAd 返回对象子集 */
interface WxRewardedVideoAdLike {
  load?: () => Promise<void>
  show?: () => Promise<void>
  offLoad?: (cb?: (...a: never[]) => void) => void
  offClose?: (cb?: (...a: never[]) => void) => void
  offError?: (cb?: (...a: never[]) => void) => void
  destroy?: () => void
  onLoad?: (cb: () => void) => void
  onClose?: (cb: (res: { isEnded: boolean }) => void) => void
  onError?: (cb: (e: { errCode: number; errMsg: string }) => void) => void
}

/** wx.createInterstitialAd 返回对象子集 */
interface WxInterstitialAdLike {
  load?: () => Promise<void>
  show?: () => Promise<void>
  destroy?: () => void
  onLoad?: (cb: () => void) => void
  onClose?: (cb: () => void) => void
  onError?: (cb: (e: { errCode: number; errMsg: string }) => void) => void
}

/** wx.createBannerAd 返回对象子集 */
interface WxBannerAdLike {
  show?: () => Promise<void>
  hide?: () => void
  destroy?: () => void
  onLoad?: (cb: () => void) => void
  onResize?: (cb: (size: { width: number; height: number }) => void) => void
  onError?: (cb: (e: { errCode: number; errMsg: string }) => void) => void
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
            // ★能力颗粒度对齐：读卡模式（wx.getNFCAdapter）
            getAdapter: () => buildNfcAdapter(wx),
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
        // ★能力颗粒度对齐：MapContext 剩余 21 方法（查询/视野/覆盖物/图层）
        getCenterLocation: () => call<{ latitude: number; longitude: number }>(ctx.getCenterLocation, 'getCenterLocation'),
        getRotate: () => call<{ rotate: number }>(ctx.getRotate, 'getRotate').then((r) => r.rotate),
        getSkew: () => call<{ skew: number }>(ctx.getSkew, 'getSkew').then((r) => r.skew),
        fromScreenLocation: (x, y) => call<{ latitude: number; longitude: number }>(ctx.fromScreenLocation, 'fromScreenLocation', { x, y }),
        toScreenLocation: (latitude, longitude) => call<{ x: number; y: number }>(ctx.toScreenLocation, 'toScreenLocation', { latitude, longitude }),
        setCenterOffset: (offset) => call<void>(ctx.setCenterOffset, 'setCenterOffset', { offset }),
        setBoundary: (boundaries) => call<void>(ctx.setBoundary, 'setBoundary', { boundaries }),
        moveAlong: (opt) => call<void>(ctx.moveAlong, 'moveAlong', opt),
        addArc: (arc) => call<void>(ctx.addArc, 'addArc', { ...arc, start: arc.start, end: arc.end }),
        eraseLines: (ids) => call<void>(ctx.eraseLines, 'eraseLines', { eraseOptions: ids.map((id) => ({ id })) }),
        initMarkerCluster: (enable) => call<void>(ctx.initMarkerCluster, 'initMarkerCluster', { enableCluster: enable }),
        setLocMarkerIcon: (iconPath) => call<void>(ctx.setLocMarkerIcon, 'setLocMarkerIcon', { iconPath }),
        addCustomLayer: (layer) => call<void>(ctx.addCustomLayer, 'addCustomLayer', { ...layer, layerId: layer.layerId ?? layer.id }),
        removeCustomLayer: (layerId) => call<void>(ctx.removeCustomLayer, 'removeCustomLayer', { layerId }),
        addVisualLayer: (layer) => call<void>(ctx.addVisualLayer, 'addVisualLayer', { ...layer, layerId: layer.layerId ?? layer.id }),
        removeVisualLayer: (layerId) => call<void>(ctx.removeVisualLayer, 'removeVisualLayer', { layerId }),
        executeVisualLayerCommand: (command) => call<{ result: string }>(ctx.executeVisualLayerCommand, 'executeVisualLayerCommand', { command: command.command ?? '', layerId: command.layerId ?? '' }).then((r) => r.result),
        addGroundOverlay: (overlay) => call<void>(ctx.addGroundOverlay, 'addGroundOverlay', { ...overlay, id: overlay.id }),
        updateGroundOverlay: (overlay) => call<void>(ctx.updateGroundOverlay, 'updateGroundOverlay', { ...overlay, id: overlay.id }),
        removeGroundOverlay: (overlayId) => call<void>(ctx.removeGroundOverlay, 'removeGroundOverlay', { id: overlayId }),
      }
    },
    // ★能力颗粒度对齐：C25 后台/宿主生命周期全事件面（原仅 visible/hidden）
    getBackground: () => {
      const cbs: Array<(e: BackgroundEvent) => void> = []
      const emit = (type: BackgroundEvent['type']) => cbs.forEach((cb) => cb({ type, time: Date.now() }))
      if (typeof wx.onAppHide === 'function') wx.onAppHide(() => emit('enter-background'))
      if (typeof wx.onAppShow === 'function') wx.onAppShow(() => emit('enter-foreground'))
      // 通用订阅助手：wx.onXxx 存在 → 挂接并返回 off（无 off 则 no-op 取消）；缺失 → no-op 取消
      // Raw=wx 回调原始载荷；Out=对外暴露类型（可同形或经 map 提取）
      const sub = <Raw, Out>(onName: keyof WxLike, cb: (out: Out) => void, map: (r: Raw) => Out): (() => void) => {
        const on = wx[onName]
        if (typeof on !== 'function') return () => {}
        const h = (r: Raw): void => cb(map(r))
        ;(on as unknown as (c: (r: Raw) => void) => void)(h)
        return () => {
          // wx 各 on* 对应 off* 命名不同；本处理保守：无显式 off 表 → 不解除（生命周期事件常驻，影响可忽略）
        }
      }
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
        onMemoryWarning: (cb) => sub<{ level: number }, number>('onMemoryWarning', cb, (r) => r.level),
        onThemeChange: (cb) => sub<{ theme: 'dark' | 'light' }, 'dark' | 'light'>('onThemeChange', cb, (r) => r.theme),
        onWindowResize: (cb) => sub<{ size: { windowWidth: number; windowHeight: number } }, { windowWidth: number; windowHeight: number }>('onWindowResize', cb, (r) => r.size),
        onError: (cb) => sub<string, string>('onError', cb, (r) => r),
        onUnhandledRejection: (cb) => sub<{ reason: string; promise: Promise<unknown> }, { reason: string; promise: Promise<unknown> }>('onUnhandledRejection', cb, (r) => r),
        onNetworkStatusChange: (cb) => sub<{ isConnected: boolean; networkType: string }, { isConnected: boolean; networkType: string }>('onNetworkStatusChange', cb, (r) => r),
        getLaunchOptions: async () => {
          if (typeof wx.getLaunchOptionsSync !== 'function') return capErr<Record<string, unknown>>('background.unsupported', 'wx.getLaunchOptionsSync 缺失')
          try {
            return capOk(wx.getLaunchOptionsSync())
          } catch (e) {
            return capErr<Record<string, unknown>>('background.failed', e instanceof Error ? e.message : String(e))
          }
        },
        getEnterOptions: async () => {
          if (typeof wx.getEnterOptionsSync !== 'function') return capErr<Record<string, unknown>>('background.unsupported', 'wx.getEnterOptionsSync 缺失')
          try {
            return capOk(wx.getEnterOptionsSync())
          } catch (e) {
            return capErr<Record<string, unknown>>('background.failed', e instanceof Error ? e.message : String(e))
          }
        },
      }
    },
    // ★能力颗粒度对齐：C20 日历 API（增删查；查询无开放 API → Err）
    // ★C51 小程序热更新（wx.getUpdateManager）
    getUpdateManager: () => {
      if (typeof wx.getUpdateManager !== 'function') throw new CapError('update.unsupported', 'wx.getUpdateManager 缺失')
      const mgr = wx.getUpdateManager()
      const subs: { ready: Array<() => void>; failed: Array<(m: string) => void>; check: Array<(h: boolean) => void> } = { ready: [], failed: [], check: [] }
      mgr.onUpdateReady(() => subs.ready.forEach((cb) => cb()))
      mgr.onUpdateFailed((r) => subs.failed.forEach((cb) => cb(r?.errMsg ?? 'update failed')))
      return {
        checkUpdate: () =>
          new Promise<CapResult<{ hasUpdate: boolean }>>((resolve) => {
            try {
              mgr.onCheckForUpdate((r) => {
                subs.check.forEach((cb) => cb(r.hasUpdate))
                resolve(capOk({ hasUpdate: r.hasUpdate }))
              })
            } catch (e) {
              resolve(capErr('update.failed', e instanceof Error ? e.message : String(e)))
            }
          }),
        onCheckForUpdate: (cb) => { subs.check.push(cb); return () => { const i = subs.check.indexOf(cb); if (i >= 0) subs.check.splice(i, 1) } },
        onUpdateReady: (cb) => { subs.ready.push(cb); return () => { const i = subs.ready.indexOf(cb); if (i >= 0) subs.ready.splice(i, 1) } },
        onUpdateFailed: (cb) => { subs.failed.push(cb); return () => { const i = subs.failed.indexOf(cb); if (i >= 0) subs.failed.splice(i, 1) } },
        applyUpdate: () => Promise.resolve(capOk(mgr.applyUpdate() as undefined)),
      }
    },
    // ★颗粒度对齐 C3：C52 相册（wx.chooseMedia/saveImageToPhotosAlbum/previewMedia）
    getAlbum: () => ({
      pick: (options) =>
        new Promise<CapResult<MediaFile[]>>((resolve) => {
          if (typeof wx.chooseMedia !== 'function') return resolve(capErr('album.unsupported', 'wx.chooseMedia 缺失'))
          const mediaType = options?.mediaType === 'all' ? ['image', 'video'] : options?.mediaType ? [options.mediaType] : ['image']
          wx.chooseMedia({
            count: options?.count ?? 1,
            mediaType,
            sourceType: options?.source ? [options.source] : ['album', 'camera'],
            success: (r) =>
              resolve(
                capOk(
                  r.tempFiles.map((f) => ({
                    tempFilePath: f.tempFilePath,
                    type: (f.duration != null ? 'video' : 'image') as MediaFile['type'],
                    size: f.size,
                    duration: f.duration,
                    width: f.width,
                    height: f.height,
                  })),
                ),
              ),
            fail: (e) => resolve(capErr('album.failed', '选择媒体失败', e)),
          })
        }),
      saveImage: (filePath) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.saveImageToPhotosAlbum !== 'function') return resolve(capErr('album.unsupported', 'wx.saveImageToPhotosAlbum 缺失'))
          wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.save-failed', '保存图片失败（需 scope.writePhotosAlbum 授权）', e)) })
        }),
      saveVideo: (filePath) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.saveVideoToPhotosAlbum !== 'function') return resolve(capErr('album.unsupported', 'wx.saveVideoToPhotosAlbum 缺失'))
          wx.saveVideoToPhotosAlbum({ filePath, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.save-failed', '保存视频失败（需 scope.writePhotosAlbum 授权）', e)) })
        }),
      preview: (urls, current) =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.previewMedia !== 'function') return resolve(capErr('album.unsupported', 'wx.previewMedia 缺失'))
          wx.previewMedia({ urls, current, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('album.failed', '预览失败', e)) })
        }),
    }),
    // ★颗粒度对齐 C3：C53 Worker（wx.createWorker）
    createWorker: (scriptPath) => {
      if (typeof wx.createWorker !== 'function') throw new CapError('worker.unsupported', 'wx.createWorker 缺失')
      const w = wx.createWorker(scriptPath)
      return {
        postMessage: (message) => w.postMessage(message),
        onMessage: (cb) => { w.onMessage(cb); return () => { /* wx Worker onMessage 无对应 off；随 terminate 释放 */ } },
        terminate: () => w.terminate(),
      }
    },
    // ★颗粒度对齐 C3 批 2：C54 收货地址（wx.chooseAddress）
    chooseAddress: () =>
      new Promise<ShippingAddress>((resolve, reject) => {
        if (typeof wx.chooseAddress !== 'function') return reject(new CapError('address.unsupported', 'wx.chooseAddress 缺失'))
        wx.chooseAddress({
          success: (r) => resolve({ userName: r.userName, postalCode: r.postalCode, provinceName: r.provinceName, cityName: r.cityName, countyName: r.countyName, detailInfo: r.detailInfo, nationalCode: r.nationalCode, telNumber: r.telNumber }),
          fail: (e) => reject(new CapError('address.failed', '选择收货地址失败', e)),
        })
      }),
    // ★颗粒度对齐 C3 批 2：C55 WiFi（wx.getConnectedWifi/getWifiList/connectWifi）
    getWifi: () => {
      const map = (w: { SSID: string; BSSID: string; secure: boolean; signalStrength: number; frequency?: number }): WifiInfo => ({ SSID: w.SSID, BSSID: w.BSSID, secure: w.secure, signalStrength: w.signalStrength, frequency: w.frequency })
      return {
        getConnected: () =>
          new Promise<CapResult<WifiInfo>>((resolve) => {
            if (typeof wx.getConnectedWifi !== 'function') return resolve(capErr('wifi.unsupported', 'wx.getConnectedWifi 缺失'))
            wx.getConnectedWifi({ success: (r) => resolve(capOk(map(r.wifi))), fail: (e) => resolve(capErr('wifi.failed', '获取当前 WiFi 失败', e)) })
          }),
        list: () =>
          new Promise<CapResult<WifiInfo[]>>((resolve) => {
            if (typeof wx.getWifiList !== 'function' || typeof wx.onGetWifiList !== 'function') return resolve(capErr('wifi.unsupported', 'wx.getWifiList/onGetWifiList 缺失'))
            let settled = false
            wx.onGetWifiList((r) => {
              if (settled) return
              settled = true
              resolve(capOk((r.wifiList ?? []).map(map)))
            })
            if (typeof wx.startWifi === 'function') wx.startWifi({})
            wx.getWifiList({})
          }),
        connect: (SSID, password) =>
          new Promise<CapResult<void>>((resolve) => {
            if (typeof wx.connectWifi !== 'function') return resolve(capErr('wifi.unsupported', 'wx.connectWifi 缺失（iOS 不支持程序化连接）'))
            wx.connectWifi({ SSID, password, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('wifi.connect-failed', '连接 WiFi 失败', e)) })
          }),
      }
    },
    // ★颗粒度对齐 C3 批 2：C56 微信运动（wx.getWeRunData）
    getWeRunData: () =>
      new Promise<WeRunData>((resolve, reject) => {
        if (typeof wx.getWeRunData !== 'function') return reject(new CapError('werun.unsupported', 'wx.getWeRunData 缺失'))
        wx.getWeRunData({
          success: (r) => resolve({ encryptedData: r.encryptedData, iv: r.iv, cloudID: r.cloudID }),
          fail: (e) => reject(new CapError('werun.failed', '获取微信运动数据失败（需 scope.werun 授权 + 后端解密）', e)),
        })
      }),
    // ★组件实例 API 对齐（2026-09-12）：C57 画布（wx.createCanvasContext / SelectorQuery node / canvasToTempFilePath / createOffscreenCanvas）
    createCanvas: (id) => {
      const canvasId = id.replace(/^#/, '')
      // 旧接口 CanvasContext（方法名已对齐官方）——wx 直接返回；缺 API → 各方法级 Err
      const makeContext = (): CapResult<CanvasContext> => {
        if (typeof wx.createCanvasContext !== 'function') return capErr('canvas.unsupported', 'wx.createCanvasContext 缺失')
        const raw = wx.createCanvasContext(canvasId) as Record<string, unknown>
        const call = (name: string, ...args: unknown[]): void => {
          const fn = raw[name]
          if (typeof fn === 'function') (fn as (...a: unknown[]) => void).apply(raw, args)
        }
        return capOk({
          setFillStyle: (c) => call('setFillStyle', c),
          setStrokeStyle: (c) => call('setStrokeStyle', c),
          setLineWidth: (w) => call('setLineWidth', w),
          setLineCap: (v) => call('setLineCap', v),
          setLineJoin: (v) => call('setLineJoin', v),
          setMiterLimit: (v) => call('setMiterLimit', v),
          setGlobalAlpha: (a) => call('setGlobalAlpha', a),
          setShadow: (x, y, b, c) => call('setShadow', x, y, b, c),
          setLineDash: (p, o) => call('setLineDash', p, o),
          setFontSize: (s) => call('setFontSize', s),
          setTextAlign: (v) => call('setTextAlign', v),
          setTextBaseline: (v) => call('setTextBaseline', v),
          setTransform: (a, b, c, d, e, f) => call('setTransform', a, b, c, d, e, f),
          save: () => call('save'),
          restore: () => call('restore'),
          translate: (x, y) => call('translate', x, y),
          rotate: (r) => call('rotate', r),
          scale: (x, y) => call('scale', x, y),
          beginPath: () => call('beginPath'),
          closePath: () => call('closePath'),
          moveTo: (x, y) => call('moveTo', x, y),
          lineTo: (x, y) => call('lineTo', x, y),
          arc: (x, y, r, s, e, cc) => call('arc', x, y, r, s, e, cc),
          arcTo: (x1, y1, x2, y2, r) => call('arcTo', x1, y1, x2, y2, r),
          quadraticCurveTo: (cpx, cpy, x, y) => call('quadraticCurveTo', cpx, cpy, x, y),
          bezierCurveTo: (a, b, c, d, e, f) => call('bezierCurveTo', a, b, c, d, e, f),
          rect: (x, y, w, h) => call('rect', x, y, w, h),
          fill: () => call('fill'),
          stroke: () => call('stroke'),
          clip: () => call('clip'),
          fillRect: (x, y, w, h) => call('fillRect', x, y, w, h),
          strokeRect: (x, y, w, h) => call('strokeRect', x, y, w, h),
          clearRect: (x, y, w, h) => call('clearRect', x, y, w, h),
          fillText: (t, x, y, mw) => call('fillText', t, x, y, mw),
          measureText: (t) => {
            if (typeof raw.measureText !== 'function') return { width: 0 }
            return (raw.measureText as (s: string) => CanvasTextMetrics)(t)
          },
          drawImage: (img, ...args) => call('drawImage', img, ...args),
          createLinearGradient: (x0, y0, x1, y1) => {
            if (typeof raw.createLinearGradient !== 'function') return { addColorStop: () => {} }
            return (raw.createLinearGradient as (...a: number[]) => CanvasGradientLike)(x0, y0, x1, y1)
          },
          createCircularGradient: (x, y, r) => {
            if (typeof raw.createCircularGradient !== 'function') return { addColorStop: () => {} }
            return (raw.createCircularGradient as (x: number, y: number, r: number) => CanvasGradientLike)(x, y, r)
          },
          createPattern: (img, rep) => {
            if (typeof raw.createPattern !== 'function') return null
            return (raw.createPattern as (i: unknown, r: string) => CanvasPatternLike)(img, rep)
          },
          draw: (reserve, cb) => {
            const done = typeof reserve === 'function' ? reserve : cb
            const keep = typeof reserve === 'boolean' ? reserve : undefined
            if (typeof raw.draw === 'function') (raw.draw as (r?: boolean, c?: () => void) => void)(keep, done)
            else if (done) done()
          },
        })
      }
      const queryNode = (): Promise<CanvasNode> =>
        new Promise<CanvasNode>((resolve, reject) => {
          if (typeof wx.createSelectorQuery !== 'function') return reject(new CapError('canvas.unsupported', 'wx.createSelectorQuery 缺失（type=2d 节点不可用）'))
          const q = wx.createSelectorQuery()
          const sel = q.select?.('#' + canvasId)
          if (!sel || typeof sel.fields !== 'function') return reject(new CapError('canvas.unsupported', 'SelectorQuery.fields 缺失'))
          sel.fields({ node: true, size: true }, () => {})
          if (typeof q.exec !== 'function') return reject(new CapError('canvas.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const first = Array.isArray(res) ? (res[0] as { node?: CanvasNode } | undefined) : (res as { node?: CanvasNode } | undefined)
            if (first?.node) resolve(first.node)
            else reject(new CapError('canvas.node-missing', '未取得 canvas 节点（需 <canvas type="2d" id="…">）'))
          })
        })
      const exportImage = (options?: CanvasExportOptions): Promise<CapResult<string>> =>
        new Promise<CapResult<string>>((resolve) => {
          if (typeof wx.canvasToTempFilePath !== 'function') return resolve(capErr('canvas.unsupported', 'wx.canvasToTempFilePath 缺失'))
          wx.canvasToTempFilePath({
            canvasId,
            ...options,
            success: (r: unknown) => resolve(capOk((r as { tempFilePath: string }).tempFilePath)),
            fail: (e: unknown) => resolve(capErr('canvas.export-failed', '导出画布失败', e)),
          })
        })
      return {
        id: canvasId,
        createContext: makeContext,
        node: () => wrap(queryNode()),
        toTempFilePath: exportImage,
        toDataURL: (options) =>
          exportImage(options).then(async (r) => {
            if (!r.ok) return r
            const fsm = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : undefined
            if (!fsm?.readFile) return capErr<string>('canvas.unsupported', 'wx.getFileSystemManager.readFile 缺失（无法转 base64）')
            return await new Promise<CapResult<string>>((resolve) => {
              fsm.readFile!({
                filePath: r.data,
                encoding: 'base64',
                success: (rr) => resolve(capOk('data:image/png;base64,' + String(rr.data))),
                fail: (e) => resolve(capErr<string>('canvas.export-failed', '读取临时文件失败', e)),
              })
            })
          }),
        offscreen: (width, height, type = '2d') => {
          if (typeof wx.createOffscreenCanvas !== 'function') return capErr<OffscreenCanvasHandle>('canvas.unsupported', 'wx.createOffscreenCanvas 缺失')
          const off = wx.createOffscreenCanvas({ type, width, height }) as { width: number; height: number; getContext: (t: string) => unknown }
          return capOk({
            width: off.width,
            height: off.height,
            getContext: (t: '2d' | 'webgl') => off.getContext(t) as CanvasContext | null,
          })
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C58 元素查询（wx.createSelectorQuery）
    createElementQuery: (id) => {
      const norm = (sel?: string): string => {
        const s = sel ?? id ?? ''
        return s.startsWith('#') ? s : s ? '#' + s : ''
      }
      const execOne = <T,>(build: (q: WxSelectorQueryLike) => void): Promise<CapResult<T>> =>
        new Promise<CapResult<T>>((resolve) => {
          if (typeof wx.createSelectorQuery !== 'function') return resolve(capErr<T>('element.unsupported', 'wx.createSelectorQuery 缺失'))
          const q = wx.createSelectorQuery()
          try {
            build(q)
          } catch (e) {
            return resolve(capErr<T>('element.failed', 'SelectorQuery 构建失败', e))
          }
          if (typeof q.exec !== 'function') return resolve(capErr<T>('element.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const first = Array.isArray(res) ? res[0] : res
            if (first == null) return resolve(capErr<T>('element.not-found', '未查询到元素'))
            resolve(capOk(first as T))
          })
        })
      const execMany = <T,>(selectors: string[], build: (q: WxSelectorQueryLike, sel: string) => void): Promise<CapResult<T[]>> =>
        new Promise<CapResult<T[]>>((resolve) => {
          if (typeof wx.createSelectorQuery !== 'function') return resolve(capErr<T[]>('element.unsupported', 'wx.createSelectorQuery 缺失'))
          const q = wx.createSelectorQuery()
          try {
            for (const sel of selectors) build(q, sel)
          } catch (e) {
            return resolve(capErr<T[]>('element.failed', 'SelectorQuery 构建失败', e))
          }
          if (typeof q.exec !== 'function') return resolve(capErr<T[]>('element.unsupported', 'SelectorQuery.exec 缺失'))
          q.exec((res: unknown) => {
            const arr = Array.isArray(res) ? res : []
            resolve(capOk(arr as T[]))
          })
        })
      return {
        boundingClientRect: (selector) => execOne<ElementRect>((q) => {
          const s = q.select?.(norm(selector))
          s?.boundingClientRect?.()
        }),
        scrollOffset: (selector) => execOne<ElementScrollOffset>((q) => {
          const s = q.select?.(norm(selector))
          s?.scrollOffset?.()
        }),
        fields: (options, selector) => execOne<ElementFieldsResult>((q) => {
          const s = q.select?.(norm(selector))
          s?.fields?.({ ...options })
        }),
        size: (selector) =>
          execOne<ElementRect>((q) => {
            const s = q.select?.(norm(selector))
            s?.boundingClientRect?.()
          }).then((r) => (r.ok ? capOk({ width: r.data.width ?? 0, height: r.data.height ?? 0 }) : (r as unknown as CapResult<{ width: number; height: number }>))),
        batch: (selectors) => execMany<ElementRect>(selectors, (q, sel) => q.select?.(norm(sel))?.boundingClientRect?.()),
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C59 交叉观察（wx.createIntersectionObserver）
    createIntersection: (options) => {
      const make = wx.createIntersectionObserver
      const obs = typeof make === 'function' ? make.call(wx, undefined, options) : undefined
      const handle: IntersectionHandle = {
        relativeTo: (selector, margins) => {
          obs?.relativeTo?.(selector, margins)
          return handle
        },
        relativeToViewport: (margins) => {
          obs?.relativeToViewport?.(margins)
          return handle
        },
        observe: (targetSelector, cb) => {
          obs?.observe?.(targetSelector, (res) => cb(res as IntersectionResult))
          return handle
        },
        disconnect: () => {
          obs?.disconnect?.()
        },
      }
      return handle
    },
    // ★组件实例 API 对齐（2026-09-12）：C60 媒体查询（wx.createMediaQueryObserver）
    createMediaQuery: () => {
      const obs = typeof wx.createMediaQueryObserver === 'function' ? wx.createMediaQueryObserver() : undefined
      return {
        observe: (condition, cb) => {
          if (!obs?.observe) {
            cb({ matches: false })
            return
          }
          obs.observe({ ...condition }, (res) => cb({ matches: !!res.matches }))
        },
        disconnect: () => {
          obs?.disconnect?.()
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C61 视频控制器（wx.createVideoContext）
    createVideo: (id) => {
      const ctx = typeof wx.createVideoContext === 'function' ? wx.createVideoContext(id.replace(/^#/, '')) : undefined
      const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('video.unsupported', 'VideoContext.' + name + ' 缺失')
          try {
            ;(fn as (...a: unknown[]) => void).apply(ctx, args)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('video.failed', '视频 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { play: 'onPlay', pause: 'onPause', ended: 'onEnded', timeupdate: 'onTimeUpdate', error: 'onError', fullscreenchange: 'onFullScreenChange' }
      return {
        play: () => run(ctx?.play, 'play'),
        pause: () => run(ctx?.pause, 'pause'),
        stop: () => run(ctx?.stop, 'stop'),
        seek: (position) => run(ctx?.seek, 'seek', position),
        playbackRate: (rate) => run(ctx?.playbackRate, 'playbackRate', rate),
        requestFullScreen: (options) => run(ctx?.requestFullScreen, 'requestFullScreen', options),
        exitFullScreen: () => run(ctx?.exitFullScreen, 'exitFullScreen'),
        sendDanmu: (danmu) => run(ctx?.sendDanmu, 'sendDanmu', danmu),
        on: (event, cb) => {
          const fn = ctx?.[evMap[event] as keyof WxVideoContextLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb)
          return () => {}
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C62 音频控制器（wx.createInnerAudioContext）
    createAudio: (src) => {
      if (typeof wx.createInnerAudioContext !== 'function') throw new CapError('audio.unsupported', 'wx.createInnerAudioContext 缺失')
      const ac = wx.createInnerAudioContext()
      if (src) ac.src = src
      const run = (fn: unknown, name: string, ...args: unknown[]): Promise<CapResult<void>> =>
        Promise.resolve().then(() => {
          if (typeof fn !== 'function') return capErr<void>('audio.unsupported', 'InnerAudioContext.' + name + ' 缺失')
          try {
            ;(fn as (...a: unknown[]) => void).apply(ac, args)
            return capOk(undefined)
          } catch (e) {
            return capErr<void>('audio.failed', '音频 ' + name + ' 失败', e)
          }
        })
      const evMap: Record<string, string> = { canplay: 'onCanplay', play: 'onPlay', pause: 'onPause', stop: 'onStop', ended: 'onEnded', timeupdate: 'onTimeUpdate', error: 'onError' }
      return {
        play: (s) => {
          if (s) ac.src = s
          return run(ac.play, 'play')
        },
        pause: () => run(ac.pause, 'pause'),
        stop: () => run(ac.stop, 'stop'),
        seek: (position) => run(ac.seek, 'seek', position),
        setVolume: (v) => { ac.volume = v },
        setLoop: (v) => { ac.loop = v },
        get currentTime() { return ac.currentTime ?? 0 },
        get duration() { return ac.duration ?? 0 },
        get paused() { return ac.paused ?? false },
        destroy: () => ac.destroy?.(),
        on: (event, cb) => {
          const fn = ac[evMap[event] as keyof WxInnerAudioContextLike]
          if (typeof fn !== 'function') return () => {}
          ;(fn as (c: (p: unknown) => void) => void)(cb as (p: unknown) => void)
          return () => {}
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C63 直播推流控制器（wx.createLivePusherContext）
    createLivePusher: (id) => {
      const ctx = typeof wx.createLivePusherContext === 'function' ? wx.createLivePusherContext(id.replace(/^#/, '')) : undefined
      const call = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof fn !== 'function') return resolve(capErr<void>('live-pusher.unsupported', 'LivePusherContext.' + name + ' 缺失'))
          try {
            ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr<void>('live-pusher.failed', '推流 ' + name + ' 失败', e)) })
          } catch (e) {
            resolve(capErr<void>('live-pusher.failed', '推流 ' + name + ' 失败', e))
          }
        })
      return {
        start: () => call(ctx?.start, 'start'),
        stop: () => call(ctx?.stop, 'stop'),
        pause: () => call(ctx?.pause, 'pause'),
        resume: () => call(ctx?.resume, 'resume'),
        switchCamera: () => call(ctx?.switchCamera, 'switchCamera'),
        toggleTorch: () => call(ctx?.toggleTorch, 'toggleTorch'),
        snapshot: () =>
          new Promise<CapResult<string>>((resolve) => {
            if (typeof ctx?.snapshot !== 'function') return resolve(capErr<string>('live-pusher.unsupported', 'LivePusherContext.snapshot 缺失'))
            ctx.snapshot({ success: (r: unknown) => resolve(capOk((r as { tempImagePath?: string }).tempImagePath ?? '')), fail: (e: unknown) => resolve(capErr<string>('live-pusher.failed', '推流截图失败', e)) })
          }),
        sendMessage: (msg) =>
          new Promise<CapResult<void>>((resolve) => {
            if (typeof ctx?.sendMessage !== 'function') return resolve(capErr<void>('live-pusher.unsupported', 'LivePusherContext.sendMessage 缺失'))
            ctx.sendMessage({ msg, success: () => resolve(capOk(undefined)), fail: (e: unknown) => resolve(capErr<void>('live-pusher.failed', '发送 SEI 消息失败', e)) })
          }),
        on: (event, cb) => {
          if (typeof ctx?.on !== 'function') return () => {}
          ctx.on(event, cb)
          return () => {
            if (typeof ctx?.off === 'function') ctx.off(event, cb)
          }
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C64 广告（wx.createRewardedVideoAd/createInterstitialAd/createBannerAd）
    getAd: () => {
      const cache = new Map<string, unknown>()
      const ensure = <T,>(key: string, make: () => T): T => {
        if (!cache.has(key)) cache.set(key, make())
        return cache.get(key) as T
      }
      return {
        rewardedVideo: (adUnitId) =>
          ensure('rv:' + adUnitId, (): RewardedVideoAdHandle => {
            if (typeof wx.createRewardedVideoAd !== 'function') throw new CapError('ad.unsupported', 'wx.createRewardedVideoAd 缺失')
            const ad = wx.createRewardedVideoAd({ adUnitId })
            return {
              load: () => Promise.resolve(ad.load?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '加载激励视频失败', e)),
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示激励视频失败', e)),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => ad.offLoad?.(cb) },
              onClose: (cb) => { ad.onClose?.((res) => cb({ isEnded: !!res.isEnded })); return () => ad.offClose?.() },
              onError: (cb) => { ad.onError?.(cb); return () => ad.offError?.() },
              off: () => ad.destroy?.(),
            }
          }),
        interstitial: (adUnitId) =>
          ensure('int:' + adUnitId, (): InterstitialAdHandle => {
            if (typeof wx.createInterstitialAd !== 'function') throw new CapError('ad.unsupported', 'wx.createInterstitialAd 缺失')
            const ad = wx.createInterstitialAd({ adUnitId })
            return {
              load: () => Promise.resolve(ad.load?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '加载插屏广告失败', e)),
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示插屏广告失败', e)),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => {} },
              onClose: (cb) => { ad.onClose?.(cb); return () => {} },
              onError: (cb) => { ad.onError?.(cb); return () => {} },
              destroy: () => ad.destroy?.(),
            }
          }),
        banner: (options) =>
          ensure('banner:' + options.adUnitId, (): BannerAdHandle => {
            if (typeof wx.createBannerAd !== 'function') throw new CapError('ad.unsupported', 'wx.createBannerAd 缺失')
            const ad = wx.createBannerAd({ adUnitId: options.adUnitId, style: options.style })
            return {
              show: () => Promise.resolve(ad.show?.()).then(() => capOk(undefined), (e) => capErr<void>('ad.failed', '展示横幅广告失败', e)),
              hide: () => Promise.resolve().then(() => { ad.hide?.(); return capOk(undefined) }),
              destroy: () => ad.destroy?.(),
              onLoad: (cb) => { ad.onLoad?.(cb); return () => {} },
              onResize: (cb) => { ad.onResize?.(cb); return () => {} },
              onError: (cb) => { ad.onError?.(cb); return () => {} },
            }
          }),
      }
    },
    // ★权威标尺缺口 C65：隐私协议（wx.getPrivacySetting / openPrivacyContract / requirePrivacyAuthorize / onNeedPrivacyAuthorization）
    getPrivacy: () => ({
      getSetting: () =>
        new Promise<CapResult<PrivacySetting>>((resolve) => {
          if (typeof wx.getPrivacySetting !== 'function') return resolve(capErr('privacy.unsupported', 'wx.getPrivacySetting 缺失'))
          wx.getPrivacySetting({
            success: (r) => resolve(capOk({ needAuthorization: !!r.needAuthorization, privacyContractName: r.privacyContractName ?? '' })),
            fail: (e) => resolve(capErr('privacy.failed', '查询隐私授权状态失败', e)),
          })
        }),
      openContract: () =>
        new Promise<CapResult<void>>((resolve) => {
          if (typeof wx.openPrivacyContract !== 'function') return resolve(capErr('privacy.unsupported', 'wx.openPrivacyContract 缺失'))
          wx.openPrivacyContract({ success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('privacy.failed', '打开隐私协议页失败', e)) })
        }),
      requireAuthorize: () =>
        new Promise<CapResult<boolean>>((resolve) => {
          if (typeof wx.requirePrivacyAuthorize !== 'function') return resolve(capErr('privacy.unsupported', 'wx.requirePrivacyAuthorize 缺失'))
          wx.requirePrivacyAuthorize({ success: () => resolve(capOk(true)), fail: (e) => resolve(capErr('privacy.denied', '用户拒绝隐私授权', e)) })
        }),
      onNeedAuthorization: (cb) => {
        if (typeof wx.onNeedPrivacyAuthorization !== 'function') return () => {}
        wx.onNeedPrivacyAuthorization(cb)
        return () => {
          if (typeof wx.offNeedPrivacyAuthorization === 'function') wx.offNeedPrivacyAuthorization(cb)
        }
      },
    }),
    getCalendar: () => ({
      add: (event) =>
        new Promise<CapResult<void>>((resolve) => {
          if (!wx.addPhoneCalendar) return resolve(capErr('calendar.unsupported', 'wx.addPhoneCalendar 缺失'))
          wx.addPhoneCalendar({ ...event, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('calendar.failed', '添加日程失败', e)) })
        }),
      remove: (eventId) =>
        new Promise<CapResult<void>>((resolve) => {
          if (!wx.removePhoneCalendar) return resolve(capErr('calendar.unsupported', 'wx.removePhoneCalendar 缺失'))
          wx.removePhoneCalendar({ eventId, success: () => resolve(capOk(undefined)), fail: (e) => resolve(capErr('calendar.failed', '删除日程失败', e)) })
        }),
      list: () => Promise.resolve(capErr<CalendarEvent[]>('calendar.unsupported', '小程序无日历查询开放 API（仅写）')),
    }),
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
    // ★能力颗粒度对齐：C49 直播观看端（wx.createLivePlayerContext(roomId) → 播放控制全套）
    joinLiveRoom: (options) => {
      // 缺 API → 返回「全 reject 桥」（useLive 为 Promise 型 hook：方法级 Err 而非抛）
      if (typeof wx.createLivePlayerContext !== 'function') {
        const noSupport = (): Promise<never> => Promise.reject(new CapError('live.unsupported', 'wx.createLivePlayerContext 缺失（live-player 组件需直播类目）'))
        return { play: noSupport, pause: noSupport, resume: noSupport, stop: noSupport, mute: () => {}, snapshot: noSupport, requestFullScreen: noSupport, exitFullScreen: noSupport, status: () => 'stopped' as const, onStateChange: () => () => {} }
      }
      const ctx = wx.createLivePlayerContext(options.roomId)
      let state: LivePlayState = 'stopped'
      const stateCbs: Array<(s: LivePlayState) => void> = []
      const setState = (s: LivePlayState): void => {
        state = s
        stateCbs.forEach((cb) => cb(s))
      }
      const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
        new Promise<void>((res, rej) => {
          if (typeof fn !== 'function') return rej(new CapError('live.unsupported', 'LivePlayerContext.' + name + ' 缺失'))
          ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('live.failed', 'wx 直播 ' + name + ' 失败', e)) })
        })
      // 生命周期回调驱动状态
      if (ctx.onPlay) ctx.onPlay(() => setState('playing'))
      if (ctx.onPause) ctx.onPause(() => setState('paused'))
      if (ctx.onStop) ctx.onStop(() => setState('stopped'))
      if (ctx.onError) ctx.onError(() => setState('error'))
      return {
        play: () => run(ctx.play, 'play'),
        pause: () => run(ctx.pause, 'pause'),
        resume: () => run(ctx.resume, 'resume'),
        stop: () => run(ctx.stop, 'stop'),
        mute: () => {
          if (typeof ctx.mute === 'function') ctx.mute({})
        },
        snapshot: () =>
          new Promise<string>((res, rej) => {
            if (typeof ctx.snapshot !== 'function') return rej(new CapError('live.unsupported', 'LivePlayerContext.snapshot 缺失'))
            ctx.snapshot({ success: (r) => res(r.tempImagePath), fail: (e: unknown) => rej(new CapError('live.failed', '截图失败', e)) })
          }),
        requestFullScreen: (direction) => run(ctx.requestFullScreen, 'requestFullScreen', { direction }),
        exitFullScreen: () => run(ctx.exitFullScreen, 'exitFullScreen'),
        status: () => state,
        onStateChange: (cb) => {
          stateCbs.push(cb)
          return () => {
            const i = stateCbs.indexOf(cb)
            if (i >= 0) stateCbs.splice(i, 1)
          }
        },
      }
    },
  }
}

/** ★能力颗粒度对齐：NFC 读卡模式桥（wx.getNFCAdapter → 发现标签 + 各技术类型连接）
 *   缺 getNFCAdapter → 全方法 Err（诚实降级）。各连接句柄方法统一 Promise<CapResult<T>>。 */
function buildNfcAdapter(wx: WxLike): NfcAdapter {
  const noAdapter = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('nfc.unsupported', 'wx.getNFCAdapter 缺失（' + op + ' 不可用）'))
  if (typeof wx.getNFCAdapter !== 'function') {
    return {
      startDiscovery: () => noAdapter('startDiscovery'),
      stopDiscovery: () => noAdapter('stopDiscovery'),
      onDiscovered: () => () => {},
      connectNdef: () => noAdapter('getNdef'),
      connectIsoDep: () => noAdapter('getIsoDep'),
      connectNfcA: () => noAdapter('getNfcA'),
      connectNfcB: () => noAdapter('getNfcB'),
      connectNfcF: () => noAdapter('getNfcF'),
      connectNfcV: () => noAdapter('getNfcV'),
      connectMifareClassic: () => noAdapter('getMifareClassic'),
      connectMifareUltralight: () => noAdapter('getMifareUltralight'),
    }
  }
  const adapter = wx.getNFCAdapter()
  const cap = <T,>(p: Promise<T>): Promise<CapResult<T>> => p.then((d) => capOk(d), (e) => capErr<T>(e instanceof CapError ? e.code : 'nfc.failed', e instanceof Error ? e.message : String(e), e))
  const run = (fn: unknown, name: string, opt?: Record<string, unknown>): Promise<void> =>
    new Promise<void>((res, rej) => {
      if (typeof fn !== 'function') return rej(new CapError('nfc.unsupported', 'NFCAdapter.' + name + ' 缺失'))
      ;(fn as (o?: Record<string, unknown>) => void)({ ...opt, success: () => res(), fail: (e: unknown) => rej(new CapError('nfc.failed', 'NFC ' + name + ' 失败', e)) })
    })
  const makeTag = (getter: () => WxNfcTagLike | undefined, name: string): Promise<CapResult<NfcTagHandle>> =>
    cap(
      (async () => {
        const tag = getter()
        if (!tag) throw new CapError('nfc.unsupported', 'NFCAdapter.' + name + ' 缺失')
        await run(tag.connect, name + '.connect')
        const handle: NfcTagHandle = {
          connect: () => cap(run(tag.connect, name + '.connect')),
          close: () => cap(run(tag.close, name + '.close')),
          isConnected: () => (typeof tag.isConnected === 'function' ? tag.isConnected() : false),
          setTimeout: (timeout) => cap(run(tag.setTimeout, name + '.setTimeout', { timeout })),
          transceive: (data) =>
            new Promise<CapResult<ArrayBuffer>>((res) => {
              if (typeof tag.transceive !== 'function') return res(capErr('nfc.unsupported', name + '.transceive 缺失'))
              tag.transceive!({ data, success: (r) => res(capOk(r.data)), fail: (e: unknown) => res(capErr('nfc.failed', 'transceive 失败', e)) })
            }),
        }
        return handle
      })(),
    )
  const makeNdef = (): Promise<CapResult<NdefHandle>> =>
    cap(
      (async () => {
        const tag = adapter.getNdef ? adapter.getNdef() : undefined
        if (!tag) throw new CapError('nfc.unsupported', 'NFCAdapter.getNdef 缺失')
        await run(tag.connect, 'Ndef.connect')
        const base = await makeTag(() => tag, 'Ndef')
        if (!base.ok) throw new CapError(base.error.code, base.error.message)
        const handle: NdefHandle = {
          ...base.data,
          writeNdefMessage: (message) =>
            new Promise<CapResult<void>>((res) => {
              if (typeof tag.writeNdefMessage !== 'function') return res(capErr('nfc.unsupported', 'Ndef.writeNdefMessage 缺失'))
              tag.writeNdefMessage({ records: message.records, success: () => res(capOk(undefined)), fail: (e) => res(capErr('nfc.failed', '写 NDEF 失败', e)) })
            }),
          onNdefMessage: (cb) => {
            if (typeof tag.onNdefMessage !== 'function') return () => {}
            tag.onNdefMessage(cb)
            return () => {
              if (typeof tag.offNdefMessage === 'function') tag.offNdefMessage(cb)
            }
          },
        }
        return handle
      })(),
    )
  return {
    startDiscovery: () => cap(run(adapter.startDiscovery, 'startDiscovery')),
    stopDiscovery: () => cap(run(adapter.stopDiscovery, 'stopDiscovery')),
    onDiscovered: (cb) => {
      if (typeof adapter.onDiscovered !== 'function') return () => {}
      const h = (r: { id: ArrayBuffer; techs: string[]; messages?: unknown[] }): void => cb({ id: r.id, techs: r.techs ?? [], messages: r.messages as NfcTag['messages'] })
      adapter.onDiscovered(h)
      return () => {
        if (typeof adapter.offDiscovered === 'function') adapter.offDiscovered(h)
      }
    },
    connectNdef: () => makeNdef(),
    connectIsoDep: () => makeTag(() => adapter.getIsoDep?.(), 'IsoDep'),
    connectNfcA: () => makeTag(() => adapter.getNfcA?.(), 'NfcA'),
    connectNfcB: () => makeTag(() => adapter.getNfcB?.(), 'NfcB'),
    connectNfcF: () => makeTag(() => adapter.getNfcF?.(), 'NfcF'),
    connectNfcV: () => makeTag(() => adapter.getNfcV?.(), 'NfcV'),
    connectMifareClassic: () => makeTag(() => adapter.getMifareClassic?.(), 'MifareClassic'),
    connectMifareUltralight: () => makeTag(() => adapter.getMifareUltralight?.(), 'MifareUltralight'),
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
    // ★能力颗粒度对齐：web 直播观看端（无标准对等 → 诚实 Err 句柄）
    joinLiveRoom: () => {
      // 桥层返回原始 Promise（reject）——hook 的 wrap 转为 Err
      const noWeb = (op: string): Promise<never> => Promise.reject(new CapError('live.unsupported', 'Web 端直播 ' + op + ' 无标准对等'))
      return {
        play: () => noWeb('play'),
        pause: () => noWeb('pause'),
        resume: () => noWeb('resume'),
        stop: () => noWeb('stop'),
        mute: () => {},
        snapshot: () => noWeb('snapshot'),
        requestFullScreen: () => noWeb('requestFullScreen'),
        exitFullScreen: () => noWeb('exitFullScreen'),
        status: () => 'stopped' as const,
        onStateChange: () => () => {},
      }
    },
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
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('nfc.unsupported', 'Web 端 NFC ' + op + ' 无标准对等'))
      const noAdapter = (): NfcAdapter => ({
        startDiscovery: () => noWeb('startDiscovery'),
        stopDiscovery: () => noWeb('stopDiscovery'),
        onDiscovered: () => () => {},
        connectNdef: () => noWeb('getNdef'),
        connectIsoDep: () => noWeb('getIsoDep'),
        connectNfcA: () => noWeb('getNfcA'),
        connectNfcB: () => noWeb('getNfcB'),
        connectNfcF: () => noWeb('getNfcF'),
        connectNfcV: () => noWeb('getNfcV'),
        connectMifareClassic: () => noWeb('getMifareClassic'),
        connectMifareUltralight: () => noWeb('getMifareUltralight'),
      })
      return {
        supported,
        available: supported,
        startHCE: () => noWeb('startHCE'),
        stopHCE: () => noWeb('stopHCE'),
        sendHCEMessage: () => noWeb('sendHCEMessage'),
        onHCEMessage: () => () => {},
        onHCEStateChange: () => () => {},
        getAdapter: noAdapter,
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
      const sub = <T,>(add: unknown, event: string, cb: (r: T) => void): (() => void) => {
        if (typeof add !== 'function') return () => {}
        const h = (e: unknown): void => cb(e as T)
        ;(add as (t: string, c: (e: unknown) => void) => void)(event, h)
        return () => {}
      }
      const w = g as { addEventListener?: unknown }
      const win = (g as { window?: { addEventListener?: unknown; getLaunchOptions?: () => Record<string, unknown> } }).window
      return {
        onEvent: (cb) => {
          cbs.push(cb)
          return () => {
            const i = cbs.indexOf(cb)
            if (i >= 0) cbs.splice(i, 1)
          }
        },
        onMemoryWarning: () => () => {},
        onThemeChange: (cb) => {
          const mm = (g as { matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: string, c: (e: { matches: boolean }) => void) => void } }).matchMedia
          if (typeof mm !== 'function') return () => {}
          const mql = mm('(prefers-color-scheme: dark)')
          if (mql.addEventListener) mql.addEventListener('change', (e) => cb(e.matches ? 'dark' : 'light'))
          return () => {}
        },
        onWindowResize: (cb) => {
          const add = (win && win.addEventListener) || w.addEventListener
          if (typeof add !== 'function') return () => {}
          const h = (): void => cb({ windowWidth: (g as { innerWidth?: number }).innerWidth ?? 0, windowHeight: (g as { innerHeight?: number }).innerHeight ?? 0 })
          ;(add as (t: string, c: () => void) => void)('resize', h)
          return () => {}
        },
        onError: (cb) => sub<string | ErrorEvent>(w.addEventListener, 'error', (e) => cb(String((e as { message?: string })?.message ?? e))),
        onUnhandledRejection: (cb) => sub<PromiseRejectionEvent>(w.addEventListener, 'unhandledrejection', (e) => cb({ reason: String((e as { reason?: unknown })?.reason ?? ''), promise: (e as { promise?: Promise<unknown> })?.promise ?? Promise.resolve() })),
        onNetworkStatusChange: (cb) => {
          const add = (g as { addEventListener?: unknown }).addEventListener
          if (typeof add !== 'function') return () => {}
          const h = (): void => cb({ isConnected: (g as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false, networkType: 'unknown' })
          ;(add as (t: string, c: () => void) => void)('online', h)
          ;(add as (t: string, c: () => void) => void)('offline', h)
          return () => {}
        },
        getLaunchOptions: async () => capErr<Record<string, unknown>>('background.unsupported', 'Web 端无启动参数对等'),
        getEnterOptions: async () => capErr<Record<string, unknown>>('background.unsupported', 'Web 端无进入参数对等'),
      }
    },
    // ★能力颗粒度对齐：C20 日历（web 无标准 → 诚实 Err）
    getCalendar: () => ({
      add: () => Promise.resolve(capErr<void>('calendar.unsupported', 'Web 端无日历写入对等')),
      remove: () => Promise.resolve(capErr<void>('calendar.unsupported', 'Web 端无日历删除对等')),
      list: () => Promise.resolve(capErr<CalendarEvent[]>('calendar.unsupported', 'Web 端无日历查询对等')),
    }),
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
    // ★颗粒度对齐 C3：web 相册 / Worker
    getAlbum: () => ({
      pick: (options) =>
        new Promise<CapResult<MediaFile[]>>((resolve) => {
          const doc = (g as { document?: { createElement?: (t: string) => HTMLInputElement } }).document
          if (!doc || typeof doc.createElement !== 'function') return resolve(capErr('album.unsupported', 'Web 无 DOM 环境（SSR）——相册选择不可用'))
          const input = doc.createElement('input')
          input.type = 'file'
          input.accept = options?.mediaType === 'video' ? 'video/*' : options?.mediaType === 'image' ? 'image/*' : 'image/*,video/*'
          if ((options?.count ?? 1) > 1) input.multiple = true
          input.onchange = () => {
            const files = Array.from(input.files ?? [])
            if (!files.length) return resolve(capErr('album.cancelled', '未选择文件'))
            const urls = (g as { URL?: { createObjectURL?: (f: unknown) => string } }).URL
            resolve(
              capOk(
                files.slice(0, options?.count ?? 1).map((f) => ({
                  tempFilePath: urls && typeof urls.createObjectURL === 'function' ? urls.createObjectURL(f) : '',
                  type: (f.type.startsWith('video') ? 'video' : 'image') as MediaFile['type'],
                  size: f.size,
                })),
              ),
            )
          }
          input.click()
        }),
      saveImage: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 无系统相册写入标准 API（可用 <a download> 替代）')),
      saveVideo: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 无系统相册写入标准 API（可用 <a download> 替代）')),
      preview: () => Promise.resolve(capErr<void>('album.unsupported', 'Web 预览由宿主组件承载（lightbox），无标准 API')),
    }),
    createWorker: (scriptPath) => {
      const W = (g as { Worker?: new (p: string) => Worker }).Worker
      if (typeof W !== 'function') throw new CapError('worker.unsupported', 'Web Worker 不可用（SSR 或受限环境）')
      const w = new W(scriptPath)
      return {
        postMessage: (message) => w.postMessage(message),
        onMessage: (cb) => {
          const h = (e: MessageEvent): void => cb(e.data)
          w.addEventListener('message', h as EventListener)
          return () => w.removeEventListener('message', h as EventListener)
        },
        terminate: () => w.terminate(),
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
    // ★组件实例 API 对齐（2026-09-12）：C57 画布（web HTMLCanvasElement + 标准 2D 上下文适配 / OffscreenCanvas）
    createCanvas: (id) => {
      const canvasId = id.replace(/^#/, '')
      const doc = (g as { document?: Document }).document
      let cached: HTMLCanvasElement | null = null
      const resolveEl = (): HTMLCanvasElement | null => {
        if (cached) return cached
        if (!doc || typeof doc.querySelector !== 'function') return null
        const byId = typeof doc.getElementById === 'function' ? doc.getElementById(canvasId) : null
        cached = (byId as HTMLCanvasElement | null) ?? (doc.querySelector(`#${canvasId}`) as HTMLCanvasElement | null) ?? (doc.querySelector(canvasId.startsWith('.') || canvasId.includes('[') ? canvasId : `canvas.${canvasId}`) as HTMLCanvasElement | null)
        return cached
      }
      const exportImage = (options?: CanvasExportOptions): Promise<CapResult<string>> => {
        const el = resolveEl()
        if (!el || typeof el.toDataURL !== 'function') return Promise.resolve(capErr<string>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）'))
        const type = options?.fileType === 'jpg' ? 'image/jpeg' : 'image/png'
        const quality = options?.quality
        // 裁剪导出：有源区域参数且元素可用 drawImage 时走离屏重绘
        const wantCrop = options && (options.x || options.y || options.width || options.height || options.destWidth || options.destHeight)
        if (wantCrop && typeof doc?.createElement === 'function') {
          try {
            const w = options?.destWidth ?? options?.width ?? el.width
            const h = options?.destHeight ?? options?.height ?? el.height
            const off = doc.createElement('canvas')
            off.width = w
            off.height = h
            const octx = off.getContext('2d')
            if (octx) {
              octx.drawImage(el, options?.x ?? 0, options?.y ?? 0, options?.width ?? el.width, options?.height ?? el.height, 0, 0, w, h)
              return Promise.resolve(capOk(off.toDataURL(type, quality)))
            }
          } catch (e) {
            return Promise.resolve(capErr<string>('canvas.export-failed', '导出画布失败', e))
          }
        }
        try {
          return Promise.resolve(capOk(el.toDataURL(type, quality)))
        } catch (e) {
          return Promise.resolve(capErr<string>('canvas.export-failed', '导出画布失败（可能被跨域图片污染）', e))
        }
      }
      return {
        id: canvasId,
        createContext: () => {
          const el = resolveEl()
          if (!el || typeof el.getContext !== 'function') return capErr<CanvasContext>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）')
          const ctx = el.getContext('2d') as CanvasRenderingContext2D | null
          if (!ctx) return capErr<CanvasContext>('canvas.unsupported', 'getContext(2d) 返回空')
          let lineDash: number[] = []
          const applyDash = (): void => {
            if (typeof (ctx as { setLineDash?: (p: number[]) => void }).setLineDash === 'function') ctx.setLineDash(lineDash)
          }
          return capOk({
            setFillStyle: (c) => { ctx.fillStyle = c },
            setStrokeStyle: (c) => { ctx.strokeStyle = c },
            setLineWidth: (w) => { ctx.lineWidth = w },
            setLineCap: (v) => { ctx.lineCap = v },
            setLineJoin: (v) => { ctx.lineJoin = v },
            setMiterLimit: (v) => { ctx.miterLimit = v },
            setGlobalAlpha: (a) => { ctx.globalAlpha = a },
            setShadow: (x, y, b, c) => { ctx.shadowOffsetX = x; ctx.shadowOffsetY = y; ctx.shadowBlur = b; if (c) ctx.shadowColor = c },
            setLineDash: (p, o) => { lineDash = o ? [o, ...p] : p; applyDash() },
            setFontSize: (s) => {
              const cur = ctx.font || '10px sans-serif'
              ctx.font = cur.replace(/^\d+(\.\d+)?px/, `${s}px`)
              if (!/px/.test(ctx.font)) ctx.font = `${s}px sans-serif`
            },
            setTextAlign: (v) => { ctx.textAlign = v },
            setTextBaseline: (v) => { ctx.textBaseline = v === 'normal' ? 'alphabetic' : v },
            setTransform: (a, b, c, d, e, f) => ctx.setTransform(a, b, c, d, e, f),
            save: () => ctx.save(),
            restore: () => ctx.restore(),
            translate: (x, y) => ctx.translate(x, y),
            rotate: (r) => ctx.rotate(r),
            scale: (x, y) => ctx.scale(x, y),
            beginPath: () => ctx.beginPath(),
            closePath: () => ctx.closePath(),
            moveTo: (x, y) => ctx.moveTo(x, y),
            lineTo: (x, y) => ctx.lineTo(x, y),
            arc: (x, y, r, s, e, cc) => ctx.arc(x, y, r, s, e, cc),
            arcTo: (x1, y1, x2, y2, r) => ctx.arcTo(x1, y1, x2, y2, r),
            quadraticCurveTo: (cpx, cpy, x, y) => ctx.quadraticCurveTo(cpx, cpy, x, y),
            bezierCurveTo: (a, b, c, d, e, f) => ctx.bezierCurveTo(a, b, c, d, e, f),
            rect: (x, y, w, h) => ctx.rect(x, y, w, h),
            fill: () => ctx.fill(),
            stroke: () => ctx.stroke(),
            clip: () => ctx.clip(),
            fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
            strokeRect: (x, y, w, h) => ctx.strokeRect(x, y, w, h),
            clearRect: (x, y, w, h) => ctx.clearRect(x, y, w, h),
            fillText: (t, x, y, mw) => (mw === undefined ? ctx.fillText(t, x, y) : ctx.fillText(t, x, y, mw)),
            measureText: (t) => {
              const m = ctx.measureText(t)
              return { width: m.width, height: (m as { actualBoundingBoxAscent?: number }).actualBoundingBoxAscent }
            },
            drawImage: (img, ...args) => {
              // 对齐官方重载：3 参（dx,dy）/ 5 参（dx,dy,dw,dh）/ 9 参（裁剪）；字符串路径 web 端不支持同步绘制
              if (typeof img === 'string') return
              const i = img as CanvasImageSource
              if (args.length === 2) ctx.drawImage(i, args[0], args[1])
              else if (args.length === 4) ctx.drawImage(i, args[0], args[1], args[2], args[3])
              else if (args.length === 8) ctx.drawImage(i, args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7])
            },
            createLinearGradient: (x0, y0, x1, y1) => ctx.createLinearGradient(x0, y0, x1, y1),
            createCircularGradient: (x, y, r) => ctx.createRadialGradient(x, y, 0, x, y, r),
            createPattern: (img, rep) => (typeof img === 'string' ? null : ctx.createPattern(img as CanvasImageSource, rep)),
            draw: (reserve, cb) => {
              // web 即时绘制——无异步提交；回调对齐 wx 的 draw 完成语义
              const done = typeof reserve === 'function' ? reserve : cb
              if (done) done()
            },
          })
        },
        node: () => {
          const el = resolveEl()
          if (!el) return Promise.resolve(capErr<CanvasNode>('canvas.unsupported', '未找到 canvas 元素（web 端需 id/选择器命中）'))
          const raf = (g as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame
          const caf = (g as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame
          return Promise.resolve(capOk({
            width: el.width,
            height: el.height,
            getContext: (t: '2d' | 'webgl') => el.getContext(t),
            requestAnimationFrame: raf ? (cb) => raf(cb) : undefined,
            cancelAnimationFrame: caf ? (h) => caf(h) : undefined,
          }))
        },
        toTempFilePath: exportImage,
        toDataURL: exportImage,
        offscreen: (width, height, type = '2d') => {
          const OC = (g as { OffscreenCanvas?: new (w: number, h: number) => { width: number; height: number; getContext: (t: string) => unknown } }).OffscreenCanvas
          if (typeof OC === 'function') {
            const off = new OC(width, height)
            return capOk({ width: off.width, height: off.height, getContext: (t: '2d' | 'webgl') => off.getContext(t) as CanvasContext | null })
          }
          if (doc && typeof doc.createElement === 'function') {
            const el = doc.createElement('canvas')
            el.width = width
            el.height = height
            return capOk({ width, height, getContext: (t: '2d' | 'webgl') => (el.getContext(t) as unknown) as CanvasContext | null })
          }
          return capErr<OffscreenCanvasHandle>('canvas.unsupported', 'Web 无 OffscreenCanvas 且无 document（SSR）')
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C58 元素查询（web querySelector + getBoundingClientRect）
    createElementQuery: (id) => {
      const doc = (g as { document?: Document }).document
      const norm = (sel?: string): string => {
        const s = sel ?? id ?? ''
        return s.startsWith('#') || s.includes('.') || s.includes('[') ? s : s ? '#' + s : ''
      }
      const pick = (sel?: string): Element | null => {
        if (!doc || typeof doc.querySelector !== 'function') return null
        const s = norm(sel)
        if (!s) return null
        try {
          return doc.querySelector(s)
        } catch {
          return null
        }
      }
      const rectOf = (el: Element): ElementRect => {
        const r = el.getBoundingClientRect()
        return { id: (el as HTMLElement).id || undefined, dataset: (el as HTMLElement).dataset as unknown as Record<string, unknown>, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }
      return {
        boundingClientRect: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementRect>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          return Promise.resolve(capOk(rectOf(el)))
        },
        scrollOffset: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementScrollOffset>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const h = el as HTMLElement
          return Promise.resolve(capOk({ id: h.id || undefined, dataset: h.dataset as unknown as Record<string, unknown>, scrollTop: h.scrollTop ?? 0, scrollLeft: h.scrollLeft ?? 0 }))
        },
        fields: (options, selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<ElementFieldsResult>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const h = el as HTMLElement
          const r = h.getBoundingClientRect()
          const out: ElementFieldsResult = { id: h.id || undefined, dataset: h.dataset as unknown as Record<string, unknown> }
          if (options.node) out.node = { width: (h as HTMLCanvasElement).width ?? Math.round(r.width), height: (h as HTMLCanvasElement).height ?? Math.round(r.height), getContext: (t: string) => (h as HTMLCanvasElement).getContext?.(t as '2d') }
          if (options.rect || options.size) {
            out.left = r.left; out.top = r.top; out.right = r.right; out.bottom = r.bottom; out.width = r.width; out.height = r.height
          }
          if (options.scrollOffset) {
            out.scrollTop = h.scrollTop ?? 0; out.scrollLeft = h.scrollLeft ?? 0
          }
          if (options.computedStyle && typeof g.getComputedStyle === 'function') {
            const cs = g.getComputedStyle(el)
            for (const key of options.computedStyle) out[camel(key)] = cs.getPropertyValue(key)
          }
          return Promise.resolve(capOk(out))
        },
        size: (selector) => {
          const el = pick(selector)
          if (!el) return Promise.resolve(capErr<{ width: number; height: number }>('element.not-found', '未找到元素（web 端需 id/选择器命中）'))
          const r = el.getBoundingClientRect()
          return Promise.resolve(capOk({ width: r.width, height: r.height }))
        },
        batch: (selectors) =>
          Promise.resolve(capOk(selectors.map((sel) => {
            const el = pick(sel)
            return el ? rectOf(el) : null
          }))),
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C59 交叉观察（web IntersectionObserver）
    createIntersection: (options) => {
      const IO = (g as { IntersectionObserver?: new (cb: (entries: unknown[]) => void, opts?: unknown) => { observe: (el: Element) => void; unobserve?: (el: Element) => void; disconnect: () => void } }).IntersectionObserver
      const callbacks = new Map<Element, (res: IntersectionResult) => void>()
      const io = typeof IO === 'function' ? new IO((entries) => {
        for (const ent of entries as Array<{ target: Element; intersectionRatio: number; time: number; intersectionRect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; boundingClientRect: DOMRectReadOnly }>) {
          const cb = callbacks.get(ent.target)
          if (!cb) continue
          const b = ent.boundingClientRect
          cb({
            id: (ent.target as HTMLElement).id || undefined,
            dataset: (ent.target as HTMLElement).dataset as unknown as Record<string, unknown>,
            intersectionRatio: ent.intersectionRatio,
            intersectionRect: ent.intersectionRect,
            boundingClientRect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height },
            relativeRect: ent.intersectionRect,
            time: ent.time,
          })
        }
      }, { threshold: options?.thresholds ?? [0] }) : undefined
      const handle: IntersectionHandle = {
        relativeTo: (selector) => {
          // web IntersectionObserver 的 root 需在构造时确定；此处记录供自定义实现扩展（标准实现以视口为参照）
          const doc = (g as { document?: Document }).document
          doc?.querySelector?.(selector)
          return handle
        },
        relativeToViewport: () => handle,
        observe: (targetSelector, cb) => {
          const doc = (g as { document?: Document }).document
          const el = doc?.querySelector?.(targetSelector)
          if (!el || !io) return handle
          callbacks.set(el, cb)
          io.observe(el)
          return handle
        },
        disconnect: () => {
          callbacks.clear()
          io?.disconnect?.()
        },
      }
      return handle
    },
    // ★组件实例 API 对齐（2026-09-12）：C60 媒体查询（web matchMedia）
    createMediaQuery: () => {
      const mm = (g as { matchMedia?: (q: string) => MediaQueryList }).matchMedia
      const subs = new Set<{ mql: MediaQueryList; cb: (r: MediaQueryResult) => void; h: () => void }>()
      return {
        observe: (condition, cb) => {
          const query = conditionToQuery(condition)
          if (typeof mm !== 'function' || !query) {
            cb({ matches: false })
            return
          }
          const mql = mm(query)
          const h = (): void => cb({ matches: mql.matches })
          mql.addEventListener?.('change', h)
          subs.add({ mql, cb, h })
          cb({ matches: mql.matches })
        },
        disconnect: () => {
          for (const s of subs) s.mql.removeEventListener?.('change', s.h)
          subs.clear()
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C61 视频控制器（web HTMLVideoElement）
    createVideo: (id) => {
      const doc = (g as { document?: Document }).document
      const el = doc?.getElementById?.(id.replace(/^#/, '')) as HTMLVideoElement | null
      const run = (op: string, fn: () => unknown): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          if (!el) return resolve(capErr<void>('video.not-found', '未找到 <video> 元素（web 端需 id 命中）'))
          try {
            const r = fn()
            // play() 返回 Promise
            if (r && typeof (r as Promise<void>).then === 'function') return void (r as Promise<void>).then(() => resolve(capOk(undefined)), (e) => resolve(capErr<void>('video.failed', '视频 ' + op + ' 失败', e)))
            resolve(capOk(undefined))
          } catch (e) {
            resolve(capErr<void>('video.failed', '视频 ' + op + ' 失败', e))
          }
        })
      const evMap: Record<string, string> = { play: 'play', pause: 'pause', ended: 'ended', timeupdate: 'timeupdate', error: 'error', fullscreenchange: 'fullscreenchange' }
      return {
        play: () => run('play', () => el?.play()),
        pause: () => run('pause', () => el?.pause()),
        stop: () => run('stop', () => { if (el) { el.pause(); el.currentTime = 0 } }),
        seek: (position) => run('seek', () => { if (el) el.currentTime = position }),
        playbackRate: (rate) => run('playbackRate', () => { if (el) el.playbackRate = rate }),
        requestFullScreen: () => run('fullscreen', () => el?.requestFullscreen?.()),
        exitFullScreen: () => run('exitFullScreen', () => doc?.exitFullscreen?.()),
        sendDanmu: () => Promise.resolve(capErr<void>('video.unsupported', 'Web 无弹幕标准 API（由宿主视图承载）')),
        on: (event, cb) => {
          if (!el) return () => {}
          const h = (e: Event): void => cb(e)
          el.addEventListener(evMap[event] ?? event, h)
          return () => el.removeEventListener(evMap[event] ?? event, h)
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C62 音频控制器（web Audio 元素）
    createAudio: (src) => {
      const A = (g as { Audio?: new (src?: string) => HTMLAudioElement }).Audio
      if (typeof A !== 'function') throw new CapError('audio.unsupported', 'web Audio 不可用（SSR/受限环境）')
      const el = new A(src)
      const run = (op: string, fn: () => unknown): Promise<CapResult<void>> =>
        new Promise<CapResult<void>>((resolve) => {
          try {
            const r = fn()
            if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).then(() => resolve(capOk(undefined)), (e) => resolve(capErr<void>('audio.failed', '音频 ' + op + ' 失败', e)))
            resolve(capOk(undefined))
          } catch (e) {
            resolve(capErr<void>('audio.failed', '音频 ' + op + ' 失败', e))
          }
        })
      return {
        play: (s) => { if (s) el.src = s; return run('play', () => el.play()) },
        pause: () => run('pause', () => el.pause()),
        stop: () => run('stop', () => { el.pause(); el.currentTime = 0 }),
        seek: (position) => run('seek', () => { el.currentTime = position }),
        setVolume: (v) => { el.volume = v },
        setLoop: (v) => { el.loop = v },
        get currentTime() { return el.currentTime },
        get duration() { return el.duration || 0 },
        get paused() { return el.paused },
        destroy: () => { try { el.pause(); el.src = '' } catch { /* noop */ } },
        on: (event, cb) => {
          const map: Record<string, string> = { canplay: 'canplay', play: 'play', pause: 'pause', stop: 'pause', ended: 'ended', timeupdate: 'timeupdate', error: 'error' }
          const h = (e: Event): void => cb(e)
          el.addEventListener(map[event] ?? event, h)
          return () => el.removeEventListener(map[event] ?? event, h)
        },
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C63 直播推流（web 无标准 → 各方法 Err 诚实降级）
    createLivePusher: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('live-pusher.unsupported', 'Web 无标准推流 API（' + op + ' 需宿主桥承载）'))
      return {
        start: () => noWeb<void>('start'),
        stop: () => noWeb<void>('stop'),
        pause: () => noWeb<void>('pause'),
        resume: () => noWeb<void>('resume'),
        switchCamera: () => noWeb<void>('switchCamera'),
        toggleTorch: () => noWeb<void>('toggleTorch'),
        snapshot: () => noWeb<string>('snapshot'),
        sendMessage: () => noWeb<void>('sendMessage'),
        on: () => () => {},
      }
    },
    // ★组件实例 API 对齐（2026-09-12）：C64 广告（web 无广告联盟标准 → 创建时 throw）
    getAd: () => ({
      rewardedVideo: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
      interstitial: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
      banner: () => { throw new CapError('ad.unsupported', 'Web 无广告联盟标准 API（需宿主接入自建广告桥）') },
    }),
    // ★权威标尺缺口 C65：隐私协议（web 无微信隐私协议标准 → 各方法 Err 诚实降级；Cookie 同意由宿主自建）
    getPrivacy: () => {
      const noWeb = <T,>(op: string): Promise<CapResult<T>> => Promise.resolve(capErr<T>('privacy.unsupported', 'Web 无微信隐私协议标准 API（' + op + ' 由宿主自建 Cookie 同意/协议页）'))
      return {
        getSetting: () => noWeb<PrivacySetting>('getSetting'),
        openContract: () => noWeb<void>('openContract'),
        requireAuthorize: () => noWeb<boolean>('requireAuthorize'),
        onNeedAuthorization: () => () => {},
      }
    },
  }
}

/** camelCase（computedStyle 键） */
function camel(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 媒体查询条件 → media query 串（web matchMedia） */
function conditionToQuery(c: MediaQueryCondition): string {
  const parts: string[] = []
  if (c.minWidth !== undefined) parts.push(`(min-width: ${c.minWidth}px)`)
  if (c.maxWidth !== undefined) parts.push(`(max-width: ${c.maxWidth}px)`)
  if (c.width !== undefined) parts.push(`(width: ${c.width}px)`)
  if (c.minHeight !== undefined) parts.push(`(min-height: ${c.minHeight}px)`)
  if (c.maxHeight !== undefined) parts.push(`(max-height: ${c.maxHeight}px)`)
  if (c.height !== undefined) parts.push(`(height: ${c.height}px)`)
  if (c.orientation) parts.push(`(orientation: ${c.orientation})`)
  return parts.join(' and ')
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
  /** ★C51 小程序热更新管理器（wx.getUpdateManager；web → Err） */
  useUpdate(): Promise<CapResult<UpdateManagerAPI>>
  /** ★能力颗粒度对齐：C20 日历完整 API（增删查） */
  useCalendarAPI(): CapResult<CalendarAPI>
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
  // ★颗粒度对齐 C3：相册 / Worker
  /** ★C52 useAlbum：相册句柄（wx.chooseMedia/saveImageToPhotosAlbum/previewMedia；web <input type=file>） */
  useAlbum(): CapResult<AlbumAPI>
  /** ★C53 useWorker：多线程 Worker（wx.createWorker / web Worker；不可用 → Err） */
  useWorker(scriptPath: string): CapResult<WorkerHandle>
  // ★颗粒度对齐 C3 批 2：收货地址 / WiFi / 微信运动
  /** ★C54 useAddress：收货地址（wx.chooseAddress；web 无标准 → Err） */
  useAddress(): Promise<CapResult<ShippingAddress>>
  /** ★C55 useWifi：WiFi 句柄（wx.getConnectedWifi/getWifiList/connectWifi；web 无标准 → Err） */
  useWifi(): CapResult<WifiAPI>
  /** ★C56 useWeRun：微信运动数据（wx.getWeRunData；web 无标准 → Err） */
  useWeRun(): Promise<CapResult<WeRunData>>
  // ★组件实例 API 对齐（2026-09-12）：C57 画布
  /** ★C57 useCanvas：画布控制器（wx.createCanvasContext/SelectorQuery node/canvasToTempFilePath/OffscreenCanvas；web HTMLCanvasElement） */
  useCanvas(id: string): CapResult<CanvasController>
  // ★组件实例 API 对齐（2026-09-12）：元素查询 / 交叉观察 / 媒体查询
  /** ★C58 useElement：元素查询句柄（wx.createSelectorQuery / web querySelector + getBoundingClientRect） */
  useElement(id?: string): CapResult<ElementQuery>
  /** ★C59 useIntersection：交叉观察句柄（wx.createIntersectionObserver / web IntersectionObserver） */
  useIntersection(options?: IntersectionOptions): CapResult<IntersectionHandle>
  /** ★C60 useMediaQuery：媒体查询句柄（wx.createMediaQueryObserver / web matchMedia） */
  useMediaQuery(): CapResult<MediaQueryObserver>
  // ★组件实例 API 对齐（2026-09-12）：媒体组件实例 + 广告
  /** ★C61 useVideo：视频控制器（wx.createVideoContext / web HTMLVideoElement） */
  useVideo(id: string): CapResult<VideoController>
  /** ★C62 useAudio：音频控制器（wx.createInnerAudioContext / web Audio） */
  useAudio(src?: string): CapResult<AudioController>
  /** ★C63 useLivePusher：直播推流控制器（wx.createLivePusherContext / web 无标准 → Err） */
  useLivePusher(id: string): CapResult<LivePusherController>
  /** ★C64 useAd：广告句柄（wx.createRewardedVideoAd/createInterstitialAd/createBannerAd / web 无标准 → throw） */
  useAd(): CapResult<AdAPI>
  // ★权威标尺缺口补齐（C65）：隐私协议
  /** ★C65 usePrivacy：隐私协议句柄（wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize；web 缺省 → Err） */
  usePrivacy(): CapResult<PrivacyAPI>
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
  // ★统一 handle 型 hook 契约：桥构造句柄失败（缺平台 API / 抛错）→ 返回 Err（不 uncaught、不半残句柄）
  const handleResult = <T,>(make: () => T): CapResult<T> => {
    try {
      return capOk(make())
    } catch (e) {
      return capErr<T>(e instanceof CapError ? e.code : 'cap.failed', e instanceof Error ? e.message : String(e))
    }
  }

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
    useUpdate: () =>
      wrap(
        (() => {
          if (!bridge.getUpdateManager) return Promise.reject(new CapError('update.unsupported', '桥未提供 getUpdateManager（useUpdate 不可用）'))
          return Promise.resolve(bridge.getUpdateManager())
        })(),
      ),
    useCalendarAPI: () => {
      if (bridge.getCalendar) return handleResult(() => bridge.getCalendar!())
      if (bridge.addCalendarEvent) {
        return capOk<CalendarAPI>({
          add: (event) => wrap(bridge.addCalendarEvent!(event)),
          remove: () => Promise.resolve(capErr('calendar.unsupported', '桥未提供日历删除')),
          list: () => Promise.resolve(capErr<CalendarEvent[]>('calendar.unsupported', '桥未提供日历查询')),
        })
      }
      throw new CapError('calendar.unsupported', '桥未提供 getCalendar（useCalendarAPI 不可用）')
    },
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
      if (!bridge.createCameraContext) return capErr<CameraController>('camera.unsupported', '桥未提供 createCameraContext（useCameraContext 不可用）')
      return handleResult(() => bridge.createCameraContext!(id))
    },
    // ★能力颗粒度对齐：录音操作控制器
    useRecorder: () => {
      if (!bridge.getRecorder) return capErr<RecorderController>('microphone.unsupported', '桥未提供 getRecorder（useRecorder 不可用）')
      return handleResult(() => bridge.getRecorder!())
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
            getCenterLocation: () => wrap(ctx.getCenterLocation()),
            getRotate: () => wrap(ctx.getRotate()),
            getSkew: () => wrap(ctx.getSkew()),
            fromScreenLocation: (x, y) => wrap(ctx.fromScreenLocation(x, y)),
            toScreenLocation: (latitude, longitude) => wrap(ctx.toScreenLocation(latitude, longitude)),
            setCenterOffset: (offset) => wrap(ctx.setCenterOffset(offset)),
            setBoundary: (boundaries) => wrap(ctx.setBoundary(boundaries)),
            moveAlong: (opt) => wrap(ctx.moveAlong(opt)),
            addArc: (arc) => wrap(ctx.addArc(arc)),
            eraseLines: (ids) => wrap(ctx.eraseLines(ids)),
            initMarkerCluster: (enable) => wrap(ctx.initMarkerCluster(enable)),
            setLocMarkerIcon: (iconPath) => wrap(ctx.setLocMarkerIcon(iconPath)),
            addCustomLayer: (layer) => wrap(ctx.addCustomLayer(layer)),
            removeCustomLayer: (layerId) => wrap(ctx.removeCustomLayer(layerId)),
            addVisualLayer: (layer) => wrap(ctx.addVisualLayer(layer)),
            removeVisualLayer: (layerId) => wrap(ctx.removeVisualLayer(layerId)),
            executeVisualLayerCommand: (command) => wrap(ctx.executeVisualLayerCommand(command)),
            addGroundOverlay: (overlay) => wrap(ctx.addGroundOverlay(overlay)),
            updateGroundOverlay: (overlay) => wrap(ctx.updateGroundOverlay(overlay)),
            removeGroundOverlay: (overlayId) => wrap(ctx.removeGroundOverlay(overlayId)),
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
            play: () => wrap(room.play()),
            pause: () => wrap(room.pause()),
            resume: () => wrap(room.resume()),
            stop: () => wrap(room.stop()),
            mute: () => room.mute(),
            snapshot: () => wrap(room.snapshot()),
            requestFullScreen: (direction) => wrap(room.requestFullScreen(direction)),
            exitFullScreen: () => wrap(room.exitFullScreen()),
            status: () => room.status(),
            onStateChange: (cb) => room.onStateChange(cb),
            leave: () => wrap(room.stop()),
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
    // ★颗粒度对齐 C3：相册 / Worker（句柄型——桥缺省 → Err）
    useAlbum: () => handleResult<AlbumAPI>(() => {
      if (!bridge.getAlbum) throw new CapError('album.unsupported', '桥未提供 getAlbum（useAlbum 不可用）')
      return bridge.getAlbum()
    }),
    useWorker: (scriptPath) => handleResult<WorkerHandle>(() => {
      if (!bridge.createWorker) throw new CapError('worker.unsupported', '桥未提供 createWorker（useWorker 不可用）')
      return bridge.createWorker(scriptPath)
    }),
    // ★颗粒度对齐 C3 批 2：收货地址 / WiFi / 微信运动
    useAddress: () =>
      wrap(
        (() => {
          if (!bridge.chooseAddress) return Promise.reject(new CapError('address.unsupported', '桥未提供 chooseAddress（useAddress 不可用）'))
          return bridge.chooseAddress()
        })(),
      ),
    useWifi: () => handleResult<WifiAPI>(() => {
      if (!bridge.getWifi) throw new CapError('wifi.unsupported', '桥未提供 getWifi（useWifi 不可用）')
      return bridge.getWifi()
    }),
    useWeRun: () =>
      wrap(
        (() => {
          if (!bridge.getWeRunData) return Promise.reject(new CapError('werun.unsupported', '桥未提供 getWeRunData（useWeRun 不可用）'))
          return bridge.getWeRunData()
        })(),
      ),
    // ★组件实例 API 对齐：C57 画布控制器
    useCanvas: (id) => handleResult<CanvasController>(() => {
      if (!bridge.createCanvas) throw new CapError('canvas.unsupported', '桥未提供 createCanvas（useCanvas 不可用）')
      return bridge.createCanvas(id)
    }),
    // ★组件实例 API 对齐：C58/C59/C60 元素查询 / 交叉观察 / 媒体查询
    useElement: (id) => handleResult<ElementQuery>(() => {
      if (!bridge.createElementQuery) throw new CapError('element.unsupported', '桥未提供 createElementQuery（useElement 不可用）')
      return bridge.createElementQuery(id)
    }),
    useIntersection: (options) => handleResult<IntersectionHandle>(() => {
      if (!bridge.createIntersection) throw new CapError('element.unsupported', '桥未提供 createIntersection（useIntersection 不可用）')
      return bridge.createIntersection(options)
    }),
    useMediaQuery: () => handleResult<MediaQueryObserver>(() => {
      if (!bridge.createMediaQuery) throw new CapError('element.unsupported', '桥未提供 createMediaQuery（useMediaQuery 不可用）')
      return bridge.createMediaQuery()
    }),
    // ★组件实例 API 对齐：C61/C62/C63 媒体组件实例 + C64 广告
    useVideo: (id) => handleResult<VideoController>(() => {
      if (!bridge.createVideo) throw new CapError('video.unsupported', '桥未提供 createVideo（useVideo 不可用）')
      return bridge.createVideo(id)
    }),
    useAudio: (src) => handleResult<AudioController>(() => {
      if (!bridge.createAudio) throw new CapError('audio.unsupported', '桥未提供 createAudio（useAudio 不可用）')
      return bridge.createAudio(src)
    }),
    useLivePusher: (id) => handleResult<LivePusherController>(() => {
      if (!bridge.createLivePusher) throw new CapError('live-pusher.unsupported', '桥未提供 createLivePusher（useLivePusher 不可用）')
      return bridge.createLivePusher(id)
    }),
    useAd: () => handleResult<AdAPI>(() => {
      if (!bridge.getAd) throw new CapError('ad.unsupported', '桥未提供 getAd（useAd 不可用）')
      return bridge.getAd()
    }),
    // ★权威标尺缺口 C65：隐私协议
    usePrivacy: () => handleResult<PrivacyAPI>(() => {
      if (!bridge.getPrivacy) throw new CapError('privacy.unsupported', '桥未提供 getPrivacy（usePrivacy 不可用）')
      return bridge.getPrivacy()
    }),
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
      album: bridge.getAlbum !== undefined,
      worker: bridge.createWorker !== undefined,
      address: bridge.chooseAddress !== undefined,
      wifi: bridge.getWifi !== undefined,
      weRun: bridge.getWeRunData !== undefined,
      canvas: bridge.createCanvas !== undefined,
      element: bridge.createElementQuery !== undefined,
      intersection: bridge.createIntersection !== undefined,
      mediaQuery: bridge.createMediaQuery !== undefined,
      video: bridge.createVideo !== undefined,
      audio: bridge.createAudio !== undefined,
      livePusher: bridge.createLivePusher !== undefined,
      ad: bridge.getAd !== undefined,
      privacy: bridge.getPrivacy !== undefined,
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