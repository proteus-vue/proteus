// packages/component-ir/src/mp-spec-coverage.ts
// ★权威标尺（2026-09-12）：小程序官方能力清单分类 + spec 驱动覆盖度门禁
//
// 背景：覆盖度门禁此前由**手写矩阵**（MP_MAPPING_MATRIX）驱动 → 自证同义反复
//   （矩阵不登记则永不红；实测矩阵漏了 useElement/useIntersection/useMedia 等幽灵引用）。
//   本模块以**官方清单**（docs/generated/miniprogram-official-spec.json：84 组件 + 301 API）
//   为标尺，要求每个官方项**被显式归类**（covered/planned/private/na/gap），
//   任何未归类项 → CI 红；gap 数受**棘轮预算**约束（只能降不能升）。
//
// 状态语义：
//   covered —— 有可运行等价（组件/语义/Hook；含改名承接：batchGetStorageSync→useStorage）
//   planned —— L2 已声明待落地（诚实登记，非已实现）
//   private —— 平台私有（微信独占，收敛 useMiniProgram / 宿主桥）；非目标端无意义
//   na      —— 不适用（废弃 API / 构建期语义 / 被语义原语「消灭」的形态）
//   gap     —— 真缺（通用能力，应补齐；受预算棘轮约束）
//
// 诚实边界：分类是**人工声明**（规则 + 显式集合），不是自动证明；但它杜绝了
//   「矩阵不登记即 100%」的自证——每个官方项都必须落到某个箱子里，且 gap 有硬上限。

export type MpSpecStatus = 'covered' | 'planned' | 'private' | 'na' | 'gap'

export interface MpSpecClass {
  status: MpSpecStatus
  /** covered/planned 时的 Proteus 承接（Hook/语义/组件） */
  proteus?: string
}

/** spec 快照（与 docs/generated/miniprogram-official-spec.json 同构） */
export interface MpOfficialSpec {
  components: string[]
  apis: string[]
}

