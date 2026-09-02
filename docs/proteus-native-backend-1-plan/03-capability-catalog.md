# G-28 能力语义清单（Top 30）

## L1 框架内置（生命周期内置，80% 场景）

| # | 能力 | iOS | Android | Harmony | Web/Mock |
|---|------|-----|---------|---------|----------|
| 1 | 相机（拍照） | AVCapture | CameraX | @ohos.multimedia.camera | WebRTC/getUserMedia |
| 2 | 相册选取 | PHPicker | ActivityResult | @ohos.file.picker | `<input type=file>` |
| 3 | 扫码 | AVFoundation | ML Kit / ZXing | @ohos.multimedia.scan | jsQR |
| 4 | 定位 | CoreLocation | FusedLocation | geoLocationManager | Geolocation API |
| 5 | 分享 | UIActivityViewController | ShareCompat | @ohos.share | Web Share API |
| 6 | 通知 | UNUserNotificationCenter | NotificationManager | notificationManager | Notification API |
| 7 | 权限申请 | Info.plist | Manifest | module.json5 | 权限 prompt |
| 8 | 震动 | UIImpactFeedback | Vibrator | vibrator | Navigator.vibrate |
| 9 | 剪贴板 | UIPasteboard | ClipboardManager | pasteboard | Clipboard API |
| 10 | 网络状态 | NetworkInfo | ConnectivityManager | connection | navigator.onLine |
| 11 | 电池信息 | UIDevice | BatteryManager | batteryInfo | Battery API |
| 12 | 设备信息 | UIDevice/devicekit | Build | deviceInfo | UA/Navigator |
| 13 | 应用状态 | AppState | ProcessLifecycle | appLifecycle | Page Visibility |
| 14 | 存储（KV） | UserDefaults | SharedPreferences | preferences | localStorage |
| 15 | 文件读写 | FileManager | Context.filesDir | fileio | OPFS / File System |
| 16 | 打开外部应用 | UIApplication.open | Intent | context.startAbility | window.open |
| 17 | 打电话/发短信 | URL Scheme | Intent | — | tel:/sms: |
| 18 | 生物识别 | LocalAuthentication | BiometricPrompt | userAuth | WebAuthn |
| 19 | 深色模式 | traitCollection | UiMode | colorMode | prefers-color-scheme |
| 20 | 键盘/软键盘 | Keyboard | WindowInsets | inputMethod | VisualViewport |

## L2 官方 Backend（独立包，+18%）

| # | 能力 | 包名示例 |
|---|------|----------|
| 21 | 蓝牙 BLE | `@proteus/backend-bluetooth` |
| 22 | NFC | `@proteus/backend-nfc` |
| 23 | 日历/联系人 | `@proteus/backend-calendar` |
| 24 | 推送（FCM/APNs/鸿蒙 Push） | `@proteus/backend-push` |
| 25 | 地图 | `@proteus/backend-map` |
| 26 | 支付 | `@proteus/backend-payment` |
| 27 | 语音识别/合成 | `@proteus/backend-speech` |
| 28 | 传感器（加速度/陀螺仪） | `@proteus/backend-sensor` |
| 29 | 串口/USB | `@proteus/backend-usb` |
| 30 | 屏幕录制 | `@proteus/backend-screen-recorder` |

## L3 社区包（+1.9%）

由生态贡献，需通过签名审计（见 `06-ecosystem-governance.md`）。

## L4 自定义 Backend（0.1% 兜底）

业务自己实现 `ProteusNativeBackend` 接口，注册到框架。仅在 L1–L3 均不满足时使用，铁律 G-28.1 要求必须封装成 Backend 而非散落在业务代码。

## 能力组合 = 业务组件

```vue
<!-- 扫码登录：iOS/Android/鸿蒙/Web/小程序 全部能跑 -->
<script setup>
const native = useNative()
const scanAndLogin = async () => {
  const { text } = await native.scanQR()
  await api.loginWithQR(text)
}
</script>
```

开发者不需要知道 AVCapture 还是 CameraX。
