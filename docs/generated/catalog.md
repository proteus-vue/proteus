# G-32 原语清单（自动生成——SSOT = packages/component-ir/src/primitives.ts）

> ★由 `npm run gen:docs` 生成，勿手改。手工维护的叙述性规划见各 plan 文档。
> 总计 **128** 原语 · implemented **44**。

## layout — 布局（12）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| L1 | `layout.box` | tag:p-box | `p-box` | <view> | implemented |
| L2 | `layout.inline` | tag:p-inline | `p-inline` | <text> 内联 | implemented |
| L3 | `layout.stack` | tag:p-stack | `p-stack` | flex + scroll-view + swiper | implemented |
| L4 | `layout.grid` | tag:p-grid | `p-grid` | <view> + CSS Grid | implemented |
| L5 | `layout.fluid` | tag:p-fluid | `p-fluid` | 响应式 CSS | implemented |
| L6 | `layout.adaptive` | tag:p-adaptive | `p-adaptive` | 无（容器宽度语义断点） | implemented |
| L7 | `layout.fit` | tag:p-fit | `p-fit` | fit-content | implemented |
| L8 | `layout.spacer` | tag:p-spacer | `p-spacer` | flex:1 | implemented |
| L9 | `layout.divider` | tag:p-divider | `p-divider` | <view> + border | implemented |
| L10 | `layout.scroll` | tag:p-scroll | `p-scroll` | <scroll-view> | implemented |
| L11 | `layout.virtual-list` | tag:p-virtual-list | `p-virtual-list` | <scroll-view> + 手动回收 | implemented |
| L12 | `layout.masonry` | tag:p-masonry | `p-masonry` | 第三方瀑布流 | implemented |

## ui — UI（18）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| U1 | `ui.text` | tag:p-text | `p-text` | <text> | implemented |
| U2 | `ui.heading` | tag:p-heading | `p-heading` | <h1>-<h6> | implemented |
| U3 | `ui.rich-text` | tag:p-rich-text | `p-rich-text` | <rich-text> | implemented |
| U4 | `ui.icon` | tag:p-icon | `p-icon` | <icon> | implemented |
| U5 | `ui.image` | tag:p-image | `p-image` | <image> | implemented |
| U6 | `ui.avatar` | tag:p-avatar | `p-avatar` | 组合 | implemented |
| U7 | `ui.media` | tag:p-media | `p-media` | <video>+<audio> | implemented |
| U8 | `ui.canvas` | tag:p-canvas | `p-canvas` | <canvas> | implemented |
| U9 | `ui.svg` | tag:p-svg | `p-svg` | 无 | implemented |
| U10 | `ui.input` | tag:p-input | `p-input` | <input> | implemented |
| U11 | `ui.textarea` | tag:p-textarea | `p-textarea` | <textarea> | implemented |
| U12 | `ui.select` | tag:p-select | `p-select` | <picker> 部分 | implemented |
| U13 | `ui.checkbox` | tag:p-checkbox | `p-checkbox` | <checkbox> | implemented |
| U14 | `ui.radio` | tag:p-radio | `p-radio` | <radio> | implemented |
| U15 | `ui.switch` | tag:p-switch | `p-switch` | <switch> | implemented |
| U16 | `ui.slider` | tag:p-slider | `p-slider` | <slider> | implemented |
| U17 | `ui.picker` | tag:p-picker | `p-picker` | <picker> | implemented |
| U18 | `ui.form` | tag:p-form | `p-form` | 组合 | implemented |

## shell — Shell（10）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| S1 | `shell.page` | tag:p-page | `p-page` | <page> | implemented |
| S2 | `shell.nav` | tag:p-nav | `p-nav` | 导航栏配置 | implemented |
| S3 | `shell.tabbar` | tag:p-tabbar | `p-tabbar` | <tabbar> | implemented |
| S4 | `shell.segment` | tag:p-segment | `p-segment` | <segment> | implemented |
| S5 | `shell.drawer` | tag:p-drawer | `p-drawer` | 组合 | implemented |
| S6 | `shell.modal` | tag:p-modal | `p-modal` | <modal>+wx.showModal | implemented |
| S7 | `shell.popover` | tag:p-popover | `p-popover` | 组合 | implemented |
| S8 | `shell.toast` | tag:p-toast | `p-toast` | wx.showToast | planned |
| S9 | `shell.action-sheet` | tag:p-action-sheet | `p-action-sheet` | wx.showActionSheet | implemented |
| S10 | `layout.split` | tag:p-split | `p-split` | 无（分栏布局） | implemented |

