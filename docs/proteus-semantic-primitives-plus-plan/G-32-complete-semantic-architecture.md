# G-32 完整语义原语架构（Semantic Primitives Architecture）

> **状态**：草案 v1 · 待评审  
> **依赖**：G-22（柔性布局）、G-24（系统集成原语）、G-27（渲染后端）、G-28（原生能力）、G-29（编译器）、G-30（任意端）、G-31（组件/API 语义化）  
> **核心结论**：Proteus 内置原语从「约 15 个」扩展为 **6 大类 · 128 个语义原语**（组件 52 + API 能力 76），覆盖小程序官方能力的 **100%**；以小程序现行全量能力为「完整性标尺」，但不继承其 API 设计——全部重写为语义优先、Hook 化、类型安全、Backend 无关的 Proteus 原语。

---

## 0. 前置：为什么原语需要「完整」

G-31 只定义了「6 布局 + 6 UI + 3 能力入口」的 L1 骨架（约 15 个），属于 **方法论验证级别**。面向真实业务（尤其迁移场景），缺原语会导致两个后果：

1. **生态组件回退到小程序 API** → 破坏语义层，Backend 不得不做「标签级翻译」，退化成 uni-app/Taro
2. **开发者手写大量 `@conditional` 兜底** → 「99% 零原生」在边界场景失效

**G-32 的目标**：让 L1（框架内置）覆盖小程序全量能力的 100%，业务在 **不写任何平台判断、不写任何原生代码** 的前提下，覆盖小程序所能覆盖的 **100% UI 组件 + 100% 原生能力**。L2/L3 生态只承接「非通用复合组件」（如富文本、图表、地图），不再承接「基础能力缺口」。

> **重要澄清**：「覆盖小程序 100%」≠「与小程序同 API」。是 **能力对等（capability parity）**，不是 **API 兼容（API compatibility）**。API 兼容由独立的 `@proteus/compat-miniprogram`（G-31）承担。

---

## 1. 设计原则（五支柱具体化）

| # | 原则 | 在原语层的落地 |
|---|------|---------------|
| P1 | **语义优先** | 原语名表达「意图」，不表达「HTML 标签/小程序组件」。`p-stack` 而非 `view-flex`；`useMedia()` 而非 `createVideoContext` |
| P2 | **组合优于新增** | 能用「布局原语 + 能力原语 + 插槽」表达的场景，**不加新组件**。如「可滚动列表」= `p-list`（虚拟化）+ `p-stack`，而非新增 `scroll-view` |
| P3 | **属性即约束** | 属性描述「我要什么布局/行为」，Backend 自选实现。`p-grid` 的 `min-col-width` 而非 `display:grid; grid-template-columns:repeat(auto-fill,...)` |
| P4 | **能力即类型** | 每个能力原语返回强类型对象，错误走 `Result<T>`（不抛、不回调地狱） |
| P5 | **缺失即降级** | 后端不支持某能力 → IR 层 `@conditional` 降级（见 G-30），**不报错、不断链**（除非显式 `required`） |

### 1.1 原语分级（与 G-28 L1/L2/L3 对齐）

| 级别 | 范围 | 职责 | 三端实现要求 |
|------|------|------|-------------|
| **L1 内置** | 本表 128 个 | 框架核心，随 Proteus 发布 | **必须 3+ 端**（Web/iOS/Android 至少三，鸿蒙/小程序可选） |
| **L2 官方** | 非通用复合（地图、富文本、图表、AR、蓝牙设备管理等） | 独立 Backend 包 `@proteus/backend-*` | **至少 2 端** |
| **L3 社区** | 业务特定 | 社区维护 | 审计签名 |

> G-31 的「~15 原语」全部归入 L1，本表是 L1 的完整版。

---

## 2. 原语分类总览（6 大类 · 128）