// —— ① 显式「已覆盖」映射（改名承接——官方名 → Proteus 承接） ——
export const SPEC_COVERED: Record<string, string> = {
  // 网络（既有 Hook 承接）
  onSocketOpen: 'useSocketTask/useWebSocket', onSocketClose: 'useSocketTask/useWebSocket',
  onSocketError: 'useSocketTask/useWebSocket', onSocketMessage: 'useSocketTask/useWebSocket',
  offSocketOpen: 'useSocketTask/useWebSocket', offSocketClose: 'useSocketTask/useWebSocket',
  offSocketError: 'useSocketTask/useWebSocket', offSocketMessage: 'useSocketTask/useWebSocket',
  // 存储（同步/批量）
  batchGetStorageSync: 'useStorage', batchSetStorageSync: 'useStorage', removeStorageSync: 'useStorage',
  // 设备/系统信息（新版拆分）
  getAccountInfoSync: 'useDevice', getAppBaseInfo: 'useDevice', getDeviceInfo: 'useDevice',
  getWindowInfo: 'useScreen', getSystemSetting: 'usePermission', getAppAuthorizeSetting: 'usePermission',
  getBatteryInfoSync: 'useBattery', getRendererUserAgent: 'useDevice', getSkylineInfo: 'useDevice',
  getSkylineInfoSync: 'useDevice', getDeviceBenchmarkInfo: 'useDevice', canIUse: 'useDevice',
  getApiCategory: 'useDevice', getFuzzyLocation: 'useLocation',
  // 应用/页面生命周期
  onAppHide: 'useAppLifecycle', onAppShow: 'useAppLifecycle', offAppHide: 'useAppLifecycle', offAppShow: 'useAppLifecycle',
  onMemoryWarning: 'useAppLifecycle', offMemoryWarning: 'useAppLifecycle',
  onThemeChange: 'useAppLifecycle', offThemeChange: 'useAppLifecycle',
  onUnhandledRejection: 'useAppLifecycle', offUnhandledRejection: 'useAppLifecycle',
  onPageNotFound: 'usePageLifecycle', offPageNotFound: 'usePageLifecycle',
  onBeforePageLoad: 'usePageLifecycle', onAfterPageLoad: 'usePageLifecycle',
  onBeforePageUnload: 'usePageLifecycle', onAfterPageUnload: 'usePageLifecycle',
  onLazyLoadError: 'usePageLifecycle', offLazyLoadError: 'usePageLifecycle',
  // 位置 / 网络 / 键盘 / WiFi / 蓝牙 / 传感器 事件
  onLocationChange: 'useLocation.watch', offLocationChange: 'useLocation.watch',
  onLocationChangeError: 'useLocation.watch', offLocationChangeError: 'useLocation.watch',
  onNetworkStatusChange: 'useNetwork', offNetworkStatusChange: 'useNetwork',
  onNetworkWeakChange: 'useNetwork', offNetworkWeakChange: 'useNetwork',
  onKeyboardHeightChange: 'useKeyboard', offKeyboardHeightChange: 'useKeyboard',
  onKeyDown: 'useKeyboard', offKeyDown: 'useKeyboard', onKeyUp: 'useKeyboard', offKeyUp: 'useKeyboard',
  onWifiConnected: 'useWifi', offWifiConnected: 'useWifi',
  onWifiConnectedWithPartialInfo: 'useWifi', offWifiConnectedWithPartialInfo: 'useWifi',
  onGetWifiList: 'useWifi', offGetWifiList: 'useWifi',
  onBluetoothAdapterStateChange: 'useBluetooth', offBluetoothAdapterStateChange: 'useBluetooth',
  onBluetoothDeviceFound: 'useBluetooth', offBluetoothDeviceFound: 'useBluetooth',
  onBLEConnectionStateChange: 'useBluetooth', offBLEConnectionStateChange: 'useBluetooth',
  onBLECharacteristicValueChange: 'useBluetooth', offBLECharacteristicValueChange: 'useBluetooth',
  onBLEMTUChange: 'useBluetooth', offBLEMTUChange: 'useBluetooth',
  onBatteryInfoChange: 'useBattery', offBatteryInfoChange: 'useBattery',
  onCompassChange: 'useSensor', offCompassChange: 'useSensor',
  onAccelerometerChange: 'useSensor', offAccelerometerChange: 'useSensor',
  onGyroscopeChange: 'useSensor', offGyroscopeChange: 'useSensor',
  onDeviceMotionChange: 'useSensor', offDeviceMotionChange: 'useSensor',
  onDeviceOrientationChange: 'useOrientation',
  // 日志 / 埋点 / 通知 / 日历
  getLogManager: 'useLog', getRealtimeLogManager: 'useLog',
  reportAnalytics: 'useAnalytics', reportEvent: 'useAnalytics', reportMonitor: 'useLog',
  sendSms: 'useSMS', addPhoneCalendar: 'useCalendarAPI', removePhoneCalendar: 'useCalendarAPI',
  openCustomerServiceChat: 'useCustomerService', requestSubscribeDeviceMessage: 'useDeviceNotification',
  // 媒体组件实例（本轮 C4）
  createVideoContext: 'useVideo', createInnerAudioContext: 'useAudio', createLivePusherContext: 'useLivePusher',
  createMediaRecorder: 'useRecorder', createWebAudioContext: 'useAudio',
  // 画布 / 查询（本轮 C4）
  createCanvasContext: 'useCanvas', createOffscreenCanvas: 'useCanvas',
  createSelectorQuery: 'useElement', createIntersectionObserver: 'useIntersection',
  createMediaQueryObserver: 'useMediaQuery',
  // 广告（本轮 C4）
  createRewardedVideoAd: 'useAd', createInterstitialAd: 'useAd', createBannerAd: 'useAd',
  // 大文件工具（useFileSystem 承接）
  arrayBufferToBase64: 'useFileSystem', base64ToArrayBuffer: 'useFileSystem',
  createBufferURL: 'useFileSystem', revokeBufferURL: 'useFileSystem',
  getFileSystemManager: 'useFileSystem', saveFileToDisk: 'useFileSystem',
  // 网络（改名承接）
  connectSocket: 'useWebSocket', uploadFile: 'useUpload', downloadFile: 'useDownload',
  // 组件实例（改名承接）
  createCameraContext: 'useCameraContext', createMapContext: 'useMap', createWorker: 'useWorker',
  createAnimation: 'useAnimation', createLivePlayerContext: 'useLive', createNFCAdapter: 'useNFC', getNFCAdapter: 'useNFC',
  getRecorderManager: 'useRecorder',
  // 存储（同步/old）
  clearStorageSync: 'useStorage', getStorageInfoSync: 'useStorage.info',
  // 系统信息旧版（new 拆分版承接）
  getSystemInfoSync: 'useDevice', getLaunchOptionsSync: 'useMiniProgram', getEnterOptionsSync: 'useMiniProgram',
  // 生命周期事件（旧名承接）
  onError: 'useAppLifecycle', offError: 'useAppLifecycle',
  onWindowResize: 'useOrientation', offWindowResize: 'useOrientation',
  onHCEMessage: 'useNFC', offHCEMessage: 'useNFC',
  offAfterPageLoad: 'usePageLifecycle', offAfterPageUnload: 'usePageLifecycle',
  offBeforePageLoad: 'usePageLifecycle', offBeforePageUnload: 'usePageLifecycle',
  // 热更新 / 联系人 / 剪贴板
  getUpdateManager: 'useUpdate', chooseContact: 'useContact',
  getMenuButtonBoundingClientRect: 'useElement.boundingClientRect',
  getLocalIPAddress: 'useNetwork',
  // 隐私协议（C65——合规刚需，2026-09-12 补齐）
  getPrivacySetting: 'usePrivacy', openPrivacyContract: 'usePrivacy',
  requirePrivacyAuthorize: 'usePrivacy', onNeedPrivacyAuthorization: 'usePrivacy',
  offNeedPrivacyAuthorization: 'usePrivacy',
  // 性能 / 预加载 / 图像编辑（C66-C68——批 D 补齐，2026-09-12）
  getPerformance: 'usePerformance', reportPerformance: 'usePerformance',
  preloadAssets: 'usePreload', preloadSkylineView: 'usePreload', preloadWebview: 'usePreload', preDownloadSubpackage: 'usePreload',
  cropImage: 'useImageEdit', editImage: 'useImageEdit',
  // 网络底层 / 媒体高级（C69-C70——批 E 补齐，2026-09-12）
  createUDPSocket: 'useSocket.udp', createTCPSocket: 'useSocket.tcp',
  createMediaContainer: 'useMediaProcessing.container', createVideoDecoder: 'useMediaProcessing.videoDecoder',
  createMediaAudioPlayer: 'useMediaProcessing.audioPlayer',
  // 录屏/缓存/空闲/窗口/导航拦截（C71-C75——批 F 补齐，2026-09-12）
  getScreenRecordingState: 'useScreenCapture', onScreenRecordingStateChanged: 'useScreenCapture',
  offScreenRecordingStateChanged: 'useScreenCapture', onUserCaptureScreen: 'useScreenCapture',
  offUserCaptureScreen: 'useScreenCapture', checkIsPictureInPictureActive: 'useScreenCapture',
  createCacheManager: 'useCacheManager',
  requestIdleCallback: 'useIdle', cancelIdleCallback: 'useIdle',
  setWindowSize: 'useWindow',
  enableAlertBeforeUnload: 'useNavigationGuard', disableAlertBeforeUnload: 'useNavigationGuard',
  // AR/XR / iBeacon / 局域网 / 翻译 / 海报 / 设备探测（C76-C81——批 G 补齐，2026-09-12）
  createVKSession: 'useAR', isVKSupport: 'useAR',
  checkDeviceSupportHevc: 'useDeviceCapability',
  onUserTriggerTranslation: 'useTranslation', offUserTriggerTranslation: 'useTranslation',
  onUserOffTranslation: 'useTranslation', offUserOffTranslation: 'useTranslation',
  onGeneratePoster: 'usePoster', offGeneratePoster: 'usePoster',
}

