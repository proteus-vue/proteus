# @proteus-vue/api

Proteus API 层（api-plan A1/A8 + B3 auth + B9 PlatformAPI）——网络请求统一抽象（`wx.request` / `fetch`）+ 设备信息 + 平台 API 收口。业务代码零平台分支。

## 导出

| API | 说明 |
|-----|------|
| `createApi(options?)` | **API 客户端工厂**：注入 baseURL/拦截器/适配器，业务零平台分支（Web 走 `fetch` 适配器，MP 走 `wx.request` 适配器，由 `createRequestAdapter` 按平台选择） |
| `createRequestAdapter(platform)` | 请求适配器工厂（`web` → fetch / `skyline` → wx.request），可自定义扩展 |
| `createAuth(api, options?)` | 认证管理（token 存取 + 过期刷新），配合 `AuthStorage` 自定义存储 |
| `createPlatformAPI(platform)` | **平台 API 收口**（B9）：`router` / `storage` / `ui` 子域统一接口，替代业务直写 `wx.*` |
| `createCapabilityHooks(bridge?)` | **能力 Hook 层**（G-32 B3）：`useXxx` 无回调 / 全类型 / 返回 `Result<T>`（见下） |
| `createCapabilityBridge()` | 平台能力桥（wx / web 自动探测；可注入 mock 单测） |
| `createReactiveStorage(storage, reactive?)` | 响应式存储（注入式 reactivity，api 包零 vue 依赖） |
| `capOk` / `capErr` / `CapError` | `Result<T>` 构造工具 + 能力错误类型 |
| `getDeviceInfo()` / `buildUrl(base, path, params?)` | 设备信息（平台差异归一）/ URL 拼接 |
| `ApiError` | 统一错误类型（status/code/message） |
| `ALL_METHODS` | 支持的 HTTP 方法常量 |

## 使用

```ts
import { createApi, createPlatformAPI, getDeviceInfo } from '@proteus-vue/api'

// 1. API 客户端（main.ts 初始化一次）
const api = createApi({ baseURL: 'https://api.example.com', timeout: 10_000 })

// 2. 请求——同一份代码双端直跑
const res = await api.get('/user/profile', { token: true })
console.log(res.data)

// 3. 平台 API 收口（业务不碰 wx.*）
const platform = createPlatformAPI(/* 由编译期/运行时注入平台 */)
await platform.ui.showToast({ title: '已保存' })
platform.storage.set('lastVisited', Date.now())

// 4. 设备信息
const { platform, system, version } = getDeviceInfo()
```

## 能力 Hook 层（G-32 B3）

`createCapabilityHooks(bridge?)` 提供 `useXxx` 能力原语——**无回调 / 无全局对象 / 全类型 / 全部返回 `Promise<Result<T>>`**（G-32 铁律）：

| Hook | 原语 | 说明（wx / web） |
|------|------|------|
| `useLocation()` | C3 | 定位（wx.getLocation / geolocation） |
| `useVibrate(ms)` | C6 | 震动（wx.vibrateShort / navigator.vibrate） |
| `useNetwork()` | C8 | 网络状态（getNetworkType / onLine） |
| `useClipboard()` / `setClipboard(t)` | C9 | 剪贴板读写 |
| `useScreen()` / `useDevice()` / `useBattery()` / `useOrientation()` | C10-12·C7 | 屏幕 / 设备 / 电量 / 方向 |
| `useShare(opts)` | C18 | 分享（shareAppMessage / navigator.share） |
| `useFetch(url, config?)` | C26 | 网络请求（成功 `.data` = 载荷——迁移文档 `wx.request → await useFetch(url)`） |
| `usePermission(name)` | C16 | 权限状态（web Permissions API） |
| `useStorage()` | C15 | 存储句柄（响应式增强见 `createReactiveStorage`） |
| `useSensor(kind)` | C5 | 传感器一次性读取（accelerometer/compass/gyroscope——wx onXxxChange / web DeviceMotion+DeviceOrientation） |
| `useBrightness()` / `setBrightness(v)` | C13 | 屏幕亮度（wx get/setScreenBrightness；web 无标准 API → Err 降级） |
| `usePhoneCall(number)` | C21 | 拨打电话（wx.makePhoneCall；web 需宿主放行 → Err） |
| `useAuth()` | C33 | **认证组合**：token 托管 + 登录/登出 + 订阅（业务不读 raw token） |
| `useBiometric()` / `authenticateBiometric()` | C38 | 生物识别（wx startSoterAuthentication / web WebAuthn） |
| `usePayment(config)` | C40 | 支付（wx.requestPayment；web → Err） |
| `useLogin(provider?)` | C41 | 登录（wx.login → code；web 需集成第三方 provider → Err） |
| `useQRCode()` | C42 | 扫码（wx.scanCode；web 需摄像头取流源 → Err） |
| `useWebSocket(url, protocols?)` | C27 | WebSocket 连接句柄（send/close/on——wx.connectSocket / web `WebSocket`） |
| `useUpload(opts, onProgress?)` | C29 | 上传文件（wx.uploadFile / web fetch FormData；进度回调） |
| `useDownload(url, opts?, onProgress?)` | C30 | 下载文件（wx.downloadFile tempFilePath / web fetch blob） |
| `useAnalytics()` | C34 | 埋点句柄（`track(name, params)`——wx.reportEvent；web 无标准 → Err） |
| `useLog()` | C35 | 日志句柄（`log/warn/error`——console + 上报链） |
| `useFileSystem()` | C43 | 文件系统句柄（`readFile/writeFile/remove/exists`——wx.getFileSystemManager / web 内存降级） |
| `useNotification(templateId)` | C17 | 消息订阅授权（wx.requestSubscribeMessage / web Notification.requestPermission） |
| `useContact()` | C19 | 联系人选择（wx.chooseContact；web 无标准 → Err） |
| `useCalendar(event)` | C20 | 添加日历事件（wx.addPhoneCalendar；web → Err） |
| `useAppLifecycle()` | C23 | 应用生命周期订阅句柄（`onLaunch/onShow/onHide`——wx App 钩子 / web visibilitychange+load） |
| `useArchive(opts)` | C44 | 压缩文件（wx.compressFile；web → Err） |
| `useShortcut()` | C45 | 添加桌面快捷方式（wx.addToDesktop；web → Err） |
| `usePageLifecycle()` | C24 | 页面生命周期订阅句柄（onLoad/onShow/onHide——wx Page 钩子 / web load+visibilitychange） |
| `useBluetooth()` | C36 | 蓝牙状态（wx.openBluetoothAdapter+getBluetoothDevices / web 特性探测） |
| `useNFC()` | C37 | NFC 状态（wx.getHCEState / web NDEFReader 特性探测） |
| `useCamera()` | C1 | 摄像头访问（wx.authorize scope.camera / web getUserMedia） |
| `useMicrophone()` | C2 | 麦克风访问（wx.authorize scope.record / web getUserMedia） |
| `useKeyboard()` | C14 | 键盘生命周期句柄（info + onChange——wx.onKeyboardHeightChange / web visualViewport） |
| `probe()` | — | 能力可用性探测面（降级决策依据：缺失 → 对应 `Err('<cap>.unsupported')` 非抛异常） |

