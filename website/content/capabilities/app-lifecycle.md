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

| 方法 | 签名 | 说明 |
|---|---|---|
| [`onLaunch`](#onlaunch) | `onLaunch(cb: () => void): () => void` | — |
| [`onShow`](#onshow) | `onShow(cb: () => void): () => void` | — |
| [`onHide`](#onhide) | `onHide(cb: () => void): () => void` | — |
| [`onError`](#onerror) | `onError(cb: (e: { error: string }) => void): () => void` | 未捕获异常（MP `App.onError` / Web window.onerror / App 壳） |
| [`onUnhandledRejection`](#onunhandledrejection) | `onUnhandledRejection(cb: (e: { reason: string }) => void): () => void` | 未处理的 Promise rejection（MP `App.onUnhandledRejection` / Web unhandledrejection） |
| [`onMemoryWarning`](#onmemorywarning) | `onMemoryWarning(cb: (e: { level: number }) => void): () => void` | 内存警告（MP `App.onMemoryWarning` / ★App 端壳：iOS didReceiveMemoryWarning / Android onTrimMemory） |
| [`onThemeChange`](#onthemechange) | `onThemeChange(cb: (e: { theme: 'dark' \| 'light' }) => void): () => void` | 系统主题变化（MP `App.onThemeChange` / Web matchMedia / App 壳） |
| [`onWindowResize`](#onwindowresize) | `onWindowResize(cb: (e: { windowWidth: number; windowHeight: number }) => void): () => void` | 窗口尺寸变化（MP `wx.onWindowResize` / Web resize / App 旋转分屏） |
| [`onPageNotFound`](#onpagenotfound) | `onPageNotFound(cb: (e: { path: string }) => void): () => void` | 页面未找到（MP `App.onPageNotFound` / Web 路由未命中） |
| [`onAudioInterruptionBegin`](#onaudiointerruptionbegin) | `onAudioInterruptionBegin(cb: () => void): () => void` | 音频中断开始（来电等——MP `App.onAudioInterruptionBegin` / App 壳） |
| [`onAudioInterruptionEnd`](#onaudiointerruptionend) | `onAudioInterruptionEnd(cb: () => void): () => void` | 音频中断结束 |

### `onLaunch`

```ts
onLaunch(cb: () => void): () => void
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

### `onHide`

```ts
onHide(cb: () => void): () => void
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onError`

```ts
onError(cb: (e: { error: string }) => void): () => void
```

**说明**：未捕获异常（MP `App.onError` / Web window.onerror / App 壳）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { error: string }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onUnhandledRejection`

```ts
onUnhandledRejection(cb: (e: { reason: string }) => void): () => void
```

**说明**：未处理的 Promise rejection（MP `App.onUnhandledRejection` / Web unhandledrejection）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { reason: string }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onMemoryWarning`

```ts
onMemoryWarning(cb: (e: { level: number }) => void): () => void
```

**说明**：内存警告（MP `App.onMemoryWarning` / ★App 端壳：iOS didReceiveMemoryWarning / Android onTrimMemory）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { level: number }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onThemeChange`

```ts
onThemeChange(cb: (e: { theme: 'dark' | 'light' }) => void): () => void
```

**说明**：系统主题变化（MP `App.onThemeChange` / Web matchMedia / App 壳）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { theme: 'dark' \| 'light' }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onWindowResize`

```ts
onWindowResize(cb: (e: { windowWidth: number; windowHeight: number }) => void): () => void
```

**说明**：窗口尺寸变化（MP `wx.onWindowResize` / Web resize / App 旋转分屏）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { windowWidth: number; windowHeight: number }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onPageNotFound`

```ts
onPageNotFound(cb: (e: { path: string }) => void): () => void
```

**说明**：页面未找到（MP `App.onPageNotFound` / Web 路由未命中）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(e: { path: string }) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onAudioInterruptionBegin`

```ts
onAudioInterruptionBegin(cb: () => void): () => void
```

**说明**：音频中断开始（来电等——MP `App.onAudioInterruptionBegin` / App 壳）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onAudioInterruptionEnd`

```ts
onAudioInterruptionEnd(cb: () => void): () => void
```

**说明**：音频中断结束

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

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->