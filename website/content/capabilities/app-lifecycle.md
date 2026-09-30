---
title: useAppLifecycle（capability.app-lifecycle）
group: 应用与生命周期
order: 7001
---

# useAppLifecycle

useAppLifecycle：应用生命周期订阅句柄（wx App 钩子 / web visibilitychange+load）

> 能力原语 C23 · `capability.app-lifecycle` · 返回 `LifecycleHooks` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useAppLifecycle(): AppLifecycle
```

## 返回值

返回 `AppLifecycle`（同步句柄——无 Promise、无 await，结构见下）。

## 方法

| 方法 | 说明 | 端支持（MP / Web / App） |
|---|---|---|
| [`onLaunch`](#onlaunch) | 应用启动（**恰好一次**，先于首个 show；壳只需转发 show，总线自动补 launch） | MP ✅ · Web ✅ · App ✅ |
| [`onShow`](#onshow) | 应用进入前台 | MP ✅ · Web ✅ · App ✅ |
| [`onHide`](#onhide) | 应用退到后台 | MP ✅ · Web ✅ · App ✅ |
| [`onPageNotFound`](#onpagenotfound) | 路由未命中（可跳兜底页） | MP ✅ · Web ✅ · App ✅ |
| [`onAudioInterruptionBegin`](#onaudiointerruptionbegin) | 音频被系统中断开始（来电等） | MP ✅ · Web — · App ✅ |
| [`onAudioInterruptionEnd`](#onaudiointerruptionend) | 音频中断结束（可恢复播放） | MP ✅ · Web — · App ✅ |

### 方法级端支持（各端真实触发源）

- `onLaunch`：MP `首个 onAppShow 自动补发` · Web `首个 load 自动补发` · App `壳冷启动`
- `onShow`：MP `wx.onAppShow` · Web `visibilitychange→visible` · App `壳 resume（Activity.onResume / didBecomeActive）`
- `onHide`：MP `wx.onAppHide` · Web `visibilitychange→hidden` · App `壳 pause（Activity.onPause / willResignActive）`
- `onPageNotFound`：MP `App.onPageNotFound / wx.onPageNotFound` · Web `路由未命中（router 层推）` · App `路由未命中`
- `onAudioInterruptionBegin`：MP `App.onAudioInterruptionBegin` · Web —（无此事件） · App `壳音频会话通知`
- `onAudioInterruptionEnd`：MP `App.onAudioInterruptionEnd` · Web —（无此事件） · App `壳音频会话通知`

### `onLaunch`

```ts
onLaunch(cb: () => void): () => void
```

**说明**：应用启动（**恰好一次**，先于首个 show；冷启动自动补发——壳只需转发 show/hide）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onShow`

```ts
onShow(cb: () => void): () => void
```

**说明**：应用进入前台

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onHide`

```ts
onHide(cb: () => void): () => void
```

**说明**：应用退到后台

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onPageNotFound`

```ts
onPageNotFound(cb: (e: { path: string }) => void): () => void
```

**说明**：路由未命中（可跳兜底页）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { path: string }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onAudioInterruptionBegin`

```ts
onAudioInterruptionBegin(cb: () => void): () => void
```

**说明**：音频被系统中断开始（来电等）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onAudioInterruptionEnd`

```ts
onAudioInterruptionEnd(cb: () => void): () => void
```

**说明**：音频中断结束（可恢复播放）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

## 错误码

| code | 说明 |
|---|---|
| `app-lifecycle.unsupported` | 桥未提供 getAppLifecycle（useAppLifecycle 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → App.onLaunch/onShow |
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
const app = useAppLifecycle() // 同步句柄——无 await、无 res.ok

console.log('当前阶段:', app.phase)
const off = app.onShow(() => console.log('回到前台'))
// app.onLaunch(...) / app.onHide(...)；off() 取消订阅
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