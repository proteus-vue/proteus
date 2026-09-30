---
title: usePageLifecycle（capability.page-lifecycle）
group: 应用与生命周期
order: 7002
---

# usePageLifecycle

usePageLifecycle：页面生命周期订阅句柄（wx Page 钩子 / web load+visibilitychange）

> 能力原语 C24 · `capability.page-lifecycle` · 返回 `LifecycleHooks` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
usePageLifecycle(): PageLifecycle
```

## 返回值

返回 `PageLifecycle`（同步句柄——无 Promise、无 await，结构见下）。

## 方法

| 方法 | 说明 | 端支持（MP / Web / App） |
|---|---|---|
| [`onLoad`](#onload) | 页面加载（每次进入该页触发一次，可读取路由参数） | MP ✅ · Web ✅ · App ✅ |
| [`onShow`](#onshow) | 页面显示（切入前台，或从上层页面返回） | MP ✅ · Web ✅ · App ✅ |
| [`onReady`](#onready) | 页面首帧渲染完成（一次） | MP ✅ · Web ✅ · App ✅ |
| [`onHide`](#onhide) | 页面隐藏（切后台，或被上层页面覆盖） | MP ✅ · Web ✅ · App ✅ |
| [`onUnload`](#onunload) | 页面卸载（离开并销毁） | MP ✅ · Web ✅ · App ✅ |
| [`onRouteDone`](#onroutedone) | 路由动画完成（转场结束后） | MP ✅ · Web ✅ · App ✅ |
| [`onPullDownRefresh`](#onpulldownrefresh) | 下拉刷新（用户下拉页面） | MP ✅ · Web — · App ✅ |
| [`onReachBottom`](#onreachbottom) | 滚动触底（可用于加载更多） | MP ✅ · Web ✅ · App ✅ |
| [`onPageScroll`](#onpagescroll) | 页面滚动（携带 scrollTop） | MP ✅ · Web ✅ · App ✅ |
| [`onResize`](#onresize) | 页面尺寸变化（旋转 / 分屏 / 窗口缩放） | MP ✅ · Web ✅ · App ✅ |
| [`onTabItemTap`](#ontabitemtap) | 点击 tab 栏项（携带 index / pagePath） | MP ✅ · Web — · App ✅ |
| [`setShareAppMessageProvider`](#setshareappmessageprovider) | 转发给好友（**决策型**：注册的 provider 返回值即分享内容） | MP ✅ · Web ✅ · App ✅ |
| [`setShareTimelineProvider`](#setsharetimelineprovider) | 分享到朋友圈（**决策型**） | MP ✅ · Web — · App ✅ |
| [`setAddToFavoritesProvider`](#setaddtofavoritesprovider) | 收藏页面（**决策型**） | MP ✅ · Web — · App ✅ |
| [`setSaveExitStateProvider`](#setsaveexitstateprovider) | 保存退出状态（**决策型**：provider 返回需保存的状态对象） | MP ✅ · Web ✅ · App ✅ |

### 方法级端支持（各端真实触发源）

- `onLoad`：MP `Page.onLoad（编译产物派发）` · Web `文档 load` · App `虚拟栈 mount 命令`
- `onShow`：MP `Page.onShow（编译产物派发）` · Web `load 后 + visibilitychange→visible` · App `虚拟栈 enter 命令 / 壳 resume`
- `onReady`：MP `Page.onReady（编译产物派发）` · Web `load 后首帧（rAF）` · App `屏首帧渲染完成`
- `onHide`：MP `Page.onHide（编译产物派发）` · Web `visibilitychange→hidden` · App `虚拟栈 exit 命令 / 壳 pause`
- `onUnload`：MP `Page.onUnload（编译产物派发）` · Web `beforeunload` · App `虚拟栈 unmount 命令`
- `onRouteDone`：MP `Page.onRouteDone（基础库 2.32.1+）` · Web `transitionend（由 router 层推）` · App `Morpheus 转场结束` — 基础库版本要求较高：低版本无此钩子（产物会生成，但不触发——诚实降级）
- `onPullDownRefresh`：MP `Page.onPullDownRefresh` · Web —（无此事件） · App `宿主下拉手势` — ★小程序需在 page.json 开 enablePullDownRefresh，否则不触发；**Web 无原生等价**（诚实不触发）
- `onReachBottom`：MP `Page.onReachBottom` · Web `scroll 距底 ≤50px` · App `滚动到底` — Web 端为阈值启发式（50px）；小程序按 onReachBottomDistance 配置
- `onPageScroll`：MP `Page.onPageScroll` · Web `scroll（rAF 节流）` · App `滚动回调` — ★★**高频事件**：微信官方明确会引起逻辑层与渲染层通信 ⇒ 小程序端**仅当你声明过 onPageScroll 时才派发**；Web 端已 rAF 节流
- `onResize`：MP `Page.onResize（编译产物派发）` · Web `resize` · App `屏幕旋转 / 分屏`
- `onTabItemTap`：MP `Page.onTabItemTap（编译产物派发）` · Web —（无此事件） · App `tab 栏点击` — Web 端无 tab 栏概念（如自绘 tab 请直接用组件事件）
- `setShareAppMessageProvider`：MP `Page.onShareAppMessage` · Web `navigator.share（需用户手势）` · App `系统分享面板` — ★小程序**声明后才显示右上角"转发"入口**（框架不自动补——不擅自加用户可见行为）
- `setShareTimelineProvider`：MP `Page.onShareTimeline` · Web —（无此事件） · App `系统分享面板` — 同转发：小程序声明后才显示入口
- `setAddToFavoritesProvider`：MP `Page.onAddToFavorites` · Web —（无此事件） · App `系统收藏` — 同转发：小程序声明后才显示入口
- `setSaveExitStateProvider`：MP `Page.onSaveExitState（基础库 2.7.4+）` · Web `beforeunload' 的 'returnValue` · App `退出前状态保存` — Web 端语义差异：beforeunload 的返回值用于**离开确认**（浏览器不持久化状态）

### `onLoad`

```ts
onLoad(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onShow`

```ts
onShow(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onReady`

```ts
onReady(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onHide`

```ts
onHide(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onUnload`

```ts
onUnload(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onRouteDone`

```ts
onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void
```

**说明**：路由动画完成（MP `onRouteDone` / App 转场结束 / Web transitionend）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['route-done']) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onPullDownRefresh`

```ts
onPullDownRefresh(cb: () => void): () => void
```

**说明**：下拉刷新（MP `onPullDownRefresh` / App 宿主手势；★Web 无原生——诚实不触发）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onReachBottom`

```ts
onReachBottom(cb: () => void): () => void
```

**说明**：触底（MP `onReachBottom` / Web 滚动到底 / App 滚动到底）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onPageScroll`

```ts
onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void
```

**说明**：页面滚动（★**高频**：微信文档明确会引起两线程通信 ⇒ MP 端仅"声明过 onPageScroll"才派发）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['page-scroll']) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onResize`

```ts
onResize(cb: (e: PageEventPayloads['resize']) => void): () => void
```

**说明**：尺寸变化（MP `onResize` / Web resize / App 旋转分屏）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['resize']) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onTabItemTap`

```ts
onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void
```

**说明**：tab 点击（MP `onTabItemTap` / App tab 栏）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['tab-item-tap']) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `setShareAppMessageProvider`

```ts
setShareAppMessageProvider(fn: () => ShareContent): void
```

**说明**：转发给好友（返回分享内容；MP 端声明后右上角出现"转发"入口）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fn` | `() => ShareContent` | 是 | 回调函数 |

**返回值**：`void`

### `setShareTimelineProvider`

```ts
setShareTimelineProvider(fn: () => ShareContent): void
```

**说明**：分享到朋友圈（同上；声明后才显示入口）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fn` | `() => ShareContent` | 是 | 回调函数 |

**返回值**：`void`

### `setAddToFavoritesProvider`

```ts
setAddToFavoritesProvider(fn: () => ShareContent): void
```

**说明**：收藏（同上）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fn` | `() => ShareContent` | 是 | 回调函数 |

**返回值**：`void`

### `setSaveExitStateProvider`

```ts
setSaveExitStateProvider(fn: () => Record<string, unknown>): void
```

**说明**：保存退出状态（MP `onSaveExitState`——返回需保存的状态对象）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fn` | `() => Record<string, unknown>` | 是 | 回调函数 |

**返回值**：`void`

## 错误码

| code | 说明 |
|---|---|
| `page-lifecycle.unsupported` | 桥未提供 getPageLifecycle（usePageLifecycle 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → Page.onLoad/onShow |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | ✅ | native-ios（UIKit） · App 宿主桥（capability-app.ts）· 真机双端验证（check:host-runtime） |
| Android 原生 | ✅ | native-android（Jetpack） · App 宿主桥（capability-app.ts）· 真机双端验证（check:host-runtime） |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · App 桥已就绪（平台中立）——鸿蒙宿主壳未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const page = usePageLifecycle() // 同步句柄——无 await、无 res.ok

console.log('页面阶段:', page.phase)
const off = page.onShow(() => console.log('页面可见'))
// page.onLoad(...) / page.onHide(...)；off() 取消订阅
```

## 平台专栏

### 小程序（MP）

- **页面栈与路由事件** — 小程序页面栈深 10 层、navigateTo/redirectTo/switchTab 的语义差异，以及路由完成时机（onRouteDone） · 相关能力: [`useNavigationGuard`](/capabilities/navigation-guard)
- **tabBar 与 tab 切换** — tab 页的 onTabItemTap 与 switchTab（非 tab 页全销毁、其他 tab 保活） · 相关能力: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **下拉刷新与触底** — ★需在 page.json 开 enablePullDownRefresh；onReachBottomDistance 控制触底阈值 · 相关能力: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **后台与音频中断** — onAppHide/onAppShow 的前后台语义，以及来电等导致的音频中断（onAudioInterruption*） · 相关能力: [`useAppLifecycle`](/capabilities/app-lifecycle)

### Web

- **页签可见性与前后台** — visibilitychange 是唯一的"前后台"信号（浏览器不区分"切后台"与"切页签"）；load 只触发一次 · 相关能力: [`useAppLifecycle`](/capabilities/app-lifecycle)
- **页面卸载与离开确认** — beforeunload 的 returnValue 用于**离开确认**（浏览器不持久化状态，与小程序 onSaveExitState 语义不同） · 相关能力: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **高频滚动** — scroll 事件由 rAF 节流后派发；触底用 50px 阈值启发式（无原生 onReachBottom） · 相关能力: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **分屏与窗口缩放** — resize 同时驱动应用级与应用级页面尺寸事件（旋转 / 分屏 / 缩放窗口都会触发） · 相关能力: [`useWindow`](/capabilities/window)

### App（iOS / Android / 鸿蒙）

- **Activity / ViewController 生命周期** — 壳把 onCreate/onResume/onPause（iOS 的 viewDidLoad/didBecomeActive/willResignActive）转发到运行时，映射为 app 的 launch/show/hide——**业务不直接接触 Activity 生命周期**（G-39 生命周期唯一拥有） · 相关能力: [`useAppLifecycle`](/capabilities/app-lifecycle)
- **键盘事件（软键盘高度）** — 软键盘展开/收起与高度变化——App 端由壳转发，小程序用 wx.onKeyboardHeightChange，Web 用 visualViewport 启发式 · 相关能力: [`useKeyboard`](/capabilities/keyboard)
- **窗体与窗口管理** — 多窗口 / 分屏 / 窗口尺寸（平板、折叠屏、桌面端）——App 端走宿主窗体 API（CMP 标签页内导航另有 useWindow） · 相关能力: [`useWindow`](/capabilities/window)
- **内存警告与低内存** — iOS didReceiveMemoryWarning / Android onTrimMemory 由壳转发——用于释放缓存（配合 G-43 所有权模型） · 相关能力: [`useBackground`](/capabilities/background)
- **深链与冷启动参数** — 冷启动 launch/enter 参数（深链 query）与虚拟栈的初始栈恢复 · 相关能力: [`useBackground`](/capabilities/background)

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->