// —— ② 显式「平台私有」（微信独占；收敛 useMiniProgram / 宿主桥） ——
export const SPEC_PRIVATE: ReadonlySet<string> = new Set([
  // 支付 / 交通卡 / 离线支付
  'addPaymentPassFinish', 'addPaymentPassGetCertificateData', 'canAddSecureElementPass', 'getSecureElementPasses',
  'removeSecureElementPass', 'checkTransitCardSupport', 'getTransitCardCPLC', 'getTransitCardInfo', 'getTransitCardList',
  'issueTransitCard', 'rechargeTransitCard', 'deleteTransitCard', 'createGlobalPayment', 'requestCommonPayment',
  'requestVirtualPayment', 'requestPluginPayment', 'requestAppleSubscribeSign', 'jumpToOfflinePay', 'openHKOfflinePayView',
  'requestMerchantTransfer', 'openInquiriesTopic', 'openHKOfflinePayView',
  // 视频号 / 直播频道
  'getChannelsLiveInfo', 'getChannelsLiveNoticeInfo', 'getChannelsShareKey', 'openChannelsActivity', 'openChannelsEvent',
  'openChannelsLive', 'openChannelsLiveNoticeInfo', 'openChannelsUserProfile', 'reserveChannelsLive',
  // VoIP / 客服会话
  'getDeviceVoIPList', 'requestDeviceVoIP', 'joinVoIPChat', 'setEnable1v1Chat', 'join1v1Chat', 'enterChatToolMode',
  'onVoIPChatInterrupted', 'offVoIPChatInterrupted', 'onVoIPChatMembersChanged', 'offVoIPChatMembersChanged',
  'onVoIPChatSpeakersChanged', 'offVoIPChatSpeakersChanged', 'onVoIPChatStateChanged', 'offVoIPChatStateChanged',
  'onVoIPVideoMembersChanged', 'offVoIPVideoMembersChanged',
  // 人脸核身 / 类目资质
  'startFacialRecognitionVerify', 'checkIsSupportFacialRecognition', 'requestFacialVerify',
  'faceDetect', 'initFaceDetect', 'stopFaceDetect', 'setVisualEffectOnCapture',
  // AI 推理（类目）
  'createInferenceSession', 'getInferenceEnvInfo',
  // 企业 / 员工关系
  'bindEmployeeRelation', 'checkEmployeeRelation', 'requestSubscribeEmployeeMessage', 'authPrivateMessage',
  // 插件
  'pluginLogin', 'getPluginUpdateManager', 'authorizeForMiniProgram',
  // 营销 / 门店 / 贴纸 / 公众号
  'openDesignerProfile', 'openOfficialAccountArticle', 'openOfficialAccountChat', 'openOfficialAccountProfile',
  'shareToOfficialAccount', 'postMessageToReferrerMiniProgram', 'postMessageToReferrerPage',
  'openSingleStickerView', 'openStickerIPView', 'openStickerSetView', 'openStoreCouponDetail', 'openStoreOrderDetail',
  'openVideoEditor',
  // 加密 / 群入口 / 扩展配置
  'getUserCryptoManager', 'getGroupEnterInfo', 'getExtConfigSync', 'getCommonConfig', 'getExptInfoSync',
  // 后台音频（旧）/ 小程序互跳 / 路由重写
  'getBackgroundAudioManager', 'onBackgroundAudioPause', 'onBackgroundAudioPlay', 'onBackgroundAudioStop',
  'openEmbeddedMiniProgram', 'exitMiniProgram', 'restartMiniProgram', 'rewriteRoute',
  'onEmbeddedMiniProgramHeightChange', 'offEmbeddedMiniProgramHeightChange', 'openData',
  // 小程序归属 / 开屏广告 / XR 系统（微信私有）
  'checkIsAddedToMyMiniProgram', 'getShowSplashAdStatus', 'getXrFrameSystem',
])

