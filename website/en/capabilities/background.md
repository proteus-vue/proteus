---
title: useBackground (capability.background)
group: 应用与生命周期
order: 7003
---

# useBackground

useBackground: background/foreground switch subscription (wx onAppHide/onAppShow / web visibilitychange)

> Capability primitive C25 · `capability.background` · returns `BackgroundAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useBackground(): Promise<CapResult<BackgroundAPI>>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `BackgroundAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`onEvent`](#onevent) | `onEvent(cb: (e: BackgroundEvent) => void): () => void` | — |
| [`onMemoryWarning`](#onmemorywarning) | `onMemoryWarning(cb: (level: number) => void): () => void` | — |
| [`onThemeChange`](#onthemechange) | `onThemeChange(cb: (theme: 'dark' \| 'light') => void): () => void` | — |
| [`onWindowResize`](#onwindowresize) | `onWindowResize(cb: (size: { windowWidth: number; windowHeight: number }) => void): () => void` | — |
| [`onError`](#onerror) | `onError(cb: (error: string) => void): () => void` | — |
| [`onUnhandledRejection`](#onunhandledrejection) | `onUnhandledRejection(cb: (reason: { reason: string; promise: Promise<unknown> }) => void): () => void` | — |
| [`onNetworkStatusChange`](#onnetworkstatuschange) | `onNetworkStatusChange(cb: (status: { isConnected: boolean; networkType: string }) => void): () => void` | — |
| [`getLaunchOptions`](#getlaunchoptions) | `getLaunchOptions(): Promise<CapResult<Record<string, unknown>>>` | — |
| [`getEnterOptions`](#getenteroptions) | `getEnterOptions(): Promise<CapResult<Record<string, unknown>>>` | — |

### `onEvent`

```ts
onEvent(cb: (e: BackgroundEvent) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: BackgroundEvent) => void` | Yes | — |

**Returns**: `() => void`

### `onMemoryWarning`

```ts
onMemoryWarning(cb: (level: number) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(level: number) => void` | Yes | — |

**Returns**: `() => void`

### `onThemeChange`

```ts
onThemeChange(cb: (theme: 'dark' | 'light') => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(theme: 'dark' \| 'light') => void` | Yes | — |

**Returns**: `() => void`

### `onWindowResize`

```ts
onWindowResize(cb: (size: { windowWidth: number; windowHeight: number }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(size: { windowWidth: number; windowHeight: number }) => void` | Yes | — |

**Returns**: `() => void`

### `onError`

```ts
onError(cb: (error: string) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(error: string) => void` | Yes | — |

**Returns**: `() => void`

### `onUnhandledRejection`

```ts
onUnhandledRejection(cb: (reason: { reason: string; promise: Promise<unknown> }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(reason: { reason: string; promise: Promise<unknown> }) => void` | Yes | — |

**Returns**: `() => void`

### `onNetworkStatusChange`

```ts
onNetworkStatusChange(cb: (status: { isConnected: boolean; networkType: string }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(status: { isConnected: boolean; networkType: string }) => void` | Yes | — |

**Returns**: `() => void`

### `getLaunchOptions`

```ts
getLaunchOptions(): Promise<CapResult<Record<string, unknown>>>
```

**Returns**: `Promise<CapResult<Record<string, unknown>>>`

### `getEnterOptions`

```ts
getEnterOptions(): Promise<CapResult<Record<string, unknown>>>
```

**Returns**: `Promise<CapResult<Record<string, unknown>>>`

## Referenced types

### `BackgroundEvent`

C25 后台事件（wx onAppHide/onAppShow / web visibilitychange）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `type` | `'enter-background' \| 'enter-foreground'` | — | 事件类型（退后台 / 回前台） |
| `time` | `number` | — | 事件时间戳（ms） |

## Error codes

| code | Doc |
|---|---|
| `background.unsupported` | The bridge does not provide getBackground (useBackground unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.onBackground |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const res = await useBackground()

if (res.ok) {
  const bg = res.data
  const off = bg.onEvent((e) => console.log(e.type === 'enter-background' ? 'entered background' : 'returned to foreground', e.time))
  // off() unsubscribes
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->