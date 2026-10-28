// packages/api/src/capability.ts —— 能力层**工厂 + Hook + 响应式存储**（G-32 B3 · 决策 #870 拆分后）
//   createCapabilityBridge / createCapabilityHooks / createReactiveStorage。类型契约见 capability-types.ts（本文件转发）。
import { detectRuntime } from '@proteus-vue/shared'
import { mpBridgeExt, webBridgeExt } from './generated/bridge-ext'
import { detectAppHost } from './capability-app'
// ★★2026-10-19（决策 #1067）：App 端三组能力（生命周期 + 平台能力 + 设备域）统一装配
import { createAppCapabilities } from './capability-app-device'
import { createSubscriptionScope } from './capability-hooks-scope' // ★#1071
import { makeCapabilityRuntime } from './capability-runtime'; import type { CapabilityHooksOptions } from './capability-hooks-options'; import { mergeWebWithApp } from './capability-app-fallback'   // ★#1094 G-43 · #1238
import { getSharedCapabilityBridge, registerBridgeFactory } from './capability-bridge-shared'
import { createAuth } from './auth'; import type { AuthStorage } from './auth'
import { CapError, capErr, capOk, wrap } from './capability-types'
import { probeOf } from './capability-probe'   // ★#1133 探测面（90 行映射表，独立职责）
// ★#1133：请求管线（拦截器 / 重试 / 去重 / 并发 / 任务句柄）——平台无关策略层
import { createFetchPipeline } from './capability-fetch-pipeline'
import type { FetchTask } from './capability-fetch-pipeline'
import type { ARAPI, AdAPI, AlbumAPI, AppLifecycle, ArchiveOptions, AudioController, AuthState, BackgroundAPI, BatteryInfo, BeaconAPI, BiometricOptions, BluetoothAPI, CacheManagerHandle, CalendarAPI, CalendarEvent, CameraController, CanvasController, CapDeviceInfo, CapResult, CapabilityBridge, CapabilityProbe, CompatStorage, Contact, CookieJar, Coords, DataChannelHandle, DataChannelOptions, DeviceCapabilityAPI, DownloadOptions, DownloadResult, ElementQuery, FSAdapter, FetchConfig, FetchResult, FileSystemBridge, HostContext, IAPReceipt, IdleAPI, ImageEditAPI, IntersectionHandle, IntersectionOptions, KeyboardLifecycle, LivePusherController, LiveRoomHandle, LiveRoomOptions, LocalServiceAPI, Logger, LoginResult, MapController, MediaAccess, MediaProcessingAPI, MediaQueryObserver, MessageSubscription, MiniProgramAPI, NFCAPI, NavigationGuardAPI, NetworkType, OrientationInfo, PageLifecycle, PaymentConfig, PaymentReceipt, PerformanceAPI, PermissionState, PosterAPI, PreloadAPI, PrivacyAPI, ProgressCallback, RecorderController, ScreenCaptureAPI, ScreenInfo, SensorKind, SensorSample, SensorStream, ShareOptions, ShippingAddress, SocketTaskHandle, TCPSocketConnectOptions, TCPSocketHandle, TrackAPI, TranslationAPI, UDPSocketHandle, UpdateManagerAPI, UploadOptions, UploadResult, VideoController, WeRunData, WebAssemblyAPI, WebSocketConnection, WifiAPI, WindowAPI, WorkerHandle, WxLike } from './capability-types'
import { webBridge, wxBridge } from './capability-bridges'
// ★决策 #870：类型契约整体转发——保持 @proteus-vue/api 公共面（含 index.ts 的 capOk/capErr/CapError/各类型）不变
export * from './capability-types'

export function createCapabilityBridge(resOpts: CapabilityHooksOptions = {}): CapabilityBridge {   // ★#1094 账本透传
  const g = globalThis as { wx?: WxLike }
  // ★★App 宿主（壳注入 `__PROTEUS_HOST_ID__`）⇒ 挂 App 生命周期能力。
  //   · 为什么必须显式判定：QuickJS/JSC **无 window 无 wx** ⇒ detectRuntime() 落 'web'，
  //     web 桥的 getAppLifecycle 依赖 visibilitychange（App 端不存在）⇒ 三个 Hook 形同虚设；
  //   · 合并顺序：**最后展开**（App 能力覆盖 wx/web 的同名缺省——App 宿主上是权威实现）；
  //   · 诚实边界：App 端已接「应用与生命周期」+「设备与系统」两域；其余域（媒体/位置/支付…）
  //     仍走 web 桥的降级路径——逐域铺开（不冒充已完成）。
  // ★★App 端三组能力的装配收在 `capability-app-device.ts::createAppCapabilities`（决策 #1067）。
  const appCaps = detectAppHost() ? createAppCapabilities(CapError, resOpts) : ({} as Record<string, never>)
  if (detectRuntime() === 'mp' && g.wx) return { ...wxBridge(g.wx), ...mpBridgeExt(g.wx, CapError), ...appCaps }
  return mergeWebWithApp({ ...webBridge(globalThis), ...webBridgeExt(globalThis, CapError) }, appCaps)   // ★#1238 禁止 web 兜底冒充（见 capability-app-fallback.ts）
}