// —— ③ 显式「不适用」（废弃 / 构建期 / 被语义原语消灭） ——
export const SPEC_NA: ReadonlySet<string> = new Set([
  // 废弃路由事件（wx.router 前身）
  'onAppRoute', 'offAppRoute', 'onAppRouteDone', 'offAppRouteDone', 'onBeforeAppRoute', 'offBeforeAppRoute',
  // 废弃音频（→ createWebAudioContext）
  'createAudioContext',
  // 构建期动态路径（编译期解析，无运行期 API）
  'resolve',
  // 内置字体（宿主排版层）
  'loadBuiltInFontFace',
  // 并行状态（试验特性，已废弃）
  'onParallelStateChange', 'offParallelStateChange',
  // 系统信息旧版（新工程用 getWindowInfo/getDeviceInfo/getAppBaseInfo）
  'getSystemInfoAsync',
  // 调度原语（Vue nextTick / 渲染器调度等价，非平台能力）
  'nextTick',
])

// —— ③-b 显式「规划待落地」（L2 通用缺口——可见待办，非 owned 自证；棘轮约束下只能降不能升） ——
export const SPEC_PLANNED: Record<string, string> = {
  // 网络底层（已由 C69 useSocket 覆盖——见 SPEC_COVERED）
  // 媒体高级（已由 C70 useMediaProcessing 覆盖——见 SPEC_COVERED）
  // 图像编辑（已由 C68 useImageEdit 覆盖——见 SPEC_COVERED）
  // 性能（已由 C66 usePerformance 覆盖——见 SPEC_COVERED）
  // 录屏 / 画中画（已由 C71 useScreenCapture 覆盖——见 SPEC_COVERED + EVENT_BASE covered）
  // 预加载 / 分包（已由 C67 usePreload 覆盖——见 SPEC_COVERED）
  // AR / XR（已由 C76 useAR 覆盖——见 SPEC_COVERED）
  // 缓存管理 / 窗口 / 卸载拦截（已由 C72/C74/C75 覆盖——见 SPEC_COVERED）
  // 调度（已由 C73 useIdle 覆盖——见 SPEC_COVERED）
  // 设备能力探测（已由 C81 useDeviceCapability 覆盖——见 SPEC_COVERED）
}

