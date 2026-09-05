---
title: 能力总览
---

# 能力总览

> 50 个能力原语——SSOT = `PRIMITIVE_CATALOG`（capability kind）+ `CapabilityHooks` 接口。**Hook 全部已实现**（API 就绪，双端桥/降级见各页平台等价表）

| # | 能力 | API | 返回 | 小程序等价 |
|---|---|---|---|---|
| C1 | [capability.camera](/docs/capability/camera) | `useCamera()` | `Result<Media>` | wx.createCameraContext |
| C2 | [capability.microphone](/docs/capability/microphone) | `useMicrophone()` | `Result<AudioBuffer>` | RecorderManager |
| C3 | [capability.location](/docs/capability/location) | `useLocation()` | `Result<Coords>` | wx.getLocation |
| C4 | [capability.map](/docs/capability/map) | `useMap()` | `MapController` | wx.createMapContext |
| C5 | [capability.sensor](/docs/capability/sensor) | `useSensor()` | `SensorStream` | onAccelerometer/onCompass/onGyroscope |
| C6 | [capability.vibrate](/docs/capability/vibrate) | `useVibrate()` | `void` | wx.vibrateShort/Long |
| C7 | [capability.battery](/docs/capability/battery) | `useBattery()` | `BatteryInfo` | wx.getBatteryInfo |
| C8 | [capability.network](/docs/capability/network) | `useNetwork()` | `NetworkType` | wx.getNetworkType |
| C9 | [capability.clipboard](/docs/capability/clipboard) | `useClipboard()` | `Result<string>` | wx.set/getClipboardData |
| C10 | [capability.screen](/docs/capability/screen) | `useScreen()` | `ScreenInfo` | wx.getSystemInfo |
| C11 | [capability.device](/docs/capability/device) | `useDevice()` | `DeviceInfo` | wx.getSystemInfo |
| C12 | [capability.orientation](/docs/capability/orientation) | `useOrientation()` | `Orientation` | wx.onDeviceOrientationChange |
| C13 | [capability.brightness](/docs/capability/brightness) | `useBrightness()` | `Result<void>` | wx.setScreenBrightness |
| C14 | [capability.keyboard](/docs/capability/keyboard) | `useKeyboard()` | `KeyboardInfo` | wx.onKeyboardHeightChange |
| C15 | [capability.storage](/docs/capability/storage) | `useStorage()` | `StorageAPI` | wx.set/getStorage |
| C16 | [capability.permission](/docs/capability/permission) | `usePermission()` | `Result<PermissionStatus>` | wx.authorize |
| C17 | [capability.notification](/docs/capability/notification) | `useNotification()` | `NotificationAPI` | wx.requestSubscribeMessage |
| C18 | [capability.share](/docs/capability/share) | `useShare()` | `Result<void>` | wx.shareAppMessage |
| C19 | [capability.contact](/docs/capability/contact) | `useContact()` | `Result<Contact[]>` | wx.chooseContact |
| C20 | [capability.calendar](/docs/capability/calendar) | `useCalendar()` | `CalendarAPI` | wx.addPhoneCalendar |
| C21 | [capability.phone-call](/docs/capability/phone-call) | `usePhoneCall()` | `Result<void>` | wx.makePhoneCall |
| C22 | [capability.sms](/docs/capability/sms) | `useSMS()` | `Result<void>` | wx.??（受限） |
| C23 | [capability.app-lifecycle](/docs/capability/app-lifecycle) | `useAppLifecycle()` | `LifecycleHooks` | App.onLaunch/onShow |
| C24 | [capability.page-lifecycle](/docs/capability/page-lifecycle) | `usePageLifecycle()` | `LifecycleHooks` | Page.onLoad/onShow |
| C25 | [capability.background](/docs/capability/background) | `useBackground()` | `BackgroundAPI` | wx.onBackground |
| C26 | [capability.fetch](/docs/capability/fetch) | `useFetch()` | `Promise<T>` | wx.request |
| C27 | [capability.websocket](/docs/capability/websocket) | `useWebSocket()` | `WSConnection` | wx.connectSocket |
| C28 | [capability.socket-task](/docs/capability/socket-task) | `useSocketTask()` | `SocketTask` | wx.SocketTask |
| C29 | [capability.upload](/docs/capability/upload) | `useUpload()` | `Progress<Result>` | wx.uploadFile |
| C30 | [capability.download](/docs/capability/download) | `useDownload()` | `Progress<Result>` | wx.downloadFile |
| C31 | [capability.data-channel](/docs/capability/data-channel) | `useDataChannel()` | `Channel` | wx...（直播/实时） |
| C32 | [capability.cookie](/docs/capability/cookie) | `useCookie()` | `CookieJar` | 无 |
| C33 | [capability.auth](/docs/capability/auth) | `useAuth()` | `AuthState` | 组合 |
| C34 | [capability.analytics](/docs/capability/analytics) | `useAnalytics()` | `TrackAPI` | wx.reportEvent |
| C35 | [capability.log](/docs/capability/log) | `useLog()` | `Logger` | console + 上报 |
| C36 | [capability.bluetooth](/docs/capability/bluetooth) | `useBluetooth()` | `BluetoothAPI` | wx.openBluetoothAdapter |
| C37 | [capability.nfc](/docs/capability/nfc) | `useNFC()` | `NFCAPI` | wx.getHCEState |
| C38 | [capability.biometric](/docs/capability/biometric) | `useBiometric()` | `Result<boolean>` | wx.checkIsSupportFingerPrint |
| C39 | [capability.face-id](/docs/capability/face-id) | `useFaceID()` | `Result<boolean>` | 组合 |
| C40 | [capability.payment](/docs/capability/payment) | `usePayment()` | `Result<PayResult>` | wx.requestPayment |
| C41 | [capability.login](/docs/capability/login) | `useLogin()` | `Result<Token>` | wx.login |
| C42 | [capability.qr-code](/docs/capability/qr-code) | `useQRCode()` | `Result<string>` | wx.scanCode + canvas |
| C43 | [capability.file-system](/docs/capability/file-system) | `useFileSystem()` | `FSAdapter` | wx.getFileSystemManager |
| C44 | [capability.archive](/docs/capability/archive) | `useArchive()` | `Result<void>` | wx.compressFile |
| C45 | [capability.shortcut](/docs/capability/shortcut) | `useShortcut()` | `Result<void>` | wx.addToDesktop |
| C46 | [capability.in-app-purchase](/docs/capability/in-app-purchase) | `useInAppPurchase()` | `Result<Receipt>` | wx.requestPayment 扩展 |
| C47 | [capability.mini-program](/docs/capability/mini-program) | `useMiniProgram()` | `MPContext` | wx.navigateToMiniProgram |
| C48 | [capability.embedded](/docs/capability/embedded) | `useEmbedded()` | `HostContext` | 无（被宿主嵌入） |
| C49 | [capability.live](/docs/capability/live) | `useLive()` | `LiveRoom` | wx...（直播组件） |
| C50 | [capability.extension](/docs/capability/extension) | `useExtension()` | `ExtensionAPI` | 无（插件/扩展点 G-21） |