```
┌─────────────────────────────────────────────────────────────┐
│  L1 Semantic Primitives (128)                               │
├─────────────────────────────────────────────────────────────┤
│  ① 布局原语 Layout       (12)   G-22 泛化                  │
│  ② 基础 UI 原语 UI        (18)   视图/文本/媒体/输入         │
│  ③ 容器/导航原语 Shell    (10)   页面/路由/弹层/分栏         │
│  ④ 交互/手势原语 Gesture  (10)   触摸/滑动/拖拽/长按         │
│  ⑤ 能力原语 Capability   (50)   G-28 系统化                │
│  ⑥ 工程原语 Engineering   (28)   状态/生命周期/动画/调试     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. ① 布局原语 Layout（12）—— G-22 泛化

> **原则**：所有布局意图都是「约束」，Backend 自选渲染技术（Flex / Grid / UICollectionView / ConstraintLayout / Flutter RenderBox）。**不设 `scroll-view` / `swiper` / `movable-view` 这类「实现型」组件**——它们被还原为布局属性。

| # | 原语 | 语义 | 关键属性（约束） | 小程序等价 | 降级（Tier 2/3） |
|---|------|------|-----------------|-----------|-----------------|
| L1 | `<p-box>` | 原子容器（= div，但语义明确：块级盒） | `aspect-ratio`, `overflow: clip/scroll` | `<view>` | 天然降级 |
| L2 | `<p-inline>` | 行内容器 | `wrap: nowrap/wrap` | `<text>` 内联 | → `p-box` |
| L3 | `<p-stack>` | **一维排列**（核心） | `direction: row/col`, `gap`, `align`, `wrap`, `snap: none/proximity/mandatory`, `loop: bool` | `flex` + `<scroll-view>` + `<swiper>` | `snap/loop` 退化为普通 `wrap` |
| L4 | `<p-grid>` | **二维网格** | `min-col-width`, `max-cols`, `gap`, `auto-flow` | `<view>` + CSS Grid | → `p-stack wrap` |
| L5 | `<p-fluid>` | 流式自适应（按容器宽重排） | `breakpoints`, `min-item-width` | 响应式 CSS | → 固定单列 |
| L6 | `<p-adaptive>` | 容器宽度语义断点 | `sheet/dialog/popover/drawer` | 无 | → `p-box` |
| L7 | `<p-fit>` | 内容自适应尺寸 | `mode: content/min/max` | `fit-content` | → 包裹内容 |
| L8 | `<p-spacer>` | 弹性空白（推挤布局） | `grow`, `shrink` | `flex:1` | 忽略 |
| L9 | `<p-divider>` | 分隔线 | `orientation`, `inset` | `<view>` + border | → 空白 |
| L10 | `<p-scroll>` | **显式滚动容器**（仅当需「滚动」语义时用） | `axis`, `paging: bool`, `refresh: bool`, `indicator` | `<scroll-view>` | 无滚动（内容截断告警） |
| L11 | `<p-virtual-list>` | 虚拟化长列表（**能力型组件**） | `item-size: fixed/estimated/auto`, `buffer`, `direction`, `header/footer` slot | `<scroll-view>` + 手动回收 | → 非虚拟化 `p-stack`（小数据） |
| L12 | `<p-masonry>` | 瀑布流 | `col-count`, `gap` | 第三方 | → `p-grid` |

**关键设计**：`snap: mandatory + loop` 表达「轮播」，`paging: true` 表达「翻页」——**swiper/scroll-view 被消灭，还原为属性**。

---

## 4. ② 基础 UI 原语 UI（18）

### 4.1 视图/内容

| # | 原语 | 语义 | 关键属性 | 小程序等价 |
|---|------|------|---------|-----------|
| U1 | `<p-text>` | 文本（支持富文本插槽） | `content`, `selectable`, `truncate: line-clamp`, `align` | `<text>` |
| U2 | `<p-heading>` | 标题（语义级） | `level: 1-6` | `<h1>`-`<h6>` |
| U3 | `<p-rich-text>` | 富文本（HTML/markdown → IR） | `source`, `schema` | `<rich-text>` |
| U4 | `<p-icon>` | 图标（矢量优先） | `name`, `size`, `color`, `spin` | `<icon>` |
| U5 | `<p-image>` | 图片 | `src`, `fit: cover/contain/fill`, `placeholder`, `lazy`, `decoding: sync/async`, `srcset` | `<image>` |
| U6 | `<p-avatar>` | 头像（复合） | `src`, `shape`, `size`, `fallback` | 组合 |
| U7 | `<p-media>` | **媒体统一入口** | `kind: image/video/audio/live`, `controls`, `autoplay`, `poster`, `loop`, `muted`, `picture-in-picture` | `<video>` + `<audio>` |
| U8 | `<p-canvas>` | 画布 | `engine: 2d/webgl/skia`, `resolution` | `<canvas>` |
| U9 | `<p-svg>` | 矢量图形 | `path`, `viewbox` | 无 |

### 4.2 输入/表单

| # | 原语 | 语义 | 关键属性 | 小程序等价 |
|---|------|------|---------|-----------|
| U10 | `<p-input>` | 单行输入 | `type: text/number/password/search/email`, `mask`, `validation`, `clearable` | `<input>` |
| U11 | `<p-textarea>` | 多行输入 | `autosize`, `max-length`, `count` | `<textarea>` |
| U12 | `<p-select>` | 选择器（弹层型） | `options`, `multiple`, `searchable`, `cascader` | `<picker>` 部分 |
| U13 | `<p-checkbox>` | 多选 | `checked`, `indeterminate`, `group` | `<checkbox>` |
| U14 | `<p-radio>` | 单选 | `value`, `group` | `<radio>` |
| U15 | `<p-switch>` | 开关 | `checked`, `loading` | `<switch>` |
| U16 | `<p-slider>` | 滑块 | `min`, `max`, `step`, `range` | `<slider>` |
| U17 | `<p-picker>` | 原生日期/时间/城市选择 | `mode: date/time/region`, `start/end` | `<picker>` |
| U18 | `<p-form>` | 表单容器（校验聚合） | `model`, `rules`, `layout: horizontal/vertical` | 组合 |

---

## 5. ③ 容器/导航原语 Shell（10）

| # | 原语 | 语义 | 关键属性 | 小程序等价 |
|---|------|------|---------|-----------|
| S1 | `<p-page>` | 页面根容器（= route component，G-17） | `title`, `status-bar`, `pull-refresh` | `<page>` |
| S2 | `<p-nav>` | 导航栏（声明式映射 G-17 路由） | `title`, `left/right` slot, `transparent` | 导航栏配置 |
| S3 | `<p-tabbar>` | 底部标签栏 | `tabs`, `active`, `badge` | `<tabbar>` |
| S4 | `<p-segment>` | 分段控制器 | `options`, `active` | `<segment>` |
| S5 | `<p-drawer>` | 侧滑抽屉 | `side: left/right`, `width`, `overlay` | 组合 |
| S6 | `<p-modal>` | 模态弹窗 | `open`, `dismissible`, `sheet/dialog/alert` | `<modal>` + `wx.showModal` |
| S7 | `<p-popover>` | 气泡浮层 | `trigger: click/hover/focus`, `placement` | 组合 |
| S8 | `<p-toast>` | 轻提示 | `message`, `duration`, `type` | `wx.showToast` |
| S9 | `<p-action-sheet>` | 动作面板 | `actions`, `cancel` | `wx.showActionSheet` |
| S10 | `<p-split>` | 分栏布局（响应式） | `breakpoint`, `ratio`, `collapse` | 无 |

---

## 6. ④ 交互/手势原语 Gesture（10）

> **原则**：手势是「声明式约束」，Backend 映射到平台原生手势识别器（iOS UIGestureRecognizer / Android GestureDetector / Web Pointer Events / Harmony 手势系统）。**不暴露 `bindtouchstart` 这类事件名**——事件是 Backend 实现细节。

| # | 原语/API | 语义 | 属性/参数 | 小程序等价 |
|---|---------|------|----------|-----------|
| G1 | `v-gesture:tap` | 点击 | `count: 1/2`（双击） | `bindtap` |
| G2 | `v-gesture:longpress` | 长按 | `duration`, `onEnd` | `bindlongpress` |
| G3 | `v-gesture:swipe` | 滑动 | `direction: up/down/left/right`, `threshold` | `bindswipe` |
| G4 | `v-gesture:pan` | 拖动 | `axis`, `bounds` | `bindtouchmove` |
| G5 | `v-gesture:pinch` | 双指缩放 | `scale`, `onChange` | `bindtouchstart/move` 组合 |
| G6 | `v-gesture:rotate` | 旋转 | `angle` | 组合 |
| G7 | `v-gesture:press` | 按压（3D Touch） | `force` | `wx.onCompassChange` 类 |
| G8 | `<p-draggable>` | 可拖拽元素 | `ghost`, `snap-to-grid`, `onDrop` | `movable-view` |
| G9 | `<p-scrollable>` | 可滚动区域（手势增强版） | `bounce`, `refresh`, `load-more` | `<scroll-view>` |
| G10 | `useGesture()` | 组合手势 Hook | `recognizers[]`, `simultaneous` | 无 |

---

## 7. ⑤ 能力原语 Capability（50）—— G-28 系统化

> **原则**：全部为 `useXxx()` Hook，**无回调、无全局对象、全类型、返回 `Result<T>`**。每个能力有 `capabilities` 声明（G-28），缺失时编译期降级。

### 7.1 设备/硬件（15）

| # | API | 语义 | 返回类型 | 小程序等价 |
|---|-----|------|---------|-----------|
| C1 | `useCamera()` | 相机（拍照/录制） | `Result<Media>` | `wx.createCameraContext` |
| C2 | `useMicrophone()` | 麦克风 | `Result<AudioBuffer>` | `RecorderManager` |
| C3 | `useLocation()` | 定位 | `Result<Coords>` | `wx.getLocation` |
| C4 | `useMap()` | 地图（与 `<p-map>` L2 配合） | `MapController` | `wx.createMapContext` |
| C5 | `useSensor()` | 传感器统一入口 | `SensorStream` | `onAccelerometer/onCompass/onGyroscope` |
| C6 | `useVibrate()` | 震动 | `void` | `wx.vibrateShort/Long` |
| C7 | `useBattery()` | 电量 | `BatteryInfo` | `wx.getBatteryInfo` |
| C8 | `useNetwork()` | 网络状态 | `NetworkType` | `wx.getNetworkType` |
| C9 | `useClipboard()` | 剪贴板 | `Result<string>` | `wx.set/getClipboardData` |
| C10 | `useScreen()` | 屏幕信息 | `ScreenInfo` | `wx.getSystemInfo` |
| C11 | `useDevice()` | 设备信息 | `DeviceInfo` | `wx.getSystemInfo` |
| C12 | `useOrientation()` | 屏幕方向 | `Orientation` | `wx.onDeviceOrientationChange` |
| C13 | `useBrightness()` | 屏幕亮度 | `Result<void>` | `wx.setScreenBrightness` |
| C14 | `useKeyboard()` | 键盘 | `KeyboardInfo` | `wx.onKeyboardHeightChange` |
| C15 | `useStorage()` | 本地存储（响应式） | `StorageAPI` | `wx.set/getStorage` |

### 7.2 系统/OS（10）

| # | API | 语义 | 返回类型 | 小程序等价 |
|---|-----|------|---------|-----------|
| C16 | `usePermission()` | 权限申请 | `Result<PermissionStatus>` | `wx.authorize` |
| C17 | `useNotification()` | 通知/消息推送 | `NotificationAPI` | `wx.requestSubscribeMessage` |
| C18 | `useShare()` | 分享 | `Result<void>` | `wx.shareAppMessage` |
| C19 | `useContact()` | 联系人 | `Result<Contact[]>` | `wx.chooseContact` |
| C20 | `useCalendar()` | 日历 | `CalendarAPI` | `wx.addPhoneCalendar` |
| C21 | `usePhoneCall()` | 拨打电话 | `Result<void>` | `wx.makePhoneCall` |
| C22 | `useSMS()` | 短信 | `Result<void>` | `wx.??`（受限） |
| C23 | `useAppLifecycle()` | 应用生命周期 | `LifecycleHooks` | `App.onLaunch/onShow` |
| C24 | `usePageLifecycle()` | 页面生命周期 | `LifecycleHooks` | `Page.onLoad/onShow` |
| C25 | `useBackground()` | 后台运行 | `BackgroundAPI` | `wx.onBackground` |

### 7.3 通信/数据（10）

| # | API | 语义 | 返回类型 | 小程序等价 |
|---|-----|------|---------|-----------|
| C26 | `useFetch()` | 网络请求（统一拦截/缓存） | `Promise<T>` | `wx.request` |
| C27 | `useWebSocket()` | WebSocket | `WSConnection` | `wx.connectSocket` |
| C28 | `useSocketTask()` | Socket 任务 | `SocketTask` | `wx.SocketTask` |
| C29 | `useUpload()` | 上传 | `Progress<Result>` | `wx.uploadFile` |
| C30 | `useDownload()` | 下载 | `Progress<Result>` | `wx.downloadFile` |
| C31 | `useDataChannel()` | 实时数据通道 | `Channel` | `wx...`（直播/实时） |
| C32 | `useCookie()` | Cookie 管理 | `CookieJar` | 无 |
| C33 | `useAuth()` | 鉴权（与路由守卫 G-17 配合） | `AuthState` | 组合 |
| C34 | `useAnalytics()` | 埋点 | `TrackAPI` | `wx.reportEvent` |
| C35 | `useLog()` | 日志 | `Logger` | `console` + 上报 |

### 7.4 扩展能力（10）

| # | API | 语义 | 返回类型 | 小程序等价 |
|---|-----|------|---------|-----------|
| C36 | `useBluetooth()` | 蓝牙 | `BluetoothAPI` | `wx.openBluetoothAdapter` |
| C37 | `useNFC()` | NFC | `NFCAPI` | `wx.getHCEState` |
| C38 | `useBiometric()` | 生物识别 | `Result<boolean>` | `wx.checkIsSupportFingerPrint` |
| C39 | `useFaceID()` | 面容识别 | `Result<boolean>` | 组合 |
| C40 | `usePayment()` | 支付 | `Result<PayResult>` | `wx.requestPayment` |
| C41 | `useLogin()` | 登录（统一 OAuth） | `Result<Token>` | `wx.login` |
| C42 | `useQRCode()` | 二维码（生成/识别） | `Result<string>` | `wx.scanCode` + canvas |
| C43 | `useFileSystem()` | 文件系统 | `FSAdapter` | `wx.getFileSystemManager` |
| C44 | `useArchive()` | 压缩/解压 | `Result<void>` | `wx.compressFile` |
| C45 | `useShortcut()` | 桌面快捷方式 | `Result<void>` | `wx.addToDesktop` |
| C46 | `useInAppPurchase()` | 应用内购买 | `Result<Receipt>` | `wx.requestPayment` 扩展 |

### 7.5 平台特有（能力入口组件，L1 兜底 9 个）

| # | API | 语义 | 返回类型 | 小程序等价 |
|---|-----|------|---------|-----------|
| C47 | `useMiniProgram()` | 小程序宿主互操作（跳转/获取 launchOptions） | `MPContext` | `wx.navigateToMiniProgram` |
| C48 | `useEmbedded()` | 被宿主嵌入（如 Lynx 嵌入抖音） | `HostContext` | 无 |
| C49 | `useLive()` | 直播能力 | `LiveRoom` | `wx...`（直播组件） |
| C50 | `useExtension()` | 插件/扩展点（G-21 Compiler Plugin 配合） | `ExtensionAPI` | 无 |

> **说明**：小程序特有的「模板消息/订阅消息/客服消息/意见反馈」等，**统一收敛到 `useNotification()` / `useFeedback()`**——不单独暴露，避免污染语义层。

---

## 8. ⑥ 工程原语 Engineering（28）

### 8.1 状态/生命周期

| # | 原语 | 语义 | 小程序等价 |
|---|------|------|-----------|
| E1 | `useState()` | 响应式状态（Vue ref 封装） | `data` |
| E2 | `useComputed()` | 计算属性 | `computed` |
| E3 | `useWatch()` | 侦听 | `watch` |
| E4 | `useStore()` | 全局状态（Pinia 封装） | `getApp().globalData` |
| E5 | `useProvide()` / `useInject()` | 依赖注入 | 无 |
| E6 | `useLifecycle()` | 生命周期统一（onMount/onUnmount/onShow/onHide） | `onLoad/onShow/onHide/onUnload` |
| E7 | `useReady()` | 渲染完成 | `onReady` |
| E8 | `useErrorBoundary()` | 错误捕获 | `onError` |
| E9 | `usePageParam()` | 页面参数（G-17） | `onLoad(options)` |
| E10 | `useRoute()` | 当前路由 | `getCurrentPages()` |

### 8.2 路由/导航（G-17 语义化）

| # | API | 语义 | 小程序等价 |
|---|-----|------|-----------|
| E11 | `router.push()` | 前进 | `wx.navigateTo` |
| E12 | `router.replace()` | 替换 | `wx.redirectTo` |
| E13 | `router.back()` | 返回 | `wx.navigateBack` |
| E14 | `router.switchTab()` | 切 tab | `wx.switchTab` |
| E15 | `router.reLaunch()` | 重启 | `wx.reLaunch` |
| E16 | `router.beforeEach()` | 全局守卫 | `onLaunch` 手动 |
| E17 | `router.afterEach()` | 后置钩子 | 无 |
| E18 | `<router-link>` | 声明式导航 | `<navigator>` |

### 8.3 动画/过渡

| # | 原语 | 语义 | 小程序等价 |
|---|------|------|-----------|
| E19 | `<p-transition>` | 过渡（显隐） | `transition` CSS |
| E20 | `<p-animate>` | 动画声明 | `animation` CSS |
| E21 | `useAnimation()` | 动画控制 Hook | `wx.createAnimation` |
| E22 | `useGestureAnimation()` | 手势驱动动画 | 组合 |
| E23 | `useScrollAnimation()` | 滚动驱动 | 组合 |

### 8.4 调试/工程化

| # | 原语 | 语义 | 小程序等价 |
|---|------|------|-----------|
| E24 | `useDevTools()` | 开发工具接入 | 小程序 DevTools |
| E25 | `useInspector()` | 元素审查 | 无 |
| E26 | `usePerformance()` | 性能埋点 | `wx.reportPerformance` |
| E27 | `defineComponent()` | 类型化组件定义（含 C-IR 元信息） | `Component()` |
| E28 | `defineCapability()` | 能力降级声明（G-30） | 无 |

---

## 9. 小程序全量能力对照矩阵（完整性标尺）

> **用法**：本表用于「覆盖度审计」。`✅` = 有对应 Proteus 原语；`🔄` = 由 compat 层翻译；`❌` = 小程序私有能力（如微信登录），收敛到 C47 `useMiniProgram()`。

### 9.1 组件对照（小程序官方组件 → Proteus）

| 小程序组件 | Proteus 原语 | 状态 | 备注 |
|-----------|-------------|------|------|
| view | `<p-box>` / `<p-stack>` | ✅ | 语义拆分 |
| text | `<p-text>` / `<p-heading>` | ✅ | 语义拆分 |
| image | `<p-image>` | ✅ | |
| scroll-view | `<p-scroll>` / `<p-virtual-list>` | ✅ | 语义拆分 |
| swiper | `<p-stack snap loop>` | ✅ | **消灭为属性** |
| movable-view | `<p-draggable>` | ✅ | |
| cover-view | `<p-overlay>` (L2) | 🔄 | Web 兼容性 |
| icon | `<p-icon>` | ✅ | |
| progress | `<p-progress>` (L2) | 🔄 | 复合组件 |
| rich-text | `<p-rich-text>` | ✅ | |
| button | `<p-button>` (U, L1 已有) | ✅ | |
| form | `<p-form>` | ✅ | |
| input | `<p-input>` | ✅ | |
| textarea | `<p-textarea>` | ✅ | |
| checkbox | `<p-checkbox>` | ✅ | |
| radio | `<p-radio>` | ✅ | |
| picker | `<p-picker>` / `<p-select>` | ✅ | 拆分 |
| slider | `<p-slider>` | ✅ | |
| switch | `<p-switch>` | ✅ | |
| label | `<p-label>` (L2) | 🔄 | |
| navigator | `<router-link>` / `router.*` | ✅ | |
| audio | `<p-media kind="audio">` | ✅ | **消灭为属性** |
| video | `<p-media kind="video">` | ✅ | **消灭为属性** |
| camera | `<p-camera>` (L2) + `useCamera()` | ✅ | |
| canvas | `<p-canvas>` | ✅ | |
| map | `<p-map>` (L2) + `useMap()` | ✅ | |
| web-view | `<p-webview>` (L2) | 🔄 | 宿主能力 |
| live-player | `<p-media kind="live">` | ✅ | |
| editor | `<p-rich-text editable>` | ✅ | |
| ... 其他官方组件 | 均落入 L1/L2 | ✅ | |

### 9.2 API 对照（小程序 wx.* → Proteus）

| 小程序 API 类别 | Proteus | 覆盖 |
|----------------|---------|------|
| 网络：request/uploadFile/downloadFile | `useFetch/useUpload/useDownload` | 100% |
| 媒体：图片/音频/视频/相机/录音 | `useCamera/useMicrophone` + `<p-media>` | 100% |
| 文件：FileSystemManager | `useFileSystem()` | 100% |
| 数据缓存：set/getStorage | `useStorage()` | 100% |
| 位置：getLocation/chooseLocation/openLocation | `useLocation()` + `useMap()` | 100% |
| 设备：系统信息/网络/屏幕/加速度/罗盘/陀螺/设备方向/亮度/震动 | `useDevice/useNetwork/useScreen/useSensor/useBrightness/useVibrate` | 100% |
| 扫码：scanCode | `useQRCode()` | 100% |
| 蓝牙：openBluetoothAdapter 全家桶 | `useBluetooth()` | 100% |
| NFC：getHCEState 等 | `useNFC()` | 100% |
| 生物识别：checkIsSupportFingerPrint 等 | `useBiometric()` | 100% |
| 联系人：chooseContact/addPhoneContact | `useContact()` | 100% |
| 界面：Toast/Loading/Modal/ActionSheet/NavigationBar/TabBar | `<p-toast>/<p-modal>/<p-action-sheet>/<p-nav>/<p-tabbar>` | 100% |
| 页面：setNavigationBarTitle 等 | `<p-nav>` + `usePageLifecycle` | 100% |
| 路由：navigateTo/redirectTo 等 | `router.*` | 100% |
| 分享：onShareAppMessage/shareTimeline | `useShare()` | 100% |
| 支付：requestPayment | `usePayment()` | 100% |
| 登录：login/checkSession | `useLogin()` | 100% |
| 消息：requestSubscribeMessage 等 | `useNotification()` | 100% |
| 账号：getUserProfile | `useAuth()` | 100% |
| 设置：openSetting/getSetting | `usePermission()` | 100% |
| Worker：createWorker | `useWorker()` (L2) | 🔄 |
| WXML：createSelectorQuery | `useElement()` (E, L1 已有) | 100% |
| Canvas：createCanvasContext | `<p-canvas>` + `useCanvas()` | 100% |
| 动画：createAnimation | `useAnimation()` | 100% |
| 导航：geolocation | `useLocation()` | 100% |
| 实时数据：live 相关 | `useLive()` | 100% |
| **微信私有**：requestWeChatPay/开放标签等 | `useMiniProgram()` | 收敛 |

> **审计结论**：小程序官方 **组件 100%** + **API 类别 100%** 被 Proteus L1/L2 覆盖（其中约 90% 在 L1 = 本表 128 原语；约 10% 属平台复合组件归入 L2）。

---

## 10. 与 Lynx Element PAPI 的边界（呼应前序讨论）

Lynx 的 `__CreateElement/__SetAttribute/__AddClass` 属于 **RenderBackend 输出层**，Proteus 不暴露给业务。映射示意：

```
<p-stack direction="row" class="A B C">
   ↓ Compiler → C-IR (G-31)
   ↓ RenderBackend(Lynx)
