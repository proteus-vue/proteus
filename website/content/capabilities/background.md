---
title: useBackground（capability.background）
group: 应用与生命周期
order: 7003
---

# useBackground

useBackground：后台/前台切换订阅（wx onAppHide/onAppShow / web visibilitychange）

> 能力原语 C25 · `capability.background` · 返回 `BackgroundAPI` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useBackground(): Promise<CapResult<BackgroundAPI>>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `BackgroundAPI` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`onEvent`](#onevent) | 订阅前后台切换（返回取消） |
| [`onMemoryWarning`](#onmemorywarning) | 内存警告（wx.onMemoryWarning） |
| [`onThemeChange`](#onthemechange) | 主题变化（wx.onThemeChange，深色/浅色） |
| [`onWindowResize`](#onwindowresize) | 窗口尺寸变化（wx.onWindowResize / web resize） |
| [`onError`](#onerror) | 小程序错误（wx.onError） |
| [`onUnhandledRejection`](#onunhandledrejection) | 未处理的 Promise rejection（wx.onUnhandledRejection） |
| [`onNetworkStatusChange`](#onnetworkstatuschange) | 网络状态变化（wx.onNetworkStatusChange） |
| [`getLaunchOptions`](#getlaunchoptions) | 启动参数（wx.getLaunchOptionsSync） |
| [`getEnterOptions`](#getenteroptions) | 当前进入参数（wx.getEnterOptionsSync） |

### `onEvent`

```ts
onEvent(cb: (e: BackgroundEvent) => void): () => void
```

**说明**：订阅前后台切换（返回取消）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: BackgroundEvent) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onMemoryWarning`

```ts
onMemoryWarning(cb: (level: number) => void): () => void
```

**说明**：内存警告（wx.onMemoryWarning）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(level: number) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onThemeChange`

```ts
onThemeChange(cb: (theme: 'dark' | 'light') => void): () => void
```

**说明**：主题变化（wx.onThemeChange，深色/浅色）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(theme: 'dark' \| 'light') => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onWindowResize`

```ts
onWindowResize(cb: (size: { windowWidth: number; windowHeight: number }) => void): () => void
```

**说明**：窗口尺寸变化（wx.onWindowResize / web resize）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(size: { windowWidth: number; windowHeight: number }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onError`

```ts
onError(cb: (error: string) => void): () => void
```

**说明**：小程序错误（wx.onError）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(error: string) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onUnhandledRejection`

```ts
onUnhandledRejection(cb: (reason: { reason: string; promise: Promise<unknown> }) => void): () => void
```

**说明**：未处理的 Promise rejection（wx.onUnhandledRejection）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(reason: { reason: string; promise: Promise<unknown> }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onNetworkStatusChange`

```ts
onNetworkStatusChange(cb: (status: { isConnected: boolean; networkType: string }) => void): () => void
```

**说明**：网络状态变化（wx.onNetworkStatusChange）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(status: { isConnected: boolean; networkType: string }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `getLaunchOptions`

```ts
getLaunchOptions(): Promise<CapResult<Record<string, unknown>>>
```

**说明**：启动参数（wx.getLaunchOptionsSync）

**返回值**：`Promise<CapResult<Record<string, unknown>>>`

### `getEnterOptions`

```ts
getEnterOptions(): Promise<CapResult<Record<string, unknown>>>
```

**说明**：当前进入参数（wx.getEnterOptionsSync）

**返回值**：`Promise<CapResult<Record<string, unknown>>>`

## 类型引用

### `BackgroundEvent`

C25 后台事件（wx onAppHide/onAppShow / web visibilitychange）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `type` | `'enter-background' \| 'enter-foreground'` | — | 事件类型（退后台 / 回前台） |
| `time` | `number` | — | 事件时间戳（ms） |

## 错误码

| code | 说明 |
|---|---|
| `background.unsupported` | 桥未提供 getBackground（useBackground 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.onBackground |
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
const res = await useBackground()

if (res.ok) {
  const bg = res.data
  const off = bg.onEvent((e) => console.log(e.type === 'enter-background' ? '进入后台' : '回到前台', e.time))
  // off() 取消订阅
} else if (res.error.code.endsWith('.unsupported')) {
  // 平台不支持 → 降级路径
}
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