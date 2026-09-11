# 能力 API 颗粒度对齐台账（Capability Granularity Alignment）

> **起因**：用户「对比小程序文档组件 API 功能颗粒度没对齐，比如蓝牙只有一个蓝牙信息返回，没有操作管理写入等等，还有很多都没对齐」。
> **审计日期**：2026-09-11 · **SSOT**：`docs/proteus-semantic-primitives-plus-plan/G-32-complete-semantic-architecture.md` §7（C1-C50 计划）+ `packages/api/src/capability.ts`（实现）
> **结论**：这不是「遗漏」，而是 **计划→实现的漂移**——G-32 §7 明确给每个能力声明了**富操作接口**返回类型（`BluetoothAPI`/`MapController`/`FSAdapter`/`NotificationAPI`…），实现却把多数做成了**一次性读取/授权探测**。

---

## 1. 问题定性

| 维度 | 事实 |
|------|------|
| 官方 `wx.*` 接口方法（`miniprogram-api-typings` 5.2.3） | **495** |
| Proteus 桥实际调用 | **~48**（≈ **10%**） |
| G-32 §7 声明的富接口（`XxxAPI`） | 10 个 |
| 其中真正声明了类型的 | **4 个**（`BackgroundAPI` / `TrackAPI` / `FSAdapter` / `MapController`） |
| 声明了但**类型根本不存在**的 | `BluetoothAPI` / `NFCAPI` / `NotificationAPI` / `CalendarAPI` / `StorageAPI` / `SensorStream` / `AudioBuffer` |

典型（用户举例）：`useBluetooth()` 计划返回 `BluetoothAPI`（连接/读/写/订阅/断开），实现只返回：

```ts
// packages/api/src/capability.ts:384
export interface BluetoothInfo { supported: boolean; available: boolean; devices: string[] }
```

即「开适配器 + 列设备名」两步探测，**无任何 BLE 操作**。

---

## 2. 缺口总表（C1-C50）

`actual` = `CapabilityHooks` 实际返回类型（`packages/api/src/capability.ts`）；`intended` = G-32 §7；`thin/rich` = 一次性读取 vs 操作句柄。

