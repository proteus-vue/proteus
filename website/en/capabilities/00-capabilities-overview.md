---
title: Capabilities overview
group: 总览
order: 0
---

# Capabilities overview

> 50 capability primitives — SSOT = `PRIMITIVE_CATALOG` (capability kind) + `CapabilityHooks` interface. **All hooks implemented** (API ready — target bridges/degradation in each page's compat table).

## Network & Communication (8)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C26 | [capability.fetch](/docs/capability/fetch) | `useFetch()` | `Promise<T>` | wx.request |
| C27 | [capability.websocket](/docs/capability/websocket) | `useWebSocket()` | `WSConnection` | wx.connectSocket |
| C28 | [capability.socket-task](/docs/capability/socket-task) | `useSocketTask()` | `SocketTask` | wx.SocketTask |
| C29 | [capability.upload](/docs/capability/upload) | `useUpload()` | `Progress<Result>` | wx.uploadFile |
| C30 | [capability.download](/docs/capability/download) | `useDownload()` | `Progress<Result>` | wx.downloadFile |
| C31 | [capability.data-channel](/docs/capability/data-channel) | `useDataChannel()` | `Channel` | — |
| C36 | [capability.bluetooth](/docs/capability/bluetooth) | `useBluetooth()` | `BluetoothAPI` | wx.openBluetoothAdapter |
| C37 | [capability.nfc](/docs/capability/nfc) | `useNFC()` | `NFCAPI` | wx.getHCEState |

## Device & System (10)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
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

## Storage & Files (4)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C15 | [capability.storage](/docs/capability/storage) | `useStorage()` | `StorageAPI` | wx.set/getStorage |
| C32 | [capability.cookie](/docs/capability/cookie) | `useCookie()` | `CookieJar` | — |
| C43 | [capability.file-system](/docs/capability/file-system) | `useFileSystem()` | `FSAdapter` | wx.getFileSystemManager |
| C44 | [capability.archive](/docs/capability/archive) | `useArchive()` | `Result<void>` | wx.compressFile |

## Location & Maps (2)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C3 | [capability.location](/docs/capability/location) | `useLocation()` | `Result<Coords>` | wx.getLocation |
| C4 | [capability.map](/docs/capability/map) | `useMap()` | `MapController` | wx.createMapContext |

## Media & Scanning (4)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C1 | [capability.camera](/docs/capability/camera) | `useCamera()` | `Result<Media>` | wx.createCameraContext |
| C2 | [capability.microphone](/docs/capability/microphone) | `useMicrophone()` | `Result<AudioBuffer>` | RecorderManager |
| C42 | [capability.qr-code](/docs/capability/qr-code) | `useQRCode()` | `Result<string>` | wx.scanCode + canvas |
| C49 | [capability.live](/docs/capability/live) | `useLive()` | `LiveRoom` | — |

## Account & Payment (7)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C16 | [capability.permission](/docs/capability/permission) | `usePermission()` | `Result<PermissionStatus>` | wx.authorize |
| C33 | [capability.auth](/docs/capability/auth) | `useAuth()` | `AuthState` | — |
| C38 | [capability.biometric](/docs/capability/biometric) | `useBiometric()` | `Result<boolean>` | wx.checkIsSupportFingerPrint |
| C39 | [capability.face-id](/docs/capability/face-id) | `useFaceID()` | `Result<boolean>` | — |
| C40 | [capability.payment](/docs/capability/payment) | `usePayment()` | `Result<PayResult>` | wx.requestPayment |
| C41 | [capability.login](/docs/capability/login) | `useLogin()` | `Result<Token>` | wx.login |
| C46 | [capability.in-app-purchase](/docs/capability/in-app-purchase) | `useInAppPurchase()` | `Result<Receipt>` | — |

## Notifications & Sharing (7)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C17 | [capability.notification](/docs/capability/notification) | `useNotification()` | `NotificationAPI` | wx.requestSubscribeMessage |
| C18 | [capability.share](/docs/capability/share) | `useShare()` | `Result<void>` | wx.shareAppMessage |
| C19 | [capability.contact](/docs/capability/contact) | `useContact()` | `Result<Contact[]>` | wx.chooseContact |
| C20 | [capability.calendar](/docs/capability/calendar) | `useCalendar()` | `CalendarAPI` | wx.addPhoneCalendar |
| C21 | [capability.phone-call](/docs/capability/phone-call) | `usePhoneCall()` | `Result<void>` | wx.makePhoneCall |
| C22 | [capability.sms](/docs/capability/sms) | `useSMS()` | `Result<void>` | — |
| C45 | [capability.shortcut](/docs/capability/shortcut) | `useShortcut()` | `Result<void>` | wx.addToDesktop |

## App & Lifecycle (6)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C23 | [capability.app-lifecycle](/docs/capability/app-lifecycle) | `useAppLifecycle()` | `LifecycleHooks` | App.onLaunch/onShow |
| C24 | [capability.page-lifecycle](/docs/capability/page-lifecycle) | `usePageLifecycle()` | `LifecycleHooks` | Page.onLoad/onShow |
| C25 | [capability.background](/docs/capability/background) | `useBackground()` | `BackgroundAPI` | wx.onBackground |
| C47 | [capability.mini-program](/docs/capability/mini-program) | `useMiniProgram()` | `MPContext` | wx.navigateToMiniProgram |
| C48 | [capability.embedded](/docs/capability/embedded) | `useEmbedded()` | `HostContext` | — |
| C50 | [capability.extension](/docs/capability/extension) | `useExtension()` | `ExtensionAPI` | — |

## Observability & Debugging (2)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C34 | [capability.analytics](/docs/capability/analytics) | `useAnalytics()` | `TrackAPI` | wx.reportEvent |
| C35 | [capability.log](/docs/capability/log) | `useLog()` | `Logger` | — |
