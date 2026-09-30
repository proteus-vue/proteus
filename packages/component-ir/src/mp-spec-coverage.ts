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

  // ★★2026-09-30 补齐（快照抽取器修泛型缺陷后新可见的 102 个官方 API——
  //   旧快照结构性漏抽它们 ⇒ 此前从未被归类。逐条证据见 tools 归类记录）
  authorize: 'usePermission',
  canvasToTempFilePath: 'useCanvas',
  chooseAddress: 'useAddress',
  chooseMedia: 'useAlbum',
  connectWifi: 'useWifi',
  getBatteryInfo: 'useBattery',
  getClipboardData: 'useClipboard',
  getConnectedWifi: 'useWifi',
  getHCEState: 'useNFC',
  getLocation: 'useLocation',
  getNetworkType: 'useNetwork',
  getScreenBrightness: 'useBrightness',
  getSetting: 'usePermission',
  getStorageSync: 'useStorage',
  getWeRunData: 'useWeRun',
  getWifiList: 'useWifi',
  login: 'useLogin',
  makePhoneCall: 'usePhoneCall',
  navigateToMiniProgram: 'useMiniProgram',
  previewMedia: 'useAlbum',
  request: 'useFetch',
  requestPayment: 'usePayment',
  saveImageToPhotosAlbum: 'useAlbum',
  saveVideoToPhotosAlbum: 'useAlbum',
  scanCode: 'useQRCode',
  setClipboardData: 'useClipboard',
  setScreenBrightness: 'useBrightness',
  setStorageSync: 'useStorage',
  startSoterAuthentication: 'useBiometric',
  startWifi: 'useWifi',
  vibrateShort: 'useVibrate',
  requestSubscribeMessage: 'useNotification',
  setWifiList: 'useWifi',
  stopWifi: 'useWifi',
  // ★2026-09-30 NC1：setKeepScreenOn 已由声明式能力 C83 承接（落地后据实由 planned 转 covered）
  setKeepScreenOn: 'useKeepScreenOn',
  // ★2026-09-30 记账修正：命令式全局提示**早已实现**（`packages/api/src/platform.ts` 的 createUIAPI：
  //   MP 走 wx.showToast/showLoading；Web 走 DOM 自绘 + SSR console 降级），且有测试
  //   （tests/platform-api.test.ts「stub wx 时 showToast/showLoading/hideLoading/showModal/
  //   showActionSheet 转发」）。同一份实现里的 showModal/showActionSheet **早已标 covered**
  //   ⇒ 这 4 条此前记 planned 属**记账不一致**（非能力缺口）。
  //   ★形态说明：命令式（走 PlatformAPI.ui）与声明式（p-toast / p-loading 组件）是**两条并存路径**，
  //     与 showModal（shell.modal 组件）↔ wx.showModal 的关系同构。
  showToast: 'PlatformAPI.ui.showToast（+ shell.toast / p-toast 组件）',
  hideToast: 'PlatformAPI.ui（DOM/wx 提示随 showToast 生命周期；组件路径见 p-toast）',
  showLoading: 'PlatformAPI.ui.showLoading（+ ui.loading / p-loading 组件）',
  hideLoading: 'PlatformAPI.ui.hideLoading',
  batchGetStorage: 'useStorage',
  batchSetStorage: 'useStorage',
  clearStorage: 'useStorage',
  getStorage: 'useStorage',
  setStorage: 'useStorage',
  removeStorage: 'useStorage',
  getStorageInfo: 'useStorage',
  startAccelerometer: 'useSensorStream',
  stopAccelerometer: 'useSensorStream',
  startCompass: 'useSensorStream',
  stopCompass: 'useSensorStream',
  startGyroscope: 'useSensorStream',
  stopGyroscope: 'useSensorStream',
  startLocationUpdate: 'useLocation',
  stopLocationUpdate: 'useLocation',
  startLocationUpdateBackground: 'useLocation',
  openBluetoothAdapter: 'useBluetooth',
  closeBluetoothAdapter: 'useBluetooth',
  getBluetoothAdapterState: 'useBluetooth',
  getBluetoothDevices: 'useBluetooth',
  getConnectedBluetoothDevices: 'useBluetooth',
  createBLEConnection: 'useBluetooth',
  closeBLEConnection: 'useBluetooth',
  getBLEDeviceCharacteristics: 'useBluetooth',
  getBLEDeviceServices: 'useBluetooth',
  getBLEDeviceRSSI: 'useBluetooth',
  getBLEMTU: 'useBluetooth',
  setBLEMTU: 'useBluetooth',
  isBluetoothDevicePaired: 'useBluetooth',
  makeBluetoothPair: 'useBluetooth',
  notifyBLECharacteristicValueChange: 'useBluetooth',
  readBLECharacteristicValue: 'useBluetooth',
  writeBLECharacteristicValue: 'useBluetooth',
  startBluetoothDevicesDiscovery: 'useBluetooth',
  stopBluetoothDevicesDiscovery: 'useBluetooth',
  openSystemBluetoothSetting: 'useBluetooth',
  closeSocket: 'useWebSocket',
  sendSocketMessage: 'useWebSocket',
  getBeacons: 'useBeacon',
  startBeaconDiscovery: 'useBeacon',
  stopBeaconDiscovery: 'useBeacon',
  startLocalServiceDiscovery: 'useLocalService',
  stopLocalServiceDiscovery: 'useLocalService',
  startHCE: 'useNFC',
  stopHCE: 'useNFC',
  sendHCEMessage: 'useNFC',
  checkIsSupportSoterAuthentication: 'useBiometric',
  checkIsSoterEnrolledInDevice: 'useBiometric',
  chooseImage: 'useAlbum',
  chooseVideo: 'useAlbum',
  previewImage: 'useAlbum',
  compressImage: 'useMediaProcessing',
  compressVideo: 'useMediaProcessing',
  getAvailableAudioSources: 'useAudio',
  setInnerAudioOption: 'useAudio',
  vibrateLong: 'useVibrate',
  hideKeyboard: 'useKeyboard',
  openSetting: 'usePermission',
  openAppAuthorizeSetting: 'usePermission',
  addPhoneRepeatCalendar: 'useCalendarAPI',
  navigateTo: 'useRouter/useRoute（packages/router）',
  navigateBack: 'useRouter/useRoute（packages/router）',
  redirectTo: 'useRouter/useRoute（packages/router）',
  reLaunch: 'useRouter/useRoute（packages/router）',
  switchTab: 'useRouter/useRoute（packages/router）',
  showModal: 'shell.modal（p-modal 组件）',
  showActionSheet: 'shell.action-sheet（p-action-sheet 组件）',
  getSelectedTextRange: 'ui.selection（p-selection 组件）',
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
  // ★★2026-09-30 补齐（新可见 36 条——微信生态独占：卡券/红包/订单支付/发票/车牌/POI/
  //   群工具与群分享/VoIP/收藏/后台周期拉取/分享菜单控制/小程序返回链/提示更新微信）
  'addCard',
  'openCard',
  'showRedPackage',
  'requestOrderPayment',
  'chooseInvoice',
  'chooseInvoiceTitle',
  'chooseLicensePlate',
  'chooseLocation',
  'choosePoi',
  'getChatToolInfo',
  'openChatTool',
  'notifyGroupMembers',
  'selectGroupMembers',
  'shareAppMessageToGroup',
  'shareEmojiToGroup',
  'shareFileMessage',
  'shareFileToGroup',
  'shareImageToGroup',
  'shareVideoMessage',
  'shareVideoToGroup',
  'shareToWeRun',
  'subscribeVoIPVideoMembers',
  'updateVoIPChatMuteConfig',
  'exitVoIPChat',
  'addFileToFavorites',
  'addVideoToFavorites',
  'hideShareMenu',
  'showShareMenu',
  'updateShareMenu',
  'showShareImageMenu',
  'navigateBackMiniProgram',
  'updateWeChatApp',
  'openLocation',
  'getBackgroundFetchData',
  'getBackgroundFetchToken',
  'setBackgroundFetchToken',
  // ★2026-09-30 归类修正：这两条依赖**微信生态上下文**（聊天会话选文件 / 微信授权头像昵称），
  //   与 Web/App 无共同语义 ⇒ 属「微信独占」而非「通用缺口」（重分类前误记 planned——那会虚增
  //   缺口数并误导 NC2 排期去做"跨端对等"，而它本质上没有对等物）
  'chooseMessageFile', 'getUserProfile',
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
  // ★★2026-09-30 补齐（新可见 33 条——已废弃/构建期/被语义原语消灭/宿主层；逐组见注释）
  'checkSession',
  'getShareInfo',
  'getUserInfo',
  'getSystemInfo',
  'setEnableDebug',
  'playVoice',
  'pauseVoice',
  'stopVoice',
  'startRecord',
  'stopRecord',
  'playBackgroundAudio',
  'pauseBackgroundAudio',
  'stopBackgroundAudio',
  'seekBackgroundAudio',
  'getBackgroundAudioPlayerState',
  'getExtConfig',
  'loadFontFace',
  'setNavigationBarTitle',
  'setNavigationBarColor',
  'showNavigationBarLoading',
  'hideNavigationBarLoading',
  'setTopBarText',
  'hideHomeButton',
  'showTabBar',
  'hideTabBar',
  'setTabBarBadge',
  'removeTabBarBadge',
  'setTabBarItem',
  'setTabBarStyle',
  'showTabBarRedDot',
  'hideTabBarRedDot',
  'setBackgroundColor',
  'setBackgroundTextStyle',
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
  // ★C82 WebAssembly：**不在官方 301 API 清单内**（`WXWebAssembly` 属「小程序运行时」文档章节，
  //   非「API」章节）⇒ **不进 SPEC_COVERED**：那会让 covered 分子虚增而分母不变 ⇒ 覆盖率虚高。
  //   也不进 SPEC_PRIVATE（它是**公开能力**，不是微信私有 API）
  //   ⇒ 归类为「超清单能力」，由 primitives C82 直接承载（矩阵见 audit.ts）
  // ★★2026-09-30 补齐（新可见 21 条——真实缺口，NC2「内置能力扩充」候选输入）
  addPhoneContact: '通讯录写入（无对等 Hook）',
  canvasGetImageData: '画布像素读取（CanvasContext 无此方法——见 capability.ts CanvasContext）',
  canvasPutImageData: '画布像素写入（同上）',
  checkIsOpenAccessibility: '无障碍开关探测（无对等）',
  createBLEPeripheralServer: '蓝牙外设模式（无对等）',
  getImageInfo: '图片元信息（宽高/方向——useFileSystem 只给 size/digest）',
  getVideoInfo: '视频元信息（同上族）',
  getRandomValues: '密码学随机数（Web 端有 crypto.getRandomValues——宿主未接线）',
  openDocument: '文档预览（宿主文档能力，无对等）',
  pageScrollTo: '页面级滚动（p-scroll 只管组件内滚动）',
  startPullDownRefresh: '页面级下拉刷新（p-scroll refresher 只管 scroll-view）',
  stopPullDownRefresh: '页面级下拉刷新（同上）',
  startDeviceMotionListening: '设备运动监听（融合传感器——当前仅三轴单项）',
  stopDeviceMotionListening: '设备运动监听（同上）',
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
  // ★2026-09-18 诚实性修正：以下 5 条原标 covered，但其指向的 gesture 原语在 PRIMITIVE_CATALOG 中
  //   为 **planned**（`gesture.long-press` 更是拼写错误——实际名为 `gesture.longpress`）。
  //   covered 的定义是「有可运行等价」，而统一手势 API（`v-gesture:*`）尚未落地 →
  //   按实测状态改标 planned（与 2026-09-16 属性标尺虚高同类修正：数字不粉饰）。
  //   ★2026-09-18 复评：tap/longpress **已据实转 covered**（编译器新增 directive/v-gesture 规则，
  //   双端原生事件对等：MP bindtap/bindlongpress、Web Pointer 识别器）；pan/pinch/press 仍 planned
  //   （MP 无事件对等——官方是 worklet 手势处理器<组件>，非事件属性）。
  //   ★同时新增 auditSpecOverrideRefs 门禁——此前 override 表**完全不在引用校验范围内**，
  //   故这 5 条虚高 + 1 处悬空引用长期未被发现。
  'tap-gesture-handler': { status: 'covered', proteus: 'gesture.tap（★2026-09-18 落地：编译器 v-gesture:tap → bindtap——MP 原生事件对等）' },
  // ★2026-09-19 诚实性修正（与本文件 `gesture.long-press` 拼写错误同类）：本节原标 `covered`
  //   且引用 `gesture.draggable`（**拖拽**语义）——两处都不成立：
  //   ① 引用错位：双击识别在 `gesture.tap` 的 `count`/`dblTapWindow`（recognizers.ts:229），
  //      与 draggable（G8 = movable-view 拖拽）无关；
  //   ② MP 无对等：`v-gesture:tap` 在 MP 只映射 bindtap（原生事件不带 count），编译器亦无 count
  //      处理 → 双击语义仅 Web 成立。
  //   ⇒ 按 pan/scale/force-press 同一标准（MP 无原生对等即 planned）据实改标 `planned`。
  //   ★该错位长期漏网，因 auditSpecOverrideRefs 当时只校验「引用存在且已落地」——
  //     本轮补 GESTURE_HANDLER_EXPECTED 语义配对门禁（同类错位今后必红）。
  'double-tap-gesture-handler': { status: 'planned', proteus: 'gesture.tap 的 count 变体（Web 识别器支持双击；MP 原生 bindtap 不带 count，无对等）' },
  'long-press-gesture-handler': { status: 'covered', proteus: 'gesture.longpress（★2026-09-18 落地：编译器 v-gesture:longpress → bindlongpress——MP 原生事件对等）' },
  'pan-gesture-handler': { status: 'planned', proteus: 'gesture.pan（v-gesture:pan 规划中）' },
  'scale-gesture-handler': { status: 'planned', proteus: 'gesture.pinch（v-gesture:pinch 规划中）' },
  'force-press-gesture-handler': { status: 'planned', proteus: 'gesture.press（v-gesture:press 规划中）' },
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

