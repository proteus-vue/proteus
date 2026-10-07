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

| Method | Doc |
|---|---|
| [`onEvent`](#onevent) | — |
| [`onMemoryWarning`](#onmemorywarning) | — |
| [`onThemeChange`](#onthemechange) | — |
| [`onWindowResize`](#onwindowresize) | — |
| [`onError`](#onerror) | — |
| [`onUnhandledRejection`](#onunhandledrejection) | — |
| [`onNetworkStatusChange`](#onnetworkstatuschange) | — |
| [`getLaunchOptions`](#getlaunchoptions) | — |
| [`getEnterOptions`](#getenteroptions) | — |

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
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

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

## Platform notes

### Mini Program (MP)

- **Global subscription APIs** — wx.onAppShow/Hide/MemoryWarning/ThemeChange/WindowResize/Error/UnhandledRejection are global subscriptions (unlike declarative Page hooks)
- **Launch / enter options** — getLaunchOptions (once, at startup) and getEnterOptions (every foreground return) — deep-link params have two semantics here

### Web

- **visibilitychange is the only signal** — No standalone onAppShow/onAppHide on Web — foreground/background and resize derive from browser events; memory warnings use a performance.memory heuristic
- **Leave confirmation for unsaved work** — Shares the beforeunload channel with usePageLifecycle save-exit-state (this capability owns environment events; leave confirmation lives at the page layer)

### App (iOS / Android / Harmony)

- **Foreground/background forwarding** — Activity.onResume/onPause (iOS didBecomeActive/willResignActive) forwarded by the shell — the same events as useAppLifecycle launch/show/hide, plus the environment surface here
- **Memory pressure & reclamation** — iOS didReceiveMemoryWarning / Android onTrimMemory — pairs with the G-43 ownership Drop protocol to release caches
- **System theme & split view** — Dark-mode switches and window-size changes forwarded by the shell (split view is frequent on tablets/foldables)

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->