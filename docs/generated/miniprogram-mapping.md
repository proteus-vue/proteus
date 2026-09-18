# 小程序全量能力对照矩阵（自动生成——SSOT = packages/component-ir/src/audit.ts MP_MAPPING_MATRIX）

> ★由 `npm run gen:docs` 生成，勿手改。这是机器事实（catalog 与矩阵实时同步）；手工规划叙述见 `proteus-semantic-primitives-plus-plan/miniprogram-mapping.md`。
> 总计 115 项（组件 57 + API 58）；✅ 104 · 🔄 4 · ⬛ 7 · ❌ 0

## 组件对照表

| 小程序组件 | Proteus 原语 | 状态 |
|-----------|-------------|------|
| `<view>` | layout.box / layout.stack | ok |
| `<text>` | ui.text / ui.heading | ok |
| `<image>` | ui.image | ok |
| `<scroll-view>` | layout.scroll / layout.virtual-list | ok |
| `<swiper>` | layout.stack snap/loop（消灭为属性） | ok |
| `<swiper-item>` | layout.stack 子项 | ok |
| `<movable-area>` | gesture.scrollable 容器 | ok |
| `<movable-view>` | gesture.draggable | ok |
| `<cover-view>` | layout.box（Skyline 同层渲染后 view 即可覆盖——官方建议替代） | ok |
| `<cover-image>` | ui.image（同层渲染后 image 即可覆盖） | ok |
| `<icon>` | ui.icon | ok |
| `<progress>` | ui.progress | ok |
| `<rich-text>` | ui.rich-text | ok |
| `<button>` | ui.button | ok |
| `<form>` | ui.form | ok |
| `<input>` | ui.input | ok |
| `<textarea>` | ui.textarea | ok |
| `<checkbox>` | ui.checkbox | ok |
| `<radio>` | ui.radio | ok |
| `<picker>` | ui.picker / ui.select | ok |
| `<picker-view>` | ui.picker mode=wheel | ok |
| `<slider>` | ui.slider | ok |
| `<switch>` | ui.switch | ok |
| `<label>` | ui.label | ok |
| `<navigator>` | engineering.router-link / router.* | ok |
| `<audio>` | ui.media kind=audio（消灭为属性） | ok |
| `<video>` | ui.media kind=video（消灭为属性） | ok |
| `<camera>` | ui.camera（p-camera）+ useCamera | ok |
| `<live-player>` | ui.media kind=live（消灭为属性） | ok |
| `<live-pusher>` | ui.media kind=live mode=push | ok |
| `<canvas>` | ui.canvas | ok |
| `<map>` | ui.map（p-map）+ useMap | ok |
| `<web-view>` | shell.webview（p-webview）+ 宿主桥 | ok |
| `<editor>` | ui.rich-text editable | ok |
| `<ad>` | shell.ad（p-ad） | ok |
| `<official-account>` | useMiniProgram（微信私有） | private |
| `<open-data>` | useMiniProgram（微信私有） | private |
| `<share-element>` | engineering.share-element（p-share-element） | ok |
| `<aria-component>` | aria-* 属性（各组件 ariaLabel；两端原生支持） | ok |
| `<page-container>` | shell.page-container | ok |
| `<voip-room>` | useMiniProgram（微信 VOIP） | private |
| `<guild-room>` | useMiniProgram（微信游戏） | private |
| `<match-media>` | p-adaptive / p-zone（容器断点替代） | ok |
| `<navigation-bar>` | shell.nav（p-nav-bar 自绘） | ok |
| `<keyframe-animation>` | engineering.animate / engineering.transition | ok |
| `<list-view>` | layout.virtual-list（p-list-view 回收） | ok |
| `<grid-view>` | layout.grid / layout.virtual-list | ok |
| `<snapshot>` | ui.canvas（截图经 OffscreenCanvas） | compat |
| `<page-meta>` | shell.page（页面配置属性） | compat |
| `<root-portal>` | engineering.transition（teleport→root-portal 编译期） | ok |
| `<sticky-header>` | layout.scroll + sticky（CSS） | compat |
| `<sticky-section>` | layout.scroll + sticky（CSS） | compat |
| `<double-tap-gesture>` | gesture.draggable（p-draggable 手势识别器） | ok |
| `<functional-page-navigator>` | —（微信插件页专属，非目标） | private |
| `<open-container>` | —（微信开屏容器，私有） | private |
| `<selection>` | ui.selection（p-selection） | ok |
| `<keyboard-accessory>` | shell.keyboard-accessory（p-keyboard-accessory） | ok |

## API 对照表