// —— ④ 事件对 → 承接（status 区分：映射既有 Hook = covered，映射新 Hook = planned） ——
const EVENT_BASE: Record<string, MpSpecClass> = {
  // 映射既有 Hook（covered）
  onCopyUrl: { status: 'covered', proteus: 'useClipboard' }, offCopyUrl: { status: 'covered', proteus: 'useClipboard' },
  onAudioInterruptionBegin: { status: 'covered', proteus: 'useBackground' }, offAudioInterruptionBegin: { status: 'covered', proteus: 'useBackground' },
  onAudioInterruptionEnd: { status: 'covered', proteus: 'useBackground' }, offAudioInterruptionEnd: { status: 'covered', proteus: 'useBackground' },
  onBackgroundFetchData: { status: 'covered', proteus: 'useBackground' }, offBackgroundFetchData: { status: 'covered', proteus: 'useBackground' },
  onMenuButtonBoundingClientRectWeightChange: { status: 'covered', proteus: 'useElement' }, offMenuButtonBoundingClientRectWeightChange: { status: 'covered', proteus: 'useElement' },
  onApiCategoryChange: { status: 'covered', proteus: 'useDevice' }, offApiCategoryChange: { status: 'covered', proteus: 'useDevice' },
  onWindowStateChange: { status: 'covered', proteus: 'useAppLifecycle' }, offWindowStateChange: { status: 'covered', proteus: 'useAppLifecycle' },
  onBLEPeripheralConnectionStateChanged: { status: 'covered', proteus: 'useBluetooth' }, offBLEPeripheralConnectionStateChanged: { status: 'covered', proteus: 'useBluetooth' },
  // 批 G：iBeacon / 局域网 mDNS（covered——C77/C78）
  onBeaconServiceChange: { status: 'covered', proteus: 'useBeacon' }, offBeaconServiceChange: { status: 'covered', proteus: 'useBeacon' },
  onBeaconUpdate: { status: 'covered', proteus: 'useBeacon' }, offBeaconUpdate: { status: 'covered', proteus: 'useBeacon' },
  onLocalServiceFound: { status: 'covered', proteus: 'useLocalService' }, offLocalServiceFound: { status: 'covered', proteus: 'useLocalService' },
  onLocalServiceLost: { status: 'covered', proteus: 'useLocalService' }, offLocalServiceLost: { status: 'covered', proteus: 'useLocalService' },
  onLocalServiceResolveFail: { status: 'covered', proteus: 'useLocalService' }, offLocalServiceResolveFail: { status: 'covered', proteus: 'useLocalService' },
  onLocalServiceDiscoveryStop: { status: 'covered', proteus: 'useLocalService' }, offLocalServiceDiscoveryStop: { status: 'covered', proteus: 'useLocalService' },
  // 批 G：录屏（covered——C71）/ 翻译（covered——C79）/ 海报（covered——C80）
  onScreenRecordingStateChanged: { status: 'covered', proteus: 'useScreenCapture' }, offScreenRecordingStateChanged: { status: 'covered', proteus: 'useScreenCapture' },
  onUserCaptureScreen: { status: 'covered', proteus: 'useScreenCapture' }, offUserCaptureScreen: { status: 'covered', proteus: 'useScreenCapture' },
  onUserTriggerTranslation: { status: 'covered', proteus: 'useTranslation' }, offUserTriggerTranslation: { status: 'covered', proteus: 'useTranslation' },
  onUserOffTranslation: { status: 'covered', proteus: 'useTranslation' }, offUserOffTranslation: { status: 'covered', proteus: 'useTranslation' },
  onGeneratePoster: { status: 'covered', proteus: 'usePoster' }, offGeneratePoster: { status: 'covered', proteus: 'usePoster' },
}