## gesture — 手势（10）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| G1 | `gesture.tap` | api:v-gesture:tap | `v-gesture:tap` | bindtap | planned |
| G2 | `gesture.longpress` | api:v-gesture:longpress | `v-gesture:longpress` | bindlongpress | planned |
| G3 | `gesture.swipe` | api:v-gesture:swipe | `v-gesture:swipe` | bindswipe | planned |
| G4 | `gesture.pan` | api:v-gesture:pan | `v-gesture:pan` | bindtouchmove | planned |
| G5 | `gesture.pinch` | api:v-gesture:pinch | `v-gesture:pinch` | touchstart/move 组合 | planned |
| G6 | `gesture.rotate` | api:v-gesture:rotate | `v-gesture:rotate` | 组合 | planned |
| G7 | `gesture.press` | api:v-gesture:press | `v-gesture:press` | 3D Touch | planned |
| G8 | `gesture.draggable` | tag:p-draggable | `p-draggable` | movable-view | implemented |
| G9 | `gesture.scrollable` | tag:p-scrollable | `p-scrollable` | <scroll-view> | implemented |
| G10 | `gesture.use-gesture` | api:useGesture() | `useGesture()` | 无 | planned |

## capability — 能力（50）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| C1 | `capability.camera` | api:useCamera() | `useCamera()` | wx.createCameraContext | planned |
| C2 | `capability.microphone` | api:useMicrophone() | `useMicrophone()` | RecorderManager | planned |
| C3 | `capability.location` | api:useLocation() | `useLocation()` | wx.getLocation | implemented |
| C4 | `capability.map` | api:useMap() | `useMap()` | wx.createMapContext | planned |
| C5 | `capability.sensor` | api:useSensor() | `useSensor()` | onAccelerometer/onCompass/onGyroscope | planned |
| C6 | `capability.vibrate` | api:useVibrate() | `useVibrate()` | wx.vibrateShort/Long | planned |
| C7 | `capability.battery` | api:useBattery() | `useBattery()` | wx.getBatteryInfo | planned |
| C8 | `capability.network` | api:useNetwork() | `useNetwork()` | wx.getNetworkType | planned |
| C9 | `capability.clipboard` | api:useClipboard() | `useClipboard()` | wx.set/getClipboardData | planned |
| C10 | `capability.screen` | api:useScreen() | `useScreen()` | wx.getSystemInfo | planned |
| C11 | `capability.device` | api:useDevice() | `useDevice()` | wx.getSystemInfo | planned |
| C12 | `capability.orientation` | api:useOrientation() | `useOrientation()` | wx.onDeviceOrientationChange | planned |
| C13 | `capability.brightness` | api:useBrightness() | `useBrightness()` | wx.setScreenBrightness | planned |
| C14 | `capability.keyboard` | api:useKeyboard() | `useKeyboard()` | wx.onKeyboardHeightChange | planned |
| C15 | `capability.storage` | api:useStorage() | `useStorage()` | wx.set/getStorage | planned |
| C16 | `capability.permission` | api:usePermission() | `usePermission()` | wx.authorize | planned |
| C17 | `capability.notification` | api:useNotification() | `useNotification()` | wx.requestSubscribeMessage | planned |
| C18 | `capability.share` | api:useShare() | `useShare()` | wx.shareAppMessage | planned |
| C19 | `capability.contact` | api:useContact() | `useContact()` | wx.chooseContact | planned |
| C20 | `capability.calendar` | api:useCalendar() | `useCalendar()` | wx.addPhoneCalendar | planned |
| C21 | `capability.phone-call` | api:usePhoneCall() | `usePhoneCall()` | wx.makePhoneCall | planned |
| C22 | `capability.sms` | api:useSMS() | `useSMS()` | wx.??（受限） | planned |
| C23 | `capability.app-lifecycle` | api:useAppLifecycle() | `useAppLifecycle()` | App.onLaunch/onShow | planned |
| C24 | `capability.page-lifecycle` | api:usePageLifecycle() | `usePageLifecycle()` | Page.onLoad/onShow | planned |
| C25 | `capability.background` | api:useBackground() | `useBackground()` | wx.onBackground | planned |
| C26 | `capability.fetch` | api:useFetch() | `useFetch()` | wx.request | planned |
| C27 | `capability.websocket` | api:useWebSocket() | `useWebSocket()` | wx.connectSocket | planned |
| C28 | `capability.socket-task` | api:useSocketTask() | `useSocketTask()` | wx.SocketTask | planned |
| C29 | `capability.upload` | api:useUpload() | `useUpload()` | wx.uploadFile | planned |
| C30 | `capability.download` | api:useDownload() | `useDownload()` | wx.downloadFile | planned |
| C31 | `capability.data-channel` | api:useDataChannel() | `useDataChannel()` | wx...（直播/实时） | planned |
| C32 | `capability.cookie` | api:useCookie() | `useCookie()` | 无 | planned |
| C33 | `capability.auth` | api:useAuth() | `useAuth()` | 组合 | planned |
| C34 | `capability.analytics` | api:useAnalytics() | `useAnalytics()` | wx.reportEvent | planned |
| C35 | `capability.log` | api:useLog() | `useLog()` | console + 上报 | planned |
| C36 | `capability.bluetooth` | api:useBluetooth() | `useBluetooth()` | wx.openBluetoothAdapter | planned |
| C37 | `capability.nfc` | api:useNFC() | `useNFC()` | wx.getHCEState | planned |
| C38 | `capability.biometric` | api:useBiometric() | `useBiometric()` | wx.checkIsSupportFingerPrint | planned |
| C39 | `capability.face-id` | api:useFaceID() | `useFaceID()` | 组合 | planned |
| C40 | `capability.payment` | api:usePayment() | `usePayment()` | wx.requestPayment | planned |
| C41 | `capability.login` | api:useLogin() | `useLogin()` | wx.login | planned |
| C42 | `capability.qr-code` | api:useQRCode() | `useQRCode()` | wx.scanCode + canvas | planned |
| C43 | `capability.file-system` | api:useFileSystem() | `useFileSystem()` | wx.getFileSystemManager | planned |
| C44 | `capability.archive` | api:useArchive() | `useArchive()` | wx.compressFile | planned |
| C45 | `capability.shortcut` | api:useShortcut() | `useShortcut()` | wx.addToDesktop | planned |
| C46 | `capability.in-app-purchase` | api:useInAppPurchase() | `useInAppPurchase()` | wx.requestPayment 扩展 | planned |
| C47 | `capability.mini-program` | api:useMiniProgram() | `useMiniProgram()` | wx.navigateToMiniProgram | planned |
| C48 | `capability.embedded` | api:useEmbedded() | `useEmbedded()` | 无（被宿主嵌入） | planned |
| C49 | `capability.live` | api:useLive() | `useLive()` | wx...（直播组件） | planned |
| C50 | `capability.extension` | api:useExtension() | `useExtension()` | 无（插件/扩展点 G-21） | planned |

