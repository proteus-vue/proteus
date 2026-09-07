# 能力原语明细（Capability Catalog）

> 对应 G-32 §7 的 50 个能力原语，**逐一定义**：语义、参数、返回类型、降级行为、小程序原始 API 对照。  
> 目标：让任一 Backend 实现者仅凭本文即可落地，且行为一致。

---

## 约定

- 所有 API 为 Vue `useXxx()` Composable，返回响应式对象或 `Promise<Result<T>>`
- 缺失能力：Backend `capabilities` 声明 `supported:false` → Compiler 按 `@conditional` 降级（见降级文档），**不抛异常**
- 权限：需权限的能力统一通过 `usePermission()` 申请，不在各 API 重复暴露

---

## A. 设备/硬件（C1-C15）

### C1 useCamera()
```ts
interface CameraOptions {
  mode: 'photo' | 'video'
  quality?: 'low' | 'medium' | 'high'
  maxDuration?: number   // 视频秒数
  facing?: 'front' | 'back'
  saveToAlbum?: boolean
}
interface Media { uri: string; type: 'image' | 'video'; duration?: number; size: number }
function useCamera(): {
  capture(opts: CameraOptions): Promise<Result<Media>>
  startRecording(opts): Promise<Result<Media>>
  stopRecording(): void
  release(): void
}
```
**降级**：无相机 → `capture` 返回 `Err('camera.not_available')`，UI 层可 `@conditional` 隐藏拍照入口  
**小程序**：`wx.createCameraContext` + `<camera>`

### C2 useMicrophone()
```ts
function useMicrophone(): {
  start(opts: { format: 'mp3' | 'wav' }): Promise<Result<void>>
  stop(): Promise<Result<AudioBuffer>>
  pause(): void
  resume(): void
}
```
**降级**：无麦克风 → `start` 返回 Err  
**小程序**：`RecorderManager`

### C3 useLocation()
```ts
interface Coords { latitude: number; longitude: number; accuracy: number; altitude?: number }
function useLocation(): {
  getCurrent(opts: { type: 'wgs84' | 'gcj02' }): Promise<Result<Coords>>
  watch(opts, callback: (c: Coords) => void): number  // 返回 watchId
  clearWatch(id: number): void
  chooseLocation(): Promise<Result<Coords & { name: string; address: string }>>
  openLocation(coords: Coords & { name: string }): Promise<Result<void>>
}
```
**降级**：无定位权限 → `getCurrent` 返回 Err，业务可 fallback 到 IP 定位（L2）  
**小程序**：`wx.getLocation` / `wx.chooseLocation` / `wx.openLocation`

### C4 useMap() （与 `<p-map>` L2 配合）
```ts
interface MapController {
  moveTo(coords: Coords, zoom?: number): void
  addMarker(marker: Marker): string  // 返回 markerId
  removeMarker(id: string): void
  polyline(points: Coords[]): void
  on(event: 'marker-tap', cb): () => void
}
function useMap(id: string): MapController
```
**降级**：无地图 SDK → `<p-map>` 渲染静态图 + 外链打开（L2）  
**小程序**：`wx.createMapContext`

### C5 useSensor()
```ts
type SensorType = 'accelerometer' | 'compass' | 'gyroscope' | 'proximity' | 'ambient-light' | 'pressure'
interface SensorStream extends ReadableStream<SensorData> {}
function useSensor(type: SensorType, opts?: { interval: 'normal' | 'ui' | 'game' }): SensorStream
```
**降级**：传感器缺失 → Stream 永不产出，订阅无副作用  
**小程序**：`wx.onAccelerometerChange` 等 5 个独立 API → **统一收敛为 1 个 Hook**

### C6 useVibrate()
```ts
function useVibrate(): {
  short(): void      // 轻
  long(): void       // 重
  pattern(pattern: number[]): void  // 自定义
}
```
**降级**：无震动 → 空操作（no-op）  
**小程序**：`wx.vibrateShort` / `wx.vibrateLong`

### C7 useBattery()
```ts
interface BatteryInfo { level: number; charging: boolean }
function useBattery(): { current: Ref<BatteryInfo>; onChange(cb): () => void }
```
**降级**：无法读取 → `level: 1, charging: false` 静态值  
**小程序**：`wx.getBatteryInfo` / `wx.onBatteryChange`

### C8 useNetwork()
```ts
type NetworkType = 'wifi' | '4g' | '5g' | '3g' | '2g' | 'unknown' | 'none'
function useNetwork(): {
  type: Ref<NetworkType>
  isConnected: Ref<boolean>
  onTypeChange(cb: (t: NetworkType) => void): () => void
}
```
**降级**：无网络 API → `type: 'unknown'`  
**小程序**：`wx.getNetworkType` / `wx.onNetworkChange`