/** 单条分类（规则序：显式 covered → private → na → planned → 事件基名 → gap） */
export function classifySpecApi(name: string): MpSpecClass {
  if (name in SPEC_COVERED) return { status: 'covered', proteus: SPEC_COVERED[name] }
  if (SPEC_PRIVATE.has(name)) return { status: 'private' }
  if (SPEC_NA.has(name)) return { status: 'na' }
  if (name in SPEC_PLANNED) return { status: 'planned', proteus: SPEC_PLANNED[name] }
  if (name in EVENT_BASE) return EVENT_BASE[name]
  return { status: 'gap' }
}

/** 组件分类：由 MP_MAPPING_MATRIX 的显式登记驱动（tag 命中即 covered/private/...） */
export function classifySpecComponent(
  tag: string,
  matrix: ReadonlyArray<{ mp: string; status: string; planned?: boolean }>,
): MpSpecClass {
  // 显式覆盖（组件名与矩阵不同名 / 语义消灭 / Skyline 手势处理器 → 手势原语）
  if (tag in SPEC_COMPONENT_OVERRIDE) return SPEC_COMPONENT_OVERRIDE[tag]
  const row = matrix.find((r) => r.mp === `<${tag}>`)
  if (!row) return { status: 'gap' }
  if (row.planned) return { status: 'planned' }
  if (row.status === 'private') return { status: 'private' }
  if (row.status === 'missing') return { status: 'gap' }
  return { status: 'covered' }
}