| C# | Hook | actual（行号） | intended | 形态 | 缺 ops |
|----|------|---------------|----------|------|-------|
| C1 | useCamera | `CapResult<MediaAccess>` (2241) | `Result<Media>` | thin（仅授权探测） | 5 |
| C2 | useMicrophone | `CapResult<MediaAccess>` (2243) | `Result<AudioBuffer>` | thin（仅授权探测） | 12 |
| C3 | useLocation | `CapResult<Coords>` (2169) | `Result<Coords>` | 对齐 | 3 监听 |
| C4 | useMap | `CapResult<MapController>` (2248) | `MapController` | 半富（2 方法） | **28** |
| C5 | useSensor | `CapResult<SensorSample>` (2188) | `SensorStream` | thin（一次性且不解除监听） | 6 |
| C6 | useVibrate | `CapResult<void>` (2170) | `void` | 对齐（缺 Long） | 1 |
| C7 | useBattery | `CapResult<BatteryInfo>` (2176) | `BatteryInfo` | 对齐 | 1 监听 |
| C8 | useNetwork | `CapResult<NetworkType>` (2171) | `NetworkType` | 对齐 | 3 |
| C9 | useClipboard / setClipboard | `CapResult<string>` / `<void>` (2172-2173) | `Result<string>` | 对齐 | 0 |
| C10 | useScreen | `CapResult<ScreenInfo>` (2174) | `ScreenInfo` | 对齐 | 0 |
| C11 | useDevice | `CapResult<CapDeviceInfo>` (2175) | `DeviceInfo` | 对齐 | 0 |
| C12 | useOrientation | `CapResult<OrientationInfo>` (2177) | `Orientation` | 对齐 | 1 监听 |
| C13 | useBrightness / setBrightness | `CapResult<number>` / `<void>` (2190/2192) | `Result<void>` | 对齐 | 0 |
| C14 | useKeyboard | `KeyboardLifecycle` (2245) | `KeyboardInfo` | 富 | 0 |
| C15 | useStorage | `CompatStorage` (2185) | `StorageAPI` | thin（仅同步 KV） | **10** |
| C16 | usePermission | `CapResult<PermissionState>` (2183) | `Result<PermissionStatus>` | **小程序端恒 Err（wxBridge 缺 getPermission）** | 3+ |
| C17 | useNotification | `CapResult<MessageSubscription>` (2222) | `NotificationAPI` | thin | 3-4 |
| C18 | useShare | `CapResult<void>` (2178) | `Result<void>` | 对齐 | 0 |
| C19 | useContact | `CapResult<Contact[]>` (2224) | `Result<Contact[]>` | 对齐 | 0 |
| C20 | useCalendar | `CapResult<void>` (2226) | `CalendarAPI` | thin | 1 |
| C21 | usePhoneCall | `CapResult<void>` (2194) | `Result<void>` | 对齐 | 0 |
| C22 | useSMS | `CapResult<void>` (2250) | `Result<void>` | 诚实 Err（无开放 API） | n/a |
| C23 | useAppLifecycle | `AppLifecycle` (2228) | `LifecycleHooks` | 富 | 0 |
| C24 | usePageLifecycle | `PageLifecycle` (2235) | `LifecycleHooks` | 富 | 0 |
| C25 | useBackground | `CapResult<BackgroundAPI>` (2252) | `BackgroundAPI` | 半富（仅订阅） | **~15** |
| C26 | useFetch | `CapResult<T>` (2181) | `Promise<T>` | 对齐 | 0 |
| C27 | useWebSocket | `CapResult<WebSocketConnection>` (2209) | `WSConnection` | **富（send/close/on）** | 0 |
| C28 | useSocketTask | `CapResult<SocketTaskHandle>` (2254) | `SocketTask` | **富** | 3 |
| C29 | useUpload | `CapResult<UploadResult>` (2211) | `Progress<Result>` | thin（无 task 句柄） | 3 |
| C30 | useDownload | `CapResult<DownloadResult>` (2213) | `Progress<Result>` | thin | 3 |
| C31 | useDataChannel | `CapResult<DataChannelHandle>` (2256) | `Channel` | 半富（无 wx 底层） | n/a |
| C32 | useCookie | `CapResult<CookieJar>` (2258) | `CookieJar` | 富 | n/a |
| C33 | useAuth | `AuthState` (2196) | `AuthState` | 富 | 0 |
| C34 | useAnalytics | `TrackAPI` (2215) | `TrackAPI` | thin（1 方法） | 2 |
| C35 | useLog | `Logger` (2217) | `Logger` | 富 | 0 |
| C36 | useBluetooth | `CapResult<BluetoothInfo>` (2237) | `BluetoothAPI` | **thin** | **29（+ 外设 14）** |
| C37 | useNFC | `CapResult<NfcInfo>` (2239) | `NFCAPI` | **thin** | **17** |
| C38 | useBiometric | `CapResult<boolean>` (2198) | `Result<boolean>` | 对齐 | 0 |
| C39 | useFaceID | `CapResult<boolean>` (2260) | `Result<boolean>` | 对齐 | 0 |
| C40 | usePayment | `CapResult<PaymentReceipt>` (2202) | `Result<PayResult>` | 对齐 | 0 |
| C41 | useLogin | `CapResult<LoginResult>` (2204) | `Result<Token>` | 对齐 | 2 |
| C42 | useQRCode | `CapResult<string>` (2206) | `Result<string>` | 对齐 | 1 |
| C43 | useFileSystem | `FSAdapter` (2219) | `FSAdapter` | 半富（4 方法） | **41** |
| C44 | useArchive | `CapResult<void>` (2230) | `Result<void>` | thin | 3 |
| C45 | useShortcut | `CapResult<void>` (2232) | `Result<void>` | 对齐 | 0 |
| C46 | useInAppPurchase | `CapResult<IAPReceipt>` (2262) | `Result<Receipt>` | 诚实 Err | n/a |
| C47 | useMiniProgram | `CapResult<MiniProgramAPI>` (2264) | `MPContext` | 半富（1 方法） | 3 |
| C48 | useEmbedded | `CapResult<HostContext>` (2266) | `HostContext` | thin | n/a |
| C49 | useLive | `CapResult<LiveRoomHandle>` (2268) | `LiveRoom` | 半富（2 方法） | ~30 |
| C50 | useExtension | `CapResult<unknown>` (2270) | `ExtensionAPI` | 未定义 | n/a |

