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
| [`onPageNotFound`](#onpagenotfound) | 路由未命中（可跳兜底页） | MP ✅ · Web ✅ · App — |
| [`onAudioInterruptionBegin`](#onaudiointerruptionbegin) | 音频被系统中断开始（来电等） | MP ✅ · Web — · App ✅ |
| [`onAudioInterruptionEnd`](#onaudiointerruptionend) | 音频中断结束（可恢复播放） | MP ✅ · Web — · App ✅ |

### 方法级端支持（各端真实触发源）

- `onLaunch`：MP `首个 onAppShow 自动补发` · Web `首个 load 自动补发` · App `壳冷启动`
- `onShow`：MP `wx.onAppShow` · Web `visibilitychange→visible` · App `壳 resume（Activity.onResume / didBecomeActive）`
- `onHide`：MP `wx.onAppHide` · Web `visibilitychange→hidden` · App `壳 pause（Activity.onPause / willResignActive）`
- `onPageNotFound`：MP `App.onPageNotFound / wx.onPageNotFound` · Web `路由未命中（router 层推）` · App —（无此事件）
- `onAudioInterruptionBegin`：MP `App.onAudioInterruptionBegin` · Web —（无此事件） · App `壳音频信号接收器（Android BECOMING_NOISY / HEADSET_PLUG——已注册，★保护广播不可脚本驱动）`
- `onAudioInterruptionEnd`：MP `App.onAudioInterruptionEnd` · Web —（无此事件） · App `壳音频信号接收器（Android HEADSET_PLUG state=1——同上，真触发需物理插拔）`

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

- **小程序全局事件面** — App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* 均为小程序**独有**（Web/App 无对应语义） · 相关能力: [`useBackground`](/docs/capability/background)
- **小程序白屏与启动路径** — 冷启动参数（scene / query / 分享来源）由 App.onLaunch 提供，在生命周期里等同于首个 show · 相关能力: [`useBackground`](/docs/capability/background)

### Web

- **浏览器无"启动"概念** — 浏览器不区分"冷启动"与"刷新"——首个 load 后总线自动补一次 launch（语义等价化）
- **页签切换 ≠ 应用切后台** — visibilitychange 无法区分"用户切到另一个标签"与"最小化窗口"——两者都会触发 hide

### App（iOS / Android / 鸿蒙）

- **Activity / ViewController 生命周期转发** — 壳把 onCreate/onResume/onPause（iOS：viewDidLoad/didBecomeActive/willResignActive）转发到运行时——**业务不直接接触 Activity 生命周期**（G-39 唯一拥有）
- **内存警告与低内存** — iOS didReceiveMemoryWarning / Android onTrimMemory 由壳转发 —— 用于释放缓存（配合 G-43 所有权模型） · 相关能力: [`useBackground`](/docs/capability/background)
- **音频会话中断** — 电话/其他应用占用音频会话时，系统会打断播放 —— 两平台都由壳接真来源（iOS `AVAudioSession.interruptionNotification` 真会话语义；Android 无统一回调 ⇒ 用 `BECOMING_NOISY`/`HEADSET_PLUG` 接收器近似，★保护广播不可脚本驱动）

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->