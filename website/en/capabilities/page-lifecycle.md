---
title: usePageLifecycle (capability.page-lifecycle)
group: 应用与生命周期
order: 7002
---

# usePageLifecycle

usePageLifecycle: page lifecycle subscription handle (wx Page hooks / web load + visibilitychange)

> Capability primitive C24 · `capability.page-lifecycle` · returns `LifecycleHooks` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
usePageLifecycle(): PageLifecycle
```

## Returns

Returns `PageLifecycle` (synchronous handle/state object).

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`onLoad`](#onload) | `onLoad(cb: () => void): () => void` | — |
| [`onShow`](#onshow) | `onShow(cb: () => void): () => void` | — |
| [`onReady`](#onready) | `onReady(cb: () => void): () => void` | — |
| [`onHide`](#onhide) | `onHide(cb: () => void): () => void` | — |
| [`onUnload`](#onunload) | `onUnload(cb: () => void): () => void` | — |
| [`onRouteDone`](#onroutedone) | `onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void` | — |
| [`onPullDownRefresh`](#onpulldownrefresh) | `onPullDownRefresh(cb: () => void): () => void` | — |
| [`onReachBottom`](#onreachbottom) | `onReachBottom(cb: () => void): () => void` | — |
| [`onPageScroll`](#onpagescroll) | `onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void` | — |
| [`onResize`](#onresize) | `onResize(cb: (e: PageEventPayloads['resize']) => void): () => void` | — |
| [`onTabItemTap`](#ontabitemtap) | `onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void` | — |
| [`setShareAppMessageProvider`](#setshareappmessageprovider) | `setShareAppMessageProvider(fn: () => ShareContent): void` | — |
| [`setShareTimelineProvider`](#setsharetimelineprovider) | `setShareTimelineProvider(fn: () => ShareContent): void` | — |
| [`setAddToFavoritesProvider`](#setaddtofavoritesprovider) | `setAddToFavoritesProvider(fn: () => ShareContent): void` | — |
| [`setSaveExitStateProvider`](#setsaveexitstateprovider) | `setSaveExitStateProvider(fn: () => Record<string, unknown>): void` | — |

### `onLoad`

```ts
onLoad(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onShow`

```ts
onShow(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onReady`

```ts
onReady(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onHide`

```ts
onHide(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onUnload`

```ts
onUnload(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onRouteDone`

```ts
onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['route-done']) => void` | Yes | — |

**Returns**: `() => void`

### `onPullDownRefresh`

```ts
onPullDownRefresh(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onReachBottom`

```ts
onReachBottom(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onPageScroll`

```ts
onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['page-scroll']) => void` | Yes | — |

**Returns**: `() => void`

### `onResize`

```ts
onResize(cb: (e: PageEventPayloads['resize']) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['resize']) => void` | Yes | — |

**Returns**: `() => void`

### `onTabItemTap`

```ts
onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['tab-item-tap']) => void` | Yes | — |

**Returns**: `() => void`

### `setShareAppMessageProvider`

```ts
setShareAppMessageProvider(fn: () => ShareContent): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setShareTimelineProvider`

```ts
setShareTimelineProvider(fn: () => ShareContent): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setAddToFavoritesProvider`

```ts
setAddToFavoritesProvider(fn: () => ShareContent): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setSaveExitStateProvider`

```ts
setSaveExitStateProvider(fn: () => Record<string, unknown>): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => Record<string` | Yes | — |
| `unknown>` | `—` | Yes | — |

**Returns**: `void`

## Error codes

| code | Doc |
|---|---|
| `page-lifecycle.unsupported` | The bridge does not provide getPageLifecycle (usePageLifecycle unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → Page.onLoad/onShow |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| Android native | ✅ | native-android (Jetpack) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const page = usePageLifecycle() // synchronous handle — no await, no res.ok

console.log('page phase:', page.phase)
const off = page.onShow(() => console.log('page visible'))
// page.onLoad(...) / page.onHide(...); off() unsubscribes
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->