registerBridgeFactory(createCapabilityBridge) // ★#1072 模块加载即登记（ESM: import 先执行）

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
  /** C26 useFetch：网络请求（`{ data }` 解构兼容；#1122 加 status/headers；#1133 走请求管线） */
  useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<FetchResult<T>>
  /** ★#1133 带句柄的请求（`useFetch` = 它的 `.result`；要"能真停"就用这个） */
  useFetchTask<T = unknown>(url: string, config?: FetchConfig): FetchTask<T>
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
  /** ★NC1 C83 useKeepScreenOn：屏幕常亮开关（MP wx.setKeepScreenOn / Web Screen Wake Lock；重复调用幂等） */
  useKeepScreenOn(on: boolean): Promise<CapResult<void>>
  /** ★NC1 C84 useOpenDocument：文档预览（MP wx.openDocument / Web window.open；Web 下 office 格式通常转为下载——浏览器能力所限） */
  useOpenDocument(filePath: string): Promise<CapResult<void>>
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
  /** ★C66 usePerformance：性能句柄（wx.getPerformance/reportPerformance；web performance API） */
  usePerformance(): CapResult<PerformanceAPI>
  /** ★C67 usePreload：预加载句柄（wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage；web 缺省 → Err） */
  usePreload(): CapResult<PreloadAPI>
  /** ★C68 useImageEdit：图像编辑句柄（wx.cropImage/editImage；web 缺省 → Err） */
  useImageEdit(): CapResult<ImageEditAPI>
  /** ★C69 useSocket：底层网络 Socket（wx.createUDPSocket/createTCPSocket；web 无裸 socket → Err） */
  useSocket(): CapResult<{ udp(): UDPSocketHandle; tcp(options?: TCPSocketConnectOptions): TCPSocketHandle }>
  /** ★C70 useMediaProcessing：媒体高级（wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer） */
  useMediaProcessing(): CapResult<MediaProcessingAPI>
  /** ★C71 useScreenCapture：录屏/截屏（wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive） */
  useScreenCapture(): CapResult<ScreenCaptureAPI>
  /** ★C72 useCacheManager：缓存管理（wx.createCacheManager；web → throw） */
  useCacheManager(options?: { maxAge?: number; mode?: 'weakNetwork' | 'always' | 'none'; origin?: string }): CapResult<CacheManagerHandle>
  /** ★C73 useIdle：空闲调度（wx.requestIdleCallback / web requestIdleCallback） */
  useIdle(): CapResult<IdleAPI>
  /** ★C74 useWindow：窗口（wx.setWindowSize；web 缺省 → Err） */
  useWindow(): CapResult<WindowAPI>
  /** ★C75 useNavigationGuard：卸载拦截（wx.enableAlertBeforeUnload / web beforeunload） */
  useNavigationGuard(): CapResult<NavigationGuardAPI>
  /** ★C76 useAR：AR/XR 视觉算法（wx.createVKSession/isVKSupport；web 无对等 → Err） */
  useAR(): CapResult<ARAPI>
  /** ★C77 useBeacon：iBeacon（wx.onBeaconServiceChange/onBeaconUpdate；web 空订阅） */
  useBeacon(): CapResult<BeaconAPI>
  /** ★C78 useLocalService：局域网 mDNS（wx.onLocalService*；web 空订阅） */
  useLocalService(): CapResult<LocalServiceAPI>
  /** ★C79 useTranslation：翻译（wx.onUserTriggerTranslation/onUserOffTranslation；web 空订阅） */
  useTranslation(): CapResult<TranslationAPI>
  /** ★C80 usePoster：分享海报（wx.onGeneratePoster；web 空订阅） */
  usePoster(): CapResult<PosterAPI>
  /** ★C81 useDeviceCapability：设备能力探测（wx.checkDeviceSupportHevc / web MediaSource） */
  useDeviceCapability(): CapResult<DeviceCapabilityAPI>
  /** ★C82 WebAssembly：跨端归一（MP `WXWebAssembly` 收路径 · Web/iOS-JSC 走标准 API ·
   *  Android 走宿主 wasm3）。用 `supportsStreaming`/`supportsPathLoad` 判断，**不要按平台名分支**。
   *  三端真实形态详见 `WebAssemblyAPI` 类型头（已取证 + 真机验证）。 */
  useWebAssembly(): CapResult<WebAssemblyAPI>
  /** 能力探测面（降级查询） */
  probe(): Promise<CapabilityProbe>
  dispose(): void // ★#1071：解除本实例登记的全部订阅（幂等）
}