| 小程序 API | Proteus 原语 | 状态 |
|-----------|-------------|------|
| `wx.request/upload/download/websocket（网络）` | useFetch / useUpload / useDownload / useWebSocket / useSocketTask | ok |
| `wx.requestPayment` | usePayment | ok |
| `wx.chooseImage/chooseMedia/previewImage（媒体）` | useAlbum / useCamera + ui.image | ok |
| `wx.startRecord/RecorderManager（录音）` | useMicrophone / useRecorder | ok |
| `wx.createVideoContext/CameraContext` | ui.media + createCameraContext（ui.canvas 承接） | ok |
| `wx.scanCode` | useQRCode / p-scan-qr | ok |
| `wx.saveImageToPhotosAlbum/saveVideoToPhotosAlbum` | useAlbum（saveImage/saveVideo） | ok |
| `wx.createWorker（多线程）` | useWorker | ok |
| `wx.chooseAddress（收货地址）` | useAddress | ok |
| `wx.getConnectedWifi/getWifiList/connectWifi（WiFi）` | useWifi | ok |
| `wx.getWeRunData（微信运动）` | useWeRun | ok |
| `wx.createCanvasContext / canvasToTempFilePath / createOffscreenCanvas（Canvas 组件实例）` | useCanvas | ok |
| `wx.createSelectorQuery（元素几何查询）` | useElement | ok |
| `wx.createIntersectionObserver（交叉观察）` | useIntersection | ok |
| `wx.createMediaQueryObserver（媒体查询）` | useMediaQuery | ok |
| `wx.createVideoContext（视频组件实例）` | useVideo | ok |
| `wx.createInnerAudioContext（音频实例）` | useAudio | ok |
| `wx.createLivePusherContext（直播推流实例）` | useLivePusher | ok |
| `wx.createRewardedVideoAd/createInterstitialAd/createBannerAd（广告）` | useAd | ok |
| `wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize（隐私协议）` | usePrivacy | ok |
| `wx.getPerformance/reportPerformance（性能）` | usePerformance | ok |
| `wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage（预加载）` | usePreload | ok |
| `wx.cropImage/editImage（图像编辑）` | useImageEdit | ok |
| `wx.createUDPSocket/createTCPSocket（网络底层 Socket）` | useSocket | ok |
| `wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer（媒体高级）` | useMediaProcessing | ok |
| `wx.getScreenRecordingState/onScreenRecordingStateChanged/onUserCaptureScreen/checkIsPictureInPictureActive（录屏/截屏）` | useScreenCapture | ok |
| `wx.createCacheManager（请求缓存管理）` | useCacheManager | ok |
| `wx.requestIdleCallback/cancelIdleCallback（空闲调度）` | useIdle | ok |
| `wx.setWindowSize（PC 窗口）` | useWindow | ok |
| `wx.enableAlertBeforeUnload/disableAlertBeforeUnload（卸载拦截）` | useNavigationGuard | ok |
| `wx.createVKSession/isVKSupport（AR/XR 视觉算法）` | useAR | ok |
| `wx.onBeaconServiceChange/onBeaconUpdate（iBeacon）` | useBeacon | ok |
| `wx.onLocalServiceFound/Lost/ResolveFail/DiscoveryStop（局域网 mDNS）` | useLocalService | ok |
| `wx.onUserTriggerTranslation/onUserOffTranslation（翻译）` | useTranslation | ok |
| `wx.onGeneratePoster（分享海报）` | usePoster | ok |
| `wx.checkDeviceSupportHevc（设备能力探测）` | useDeviceCapability | ok |
| `wx.getFileSystemManager/*（文件 30+）` | useFileSystem | ok |
| `wx.compressFile/unzip` | useArchive | ok |
| `wx.set/get/remove/clearStorage(+Sync)` | useStorage | ok |
| `wx.getLocation/chooseLocation/openLocation` | useLocation / p-location | ok |
| `wx.createMapContext` | useMap | ok |
| `wx.getSystemInfo（设备/屏幕/网络/电量/亮度/方向/震动/传感器/剪贴板/电话）` | useDevice / useScreen / useNetwork / useBattery / useBrightness / useOrientation / useVibrate / useSensor / useClipboard / usePhoneCall | ok |
| `wx.openBluetoothAdapter（蓝牙 20+）` | useBluetooth | ok |
| `wx.getHCEState（NFC）` | useNFC | ok |
| `wx.checkIsSupportFingerPrint/FaceID` | useBiometric / useFaceID | ok |
| `wx.showToast/showLoading/showModal/showActionSheet` | shell.toast + ui.loading + shell.modal + shell.action-sheet | ok |
| `wx.setNavigationBarTitle/Color` | shell.nav | ok |
| `wx.setTabBarItem/Style/hide/show` | shell.tabbar | ok |
| `wx.pageScrollTo` | layout.scroll（p-scroll-view） | ok |
| `wx.createAnimation` | engineering.animate / engineering.transition | ok |
| `wx.createSelectorQuery/IntersectionObserver` | engineering.router-link + layout.scroll（实测能力） | ok |
| `wx.navigateTo/redirectTo/navigateBack/switchTab/reLaunch` | engineering.router-link + router.* API | ok |
| `wx.getCurrentPages` | engineering.router-link + shared adapter | ok |
| `App()/Page() 生命周期/getApp()` | useAppLifecycle / usePageLifecycle | ok |
| `wx.shareAppMessage/requestSubscribeMessage` | useShare / useNotification | ok |
| `wx.login/checkSession/getUserInfo/authorize` | useLogin / useAuth / usePermission | ok |
| `wx.getUpdateManager` | useUpdate | ok |
| `wx.requestWeChatPay/navigateToMiniProgram/模板消息/客服（微信私有）` | useMiniProgram | private |