/** 组件级显式分类（名不对齐/语义消灭/Skyline 专属——矩阵未逐条登记时的权威声明） */
export const SPEC_COMPONENT_OVERRIDE: Record<string, MpSpecClass> = {
  // 语义消灭为子项/属性（表单分组、多列选择）
  'checkbox-group': { status: 'na', proteus: 'p-checkbox 分组（消灭为子项）' },
  'radio-group': { status: 'na', proteus: 'p-radio 分组（消灭为子项）' },
  'picker-view-column': { status: 'na', proteus: 'p-picker 多列（消灭为属性）' },
  // Skyline 手势处理器 → 手势原语（gesture.* / v-gesture）
  'tap-gesture-handler': { status: 'covered', proteus: 'gesture.tap' },
  'double-tap-gesture-handler': { status: 'covered', proteus: 'gesture.draggable（tap 识别）' },
  'long-press-gesture-handler': { status: 'covered', proteus: 'gesture.long-press' },
  'pan-gesture-handler': { status: 'covered', proteus: 'gesture.pan' },
  'scale-gesture-handler': { status: 'covered', proteus: 'gesture.pinch' },
  'force-press-gesture-handler': { status: 'covered', proteus: 'gesture.press' },
  'horizontal-drag-gesture-handler': { status: 'covered', proteus: 'gesture.draggable' },
  'vertical-drag-gesture-handler': { status: 'covered', proteus: 'gesture.draggable' },
  // Skyline 布局构建器 → 布局语义
  'grid-builder': { status: 'covered', proteus: 'layout.grid' },
  'list-builder': { status: 'covered', proteus: 'layout.virtual-list' },
  'nested-scroll-body': { status: 'covered', proteus: 'layout.scroll（嵌套滚动）' },
  'nested-scroll-header': { status: 'covered', proteus: 'layout.scroll（嵌套滚动）' },
  'draggable-sheet': { status: 'covered', proteus: 'shell.page-container（半屏可拖）' },
  // aria-component 是 ARIA 属性文档页（非组件标签）——ARIA 属性两端原生支持（aria-label/aria-role）
  'aria-component': { status: 'na', proteus: '—（ARIA 属性文档页；aria-* 两端原生支持，组件已带 ariaLabel）' },
  // Skyline 同层渲染后冗余（官方：建议用 view 替代 cover-view/cover-image）
  'cover-view': { status: 'na', proteus: '—（同层渲染后冗余，用 layout.box 替代）' },
  'cover-image': { status: 'na', proteus: '—（同层渲染后冗余，用 ui.image 替代）' },
  // 表单/富文本/文本片段 → 语义承接（★批 H：keyboard-accessory/selection 已全端真实落地）
  'keyboard-accessory': { status: 'covered', proteus: 'shell.keyboard-accessory（p-keyboard-accessory）' },
  selection: { status: 'covered', proteus: 'ui.selection（p-selection）' },
  span: { status: 'na', proteus: 'ui.text 内联（消灭为子元素）' },
  'editor-portal': { status: 'na', proteus: 'ui.rich-text 内联（消灭为子元素）' },
  'native-component': { status: 'private', proteus: '（微信原生组件扩展点，非目标）' },
  'official-account-publish': { status: 'private', proteus: '（微信公众号发布，私有）' },
  'open-data-item': { status: 'private', proteus: '（微信开放数据项，私有）' },
  'open-data-list': { status: 'private', proteus: '（微信开放数据列表，私有）' },
  // 视频号 / 营销（类目资质）
  'channel-live': { status: 'private', proteus: '（视频号直播，私有）' },
  'channel-video': { status: 'private', proteus: '（视频号视频，私有）' },
  'ad-custom': { status: 'private', proteus: '（微信自定义广告，私有）' },
  reward: { status: 'private', proteus: '（微信激励奖励组件，私有）' },
  'store-coupon': { status: 'private', proteus: '（微信小店优惠券，私有）' },
  'store-gift': { status: 'private', proteus: '（微信小店礼品，私有）' },
  'store-home': { status: 'private', proteus: '（微信小店主页，私有）' },
  'store-product': { status: 'private', proteus: '（微信小店商品，私有）' },
}