## engineering — 工程（28）

| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |
|---|------|------|----------|-----------|------|
| E1 | `engineering.state` | api:useState() | `useState()` | data | planned |
| E2 | `engineering.computed` | api:useComputed() | `useComputed()` | computed | planned |
| E3 | `engineering.watch` | api:useWatch() | `useWatch()` | watch | planned |
| E4 | `engineering.store` | api:useStore() | `useStore()` | getApp().globalData | planned |
| E5 | `engineering.provide-inject` | api:useProvide()/useInject() | `useProvide()/useInject()` | 无 | planned |
| E6 | `engineering.lifecycle` | api:useLifecycle() | `useLifecycle()` | onLoad/onShow/onHide/onUnload | planned |
| E7 | `engineering.ready` | api:useReady() | `useReady()` | onReady | planned |
| E8 | `engineering.error-boundary` | api:useErrorBoundary() | `useErrorBoundary()` | onError | planned |
| E9 | `engineering.page-param` | api:usePageParam() | `usePageParam()` | onLoad(options) | planned |
| E10 | `engineering.route` | api:useRoute() | `useRoute()` | getCurrentPages() | planned |
| E11 | `engineering.router-push` | api:router.push() | `router.push()` | wx.navigateTo | planned |
| E12 | `engineering.router-replace` | api:router.replace() | `router.replace()` | wx.redirectTo | planned |
| E13 | `engineering.router-back` | api:router.back() | `router.back()` | wx.navigateBack | planned |
| E14 | `engineering.router-switch-tab` | api:router.switchTab() | `router.switchTab()` | wx.switchTab | planned |
| E15 | `engineering.router-relaunch` | api:router.reLaunch() | `router.reLaunch()` | wx.reLaunch | planned |
| E16 | `engineering.router-before-each` | api:router.beforeEach() | `router.beforeEach()` | onLaunch 手动 | planned |
| E17 | `engineering.router-after-each` | api:router.afterEach() | `router.afterEach()` | 无 | planned |
| E18 | `engineering.router-link` | tag:router-link | `router-link` | <navigator> | planned |
| E19 | `engineering.transition` | tag:p-transition | `p-transition` | transition CSS | implemented |
| E20 | `engineering.animate` | tag:p-animate | `p-animate` | animation CSS | implemented |
| E21 | `engineering.animation` | api:useAnimation() | `useAnimation()` | wx.createAnimation | planned |
| E22 | `engineering.gesture-animation` | api:useGestureAnimation() | `useGestureAnimation()` | 组合 | planned |
| E23 | `engineering.scroll-animation` | api:useScrollAnimation() | `useScrollAnimation()` | 组合 | planned |
| E24 | `engineering.devtools` | api:useDevTools() | `useDevTools()` | 小程序 DevTools | planned |
| E25 | `engineering.inspector` | api:useInspector() | `useInspector()` | 无 | planned |
| E26 | `engineering.performance` | api:usePerformance() | `usePerformance()` | wx.reportPerformance | planned |
| E27 | `engineering.define-component` | api:defineComponent() | `defineComponent()` | Component() | planned |
| E28 | `engineering.define-capability` | api:defineCapability() | `defineCapability()` | 无 | planned |

