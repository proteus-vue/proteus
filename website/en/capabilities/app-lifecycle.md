---
title: useAppLifecycle (capability.app-lifecycle)
group: 应用与生命周期
order: 7001
---

# useAppLifecycle

**What it does**: Observe app launch, foreground and background transitions.

**When to use it**: Pausing work in background, refreshing on resume.

> 技术标识：能力原语 C23 · `capability.app-lifecycle` · 返回 `LifecycleHooks` · **Hook implemented** (per-end support in the table below)

useAppLifecycle: app lifecycle subscription handle (wx App hooks / web visibilitychange + load)

## Signature

```ts
useAppLifecycle(): AppLifecycle
```

## Returns

Returns `AppLifecycle` (synchronous handle/state object).

## Methods

| Method | Doc | End support |
|---|---|---|
| [`onLaunch`](#onlaunch) | App launched (exactly once, before the first show; auto-emitted on cold start) | MP ✅ · Web ✅ · App ✅ |
| [`onShow`](#onshow) | App entered the foreground | MP ✅ · Web ✅ · App ✅ |
| [`onHide`](#onhide) | App moved to the background | MP ✅ · Web ✅ · App ✅ |
| [`onPageNotFound`](#onpagenotfound) | Route not matched (navigate to a fallback page) | MP ✅ · Web ✅ · App — |
| [`onAudioInterruptionBegin`](#onaudiointerruptionbegin) | Audio session interrupted by the system (e.g. incoming call) | MP ✅ · Web — · App ✅ |
| [`onAudioInterruptionEnd`](#onaudiointerruptionend) | Audio interruption ended (playback may resume) | MP ✅ · Web — · App ✅ |

### End support

- `onLaunch`: MP `auto-emitted on the first onAppShow` · Web `auto-emitted on the first load` · App `shell cold start`
- `onShow`: MP `wx.onAppShow` · Web `visibilitychange→visible` · App `shell resume (Activity.onResume / didBecomeActive)`
- `onHide`: MP `wx.onAppHide` · Web `visibilitychange→hidden` · App `shell pause (Activity.onPause / willResignActive)`
- `onPageNotFound`: MP `App.onPageNotFound / wx.onPageNotFound` · Web `route miss (pushed by the router layer)` · App — (not on this target)
- `onAudioInterruptionBegin`: MP `App.onAudioInterruptionBegin` · Web — (not on this target) · App `shell audio-signal receiver (Android BECOMING_NOISY / HEADSET_PLUG — registered; ★protected broadcast, not script-drivable)`
- `onAudioInterruptionEnd`: MP `App.onAudioInterruptionEnd` · Web — (not on this target) · App `shell audio-signal receiver (Android HEADSET_PLUG state=1 — same; requires a physical plug/unplug)`

### `onLaunch`

```ts
onLaunch(cb: () => void): () => void
```

**Doc**: App launched (exactly once, before the first show; auto-emitted on cold start)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onShow`

```ts
onShow(cb: () => void): () => void
```

**Doc**: App entered the foreground

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onHide`

```ts
onHide(cb: () => void): () => void
```

**Doc**: App moved to the background

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onPageNotFound`

```ts
onPageNotFound(cb: (e: { path: string }) => void): () => void
```

**Doc**: Route not matched (navigate to a fallback page)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: { path: string }) => void` | Yes | — |

**Returns**: `() => void`

### `onAudioInterruptionBegin`

```ts
onAudioInterruptionBegin(cb: () => void): () => void
```

**Doc**: Audio session interrupted by the system (e.g. incoming call)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onAudioInterruptionEnd`

```ts
onAudioInterruptionEnd(cb: () => void): () => void
```

**Doc**: Audio interruption ended (playback may resume)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `phase` | `AppLifecyclePhase` | Yes | — |

## Referenced types

### `AppLifecyclePhase`

应用阶段（与 C23 `AppLifecycle.phase` 同值域）

## Error codes

| code | Doc |
|---|---|
| `app-lifecycle.unsupported` | The bridge does not provide getAppLifecycle (useAppLifecycle unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → App.onLaunch/onShow |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `AppLifecycle`

★★C23 应用生命周期句柄（**扩展为完整事件面**——2026-09-30）。

【类型收口（防漂移）】定义在 `capability-app.ts` 的 `AppLifecycleHandle`，
此处仅做别名导出——**单一事实源**。三端（MP/Web/App）共用同一句柄形状：
MP 走 wx 全局 API + 产物派发；Web 走 visibilitychange/resize/scroll；
App 走壳（G-39 运行时）转发。事件面 SSOT 见 `APP_EVENTS`（11 个事件）。

| Prop/Method | Type | Doc |
|---|---|---|
| `phase` | `AppLifecyclePhase` | — |

| Prop/Method | Type | Doc |
|---|---|---|
| `onLaunch` | `onLaunch(cb: () => void): () => void` | 应用启动（**恰好一次**，先于首个 show；冷启动自动补发——壳只需转发 show/hide） |
| `onShow` | `onShow(cb: () => void): () => void` | 应用进入前台 |
| `onHide` | `onHide(cb: () => void): () => void` | 应用退到后台 |
| `onPageNotFound` | `onPageNotFound(cb: (e: { path: string }) => void): () => void` | 路由未命中（可跳兜底页） |
| `onAudioInterruptionBegin` | `onAudioInterruptionBegin(cb: () => void): () => void` | 音频被系统中断开始（来电等） |
| `onAudioInterruptionEnd` | `onAudioInterruptionEnd(cb: () => void): () => void` | 音频中断结束（可恢复播放） |

### `AppLifecyclePhase`

应用阶段（与 C23 `AppLifecycle.phase` 同值域）

| 取值 | 说明 |
|---|---|
| `'PENDING'` | — |
| `'LAUNCH'` | — |
| `'SHOW'` | — |
| `'HIDE'` | — |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const app = useAppLifecycle() // synchronous handle — no await, no res.ok

console.log('current phase:', app.phase)
const off = app.onShow(() => console.log('returned to foreground'))
// app.onLaunch(...) / app.onHide(...); off() unsubscribes
```

## Platform notes

### Mini Program (MP)

- **Mini Program global event surface** — App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* are Mini-Program-only (no Web/App equivalent) · Related capabilities: [`useBackground`](/docs/capability/background)
- **Cold-start route & scene** — Cold-start params (scene / query / share origin) come from App.onLaunch — equivalent to the first show in this lifecycle · Related capabilities: [`useBackground`](/docs/capability/background)

### Web

- **Browsers have no "launch" concept** — Browsers do not distinguish cold start from reload — the first load auto-emits one launch (semantic equivalence)
- **Tab switch != app background** — visibilitychange cannot distinguish a tab switch from a minimized window — both fire hide

### App (iOS / Android / Harmony)

- **Activity / ViewController lifecycle forwarding** — The shell forwards onCreate/onResume/onPause (iOS: viewDidLoad/didBecomeActive/willResignActive) into the runtime — **business code never touches Activity lifecycle directly** (G-39 single ownership)
- **Memory warnings & low memory** — iOS didReceiveMemoryWarning / Android onTrimMemory forwarded by the shell — release caches here (pairs with the G-43 ownership model) · Related capabilities: [`useBackground`](/docs/capability/background)
- **Audio session interruption** — When a call or another app takes the audio session the system interrupts playback — both shells wire real sources (iOS: `AVAudioSession.interruptionNotification`; Android has no unified callback ⇒ approximated via `BECOMING_NOISY`/`HEADSET_PLUG` receivers, ★protected broadcasts, not script-drivable)

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->