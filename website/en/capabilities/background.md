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
| iOS native | ✅ | native-ios (UIKit) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| Android native | ✅ | native-android (Jetpack) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
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

## Platform notes

### Mini Program (MP)

- **Page stack & routing events** — The 10-page stack limit, navigateTo/redirectTo/switchTab semantics, and route-completion timing (onRouteDone) · Related capabilities: [`useNavigationGuard`](/capabilities/navigation-guard)
- **tabBar & tab switching** — onTabItemTap on tab pages and switchTab semantics (non-tab pages destroyed; other tabs kept alive) · Related capabilities: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **Pull-down refresh & reach-bottom** — ★Requires enablePullDownRefresh in page.json; onReachBottomDistance controls the bottom threshold · Related capabilities: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **Background & audio interruption** — onAppHide/onAppShow foreground-background semantics and system audio interruptions (onAudioInterruption*) · Related capabilities: [`useAppLifecycle`](/capabilities/app-lifecycle)

### Web

- **Tab visibility & foreground/background** — visibilitychange is the only foreground/background signal (browsers do not distinguish backgrounding from tab switching); load fires once · Related capabilities: [`useAppLifecycle`](/capabilities/app-lifecycle)
- **Page unload & leave confirmation** — beforeunload returnValue drives **leave confirmation** (browsers do not persist state — unlike Mini Program onSaveExitState) · Related capabilities: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **High-frequency scrolling** — scroll is rAF-throttled before dispatch; reach-bottom uses a 50px heuristic (no native onReachBottom) · Related capabilities: [`usePageLifecycle`](/capabilities/page-lifecycle)
- **Split view & window resizing** — resize drives both app-level and page-level size events (rotation / split view / window resizing) · Related capabilities: [`useWindow`](/capabilities/window)

### App (iOS / Android / Harmony)

- **Activity / ViewController lifecycle** — The shell forwards onCreate/onResume/onPause (iOS: viewDidLoad/didBecomeActive/willResignActive) into the runtime, mapped to app launch/show/hide — **business code never touches Activity lifecycle directly** (G-39 single ownership) · Related capabilities: [`useAppLifecycle`](/capabilities/app-lifecycle)
- **Keyboard events (soft-keyboard height)** — Soft-keyboard show/hide and height changes — forwarded by the App shell, wx.onKeyboardHeightChange on Mini Program, visualViewport heuristic on Web · Related capabilities: [`useKeyboard`](/capabilities/keyboard)
- **Window management** — Multi-window / split view / window sizing (tablets, foldables, desktop) — via host window APIs on App (in-app tab navigation also uses useWindow) · Related capabilities: [`useWindow`](/capabilities/window)
- **Memory warnings & low memory** — iOS didReceiveMemoryWarning / Android onTrimMemory forwarded by the shell — release caches here (pairs with the G-43 ownership model) · Related capabilities: [`useBackground`](/capabilities/background)
- **Deep links & cold-start params** — Cold-start launch/enter params (deep-link query) and restoring the initial virtual stack · Related capabilities: [`useBackground`](/capabilities/background)

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->