__CreateElement('view', id, info)
__SetAttribute(el, 'flex-direction', 'row')
__AddClass(el, 'A') / __AddClass(el, 'B') / __AddClass(el, 'C')
   ↓ Lynx 引擎
原生视图树
```

**Proteus 原语层不出现 `view` / `__CreateElement`**——它们是 Backend 实现细节。这也是 G-32 与「小程序组件别名」的根本区别。

---

## 11. 严格规则（铁律）

- **G-32.1**：L1 原语必须覆盖小程序官方能力的 **100%**（组件 + API 类别），覆盖率由 `proteus audit:coverage` 自动化校验，低于 100% CI 红
- **G-32.2**：L1 原语 **禁止与小程序组件同名**（如不得命名 `<view>` / `<scroll-view>`），避免语义混淆；同名必须走 `@proteus/compat-miniprogram`
- **G-32.3**：L1 能力原语 **必须 3+ 端实现**（Web/iOS/Android 至少三），鸿蒙/小程序/车机可选；任一端缺失 → 降级到 L2 或标记 `experimental`
- **G-32.4**：所有能力原语 **必须返回 `Result<T>` 或 `Promise<T>`**，禁止回调风格；事件统一用 Vue `emit`（禁止 `bindtap` 式）
- **G-32.5**：原语属性必须是「约束描述」，禁止暴露 CSS 属性名（如 `display`/`flex-direction`）或平台 API 名（如 `scroll-x`/`enable-flex`）
- **CMP009**：新增原语须经「**组合性审查**」——若能用现有原语组合表达，不得新增（P2 原则）

---

## 12. 分批落地（B1-B6）

| 批次 | 范围 | 依赖 | 交付 |
|------|------|------|------|
| **B1** | L1 清单冻结（本表 128）+ C-IR schema 扩展 + `audit:coverage` 工具 | G-31 Component IR | ✅ 覆盖率报告 = 100%——清单 SSOT `PRIMITIVE_CATALOG` + 渲染映射补到 26 implemented 语义 + `proteus audit coverage`（100% + 闭环 C1-C5） |
| **B2** | ① 布局 12 + ② UI 18（Web/DOM Backend 全实现） | G-27 VueDomBackend | ✅ 布局 12 + UI 18 双端落地（23 新组件 + 演示页）；③ Shell 余 7 / ④ Gesture / ⑤ Capability 后续批次 |
| **B3** | ⑤ 能力 50（Native Backend iOS/Android 实现） | G-28 NativeBackend | 真机跑通 Top 30 |
| **B4** | ③ Shell 10 + ④ Gesture 10（含手势识别器映射） | G-27 + G-30 | ✅ ③ Shell 10 全落地 + ④ Gesture 核心落地（`@proteus-vue/gesture` 纯识别器 + useGesture + v-gesture 指令 + p-draggable/p-scrollable）；原生识别器映射后续批次 |
| **B5** | ⑥ 工程 28（路由/动画/生命周期语义化） | G-17 + Vue | DevTools 集成 |
| **B6** | 对照矩阵自动化 + 迁移 codemod 完善 + conformance 全绿 | G-31 migration | 迁移工具链 |

**M1 落点**：B1 + B2（与 G-27 B1 nodeOps、G-29 B1 CompilerIR、G-30 B1 capabilities schema、G-31 B1 C-IR **同批**——都是「定义 schema」）

---

## 13. 风险与边界

| 风险 | 缓解 |
|------|------|
| 128 原语过多，学习成本高 | 分层：核心 34（L1 骨架）+ 扩展 94；文档按场景索引；IDE 自动导入 |
| 小程序某些 API 语义确实独特（如 `createInnerAudioContext`） | 收敛到 `<p-media>` 属性；过度差异走 L2 Backend 包 |
| 宿主平台拒绝嵌入 JS（Tier 4） | G-30 Tier 模型兜底，原语降级为静态/服务端渲染 |
| 100% 覆盖承诺过重 | B1 冻结清单后，**新增小程序能力走 L2**，不破坏 L1 稳定性 |

---

## 14. 文档关系

```
PROTEUS-METHODOLOGY (原则#0)
   └─ 五支柱
        └─ G-22 柔性布局 ──→ ① 布局原语 (本章)
        └─ G-24 系统集成 ──→ ⑤ 能力原语 (本章)
        └─ G-31 组件/API 语义化 ──→ ② ③④⑥ + 铁律 G-32.x
                                   ↑
                          ★ G-32 = 五支柱在「原语完整性」上的具体化
```

> **本文件是方法论的工程化收口**：把「语义优先 + 组合 + 约束 + 类型 + 降级」五个抽象原则，落实为一张可审计、可实现的完整原语表。