/**
 * ★2026-09-18 补门禁：`SPEC_COMPONENT_OVERRIDE` 的引用一致性。
 *
 * 背景（本轮实测发现）：`auditMatrixReferences` 只遍历 `MP_MAPPING_MATRIX`，
 *   override 表**完全不在引用校验范围内** → 表里长期存在两类未被发现的缺陷：
 *   ① **虚高覆盖**：5 个手势处理器标 `covered`，但指向的 `gesture.tap/pan/pinch/press`
 *      在 PRIMITIVE_CATALOG 中是 `planned`（`covered` 的定义是「有可运行等价」）；
 *   ② **悬空引用**：`gesture.long-press` 拼写错误（实际名为 `gesture.longpress`）。
 *   两者都让「真·落地率」虚高且无人察觉。本函数把 override 表纳入同一校验。
 *
 * @param catalog      原语清单（SSOT，判定 covered 的引用是否真已落地）
 * @param overrideTable 可选注入（测试用；缺省 = SPEC_COMPONENT_OVERRIDE）
 * @returns issues 结构同矩阵引用检查；`dangling` 为未登记原语，`unimplemented` 为指向 planned 原语。
 */
/**
 * ★gesture-handler 组件 → **期望承载语义**（2026-09-19）。
 *
 * 背景（本轮实测发现）：`double-tap-gesture-handler` 长期标 `covered` 并引用
 *   `gesture.draggable`（拖拽）——语义完全对不上，却因 `auditSpecOverrideRefs` 当时只校验
 *   「引用存在且**已落地**」而无人发现（draggable 确实存在且已落地）。
 *   「引用存在」≠「引用对得上」——本表把后者机器化：**covered 声明的引用必须包含期望语义**。
 *
 * 维护：新增 *-gesture-handler 类组件时同步本表；covered 行若换了承载语义须同步此处（否则 FAIL）。
 */
