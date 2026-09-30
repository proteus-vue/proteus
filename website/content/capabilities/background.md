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

- **全局订阅 API 面** — wx.onAppShow/onAppHide/onMemoryWarning/onThemeChange/onWindowResize/onError/onUnhandledRejection 均为全局订阅（与页面级的 Page 钩子机制不同）
- **启动参数读取** — getLaunchOptions（一次性，启动时）与 getEnterOptions（每次回前台）—— 深链参数的两种语义

### Web

- **visibilitychange 为唯一信号** — Web 没有独立的 onAppShow/onAppHide —— 前后台与应用级 resize 都由浏览器事件推导；内存警告用 performance.memory 启发式
- **下载预防的离开确认** — 与 usePageLifecycle 的 save-exit-state 共用 beforeunload 通道（本能力负责环境事件，离开确认在页面层）

### App（iOS / Android / 鸿蒙）

- **业务欄的前后台转发** — Activity.onResume/onPause（iOS didBecomeActive/willResignActive）由壳转发 —— 与 useAppLifecycle 的 launch/show/hide 是**同一组事件**，本能力多了环境面
- **内存压力与回收** — iOS didReceiveMemoryWarning / Android onTrimMemory —— 与 G-43 所有权 Drop 协议配合释放缓存
- **系统主题与分屏** — 深色模式切换与窗口尺寸变化由壳转发（平板/折叠屏上分屏频繁）

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->