export interface SpecCoverageReport {
  total: number
  covered: number
  planned: number
  private: number
  na: number
  gap: number
  /** 已归类项（total − gap）——分类完整性分母（防「漏登记」）。 */
  accounted: number
  /** 分类完整率 = accounted/total（恒 100 表示「全部官方项都进了某个箱子」——不是「全实现」！） */
  classifiedPercent: number
  /** ★可落地项 = covered + planned（排除 private/na——非目标或废弃） */
  actionable: number
  /** ★真·落地率 = covered / actionable（诚实指标——「可用比例」，非「已归类比例」） */
  landedPercent: number
  gaps: Array<{ kind: 'component' | 'api'; name: string }>
  /** 规划待落地清单（planned——可见待办） */
  plannedItems: Array<{ kind: 'component' | 'api'; name: string; proteus?: string }>
}

/**
 * ★spec 覆盖度审计：官方清单逐项分类 → 报告（gap 列出全部缺口名）。
 * @param spec 官方清单快照
 * @param matrix 组件显式登记（MP_MAPPING_MATRIX）
 */
export function auditSpecCoverage(
  spec: MpOfficialSpec,
  matrix: ReadonlyArray<{ mp: string; status: string; planned?: boolean }>,
): SpecCoverageReport {
  const counts: Record<MpSpecStatus, number> = { covered: 0, planned: 0, private: 0, na: 0, gap: 0 }
  const gaps: Array<{ kind: 'component' | 'api'; name: string }> = []
  const plannedItems: Array<{ kind: 'component' | 'api'; name: string; proteus?: string }> = []
  for (const tag of spec.components) {
    const c = classifySpecComponent(tag, matrix)
    counts[c.status]++
    if (c.status === 'gap') gaps.push({ kind: 'component', name: tag })
    if (c.status === 'planned') plannedItems.push({ kind: 'component', name: tag, proteus: c.proteus })
  }
  for (const api of spec.apis) {
    const c = classifySpecApi(api)
    counts[c.status]++
    if (c.status === 'gap') gaps.push({ kind: 'api', name: api })
    if (c.status === 'planned') plannedItems.push({ kind: 'api', name: api, proteus: c.proteus })
  }
  const total = spec.components.length + spec.apis.length
  const actionable = counts.covered + counts.planned
  return {
    total,
    covered: counts.covered,
    planned: counts.planned,
    private: counts.private,
    na: counts.na,
    gap: counts.gap,
    accounted: total - counts.gap,
    classifiedPercent: total === 0 ? 0 : Math.round(((total - counts.gap) / total) * 100),
    actionable,
    landedPercent: actionable === 0 ? 100 : Math.floor((counts.covered / actionable) * 100), // ★floor（永不夸大——99.6% 显示 99 而非 100）
    gaps,
    plannedItems,
  }
}

/**
 * ★棘轮预算：covered 的硬下限 + gap 硬上限——只能向好的方向变。
 *   covered 下降 或 gap 上升 → CI 红（防「悄悄丢覆盖」）；改善后应手动调高 covered 锁定成果。
 */
export const SPEC_RATCHET: { coveredMin: number; gapMax: number } = {
  coveredMin: 255, // 2026-09-12 基线（spec 382 项：covered 255 / planned 1（share-element，需宿主分享流）/ private 106 / na 20 / gap 0）——含 C65-C81 + 组件批 H/I/J
  gapMax: 0, // 全部官方项必须归类
}