### C9 useClipboard()
```ts
function useClipboard(): {
  read(): Promise<Result<string>>
  write(text: string): Promise<Result<void>>
}
```
**降级**：Web 端需 HTTPS + 用户手势  
**小程序**：`wx.setClipboardData` / `wx.getClipboardData`

### C10 useScreen()
```ts
interface ScreenInfo {
  width: number; height: number
  pixelRatio: number
  safeArea: { top: number; bottom: number; left: number; right: number }
  orientation: 'portrait' | 'landscape'
}
function useScreen(): { info: Ref<ScreenInfo>; onResize(cb): () => void }
```
**降级**：服务端渲染 → 静态默认值  
**小程序**：`wx.getSystemInfo` 中 screen 相关字段

### C11 useDevice()
```ts
interface DeviceInfo {
  platform: 'ios' | 'android' | 'web' | 'harmony' | 'miniprogram'
  osVersion: string
  model: string
  brand: string
  language: string
  theme: 'light' | 'dark' | 'auto'
}
function useDevice(): DeviceInfo
```
**降级**：无  
**小程序**：`wx.getSystemInfo`

### C12 useOrientation()
```ts
function useOrientation(): {
  orientation: Ref<'portrait' | 'landscape'>
  lock(orientation): Promise<Result<void>>
  unlock(): void
}
```
**降级**：桌面 Web 不支持 lock → no-op  
**小程序**：`wx.onDeviceOrientationChange`

### C13 useBrightness()
```ts
function useBrightness(): {
  get(): Promise<Result<number>>  // 0-1
  set(value: number): Promise<Result<void>>
}
```
**降级**：Web 无权限 → Err  
**小程序**：`wx.getScreenBrightness` / `wx.setScreenBrightness`

### C14 useKeyboard()
```ts
interface KeyboardInfo { height: number; duration: number }
function useKeyboard(): {
  height: Ref<number>
  onShow(cb: (h: KeyboardInfo) => void): () => void
  onHide(cb): () => void
  hide(): Promise<void>
}
```
**降级**：无  
**小程序**：`wx.onKeyboardHeightChange`

### C15 useStorage()
```ts
interface StorageAPI {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  remove(key: string): void
  clear(): void
  keys(): string[]
  // 响应式：返回 Ref，变化自动持久化
  use<T>(key: string, default: T): Ref<T>
}
function useStorage(area?: 'local' | 'session' | 'secure'): StorageAPI
```
**降级**：无持久化（SSR/无 JS）→ 内存 Map，警告  
**小程序**：`wx.getStorage` / `wx.setStorage` 全家桶

---

## B. 系统/OS（C16-C25）

### C16 usePermission()
```ts
type Permission =
  | 'camera' | 'microphone' | 'location' | 'photos' | 'contacts'
  | 'calendar' | 'bluetooth' | 'notification' | 'background'
type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'undetermined'
function usePermission(): {
  request(perm: Permission, reason?: string): Promise<Result<PermissionStatus>>
  check(perm: Permission): PermissionStatus
  openSettings(): Promise<void>
}
```
**降级**：Web 部分权限无 API → `undetermined`，走 L2 polyfill  
**小程序**：`wx.authorize` / `wx.openSetting`

### C17 useNotification()
```ts
interface NotificationPayload { title: string; body: string; data?: any; badge?: number; sound?: boolean }
function useNotification(): {
  requestPermission(): Promise<Result<boolean>>
  schedule(payload: NotificationPayload, when?: Date): Promise<Result<string>>
  cancel(id: string): void
  onReceive(cb): () => void
  // 订阅消息（小程序特有，收敛）
  subscribe(templates: string[]): Promise<Result<void>>
}
```
**降级**：无推送 → 本地通知模拟（L2）  
**小程序**：`wx.requestSubscribeMessage` + 模板消息

### C18 useShare()
```ts
interface ShareData { title: string; desc?: string; imageUrl?: string; path?: string; query?: Record<string,any> }
function useShare(): {
  share(data: ShareData): Promise<Result<void>>
  onShare(cb: () => ShareData): void  // 监听系统分享面板
}
```
**降级**：Web Share API 不支持 → 复制链接 fallback  
**小程序**：`wx.shareAppMessage` / `wx.onShareAppMessage`

### C19 useContact()
```ts
function useContact(): {
  choose(opts: { multiple?: boolean }): Promise<Result<Contact[]>>
  add(contact: Contact): Promise<Result<void>>
}
interface Contact { name: string; phones: string[]; emails: string[] }
```
**降级**：Web 无通讯录 → 需原生 Backend  
**小程序**：`wx.chooseContact` / `wx.addPhoneContact`