export const GESTURE_HANDLER_EXPECTED: Record<string, string> = {
  'tap-gesture-handler': 'gesture.tap',
  'double-tap-gesture-handler': 'gesture.tap', // 语义上属 tap 的 count 变体（当前 planned——MP 无对等）
  'long-press-gesture-handler': 'gesture.longpress',
  'pan-gesture-handler': 'gesture.pan',
  'scale-gesture-handler': 'gesture.pinch',
  'force-press-gesture-handler': 'gesture.press',
  'horizontal-drag-gesture-handler': 'gesture.draggable',
  'vertical-drag-gesture-handler': 'gesture.draggable',
}

export function auditSpecOverrideRefs(
  catalog: ReadonlyArray<{ semantic: string; tag?: string; status: string }>,
  overrideTable: Record<string, MpSpecClass> = SPEC_COMPONENT_OVERRIDE,
): { issues: Array<{ mp: string; ref: string; kind: 'semantic' | 'component' | 'unimplemented' | 'mismatched' }>; coveredRefs: number } {
  const bySemantic = new Map(catalog.map((p) => [p.semantic, p]))
  const byTag = new Map(catalog.filter((p) => p.tag).map((p) => [p.tag as string, p]))
  const issues: Array<{ mp: string; ref: string; kind: 'semantic' | 'component' | 'unimplemented' | 'mismatched' }> = []
  let coveredRefs = 0

  for (const [tag, cls] of Object.entries(overrideTable)) {
    if (cls.status !== 'covered') continue // 仅 covered 的声明需要「真已落地」证据
    const text = cls.proteus ?? ''
    // ★语义配对（GESTURE_HANDLER_EXPECTED）：covered 引用必须**对得上**组件名的手势种类——
    //   防「引用存在但张冠李戴」（double-tap → gesture.draggable 即此类，长期漏网）。
    //   ★判定纪律：只在「引用里确实写了**已登记的手势语义**、但种类不符」时报错位——
    //   若写出了根本不存在的语义（如拼写错 gesture.long-press），那是悬空引用（下方 kind: semantic），
    //   不应被重复报成错位（两类缺陷各有其因，报错也要归因准确）。
    const expected = GESTURE_HANDLER_EXPECTED[tag]
    if (expected) {
      const gestureRefs = [...text.matchAll(/\bgesture\.[a-z][\w-]*/g)].map((m) => m[0]).filter((r) => bySemantic.has(r))
      if (gestureRefs.length > 0 && !gestureRefs.includes(expected)) {
        issues.push({ mp: tag, ref: expected, kind: 'mismatched' })
      }
    }
    for (const m of text.matchAll(/\b(?:layout|ui|shell|gesture|capability|engineering)\.[a-z][\w-]*/g)) {
      coveredRefs++
      const p = bySemantic.get(m[0])
      if (!p) issues.push({ mp: tag, ref: m[0], kind: 'semantic' })
      else if (p.status === 'planned') issues.push({ mp: tag, ref: m[0], kind: 'unimplemented' })
    }
    for (const m of text.matchAll(/\bp-[a-z][\w-]*/g)) {
      coveredRefs++
      const p = byTag.get(m[0])
      if (!p) issues.push({ mp: tag, ref: m[0], kind: 'component' })
      else if (p.status === 'planned') issues.push({ mp: tag, ref: m[0], kind: 'unimplemented' })
    }
  }
  return { issues, coveredRefs }
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
  // ★2026-09-18 水位修正（非回退）：255 → 250（含 5 条手势虚高）；同日后又 **250 → 252**
  //   （其中 tap/longpress 经编译器落地，见下）。原 255 基线**含 5 条虚高**
  //   （tap/long-press/pan/scale/force-press-gesture-handler 标 covered，但其手势原语为 planned）。
  //   修正后实测 covered 250 / planned 6（share-element + 5 手势）/ private 106 / na 20 / gap 0。
  //   这与 2026-09-16「属性总数 793→771」属同类修正——**修的是标尺，不是能力**：
  //   真实可运行的等价物一件没少，只是不再把「规划中」记成「已落地」。
  //   ★今后此值只增不减；若因**同类诚实性修正**需下调，必须在本注释写明被修正的具体条目。
  // ★2026-09-18 上调 250 → 252：tap/longpress 手势**真实落地**（编译器 directive/v-gesture 规则
  //   → MP bindtap/bindlongpress + Web Pointer 识别器），spec 分类据实由 planned 转 covered。
  //   与上次的「下调」性质相反——这次是**能力真实增长**（真·落地率 97%→98%）。
  // ★2026-09-19 诚实性修正（下行 253→252，属「修标尺不是修能力」）：`double-tap-gesture-handler`
  //   原标 covered 且引用 `gesture.draggable`（拖拽）——引用错位 + MP 无对等（bindtap 不带 count）
  //   ⇒ 据实转 planned。**真实可运行的等价物一件没少**，只是不再把「仅 Web 成立」记成「两端已落地」。
  //   该条即上次注释要求「因诚实性修正需下调时，必须写明被修正的具体条目」所指的条目。
  coveredMin: 361, // ★2026-09-30 上调 252 → 356（修标尺）→ 357（C83）→ **361**（4 条命令式提示：记账修正，非新能力）
  gapMax: 0, // 全部官方项必须归类
  // ★★2026-09-30：抽标尺修复后的水位重锁（**性质：修的是尺子，不是能力**——必须写清楚）
  //   起因：快照抽取器（scripts/gen-mp-spec.mjs）的 API 正则不认**泛型方法签名** `name<T>(...)`
  //   ⇒ 197 个真实官方 API（含 `wx.request` / `wx.login` / `wx.authorize` / `wx.getStorageSync` /
  //   `wx.chooseMedia` / `wx.setKeepScreenOn` 等**最核心的一批**）**从未进入权威标尺**：
  //   分母被截短 40%（298 vs 实际 495）。
  //   后果有两面：① 这些 API 的缺口**结构性不可见**（gap=0 是假的——根本没在表里）；
  //   ② 报表里的「官方 N 项」本身是错的。
  //   ✅ 修复后：官方 579 项（组件 84 · API 495）；covered 356 / planned 25 / private 145 / na 53 / gap 0。
  //   ★为什么 covered **大幅上涨**（252→356）却不是"能力增长"：新增可见的 197 项里，
  //     **104 项**（102 新归类 + 2 由既有规则命中）经逐条取证确认**已有承接**——证据见下方各表
  //     分组注释（严格口径 = 剥注释后匹配 `wx.<name>(` 或同族动态派发，非"看起来像"）；
  //     private +39 · na +33 · planned +21 —— 合计 197。它们是**此前没被记账的既有覆盖**。
  //     这是"修尺子"带来的**账面**变化：真实可运行的等价物一件没多也没少。
  //   ★planned 在后续批次中逐条转出（C83 落地 + 命令式提示 4 条记账修正）——当前值见棘轮注释
  //     —— 它们是 NC2「内置能力扩充」的候选输入（**保守归类**：拿不准一律 planned，不虚标 covered）。
  //   ★附加修复：抽取范围原为「`interface Wx {` 起 → 文件尾」（未设边界，靠缩进巧合）⇒ 改为括号配对。
}