```ts
import { createCapabilityHooks } from '@proteus-vue/api'

const cap = createCapabilityHooks()
const loc = await cap.useLocation()
if (loc.ok) console.log(loc.data.latitude, loc.data.longitude)

const auth = cap.useAuth()
const r = await auth.login()
if (r.ok) console.log('已登录', auth.isAuthenticated)
auth.subscribe((token) => console.log('登录态变化', token))
```

**降级语义（G-32.3）**：平台不支持的能力返回 `Err('<cap>.unsupported')`，**不抛异常**；桥方法缺省 undefined 时对应 Hook 返回 Err（可经 `probe()` 预检后降级 UI）。

## 工程原语（G-32 B5）

`createEngineering(options)` 提供**注入式**工程原语 `useState/useComputed/useWatch/useLifecycle/useReady/usePageParam`——api 包**零运行时依赖 vue**，由消费方注入 reactivity（与 `createReactiveStorage` 同先例）：

```ts
import { ref, computed } from 'vue'
import { createEngineering } from '@proteus-vue/api'

// 注入 Vue reactivity（也可注入自定义 mock——单测友好）
const eng = createEngineering({
  reactivity: { ref, computed, watch },
  paramSource: () => ({ id: '42' }),
})

// E1 useState（ref 语义）
const count = eng.useState(0)
count.value += 1            // 响应式
const double = eng.useComputed(() => count.value * 2) // E2 computed

// E3 useWatch：变化监听（返回停止函数）
const stop = eng.useWatch(() => count.value, (v, old) => console.log(v, old))

// E6/E7 生命周期：usePageParam 页面参数 + useLifecycle/useReady 钩子
const id = eng.usePageParam('id')   // 响应式页面参数
eng.useReady(() => console.log('ready'))
```

| 原语 | 语义 | 说明 |
|------|------|------|
| `useState(initial)` | E1 | 响应式状态（ref 语义） |
| `useComputed(getter)` | E2 | 派生状态（computed 语义） |
| `useWatch(getter, cb)` | E3 | 副作用监听（返回停止函数） |
| `useLifecycle()` | E6 | 生命周期订阅句柄（onLoad/onShow/onHide/onUnload） |
| `useReady(cb)` | E7 | 挂载就绪回调（onReady 语义） |
| `usePageParam(key)` | E9 | 响应式页面参数（wx options / web query——paramSource 注入） |
| `createEngineering(opts)` | — | 工厂：注入 `{ reactivity, lifecycle?, paramSource? }` |

后续批次（E10-E17 router 语义化 / E19-E23 动画 / E24-E28 工程化）沿同一「语义面 + 注入」模式扩展。

## 设计要点

- **业务零平台分支（铁律 1）**：网络层差异全部收敛在 adapter 内部，业务代码不出现 `if (isMp)` 之类判断
- **PlatformAPI 收口（B9）**：`wx.showToast` / `wx.getStorageSync` / `wx.navigateTo` 等统一为 `router/storage/ui` 三域接口，是后续移除业务直用 `wx.*` 的过渡层