### C20 useCalendar()
```ts
interface CalendarEvent { title: string; start: Date; end: Date; location?: string; reminder?: number }
function useCalendar(): {
  create(event: CalendarEvent): Promise<Result<string>>
  list(range: { start: Date; end: Date }): Promise<Result<CalendarEvent[]>>
}
```
**降级**：无 → Err  
**小程序**：`wx.addPhoneCalendar`

### C21 usePhoneCall()
```ts
function usePhoneCall(): { call(number: string): Promise<Result<void>> }
```
**降级**：无电话能力 → 复制号码  
**小程序**：`wx.makePhoneCall`

### C22 useSMS()
```ts
function useSMS(): { send(number: string, body?: string): Promise<Result<void>> }
```
**降级**：Web 用 `mailto:` 式链接 fallback  
**小程序**：受限，多数平台不支持

### C23 useAppLifecycle()
```ts
function useAppLifecycle(): {
  onLaunch(cb: (opts) => void): void
  onShow(cb: (opts) => void): void
  onHide(cb): void
  onError(cb: (err) => void): void
  onPageNotFound(cb): void
}
```
**降级**：Web 映射 `visibilitychange`  
**小程序**：`App({ onLaunch, onShow... })`

### C24 usePageLifecycle()
```ts
function usePageLifecycle(): {
  onLoad(cb: (query) => void): void
  onShow(cb): void
  onReady(cb): void
  onHide(cb): void
  onUnload(cb): void
  onPullDownRefresh(cb): void
  onReachBottom(cb): void
  onResize(cb): void
}
```
**降级**：Web 用路由守卫模拟  
**小程序**：`Page({ onLoad... })`

### C25 useBackground()
```ts
function useBackground(): {
  start(opts: { text: string }): Promise<Result<void>>  // 后台任务
  stop(): void
  onMessage(cb): () => void
}
```
**降级**：Web 用 Service Worker（L2）  
**小程序**：`wx.onBackground` / 后台音频

---

## C. 通信/数据（C26-C35）

### C26 useFetch() —— 统一网络请求
```ts
interface FetchOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  data?: any
  headers?: Record<string, string>
  timeout?: number
  cache?: 'default' | 'no-cache' | 'force-cache'
  retry?: number
}
interface FetchResponse<T> { data: T; status: number; headers: Record<string,string> }
function useFetch<T = any>(urlOrOpts: string | FetchOptions, opts?: FetchOptions): {
  data: Ref<T | null>
  error: Ref<Error | null>
  loading: Ref<boolean>
  execute(opts?): Promise<Result<T>>
  abort(): void
}
// 全局拦截器
useFetch.global = {
  beforeEach(req): FetchOptions | Promise<FetchOptions>
  afterEach(res): FetchResponse | Promise<FetchResponse>
  onError(err): void
}
```
**降级**：无网络 → `error` ref 更新，UI 层响应式处理  
**小程序**：`wx.request`（回调 → **Promise 化 + 响应式**）

### C27 useWebSocket()
```ts
interface WSConnection {
  send(data: string | ArrayBuffer): void
  close(code?: number): void
  onMessage(cb: (data) => void): () => void
  onClose(cb): () => void
  state: Ref<'connecting' | 'open' | 'closed'>
}
function useWebSocket(url: string, protocols?: string[]): WSConnection
```
**降级**：无 WebSocket → 轮询 L2 fallback  
**小程序**：`wx.connectSocket`

### C28-C35 略（结构同，详见 §9 对照矩阵）

> 完整签名见仓库 `proteus/src/capabilities/` 各文件实现。

---

## D. 覆盖度审计（自动化）

`proteus audit:coverage` 读取本目录所有 `useXxx` 定义 + 小程序官方 API 清单（JSON），输出：

```
✅ C1-C50 全部有对应原语
✅ 小程序组件 100% 映射
⚠️ 微信私有 API (requestWeChatPay 等) → 收敛到 C47 useMiniProgram()
覆盖率: 100% (L1: 128, L2: 0 缺口)
```

**CI 门禁**：覆盖率 < 100% → 构建失败。

---

## E. 与 G-28 SPI 的关系

```
业务代码
   ↓ 调用
useCamera() / useLocation() ...
   ↓
ProteusNativeBackend 接口（G-28）
   ↓ 各端实现
iOS:    AVCapture / CLLocation
Android: CameraX / FusedLocation
Harmony: @ohos.multimedia.camera / geoLocation
Web:    WebRTC / Geolocation API
MiniP:  wx.createCameraContext / wx.getLocation
```

**本文档定义「语义接口」，G-28 定义「SPI 契约」，Backend 提供「原生实现」** —— 三层分离，与五支柱一致。