---

## 3. Top 10 缺口域（按缺失操作数，含具体 wx 方法名）

1. **C43 文件系统**（缺 41）— 桥仅 4 方法。缺：`readdir` `stat` `rename` `mkdir` `rmdir` `copyFile` `appendFile` `open` `close` `read` `write` `truncate` `ftruncate` `fstat` `getFileInfo` `saveFile` `removeSavedFile` `getSavedFileList` `readCompressedFile` `readZipEntry` `unzip` + 全套 `*Sync`。
2. **C36 蓝牙 BLE**（缺 29 + 外设 14）— 桥仅 `openBluetoothAdapter`/`getBluetoothDevices`。缺：`createBLEConnection` `closeBLEConnection` `getBLEDeviceServices` `getBLEDeviceCharacteristics` `readBLECharacteristicValue` `writeBLECharacteristicValue` `notifyBLECharacteristicValueChange` `startBluetoothDevicesDiscovery` `stopBluetoothDevicesDiscovery` `onBluetoothDeviceFound` `getConnectedBluetoothDevices` `onBLEConnectionStateChange` `onBLECharacteristicValueChange` `getBLEDeviceRSSI` `getBLEMTU` `setBLEMTU` `closeBluetoothAdapter` `getBluetoothAdapterState` `onBluetoothAdapterStateChange` …；外设端 `createBLEPeripheralServer`（`addService`/`startAdvertising`/`writeCharacteristicValue`/`onCharacteristicWriteRequest`…）。
3. **C4 地图**（缺 28）— 桥 2 方法。缺：`includePoints` `translateMarker` `moveAlong` `setCenterOffset` `addMarkers` `removeMarkers` `addArc` `addCustomLayer` `addGroundOverlay` `addVisualLayer` `setBoundary` `fromScreenLocation` `toScreenLocation` `openMapApp` `on` `moveToLocation` …
4. **C37 NFC**（缺 17）— 桥仅 `getHCEState`。缺 HCE：`startHCE` `stopHCE` `sendHCEMessage` `onHCEMessage`；`NFCAdapter`：`getNFCAdapter` `startDiscovery` `onDiscovered` `getNdef` `getNfcA/B/F/V` `getIsoDep` `getMifareClassic/Ultralight`。
5. **C25 后台**（缺 ~15）— 仅 `onAppHide/onAppShow`。缺：`getLaunchOptionsSync` `getEnterOptionsSync` `onMemoryWarning` `onThemeChange` `onWindowResize` `onError` `onUnhandledRejection` `onNetworkStatusChange` `onPageNotFound` `onAudioInterruptionBegin/End` …
6. **C2 麦克风**（缺 12）— `getRecorderManager` 只探测从不用。缺 `RecorderManager` 全套：`start` `stop` `pause` `resume` `onStart` `onStop` `onFrameRecorded` `onError` …
7. **C15 存储**（缺 10）— 仅 4 个同步方法。缺全套**异步**：`setStorage` `getStorage` `removeStorage` `clearStorage` `getStorageInfo` `getStorageInfoSync` `batchGetStorage` `batchSetStorage`（+ Sync）。
8. **C5 传感器**（缺 6）— 形态错（应 `SensorStream`）。缺 `startAccelerometer` `stopAccelerometer` `startCompass` `stopCompass` `startGyroscope` `stopGyroscope` + `off*`。
9. **C1 相机**（缺 5）— `createCameraContext` 仅探测。缺 `CameraContext`：`takePhoto` `startRecord` `stopRecord` `setZoom` `onCameraFrame`。
10. **C17 通知**（缺 3-4）— 仅 `requestSubscribeMessage`。缺 `requestSubscribeDeviceMessage` `requestSubscribeSystemMessage` `openCustomerServiceChat`。