export { getSharedCapabilityBridge, resetSharedCapabilityBridge } from './capability-bridge-shared' // ★#1072 共享桥（省 23.8KB/页）
export function createCapabilityHooks(
  bridge: CapabilityBridge = getSharedCapabilityBridge(),
  opts: CapabilityHooksOptions = {},
): CapabilityHooks {
  // ★统一 handle 型 hook 契约：桥构造句柄失败（缺平台 API / 抛错）→ 返回 Err（不 uncaught、不半残句柄）
  const handleResult = <T,>(make: () => T): CapResult<T> => {
    try {
      return capOk(make())
    } catch (e) {
      return capErr<T>(e instanceof CapError ? e.code : 'cap.failed', e instanceof Error ? e.message : String(e))
    }
  }
  const scope = createSubscriptionScope() // ★#1071 订阅回收袋
  const res = makeCapabilityRuntime(opts)   // ★#1094 边界资源账本（G-43；不传 = 旧行为）
  const fpipe = createFetchPipeline(bridge, { ...opts.fetch, abortable: opts.fetch?.abortable ?? detectRuntime() !== 'mp', resources: res.resources ?? undefined })   // ★#1133 · ★#1243 账本（回收）

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
    useShare: (options) => wrap(bridge.share ? bridge.share(options) : Promise.reject(new CapError('share.unsupported', '桥未提供 share（useShare 不可用）'))), // ★#1336 补守卫（原 `wrap(bridge.share(...))` 在桥无 share 时同步抛 TypeError，业务读不到 unsupported）
    // ★#1122 门面开口 · #1133 走请求管线；`bridge.request` 显式出现（文档探测靠它判该端是否接线）
    useFetch: <T>(url: string, config?: FetchConfig): Promise<FetchResult<T>> =>
      bridge.request ? fpipe.fetch<T>(url, config) : Promise.resolve(capErr<T>('fetch.unsupported', '桥未提供 request（useFetch 不可用）') as FetchResult<T>),
    useFetchTask: <T>(url: string, config?: FetchConfig): FetchTask<T> => fpipe.fetchTask<T>(url, config),
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
    // ★NC1 声明式能力（2026-09-30）：C83 屏幕常亮——桥方法由生成物提供（缺省 → Err，G-32.3 降级语义）
    useKeepScreenOn: (on: boolean) =>
      wrap(
        (() => {
          if (!bridge.setKeepScreenOn) return Promise.reject(new CapError('screen.keep-on.unsupported', '桥未提供 setKeepScreenOn（useKeepScreenOn 不可用）'))
          return bridge.setKeepScreenOn(on)
        })(),
      ),
    // ★NC1 声明式能力（2026-09-30）：C84 文档预览（同上——缺桥 → Err）
    useOpenDocument: (filePath: string) =>
      wrap(
        (() => {
          if (!bridge.openDocument) return Promise.reject(new CapError('document.open.unsupported', '桥未提供 openDocument（useOpenDocument 不可用）'))
          return bridge.openDocument(filePath)
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
    useWebSocket: (url, protocols) => wrap(res.connectWs(bridge, url, protocols)),
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
        // ★#1231：`encoding` **必须透传**（否则用户传了也被吞掉 ⇒ 总是 ArrayBuffer）
        readFileSync: (path, encoding) => sync(() => fs.readFileSync(path, encoding)),
        writeFileSync: (path, data, encoding) => sync(() => fs.writeFileSync(path, data, encoding)),
        existsSync: (path) => sync(() => fs.existsSync(path)),
        statSync: (path) => sync(() => fs.statSync(path)),
        readdirSync: (path) => sync(() => fs.readdirSync(path)),
        mkdirSync: (path, recursive) => sync(() => fs.mkdirSync(path, recursive)),
        renameSync: (o, n) => sync(() => fs.renameSync(o, n)),
        unlinkSync: (path) => sync(() => fs.unlinkSync(path)),
        copyFileSync: (src, dest) => sync(() => fs.copyFileSync(src, dest)),
        appendFileSync: (path, data, encoding) => sync(() => fs.appendFileSync(path, data, encoding)),
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
      return scope.wrap(bridge.getAppLifecycle()) // ★#1071 订阅自动登记回收
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
      return scope.wrap(bridge.getPageLifecycle())
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
          return Promise.resolve(bridge.getBackground()).then(scope.wrap)
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
    // ★权威标尺缺口 C66/C67/C68：性能 / 预加载 / 图像编辑
    usePerformance: () => handleResult<PerformanceAPI>(() => {
      if (!bridge.getPerformance) throw new CapError('performance.unsupported', '桥未提供 getPerformance（usePerformance 不可用）')
      return bridge.getPerformance()
    }),
    usePreload: () => handleResult<PreloadAPI>(() => {
      if (!bridge.getPreload) throw new CapError('preload.unsupported', '桥未提供 getPreload（usePreload 不可用）')
      return bridge.getPreload()
    }),
    useImageEdit: () => handleResult<ImageEditAPI>(() => {
      if (!bridge.getImageEdit) throw new CapError('image-edit.unsupported', '桥未提供 getImageEdit（useImageEdit 不可用）')
      return bridge.getImageEdit()
    }),
    // ★权威标尺缺口 C69/C70：网络底层 / 媒体高级
    useSocket: () => handleResult<{ udp(): UDPSocketHandle; tcp(options?: TCPSocketConnectOptions): TCPSocketHandle }>(() => {
      if (!bridge.getSocket) throw new CapError('socket.unsupported', '桥未提供 getSocket（useSocket 不可用）')
      return bridge.getSocket()
    }),
    useMediaProcessing: () => handleResult<MediaProcessingAPI>(() => {
      if (!bridge.getMediaProcessing) throw new CapError('media-processing.unsupported', '桥未提供 getMediaProcessing（useMediaProcessing 不可用）')
      return bridge.getMediaProcessing()
    }),
    // ★权威标尺缺口 C71-C75：录屏/缓存/空闲/窗口/导航拦截
    useScreenCapture: () => handleResult<ScreenCaptureAPI>(() => {
      if (!bridge.getScreenCapture) throw new CapError('screen-capture.unsupported', '桥未提供 getScreenCapture（useScreenCapture 不可用）')
      return bridge.getScreenCapture()
    }),
    useCacheManager: (options) => handleResult<CacheManagerHandle>(() => {
      if (!bridge.createCacheManager) throw new CapError('cache-manager.unsupported', '桥未提供 createCacheManager（useCacheManager 不可用）')
      return bridge.createCacheManager(options)
    }),
    useIdle: () => handleResult<IdleAPI>(() => {
      if (!bridge.getIdle) throw new CapError('idle.unsupported', '桥未提供 getIdle（useIdle 不可用）')
      return bridge.getIdle()
    }),
    useWindow: () => handleResult<WindowAPI>(() => {
      if (!bridge.getWindow) throw new CapError('window.unsupported', '桥未提供 getWindow（useWindow 不可用）')
      return bridge.getWindow()
    }),
    useNavigationGuard: () => handleResult<NavigationGuardAPI>(() => {
      if (!bridge.getNavigationGuard) throw new CapError('navigation-guard.unsupported', '桥未提供 getNavigationGuard（useNavigationGuard 不可用）')
      return bridge.getNavigationGuard()
    }),
    // ★权威标尺缺口 C76-C81：AR/iBeacon/局域网/翻译/海报/设备探测
    useAR: () => handleResult<ARAPI>(() => {
      if (!bridge.getAR) throw new CapError('ar.unsupported', '桥未提供 getAR（useAR 不可用）')
      return bridge.getAR()
    }),
    useBeacon: () => handleResult<BeaconAPI>(() => {
      if (!bridge.getBeacon) throw new CapError('beacon.unsupported', '桥未提供 getBeacon（useBeacon 不可用）')
      return bridge.getBeacon()
    }),
    useLocalService: () => handleResult<LocalServiceAPI>(() => {
      if (!bridge.getLocalService) throw new CapError('local-service.unsupported', '桥未提供 getLocalService（useLocalService 不可用）')
      return bridge.getLocalService()
    }),
    useTranslation: () => handleResult<TranslationAPI>(() => {
      if (!bridge.getTranslation) throw new CapError('translation.unsupported', '桥未提供 getTranslation（useTranslation 不可用）')
      return bridge.getTranslation()
    }),
    usePoster: () => handleResult<PosterAPI>(() => {
      if (!bridge.getPoster) throw new CapError('poster.unsupported', '桥未提供 getPoster（usePoster 不可用）')
      return bridge.getPoster()
    }),
    useDeviceCapability: () => handleResult<DeviceCapabilityAPI>(() => {
      if (!bridge.getDeviceCapability) throw new CapError('device-capability.unsupported', '桥未提供 getDeviceCapability（useDeviceCapability 不可用）')
      return bridge.getDeviceCapability()
    }),
    useWebAssembly: () => handleResult<WebAssemblyAPI>(() => {
      if (!bridge.getWebAssembly) throw new CapError('webassembly.unsupported', '桥未提供 getWebAssembly（useWebAssembly 不可用）')
      return bridge.getWebAssembly()
    }),
    dispose: () => { res.dispose(scope) },   // ★#1094 = 资源释放（G-43.6）+ 订阅回收（#1071）
    probe: async () => probeOf(bridge),
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

