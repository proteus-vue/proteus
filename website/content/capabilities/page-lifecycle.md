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

| 方法 | 签名 | 说明 |
|---|---|---|
| [`onLoad`](#onload) | `onLoad(cb: () => void): () => void` | — |
| [`onShow`](#onshow) | `onShow(cb: () => void): () => void` | — |
| [`onReady`](#onready) | `onReady(cb: () => void): () => void` | — |
| [`onHide`](#onhide) | `onHide(cb: () => void): () => void` | — |
| [`onUnload`](#onunload) | `onUnload(cb: () => void): () => void` | — |
| [`onRouteDone`](#onroutedone) | `onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void` | 路由动画完成（MP `onRouteDone` / App 转场结束 / Web transitionend） |
| [`onPullDownRefresh`](#onpulldownrefresh) | `onPullDownRefresh(cb: () => void): () => void` | 下拉刷新（MP `onPullDownRefresh` / App 宿主手势；★Web 无原生——诚实不触发） |
| [`onReachBottom`](#onreachbottom) | `onReachBottom(cb: () => void): () => void` | 触底（MP `onReachBottom` / Web 滚动到底 / App 滚动到底） |
| [`onPageScroll`](#onpagescroll) | `onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void` | 页面滚动（★**高频**：微信文档明确会引起两线程通信 ⇒ MP 端仅"声明过 onPageScroll"才派发） |
| [`onResize`](#onresize) | `onResize(cb: (e: PageEventPayloads['resize']) => void): () => void` | 尺寸变化（MP `onResize` / Web resize / App 旋转分屏） |
| [`onTabItemTap`](#ontabitemtap) | `onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void` | tab 点击（MP `onTabItemTap` / App tab 栏） |
| [`setShareAppMessageProvider`](#setshareappmessageprovider) | `setShareAppMessageProvider(fn: () => ShareContent): void` | 转发给好友（返回分享内容；MP 端声明后右上角出现"转发"入口） |
| [`setShareTimelineProvider`](#setsharetimelineprovider) | `setShareTimelineProvider(fn: () => ShareContent): void` | 分享到朋友圈（同上；声明后才显示入口） |
| [`setAddToFavoritesProvider`](#setaddtofavoritesprovider) | `setAddToFavoritesProvider(fn: () => ShareContent): void` | 收藏（同上） |
| [`setSaveExitStateProvider`](#setsaveexitstateprovider) | `setSaveExitStateProvider(fn: () => Record<string, unknown>): void` | 保存退出状态（MP `onSaveExitState`——返回需保存的状态对象） |

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
| `fn` | `() => Record<string` | 是 | 回调函数 |
| `unknown>` | `—` | 是 | — |

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

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->