**附加真 bug**：`C16 usePermission` 在**小程序端恒 Err**——`wxBridge` 未实现 `getPermission`（仅 `webBridge` 有），尽管 `wx.getSetting`/`wx.openSetting`/`wx.authorize` 均存在。

---

## 4. 已经做对的（不动）

`useWebSocket`（send/close/on 富句柄）· `useSocketTask`（send/close/onMessage）· `useMap`/`useFileSystem`/`useLive`（句柄形态，只是方法少）· `useKeyboard`/`useAppLifecycle`/`usePageLifecycle`/`useCookie`/`useAuth`/`Logger`/`AuthState`。

---

## 5. 分层推进计划

> 原则（沿用 G-32.4）：富句柄 = 对象 + 方法返回 `Promise<CapResult<T>>`；订阅类返回取消函数；web 无对等 → **诚实 Err**（不虚构）。

| 层 | 范围 | 域 | 状态 |
|----|------|----|------|
| **L1 高频核心** | 硬件交互主战场 | 蓝牙 BLE · 文件系统 · 地图 · 相机/麦克风 | 🟡 进行中 |
| 　└ 蓝牙 BLE | C36 | ✅ 已落地（BluetoothAPI：连接/服务/特征值读写/通知/发现/断开 + RSSI） | ✅ |
| 　└ 文件系统 | C43 | ✅ 已落地（异步 16 方法 + Sync 10 方法；web 内存降级全量） | ✅ |
| 　└ 地图 | C4 | ✅ 已落地（MapController：标记/折线/圆/视野/坐标/移动/开App/事件） | ✅ |
| 　└ 相机/麦克风 | C1/C2 | ✅ 已落地（CameraController + RecorderController） | ✅ |
| **L2 中频** | 系统集成 | 传感器流 · 存储（异步）· NFC · 通知 · 后台 · 日历 | 🟡 进行中 |
| 　└ 传感器流 | C5 | ✅ SensorStream（start/stop/on；修 readSensor 泄漏） | ✅ |
| 　└ 存储异步 | C15 | ✅ setAsync/getAsync/removeAsync/clearAsync/info/batchGet/batchSet | ✅ |
| 　└ NFC | C37 | ✅ NFCAPI（startHCE/stopHCE/sendHCEMessage/onHCEMessage/onHCEStateChange） | ✅ |
| 　└ 通知 | C17 | ✅ subscribeDeviceMessage/openCustomerService | ✅ |
| 　└ 后台生命周期 | C25 | 待做（~15 事件：onMemoryWarning/onThemeChange/onWindowResize…） | ⬜ |
| 　└ 日历 | C20 | 待做（CalendarAPI） | ⬜ |
| **L3 长尾** | 低使用率 | 直播（~30）· AI 推理 · 多媒体编辑 · 支付扩展 | ⬜ 待评估（建议泛化壳 + 诚实边界） |
| **即时修复** | bug | `usePermission` 小程序端（wxBridge 加 getSetting→state 映射） | ✅ 已落地 |

**每域交付物**：① 扩桥接口（`getXxx(): XxxAPI`）② wxBridge 真实现 ③ webBridge 诚实降级 ④ 类型导出 ⑤ 单测（操作往返 + 无桥降级 + web 降级）。

---

## 6. 诚实边界

- **不追求 495 全量**：多数长尾 API 需特定类目/企业主体，且业务罕见——泛化壳（`wx` 直通）会造成「假覆盖」，违背 G-32.3 显式降级原则；长尾域按需（有真实业务诉求）再补。
- **BLE 外设端（`BLEPeripheralServer`）**、**NFC 全套**、**地图完整覆盖物**属「重实现」——建议按业务需求驱动，不做纯覆盖式铺开。
- **平台差异**：Web 端多数硬件能力无对等（蓝牙 Web Bluetooth 仅部分、NFC 仅 Chrome Android、文件系统仅 OPFS）——保持诚实 Err，不假装。
