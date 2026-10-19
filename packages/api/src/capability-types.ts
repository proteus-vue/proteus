// packages/api/src/capability-types.ts —— 能力层**类型契约**（自 capability.ts 拆出 · 决策 #870）
//   【为什么拆】capability.ts 曾 8987 行（巨型文件）；本文件收纳全部 interface/type 契约 +
//   CapResult/CapError/capOk/capErr（纯形状 + 结果原语，零运行时平台依赖）。平台桥实现见
//   capability-bridges.ts，工厂/Hook/响应式见 capability.ts。
//   ★纯机械搬迁，行为零变化（门禁：capability-*.test.ts + 根 vue-tsc + 包 build）。
import { createAuth } from './auth'
import type { HttpMethod, RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'
import type { AppLifecycleHandle, PageLifecycleHandle } from './capability-app'
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
export interface NotificationConstructor {
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

/**
 * ★★C23 应用生命周期句柄（**扩展为完整事件面**——2026-09-30）。
 *
 * 【类型收口（防漂移）】定义在 `capability-app.ts` 的 `AppLifecycleHandle`，
 *   此处仅做别名导出——**单一事实源**。三端（MP/Web/App）共用同一句柄形状：
 *   MP 走 wx 全局 API + 产物派发；Web 走 visibilitychange/resize/scroll；
 *   App 走壳（G-39 运行时）转发。事件面 SSOT 见 `APP_EVENTS`（11 个事件）。
 */
export type AppLifecycle = AppLifecycleHandle

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

/**
 * ★★C24 页面生命周期句柄（**扩展为完整事件面**——2026-09-30）。
 *
 * 【类型收口】定义在 `capability-app.ts` 的 `PageLifecycleHandle`，此处仅别名导出。
 * 覆盖 15 个页面事件（`PAGE_EVENTS`）：阶段事件（load/show/ready/hide/unload）+
 * 页面事件（route-done/pull-down-refresh/reach-bottom/page-scroll/resize/tab-item-tap）+
 * 决策型（share-app-message/share-timeline/add-to-favorites/save-exit-state——单处理器）。
 */
export type PageLifecycle = PageLifecycleHandle

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
 *   wx：`wx.createSelectorQuery()`（rect / scrollOffset / fields + node/rect/size）+ `createIntersectionObserver`；
 *   web：`querySelector` + `getBoundingClientRect()`。★App 选择器支持面见各方法 `@param selector`（#1082）；坐标为视口坐标（同 Web）。
 */
export interface ElementQuery {
  /**
   * 查询元素几何。
   * @param selector CSS 选择器（缺省 = 句柄初始 id）。App 端支持 `#id` / `.class` / `tag` / 复合 / 后代 / `>` / 选择器列表 / `[attr]`；兄弟（`+` `~`）、伪类、伪元素、属性运算符返回 `element.unsupported`
   */
  boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>
  /**
   * 查询元素滚动位置。
   * @param selector CSS 选择器（缺省 = 句柄初始 id）。App 端支持 `#id` / `.class` / `tag` / 复合 / 后代 / `>` / 选择器列表 / `[attr]`；兄弟（`+` `~`）、伪类、伪元素、属性运算符返回 `element.unsupported`
   */
  scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>
  /**
   * 按需查询元素字段（node/rect/size/scrollOffset/computedStyle）。
   * @param options 字段开关
   * @param selector CSS 选择器（缺省 = 句柄初始 id）。App 端支持 `#id` / `.class` / `tag` / 复合 / 后代 / `>` / 选择器列表 / `[attr]`；兄弟（`+` `~`）、伪类、伪元素、属性运算符返回 `element.unsupported`
   */
  fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>
  /**
   * 查询元素尺寸（boundingClientRect 的常用投影）。
   * @param selector CSS 选择器（缺省 = 句柄初始 id）。App 端支持 `#id` / `.class` / `tag` / 复合 / 后代 / `>` / 选择器列表 / `[attr]`；兄弟（`+` `~`）、伪类、伪元素、属性运算符返回 `element.unsupported`
   */
  size(selector?: string): Promise<CapResult<{ width: number; height: number }>>
  /**
   * 批量查询（同一查询内选择器数组——对齐官方 selectAll 的批量语义）。
   * @param selectors CSS 选择器数组（App 端支持面同 `boundingClientRect`；数组内查不到的元素回 `null`）
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

// —— ★权威标尺缺口补齐（2026-09-12）：C66 性能 / C67 预加载 / C68 图像编辑 ——

/** 性能条目（wx PerformanceEntry 子集——navigation 导航 / render 渲染 / script 脚本） */
export interface PerformanceEntry {
  /** 条目名（路由名 / 脚本路径等） */
  name: string
  /** 条目类型 */
  entryType: 'navigation' | 'render' | 'script'
  /** 时长（ms） */
  duration: number
  /** 开始时间（ms） */
  startTime?: number
  /** 关联文件列表（script 类） */
  fileList?: string[]
  /** 模块名（script 类） */
  moduleName?: string
}

/** 性能观察器句柄（wx PerformanceObserver 子集） */
export interface PerformanceObserverHandle {
  /**
   * 开始观察新性能条目。
   * @param cb 新条目回调
   * @param entryTypes 订阅的条目类型（缺省全部）
   */
  observe(cb: (entries: PerformanceEntry[]) => void, entryTypes?: string[]): void
  /** 取消观察（释放） */
  disconnect(): void
}

/**
 * ★权威标尺缺口 C66：性能（wx.getPerformance / wx.reportPerformance）。
 *   条目读取（navigation 导航 / render 渲染 / script 脚本）+ 实时观察 + 自定义指标上报
 *   （上报需在小程序后台配置指标 id）。
 *   web：`performance.getEntries*` 承接条目读取；`report` 无对等上报后端 → Err。
 */
export interface PerformanceAPI {
  /** 读取性能条目（可按类型过滤） */
  getEntries(entryType?: 'navigation' | 'render' | 'script'): Promise<CapResult<PerformanceEntry[]>>
  /** 按名字读取性能条目 */
  getEntriesByName(name: string, entryType?: string): Promise<CapResult<PerformanceEntry[]>>
  /** 创建观察器（实时推送新条目） */
  createObserver(): PerformanceObserverHandle
  /** 设置性能缓冲区大小（条目数上限） */
  setBufferSize(size: number): void
  /**
   * 上报自定义性能指标（微信性能监控平台——需后台配置 id）。
   * @param id 指标 id
   * @param value 指标值
   * @param dimensions 自定义维度（字符串或数组）
   */
  report(id: number, value: number, dimensions?: string | unknown[]): Promise<CapResult<void>>
}

/** 预加载资源项（wx.preloadAssets——字体/图片） */
export interface PreloadAsset {
  /** 资源地址 */
  src: string
  /** 资源类型（font 字体 / image 图片） */
  type: 'font' | 'image'
}

/** 分包预下载任务句柄（wx.preDownloadSubpackage 返回） */
export interface PreDownloadTask {
  /**
   * 订阅下载进度。
   * @param cb 进度回调（progress 百分比 / 已下载字节 / 预期总字节）
   * @returns 取消订阅函数
   */
  onProgressUpdate(cb: (res: { progress: number; totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void): () => void
}

/**
 * ★权威标尺缺口 C67：预加载（wx.preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage）。
 *   「用空间换时间」——提前拉取资源 / 视图 / 分包，降低首屏与页面切换等待。
 *   web：无标准预加载 API（可用 `<link rel=preload>` 或动态 import 替代）→ 各方法 Err 诚实降级。
 */
export interface PreloadAPI {
  /**
   * 预加载资源（字体 / 图片）。
   * @param data 资源列表
   */
  assets(data: PreloadAsset[]): Promise<CapResult<void>>
  /** 预加载 Skyline 视图（配合 Skyline 渲染器的页面预载） */
  skylineView(): Promise<CapResult<void>>
  /** 预加载 WebView 页面 */
  webview(): Promise<CapResult<void>>
  /**
   * 预下载分包（目前仅 workers 分包）。
   * @param packageType 分包类型（'workers'）
   */
  subpackage(packageType: string): Promise<CapResult<PreDownloadTask>>
}

/**
 * ★权威标尺缺口 C68：图像编辑（wx.cropImage / wx.editImage）。
 *   裁剪（固定比例）+ 自由编辑 → 输出临时图片路径。
 *   web：无微信编辑 UI → Err 诚实降级（可用 canvas 自实现裁剪）。
 */
export interface ImageEditAPI {
  /**
   * 裁剪图片（拉起裁剪 UI，按比例）。
   * @param src 图片路径
   * @param cropScale 裁剪比例（16:9 / 9:16 / 4:3 / 3:4 / 5:4 / 4:5 / 1:1）
   * @returns 裁剪后临时文件路径
   */
  crop(src: string, cropScale: '16:9' | '9:16' | '4:3' | '3:4' | '5:4' | '4:5' | '1:1'): Promise<CapResult<string>>
  /**
   * 编辑图片（拉起编辑 UI——涂鸦 / 裁剪 / 文字 / 马赛克）。
   * @param src 图片路径
   * @returns 编辑后临时文件路径
   */
  edit(src: string): Promise<CapResult<string>>
}

// —— ★权威标尺缺口补齐（2026-09-12）：C69 网络底层 / C70 媒体高级 ——

/** UDP 收到的消息（wx UDPSocket onMessage） */
export interface UdpMessage {
  /** 消息载荷（ArrayBuffer） */
  message: ArrayBuffer
  /** 发送端地址 */
  remoteAddress: string
  /** 发送端端口 */
  remotePort: number
  /** 发送端协议族（IPv4 / IPv6） */
  family?: string
}

/**
 * ★权威标尺缺口 C69-a：UDP Socket（`useUDPSocket()`）。
 *   wx：`wx.createUDPSocket()`；web：无 UDP 标准 API（浏览器不支持裸 UDP）→ Err 诚实降级。
 */
export interface UDPSocketHandle {
  /** 绑定本地端口（缺省系统分配） */
  bind(port?: number): Promise<CapResult<void>>
  /**
   * 预连目标地址（配合 write）。
   * @param address 目标 IP / 域名
   * @param port 目标端口
   */
  connect(address: string, port: number): Promise<CapResult<void>>
  /**
   * 发送消息。
   * @param address 目标地址
   * @param port 目标端口
   * @param message 载荷（字符串或 ArrayBuffer）
   * @param broadcast 是否广播
   */
  send(address: string, port: number, message: string | ArrayBuffer, broadcast?: boolean): Promise<CapResult<void>>
  /**
   * 向已 connect 的地址发送（少写地址；需先 connect）。
   * @param message 载荷
   */
  write(address: string, port: number, message: string | ArrayBuffer): Promise<CapResult<void>>
  /**
   * 订阅收到的消息。
   * @param cb 消息回调
   * @returns 取消订阅函数
   */
  onMessage(cb: (msg: UdpMessage) => void): () => void
  /** 订阅错误 */
  onError(cb: (err: { errMsg: string }) => void): () => void
  /** 关闭 socket（释放） */
  close(): Promise<CapResult<void>>
}

/** TCP Socket 连接选项 */
export interface TCPSocketConnectOptions {
  /** 目标地址 */
  address: string
  /** 目标端口 */
  port: number
  /** 连接超时（ms，缺省 2000） */
  timeout?: number
}

/**
 * ★权威标尺缺口 C69-b：TCP Socket（`useTCPSocket(options?)`）。
 *   wx：`wx.createTCPSocket()`；web：无原始 TCP 标准 API（浏览器不支持）→ Err 诚实降级。
 */
export interface TCPSocketHandle {
  /**
   * 连接目标地址。
   * @param options 地址 / 端口 / 超时
   */
  connect(options: TCPSocketConnectOptions): Promise<CapResult<void>>
  /**
   * 写入数据。
   * @param data 载荷（字符串或 ArrayBuffer）
   */
  write(data: string | ArrayBuffer): Promise<CapResult<void>>
  /**
   * 订阅收到的消息。
   * @param cb 消息回调（message = ArrayBuffer）
   * @returns 取消订阅函数
   */
  onMessage(cb: (res: { message: ArrayBuffer; localInfo?: unknown; remoteInfo?: unknown }) => void): () => void
  /** 订阅连接建立成功 */
  onConnect(cb: () => void): () => void
  /** 订阅错误 */
  onError(cb: (err: { errMsg: string }) => void): () => void
  /** 订阅连接关闭 */
  onClose(cb: () => void): () => void
  /** 关闭连接（释放） */
  close(): Promise<CapResult<void>>
}

/**
 * ★权威标尺缺口 C70：媒体高级（wx.createMediaContainer / createVideoDecoder / createMediaAudioPlayer）。
 *   MediaContainer 视频轨道合成 / VideoDecoder 视频解码取帧 / MediaAudioPlayer 多音源混音。
 *   wx 侧真实接入；web：MediaContainer/MediaAudioPlayer 无标准 → Err（可用 WebCodecs 之 VideoDecoder
 *   做尽力承接），VideoDecoder 有 WebCodecs 标准 → 承接。
 */
export interface MediaTrackInfo {
  /** 轨道类型 */
  kind: 'audio' | 'video'
  /** 源地址 */
  src: string
  /** 轨道起点（秒，可选） */
  startTime?: number
}

export interface MediaContainerHandle {
  /**
   * 添加音视频轨道。
   * @param track 轨道信息
   */
  addTrack(track: MediaTrackInfo): Promise<CapResult<void>>
  /**
   * 移除轨道。
   * @param track 轨道信息
   */
  removeTrack(track: MediaTrackInfo): Promise<CapResult<void>>
  /**
   * 分离视频源为轨道（不自动加入容器）。
   * @param src 视频源地址
   * @returns 分离出的轨道
   */
  extractDataSource(src: string): Promise<CapResult<MediaTrackInfo[]>>
  /**
   * 合成并导出视频。
   * @returns 导出结果（临时文件路径）
   */
  export(): Promise<CapResult<string>>
  /** 销毁容器（释放资源） */
  destroy(): void
}

export interface VideoDecoderHandle {
  /**
   * 开始解码。
   * @param options 源地址与解码选项
   */
  start(options: { source: string; mode?: number; abortAudio?: boolean }): Promise<CapResult<void>>
  /** 解码下一帧（返回帧数据） */
  getFrameData(): Promise<CapResult<{ data: ArrayBuffer; width?: number; height?: number }>>
  /**
   * 跳转到指定时间。
   * @param position 位置（秒）
   */
  seek(position: number): Promise<CapResult<void>>
  /** 停止解码（释放） */
  stop(): Promise<CapResult<void>>
}

export interface MediaAudioPlayerHandle {
  /**
   * 添加音源。
   * @param src 音频地址
   * @param startTime 起始时间（秒）
   */
  addAudioSource(src: string, startTime?: number): Promise<CapResult<void>>
  /**
   * 移除音源。
   * @param src 音频地址
   */
  removeAudioSource(src: string): Promise<CapResult<void>>
  /** 开始混音播放 */
  start(): Promise<CapResult<void>>
  /** 停止播放 */
  stop(): Promise<CapResult<void>>
  /** 销毁（释放） */
  destroy(): void
}

/**
 * ★权威标尺缺口 C70：媒体处理句柄（`useMediaProcessing()`）。
 */
export interface MediaProcessingAPI {
  /** 创建视频轨道合成容器 */
  container(): MediaContainerHandle
  /** 创建视频解码器（取帧） */
  videoDecoder(): VideoDecoderHandle
  /** 创建多音源混音播放器 */
  audioPlayer(): MediaAudioPlayerHandle
}

// —— ★权威标尺缺口补齐（2026-09-12）：C71 录屏/截屏 / C72 缓存管理 / C73 空闲调度 / C74 窗口 / C75 导航拦截 ——

/**
 * ★权威标尺缺口 C71：录屏 / 截屏（`useScreenCapture()`）。
 *   wx：`wx.getScreenRecordingState` / `onScreenRecordingStateChanged` / `onUserCaptureScreen`
 *   / `checkIsPictureInPictureActive`；web：无标准（可用 MediaDevices.getDisplayMedia 探测）→ Err 诚实降级。
 */
export interface ScreenCaptureAPI {
  /** 查询当前系统录屏状态（on 录制中 / off 未录制） */
  getRecordingState(): Promise<CapResult<'on' | 'off'>>
  /**
   * 订阅系统录屏状态变化。
   * @param cb 状态回调
   * @returns 取消订阅函数
   */
  onRecordingStateChange(cb: (state: 'on' | 'off') => void): () => void
  /**
   * 订阅用户主动截屏事件。
   * @param cb 截屏回调
   * @returns 取消订阅函数
   */
  onUserCapture(cb: () => void): () => void
  /** 查询当前是否处于画中画（Picture-in-Picture）状态 */
  isPictureInPictureActive(): Promise<CapResult<boolean>>
}

/** 缓存规则（wx.addRules 的字符串 / 正则形态简化为声明式） */
export interface CacheRule {
  /** 匹配 URL 的字符串或正则源 */
  pattern: string
  /** 缓存方法（缺省 GET） */
  method?: string
  /** 最大缓存时长（秒） */
  maxAge?: number
}

/** 缓存管理器状态 */
export interface CacheManagerState {
  /** 缓存模式（weakNetwork 弱网 / always 总是 / none 关闭） */
  mode: 'weakNetwork' | 'always' | 'none'
  /** 运行状态（0 未启动 / 1 运行中 / 2 已停止——对齐 wx state） */
  state: number
  /** 缓存域名 */
  origin?: string
  /** 默认最大缓存时长（秒） */
  maxAge?: number
}

/**
 * ★权威标尺缺口 C72：缓存管理（`useCacheManager(options?)`）。
 *   wx：`wx.createCacheManager`（HTTP 请求缓存——规则/启停/清理/删除 + 事件）；
 *   web：无对等（可用 Service Worker / Cache Storage）→ 创建时 throw 诚实降级。
 */
export interface CacheManagerHandle {
  /** 缓存规则（可读写） */
  rules: CacheRule[]
  /**
   * 添加缓存规则。
   * @param rules 规则列表
   * @returns 规则 id 列表
   */
  addRules(rules: CacheRule[]): Promise<CapResult<string[]>>
  /**
   * 删除缓存规则。
   * @param ids 规则 id 列表
   */
  deleteRules(ids: string[]): Promise<CapResult<void>>
  /** 清空全部规则 */
  clearRules(): Promise<CapResult<void>>
  /** 启动缓存 */
  start(): Promise<CapResult<void>>
  /** 停止缓存 */
  stop(): Promise<CapResult<void>>
  /**
   * 删除指定 URL 的缓存。
   * @param id 缓存 id
   */
  deleteCache(id: string): Promise<CapResult<void>>
  /**
   * 批量删除缓存。
   * @param ids 缓存 id 列表
   */
  deleteCaches(ids: string[]): Promise<CapResult<void>>
  /** 清空全部缓存 */
  clearCaches(): Promise<CapResult<void>>
  /** 读取当前配置 */
  getState(): CacheManagerState
  /**
   * 订阅缓存事件。
   * @param event 事件（request 命中规则 / enterWeakNetwork 进入弱网 / exitWeakNetwork 退出弱网）
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: 'request' | 'enterWeakNetwork' | 'exitWeakNetwork', cb: (payload: unknown) => void): () => void
}

/** 空闲回调截止信息（requestIdleCallback 回调载荷子集） */
export interface IdleDeadline {
  /** 本次空闲回调剩余时间（ms） */
  timeRemaining(): number
  /** 是否因超时触发（非真正空闲） */
  didTimeout: boolean
}

/**
 * ★权威标尺缺口 C73：空闲调度（`useIdle()`）。
 *   wx：`wx.requestIdleCallback` / `wx.cancelIdleCallback`；web：`requestIdleCallback`（Safari 缺省 → setTimeout 兜底）。
 */
export interface IdleAPI {
  /**
   * 在浏览器/宿主空闲时执行回调。
   * @param cb 空闲回调（携带 deadline）
   * @param timeout 超时（ms，到时即执行）
   * @returns 句柄 id（可传入 cancel）
   */
  request(cb: (deadline: IdleDeadline) => void, timeout?: number): Promise<CapResult<number>>
  /**
   * 取消待执行的空闲回调。
   * @param id 句柄 id
   */
  cancel(id: number): Promise<CapResult<void>>
}

/**
 * ★权威标尺缺口 C74：窗口（`useWindow()`）。
 *   wx：`wx.setWindowSize`（PC 端调整窗口）；web：无标准 → Err 诚实降级。
 */
export interface WindowAPI {
  /**
   * 调整窗口大小（PC 端）。
   * @param width 宽（px）
   * @param height 高（px）
   */
  setSize(width: number, height: number): Promise<CapResult<void>>
}

/**
 * ★权威标尺缺口 C75：导航卸载拦截（`useNavigationGuard()`）。
 *   wx：`wx.enableAlertBeforeUnload` / `disableAlertBeforeUnload`（返回/关闭时弹确认）；
 *   web：`beforeunload` 事件承接（浏览器原生行为）。
 */
export interface NavigationGuardAPI {
  /**
   * 开启卸载前确认弹窗。
   * @param message 询问文案
   */
  enable(message: string): Promise<CapResult<void>>
  /** 关闭卸载前确认弹窗 */
  disable(): Promise<CapResult<void>>
}

// —— ★权威标尺缺口补齐（2026-09-12）：C76 AR/XR / C77 iBeacon / C78 局域网服务 / C79 翻译 / C80 分享海报 / C81 设备能力探测 ——

/** VK（视觉算法）会话状态（wx VKSession.state） */
export type VKSessionState = 0 | 1 | 2 | 3

/**
 * ★权威标尺缺口 C76：AR/XR 视觉算法（`useAR()`）。
 *   wx：`wx.createVKSession`（v1/v2 视觉算法会话——平面检测/人脸/手势/深度/OCR/标记）；
 *   web：`WebXR` 无对等视觉算法 → Err 诚实降级（isVKSupport 恒 false）。
 */
export interface ARSessionHandle {
  /** 会话状态（0 未初始化 / 1 就绪 / 2 运行中 / 3 暂停） */
  state(): VKSessionState
  /** 启动会话 */
  start(): Promise<CapResult<void>>
  /** 停止会话 */
  stop(): Promise<CapResult<void>>
  /** 销毁会话（释放相机/算法资源） */
  destroy(): void
  /**
   * 订阅会话事件。
   * @param event 事件名（update / resize / addAnchors / removeAnchors 等）
   * @param cb 事件处理器
   * @returns 取消订阅函数
   */
  on(event: string, cb: (payload: unknown) => void): () => void
  /** 请求下一帧 VK 数据（驱动算法） */
  requestAnimationFrame(cb: (timestamp: number, frame: unknown) => void): number
  /** 取消动画帧 */
  cancelAnimationFrame(handle: number): void
  /** 取当前 VK 帧 */
  getVKFrame(width?: number, height?: number): unknown
}

export interface AROptions {
  /** 追踪模式（'plane' 平面 / 'marker' 标记 / 'OSD' 图片识别 / 'face' 人脸 / 'hand' 手势 / 'body' 人体 / 'depth' 深度） */
  track?: Record<string, unknown>
  /** 算法版本（缺省 v2） */
  version?: 'v1' | 'v2'
  /** WebGL 上下文（渲染锚点用） */
  gl?: unknown
}

export interface ARAPI {
  /** 创建视觉算法会话 */
  createSession(options?: AROptions): ARSessionHandle
  /**
   * 查询设备是否支持视觉算法。
   * @param version 算法版本（v1 旧版 / v2 iOS 2.22.0+）
   */
  isSupported(version?: 'v1' | 'v2'): Promise<CapResult<boolean>>
}

/** iBeacon 设备信息（wx BeaconInfo） */
export interface BeaconInfo {
  /** 设备 uuid */
  uuid: string
  /** major 值 */
  major: number
  /** minor 值 */
  minor: number
  /** 距离（米） */
  accuracy: number
  /** 信号强度 */
  rssi: number
  /** 距离档位（0 未知 / 1 极近 / 2 近 / 3 远） */
  proximity: 0 | 1 | 2 | 3
}

/**
 * ★权威标尺缺口 C77：iBeacon（`useBeacon()`）。
 *   wx：`wx.onBeaconServiceChange` / `wx.onBeaconUpdate`；web：无对等（可用 Web Bluetooth）→ Err 诚实降级。
 */
export interface BeaconAPI {
  /**
   * 订阅 Beacon 服务状态变化。
   * @param cb 状态回调（available 服务可用 / discovering 搜索中）
   * @returns 取消订阅函数
   */
  onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void
  /**
   * 订阅 Beacon 设备更新。
   * @param cb 设备回调（beacons 发现的设备列表）
   * @returns 取消订阅函数
   */
  onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void
}

/** mDNS 局域网服务（wx OnLocalServiceFound/Lost） */
export interface LocalServiceInfo {
  /** 服务名 */
  serviceName: string
  /** 服务类型（如 _http._tcp） */
  serviceType: string
  /** 服务 IP */
  ip?: string
  /** 服务端口 */
  port?: number
}

/**
 * ★权威标尺缺口 C78：局域网服务发现（`useLocalService()`，mDNS）。
 *   wx：`wx.onLocalServiceFound` / `onLocalServiceLost` / `onLocalServiceResolveFail`
 *   / `onLocalServiceDiscoveryStop`；web：无标准 mDNS → Err 诚实降级。
 */
export interface LocalServiceAPI {
  /**
   * 订阅发现新服务。
   * @param cb 服务回调
   * @returns 取消订阅函数
   */
  onFound(cb: (res: LocalServiceInfo) => void): () => void
  /**
   * 订阅服务离开。
   * @param cb 服务回调
   * @returns 取消订阅函数
   */
  onLost(cb: (res: LocalServiceInfo) => void): () => void
  /**
   * 订阅服务解析失败。
   * @param cb 服务回调
   * @returns 取消订阅函数
   */
  onResolveFail(cb: (res: LocalServiceInfo) => void): () => void
  /**
   * 订阅搜索停止。
   * @param cb 停止回调
   * @returns 取消订阅函数
   */
  onDiscoveryStop(cb: () => void): () => void
}

/**
 * ★权威标尺缺口 C79：翻译（`useTranslation()`）。
 *   wx：`wx.onUserTriggerTranslation` / `wx.onUserOffTranslation`（用户主动/取消翻译菜单）；
 *   web：无对等（可用 Translation API）→ Err 诚实降级。
 */
export interface TranslationAPI {
  /**
   * 订阅用户主动翻译。
   * @param cb 事件回调（locale 语言 / type 类型）
   * @returns 取消订阅函数
   */
  onTrigger(cb: (res: { locale: string; type: string }) => void): () => void
  /**
   * 订阅用户取消翻译。
   * @param cb 事件回调
   * @returns 取消订阅函数
   */
  onOff(cb: () => void): () => void
}

/**
 * ★权威标尺缺口 C80：分享海报（`usePoster()`）。
 *   wx：`wx.onGeneratePoster`（分享海报生成事件）；web：无对等 → Err 诚实降级。
 */
export interface PosterAPI {
  /**
   * 订阅海报生成事件。
   * @param cb 事件回调（src 海报地址 / promise 异步产物）
   * @returns 取消订阅函数
   */
  onGenerate(cb: (res: { src: string; promise?: unknown }) => void): () => void
}

/**
 * ★权威标尺缺口 C81：设备能力探测（`useDeviceCapability()`）。
 *   wx：`wx.checkDeviceSupportHevc`（HEVC 硬解支持）；web：`MediaSource.isTypeSupported` 兜底。
 */
export interface DeviceCapabilityAPI {
  /** 查询设备是否支持 HEVC（H.265）硬解码 */
  supportsHevc(): Promise<CapResult<boolean>>
}

/**
 * ★C82 WebAssembly：跨平台 WASM 模块编译/实例化/校验。
 *
 * 【为什么有它】WASM 是"一次编译、三端执行"的计算载体（图像处理 / 编解码 / 加解密 /
 *   物理引擎等 CPU 密集逻辑），与 Proteus 的「一份源码多端」定位同源。
 *
 * ★★**平台真实能力（已取证，非按标准 Web API 假设）**——三端形态**有实质差异**：
 *
 * | 端 | 入口 | 首参 | compile/validate | 证据 |
 * |---|---|---|---|---|
 * | MP（微信） | `WXWebAssembly.instantiate(path, imports)` | **代码包路径**（.wasm / .wasm.br） | ❌ **无** | 官方文档 + `miniprogram-api-typings/lib.wx.wasm.d.ts` |
 * | Web | 标准 `WebAssembly` | `BufferSource \| Response \| URL` | ✅ 有 | 平台标准 |
 * | App-iOS | JSC 内建 `WebAssembly`（与 Web 同形） | 同上 | ✅ 有 | **本机实测**：`validate(minimalModule)===true`，8 个 API 齐备 |
 * | App-Android | 宿主 **wasm3**（QuickJS 无内建 WASM ⇒ 宿主侧运行时） | `{ bytes }`（宿主通道） | ✅ 有（宿主实现） | **真机实测**：`add(2,40)===42`，真跑 i32.add（wasm3 解释器，MIT/无 JIT ⇒ 兼容 W^X） |
 *
 * 【因此本原语的设计取舍（★不是"照抄 Web 标准"）】
 *   · **入口归一为 `instantiate(source)`**，`source` 是**判别联合**（`{ bytes }` / `{ path }`）——
 *     因为 MP 只收路径、Web/App-JSC 只收字节，**没有**一个共同的首参类型可表达；
 *     若强行只暴露字节，MP 端会**结构性不可用**（无法把路径变成字节，见下）。
 *   · **`compile` / `validate` 声明为可选**（`?`）：MP 端**客观没有**这两个方法；
 *     声明为必需会让 MP 端实现要么撒谎、要么抛错。诚实做法 = 调用方 `if (wasm.compile)` 探测。
 *   · **`supportsStreaming` / `supportsPathLoad` 两个能力位**把这个差异变成**可查询的数据**，
 *     而不是让调用方按平台名分支（平台名分支是本仓 stores 铁律禁止的形态）。
 *
 * 【诚实边界（明确不支持的）】
 *   · MP 端**无法**从网络/字节流加载：官方只接受代码包内路径 ⇒ 动态下载 wasm 需先落包
 *     （`useFileSystem` + 重新分包），本原语**不假装**能做。
 *   · ★App-Android 的 JS 引擎（QuickJS）**内建无 WebAssembly** ⇒ 由**宿主侧 wasm3** 提供
 *     （`webassembly.instantiate/call/release` 通道，`hosts/android/wasm/`）；iOS 的 JSC 内建
 *     ⇒ 走引擎路径。同一份 JS 桥 **两条路径都被真机验证**（结果都是 add(2,40)=42）。
 *   · MP 端 export 支持 函数 / Memory / Table，**iOS 平台暂不支持 Global**（官方原文）。
 *   · 本原语**不做** WASM↔JS 的自动编组（那需要 IDL）；只负责"拿到 instance"，调用面归调用方。
 */
export interface WasmModuleHandle {
  /** 模块导出的符号（函数 / Memory / Table；Global 依平台而定——见接口头） */
  exports: Record<string, unknown>
  /** 该实例是否由**路径**加载（MP 端恒 true；Web/App 端恒 false） */
  fromPath: boolean
  /** 释放（暂无资源需释放——预留：WASM 实例由 GC 回收，本方法供未来池化实现统一出口） */
  dispose(): void
}

/** WASM 来源（判别联合——见 `WebAssemblyAPI` 头的跨端差异说明） */
export type WasmSource =
  /** 字节码（Web / App-JSC 用；MP 端传它 → Err('webassembly.unsupported')） */
  | { bytes: ArrayBuffer | Uint8Array }
  /** 代码包内路径（MP 用，支持 .wasm / .wasm.br；Web/App 端传它 → Err） */
  | { path: string }

export interface WasmInstantiateOptions {
  /** 导入对象（`{ module: { name: value } }`）；缺省无导入 */
  imports?: Record<string, Record<string, unknown>>
}

export interface WebAssemblyAPI {
  /**
   * 实例化 WASM 模块（**跨端归一的唯一入口**）。
   * 不可用平台 / 来源形态不匹配 → `Err('webassembly.unsupported')`（不抛异常）。
   */
  instantiate(source: WasmSource, options?: WasmInstantiateOptions): Promise<CapResult<WasmModuleHandle>>
  /**
   * 编译但不实例化（**可选**：MP 端无此能力 ⇒ `undefined`；调用方用 `if (wasm.compile)` 探测）。
   */
  compile?(bytes: ArrayBuffer | Uint8Array): Promise<CapResult<unknown>>
  /**
   * 校验字节码是否为合法模块（**可选**：MP 端无此能力 ⇒ `undefined`）。
   */
  validate?(bytes: ArrayBuffer | Uint8Array): Promise<CapResult<boolean>>
  /** 能力位：是否支持流式/字节编译（Web/App-JSC true；MP **false**——只收路径） */
  supportsStreaming: boolean
  /** 能力位：是否支持从代码包路径加载（MP true；Web/App **false**） */
  supportsPathLoad: boolean
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
  /** ★权威标尺缺口 C66 性能（wx.getPerformance / reportPerformance；web performance API） */
  getPerformance?(): PerformanceAPI
  /** ★权威标尺缺口 C67 预加载（wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage；web 缺省） */
  getPreload?(): PreloadAPI
  /** ★权威标尺缺口 C68 图像编辑（wx.cropImage/editImage；web 缺省） */
  getImageEdit?(): ImageEditAPI
  /** ★权威标尺缺口 C69 网络底层（wx.createUDPSocket/createTCPSocket；web 无裸 socket → Err） */
  getSocket?(): {
    udp(): UDPSocketHandle
    tcp(options?: TCPSocketConnectOptions): TCPSocketHandle
  }
  /** ★权威标尺缺口 C70 媒体高级（wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer） */
  getMediaProcessing?(): MediaProcessingAPI
  /** ★权威标尺缺口 C71 录屏/截屏（wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive；web 缺省） */
  getScreenCapture?(): ScreenCaptureAPI
  /** ★权威标尺缺口 C72 缓存管理（wx.createCacheManager；web 缺省 → throw） */
  createCacheManager?(options?: { maxAge?: number; mode?: 'weakNetwork' | 'always' | 'none'; origin?: string }): CacheManagerHandle
  /** ★权威标尺缺口 C73 空闲调度（wx.requestIdleCallback/cancelIdleCallback / web requestIdleCallback） */
  getIdle?(): IdleAPI
  /** ★权威标尺缺口 C74 窗口（wx.setWindowSize；web 缺省） */
  getWindow?(): WindowAPI
  /** ★权威标尺缺口 C75 导航卸载拦截（wx.enableAlertBeforeUnload/disableAlertBeforeUnload / web beforeunload） */
  getNavigationGuard?(): NavigationGuardAPI
  /** ★权威标尺缺口 C76 AR/XR（wx.createVKSession/isVKSupport；web 无对等 → Err） */
  getAR?(): ARAPI
  /** ★权威标尺缺口 C77 iBeacon（wx.onBeaconServiceChange/onBeaconUpdate；web 缺省） */
  getBeacon?(): BeaconAPI
  /** ★权威标尺缺口 C78 局域网服务 mDNS（wx.onLocalService*；web 缺省） */
  getLocalService?(): LocalServiceAPI
  /** ★权威标尺缺口 C79 翻译（wx.onUserTriggerTranslation/onUserOffTranslation；web 缺省） */
  getTranslation?(): TranslationAPI
  /** ★权威标尺缺口 C80 分享海报（wx.onGeneratePoster；web 缺省） */
  getPoster?(): PosterAPI
  /** ★权威标尺缺口 C81 设备能力探测（wx.checkDeviceSupportHevc / web MediaSource） */
  getDeviceCapability?(): DeviceCapabilityAPI
  /** ★C82 WASM（MP: WXWebAssembly.instantiate(path) / Web & App-JSC: 标准 WebAssembly） */
  getWebAssembly?(): WebAssemblyAPI
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
  // ★★NC1 声明式能力桥（2026-09-30）：由 `bridge-decls/*.ts` 声明 → `gen-bridge-ext.mjs` 生成
  /** C83 屏幕常亮（MP wx.setKeepScreenOn / Web Screen Wake Lock）——语义：开=取句柄，关=释放，重复调用幂等 */
  setKeepScreenOn?(on: boolean): Promise<void>
  /** C84 文档预览（MP wx.openDocument / Web window.open → 浏览器查看器）；原生宿主（QLPreviewController / ACTION_VIEW）属声明层 */
  openDocument?(filePath: string): Promise<void>
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
  /** ★权威标尺缺口：性能（getPerformance/reportPerformance） */
  performance: boolean
  /** ★权威标尺缺口：预加载（preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage） */
  preload: boolean
  /** ★权威标尺缺口：图像编辑（cropImage/editImage） */
  imageEdit: boolean
  /** ★权威标尺缺口：网络底层（createUDPSocket/createTCPSocket） */
  socket: boolean
  /** ★权威标尺缺口：媒体高级（createMediaContainer/createVideoDecoder/createMediaAudioPlayer） */
  mediaProcessing: boolean
  /** ★权威标尺缺口：录屏/截屏 */
  screenCapture: boolean
  /** ★权威标尺缺口：缓存管理（createCacheManager） */
  cacheManager: boolean
  /** ★权威标尺缺口：空闲调度（requestIdleCallback） */
  idle: boolean
  /** ★权威标尺缺口：窗口（setWindowSize） */
  window: boolean
  /** ★权威标尺缺口：导航卸载拦截（enableAlertBeforeUnload） */
  navigationGuard: boolean
  /** ★权威标尺缺口：AR/XR（createVKSession/isVKSupport） */
  ar: boolean
  /** ★权威标尺缺口：iBeacon（onBeaconServiceChange/onBeaconUpdate） */
  beacon: boolean
  /** ★权威标尺缺口：局域网 mDNS（onLocalService*） */
  localService: boolean
  /** ★权威标尺缺口：翻译（onUserTriggerTranslation/onUserOffTranslation） */
  translation: boolean
  /** ★权威标尺缺口：分享海报（onGeneratePoster） */
  poster: boolean
  /** ★权威标尺缺口：设备能力探测（checkDeviceSupportHevc） */
  deviceCapability: boolean
  /** ★C82 WASM 可用性（MP 需 WXWebAssembly；Web/App 需全局 WebAssembly） */
  webAssembly: boolean
}

// —— 平台桥实现（双端 + mock） ——

/** wx SocketTask（wx.connectSocket 返回） */
export interface WxSocketTask {
  send?: (opt: { data: string | ArrayBuffer }) => void
  close?: (opt?: { code?: number; reason?: string }) => void
  onOpen?: (cb: () => void) => void
  onMessage?: (cb: (r: { data: string | ArrayBuffer }) => void) => void
  onClose?: (cb: (r: { code?: number; reason?: string }) => void) => void
  onError?: (cb: (e: unknown) => void) => void
}

/** wx UploadTask（wx.uploadFile 返回） */
export interface WxUploadTask {
  onProgressUpdate?: (cb: (r: { progress: number }) => void) => void
}

/** wx DownloadTask（wx.downloadFile 返回） */
export interface WxDownloadTask {
  onProgressUpdate?: (cb: (r: { progress: number }) => void) => void
}

/** wx FileSystemManager（wx.getFileSystemManager 返回——子集） */
export interface WxFileSystemManager {
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
export interface WxStatsLike {
  size: number
  mode?: number
  lastAccessedTime?: number
  lastModifiedTime?: number
  isDirectory?: () => boolean
  isFile?: () => boolean
}

/** ★2026-09-30 导出：NC1 声明式桥生成物（generated/bridge-ext.ts）以其为参数类型 */
export interface WxLike {
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
  // ★NC1 声明式（2026-09-30）：C83 屏幕常亮 / C84 文档预览（字段声明随能力落地；包装代码由生成器产出）
  setKeepScreenOn?: (opt: { keepScreenOn: boolean; success?: () => void; fail?: (e: unknown) => void }) => void
  openDocument?: (opt: { filePath: string; success?: () => void; fail?: (e: unknown) => void }) => void
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
  // ★权威标尺缺口 C66/C67/C68：性能 / 预加载 / 图像编辑
  getPerformance?: () => WxPerformanceLike
  reportPerformance?: (id: number, value: number, dimensions?: string | unknown[]) => void
  preloadAssets?: (opt: { data: Array<{ src: string; type: 'font' | 'image' }>; success?: () => void; fail?: (e: unknown) => void }) => void
  preloadSkylineView?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  preloadWebview?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  preDownloadSubpackage?: (opt: { packageType: string; success?: () => void; fail?: (e: unknown) => void }) => WxPreDownloadTaskLike
  cropImage?: (opt: { src: string; cropScale: string; success: (r: { tempFilePath: string }) => void; fail?: (e: unknown) => void }) => void
  editImage?: (opt: { src: string; success: (r: { tempFilePath: string }) => void; fail?: (e: unknown) => void }) => void
  // ★权威标尺缺口 C69/C70：网络底层 / 媒体高级
  createUDPSocket?: () => WxUDPSocketLike
  createTCPSocket?: () => WxTCPSocketLike
  createMediaContainer?: () => WxMediaContainerLike
  createVideoDecoder?: () => WxVideoDecoderLike
  createMediaAudioPlayer?: () => WxMediaAudioPlayerLike
  // ★权威标尺缺口 C71-C75：录屏/缓存/空闲/窗口/导航拦截
  getScreenRecordingState?: (opt?: { success?: (r: { state: 'on' | 'off' }) => void; fail?: (e: unknown) => void }) => void
  onScreenRecordingStateChanged?: (cb: (r: { state: 'on' | 'off' }) => void) => void
  offScreenRecordingStateChanged?: (cb?: (...a: never[]) => void) => void
  onUserCaptureScreen?: (cb: () => void) => void
  offUserCaptureScreen?: (cb?: (...a: never[]) => void) => void
  checkIsPictureInPictureActive?: () => boolean
  createCacheManager?: (opt?: { maxAge?: number; mode?: string; origin?: string }) => WxCacheManagerLike
  requestIdleCallback?: (cb: (res: { timeRemaining?: number; didTimeout?: boolean }) => void, opt?: { timeout?: number }) => void
  cancelIdleCallback?: (id: number) => void
  setWindowSize?: (opt: { width: number; height: number; success?: () => void; fail?: (e: unknown) => void }) => void
  enableAlertBeforeUnload?: (opt: { message: string; success?: () => void; fail?: (e: unknown) => void }) => void
  disableAlertBeforeUnload?: (opt?: { success?: () => void; fail?: (e: unknown) => void }) => void
  // ★权威标尺缺口 C76-C81：AR/XR / iBeacon / 局域网 / 翻译 / 海报 / 设备探测
  createVKSession?: (opt: Record<string, unknown>) => WxVKSessionLike
  isVKSupport?: (version: 'v1' | 'v2') => boolean
  onBeaconServiceChange?: (cb: (res: { available: boolean; discovering: boolean }) => void) => void
  offBeaconServiceChange?: (cb?: (...a: never[]) => void) => void
  onBeaconUpdate?: (cb: (res: { beacons: BeaconInfo[] }) => void) => void
  offBeaconUpdate?: (cb?: (...a: never[]) => void) => void
  onLocalServiceFound?: (cb: (res: { serviceName: string; serviceType: string; ip?: string; port?: number }) => void) => void
  offLocalServiceFound?: (cb?: (...a: never[]) => void) => void
  onLocalServiceLost?: (cb: (res: { serviceName: string; serviceType: string; ip?: string; port?: number }) => void) => void
  offLocalServiceLost?: (cb?: (...a: never[]) => void) => void
  onLocalServiceResolveFail?: (cb: (res: { serviceName: string; serviceType: string; ip?: string; port?: number }) => void) => void
  offLocalServiceResolveFail?: (cb?: (...a: never[]) => void) => void
  onLocalServiceDiscoveryStop?: (cb: () => void) => void
  offLocalServiceDiscoveryStop?: (cb?: (...a: never[]) => void) => void
  onUserTriggerTranslation?: (cb: (res: { locale: string; type: string }) => void) => void
  offUserTriggerTranslation?: (cb?: (...a: never[]) => void) => void
  onUserOffTranslation?: (cb: (res: unknown) => void) => void
  offUserOffTranslation?: (cb?: (...a: never[]) => void) => void
  onGeneratePoster?: (cb: (res: { src: string; promise?: unknown }) => void) => void
  offGeneratePoster?: (cb?: (...a: never[]) => void) => void
  checkDeviceSupportHevc?: (opt?: { success?: (r: { supportHevc: boolean }) => void; fail?: (e: unknown) => void }) => void
  // ★C82 WASM：微信的 WXWebAssembly（**形态与 Web 标准有实质差异**——见 WebAssemblyAPI 头图）
  //   证据：官方文档 `/framework/performance/wasm.html` + `miniprogram-api-typings/lib.wx.wasm.d.ts`
  //   · instantiate 首参是**代码包路径**（.wasm / .wasm.br），**不是** BufferSource
  //   · **无** compile / validate（类型包里不存在这两个声明）
  //   · 基础库 v2.13.0+ 可用；v2.15.0+ Worker 内可用
  //   ★**真实形态是全局对象 `WXWebAssembly`**（官方原文「可以在全局访问并使用 WXWebAssembly 对象」）；
  //     本字段仅为**兼容注入式宿主**（把能力挂在 wx 上的形态）——桥实现两处都查（全局优先）。
  WXWebAssembly?: {
    instantiate: (path: string, imports?: Record<string, Record<string, unknown>>) => Promise<{ exports: Record<string, unknown> }>
  }
}

/** wx MapContext（wx.createMapContext 返回——C4 子集） */
/** wx.CameraContext 子集 */
export interface WxCameraContextLike {
  takePhoto?: (opt: { quality?: string; success: (r: { tempImagePath?: string; width: number; height: number }) => void; fail: (e: unknown) => void }) => void
  startRecord?: (opt: { timeoutCallback?: (r: { tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }) => void; success?: () => void; fail: (e: unknown) => void }) => void
  stopRecord?: (opt: { success: (r: { tempThumbPath?: string; tempVideoPath?: string; duration: number; size: number }) => void; fail: (e: unknown) => void }) => void
  setZoom?: (opt: { zoom: number; success?: () => void; fail: (e: unknown) => void }) => void
  onCameraFrame?: (cb: (data: { data: ArrayBuffer; width: number; height: number }) => void) => void
}
/** wx.RecorderManager 子集 */
export interface WxRecorderManagerLike {
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
export interface WxNfcAdapterLike {
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
export interface WxNfcTagLike {
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
export interface WxLivePlayerContextLike {
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
export interface WxMapContextLike {
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
export interface WxSelectorQueryLike {
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
export interface WxIntersectionObserverLike {
  relativeTo?: (selector: string, margins?: Record<string, number>) => WxIntersectionObserverLike
  relativeToViewport?: (margins?: Record<string, number>) => WxIntersectionObserverLike
  observe?: (targetSelector: string, cb: (res: unknown) => void) => void
  disconnect?: () => void
}

/** wx.createMediaQueryObserver 返回对象子集 */
export interface WxMediaQueryObserverLike {
  observe?: (condition: Record<string, unknown>, cb: (res: { matches: boolean }) => void) => void
  disconnect?: () => void
}

/** wx.createVideoContext 返回对象子集 */
export interface WxVideoContextLike {
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
export interface WxInnerAudioContextLike {
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
export interface WxLivePusherContextLike {
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
export interface WxRewardedVideoAdLike {
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
export interface WxInterstitialAdLike {
  load?: () => Promise<void>
  show?: () => Promise<void>
  destroy?: () => void
  onLoad?: (cb: () => void) => void
  onClose?: (cb: () => void) => void
  onError?: (cb: (e: { errCode: number; errMsg: string }) => void) => void
}

/** wx.createBannerAd 返回对象子集 */
export interface WxBannerAdLike {
  show?: () => Promise<void>
  hide?: () => void
  destroy?: () => void
  onLoad?: (cb: () => void) => void
  onResize?: (cb: (size: { width: number; height: number }) => void) => void
  onError?: (cb: (e: { errCode: number; errMsg: string }) => void) => void
}

/** wx.getPerformance 返回对象子集 */
export interface WxPerformanceLike {
  getEntries?: () => WxPerformanceEntryLike[]
  getEntriesByName?: (name: string, entryType?: string) => WxPerformanceEntryLike[]
  createObserver?: () => {
    observe?: (cb: (entries: WxPerformanceEntryLike[]) => void, entryTypes?: string[]) => void
    disconnect?: () => void
  }
  setBufferSize?: (size: number) => void
}

/** wx PerformanceEntry 子集 */
export interface WxPerformanceEntryLike {
  name: string
  entryType: 'navigation' | 'render' | 'script'
  duration?: number
  startTime?: number
  fileList?: string[]
  moduleName?: string
}

/** wx.preDownloadSubpackage 返回任务子集 */
export interface WxPreDownloadTaskLike {
  onProgressUpdate?: (cb: (res: { progress: number; totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) => void
}

/** wx.createUDPSocket 返回对象子集 */
export interface WxUDPSocketLike {
  bind?: (port?: number) => void
  connect?: (option: { address: string; port: number }) => void
  send?: (option: { address: string; port: number; message: string | ArrayBuffer; setBroadcast?: boolean; success?: () => void; fail?: (e: unknown) => void }) => void
  write?: (option: { address: string; port: number; message: string | ArrayBuffer }) => void
  onMessage?: (cb: (res: { message: ArrayBuffer; remoteInfo: { address: string; port: number; family?: string } }) => void) => void
  offMessage?: (cb?: (...a: never[]) => void) => void
  onError?: (cb: (e: { errMsg: string }) => void) => void
  offError?: (cb?: (...a: never[]) => void) => void
  close?: () => void
}

/** wx.createTCPSocket 返回对象子集 */
export interface WxTCPSocketLike {
  connect?: (option: { address: string; port: number; timeout?: number }) => void
  write?: (data: string | ArrayBuffer) => void
  onConnect?: (cb: () => void) => void
  offConnect?: (cb?: (...a: never[]) => void) => void
  onMessage?: (cb: (res: { message: ArrayBuffer; localInfo?: unknown; remoteInfo?: unknown }) => void) => void
  offMessage?: (cb?: (...a: never[]) => void) => void
  onError?: (cb: (e: { errMsg: string }) => void) => void
  offError?: (cb?: (...a: never[]) => void) => void
  onClose?: (cb: () => void) => void
  offClose?: (cb?: (...a: never[]) => void) => void
  close?: () => void
}

/** wx.createMediaContainer 返回对象子集 */
export interface WxMediaContainerLike {
  addTrack?: (track: Record<string, unknown>) => void
  removeTrack?: (track: Record<string, unknown>) => void
  extractDataSource?: (opt: { source: string; success?: (r: { tracks?: unknown[] }) => void; fail?: (e: unknown) => void }) => void
  export?: (opt?: Record<string, unknown>) => void
  destroy?: () => void
  on?: (event: string, cb: (payload: unknown) => void) => void
}

/** wx.createVideoDecoder 返回对象子集 */
export interface WxVideoDecoderLike {
  start?: (opt: { source: string; mode?: number; abortAudio?: boolean }) => Promise<unknown>
  getFrameData?: () => { data: ArrayBuffer; width?: number; height?: number }
  seek?: (position: number) => Promise<unknown>
  stop?: () => Promise<unknown>
}

/** wx.createMediaAudioPlayer 返回对象子集 */
export interface WxMediaAudioPlayerLike {
  addAudioSource?: (src: string, startTime?: number) => Promise<unknown>
  removeAudioSource?: (src: string) => Promise<unknown>
  start?: () => Promise<unknown>
  stop?: () => Promise<unknown>
  destroy?: () => void
}

/** wx.createCacheManager 返回对象子集 */
export interface WxCacheManagerLike {
  maxAge?: number
  mode?: string
  origin?: string
  state?: number
  addRules?: (rules: unknown[]) => string[]
  deleteRules?: (ids: string[]) => void
  clearRules?: () => void
  start?: () => void
  stop?: () => void
  deleteCache?: (id: string) => void
  deleteCaches?: (ids: string[]) => void
  clearCaches?: () => void
  on?: (event: string, cb: (payload: unknown) => void) => void
  off?: (event: string, cb?: (...a: never[]) => void) => void
}

/** wx.createVKSession 返回对象子集 */
export interface WxVKSessionLike {
  state?: VKSessionState
  start?: (cb?: (...a: unknown[]) => void) => void
  stop?: (cb?: (...a: unknown[]) => void) => void
  destroy?: () => void
  on?: (event: string, cb: (payload: unknown) => void) => void
  off?: (event: string, cb?: (...a: never[]) => void) => void
  requestAnimationFrame?: (cb: (timestamp: number, frame: unknown) => void) => number
  cancelAnimationFrame?: (handle: number) => void
  getVKFrame?: (width?: number, height?: number) => unknown
}


export const wrap = <T>(p: Promise<T>): Promise<CapResult<T>> =>
  p.then(
    (data) => capOk(data),
    (e) => capErr<T>(e instanceof CapError ? e.code : 'cap.failed', e instanceof Error ? e.message : String(e), e),
  )
