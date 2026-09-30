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

| Method | Doc | End support |
|---|---|---|
| [`onLoad`](#onload) | Page loaded (fires once per entry; route params available) | MP ✅ · Web ✅ · App ✅ |
| [`onShow`](#onshow) | Page shown (app foregrounded, or returned from an upper page) | MP ✅ · Web ✅ · App ✅ |
| [`onReady`](#onready) | First frame rendered (once) | MP ✅ · Web ✅ · App ✅ |
| [`onHide`](#onhide) | Page hidden (backgrounded, or covered by an upper page) | MP ✅ · Web ✅ · App ✅ |
| [`onUnload`](#onunload) | Page unloaded (left and destroyed) | MP ✅ · Web ✅ · App ✅ |
| [`onRouteDone`](#onroutedone) | Route animation finished (transition completed) | MP ✅ · Web ✅ · App ✅ |
| [`onPullDownRefresh`](#onpulldownrefresh) | Pull-to-refresh (user pulls the page down) | MP ✅ · Web — · App ✅ |
| [`onReachBottom`](#onreachbottom) | Scrolled to bottom (useful for load-more) | MP ✅ · Web ✅ · App ✅ |
| [`onPageScroll`](#onpagescroll) | Page scrolled (carries `scrollTop`) | MP ✅ · Web ✅ · App ✅ |
| [`onResize`](#onresize) | Page size changed (rotation / split view / window resize) | MP ✅ · Web ✅ · App ✅ |
| [`onTabItemTap`](#ontabitemtap) | Tab bar item tapped (carries `index` / `pagePath`) | MP ✅ · Web — · App ✅ |
| [`setShareAppMessageProvider`](#setshareappmessageprovider) | Share to a friend (**decision-type**: the registered provider return value is the share content) | MP ✅ · Web ✅ · App ✅ |
| [`setShareTimelineProvider`](#setsharetimelineprovider) | Share to timeline (**decision-type**) | MP ✅ · Web — · App ✅ |
| [`setAddToFavoritesProvider`](#setaddtofavoritesprovider) | Favorite the page (**decision-type**) | MP ✅ · Web — · App ✅ |
| [`setSaveExitStateProvider`](#setsaveexitstateprovider) | Save exit state (**decision-type**: the provider returns the state object to persist) | MP ✅ · Web ✅ · App ✅ |

### End support

- `onLoad`: MP `Page.onLoad (dispatched by compiled output)` · Web `document load` · App `virtual stack mount command`
- `onShow`: MP `Page.onShow (dispatched by compiled output)` · Web `after load + visibilitychange→visible` · App `stack enter command / shell resume`
- `onReady`: MP `Page.onReady (dispatched by compiled output)` · Web `first frame after load (rAF)` · App `first frame of the screen`
- `onHide`: MP `Page.onHide (dispatched by compiled output)` · Web `visibilitychange→hidden` · App `stack exit command / shell pause`
- `onUnload`: MP `Page.onUnload (dispatched by compiled output)` · Web `beforeunload` · App `stack unmount command`
- `onRouteDone`: MP `Page.onRouteDone (base library 2.32.1+)` · Web `transitionend (pushed by the router layer)` · App `Morpheus transition finished` — Requires a recent base library; older versions generate the hook but never fire (honest degradation)
- `onPullDownRefresh`: MP `Page.onPullDownRefresh` · Web — (not on this target) · App `host pull gesture` — Mini Program: requires `enablePullDownRefresh` in page.json; **Web has no native equivalent** (honestly never fires)
- `onReachBottom`: MP `Page.onReachBottom` · Web `scroll within 50px of bottom` · App `scrolled to bottom` — Web uses a 50px threshold heuristic; Mini Program follows `onReachBottomDistance`
- `onPageScroll`: MP `Page.onPageScroll` · Web `scroll (rAF-throttled)` · App `scroll callbacks` — **High-frequency event**: WeChat docs state it causes logical/render layer IPC ⇒ on Mini Program it is dispatched **only when you declared `onPageScroll`**; Web is rAF-throttled
- `onResize`: MP `Page.onResize (dispatched by compiled output)` · Web `resize` · App `rotation / split view`
- `onTabItemTap`: MP `Page.onTabItemTap (dispatched by compiled output)` · Web — (not on this target) · App `tab bar tap` — Web has no tab bar concept (use component events for a custom tab bar)
- `setShareAppMessageProvider`: MP `Page.onShareAppMessage` · Web `navigator.share (requires a user gesture)` · App `system share sheet` — Mini Program shows the top-right "Share" entry **only after you declare it** (the framework never adds it silently)
- `setShareTimelineProvider`: MP `Page.onShareTimeline` · Web — (not on this target) · App `system share sheet` — Same as share-to-friend: the entry appears only after declaration
- `setAddToFavoritesProvider`: MP `Page.onAddToFavorites` · Web — (not on this target) · App `system favorite` — Same as share-to-friend: the entry appears only after declaration
- `setSaveExitStateProvider`: MP `Page.onSaveExitState (base library 2.7.4+)` · Web `beforeunload returnValue` · App `state save before exit` — Web semantics differ: the `beforeunload` return value is used for leave confirmation (browsers do not persist state)

### `onLoad`

```ts
onLoad(cb: () => void): () => void
```

**Doc**: Page loaded (fires once per entry; route params available)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onShow`

```ts
onShow(cb: () => void): () => void
```

**Doc**: Page shown (app foregrounded, or returned from an upper page)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onReady`

```ts
onReady(cb: () => void): () => void
```

**Doc**: First frame rendered (once)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onHide`

```ts
onHide(cb: () => void): () => void
```

**Doc**: Page hidden (backgrounded, or covered by an upper page)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onUnload`

```ts
onUnload(cb: () => void): () => void
```

**Doc**: Page unloaded (left and destroyed)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onRouteDone`

```ts
onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void
```

**Doc**: Route animation finished (transition completed)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['route-done']) => void` | Yes | — |

**Returns**: `() => void`

### `onPullDownRefresh`

```ts
onPullDownRefresh(cb: () => void): () => void
```

**Doc**: Pull-to-refresh (user pulls the page down)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onReachBottom`

```ts
onReachBottom(cb: () => void): () => void
```

**Doc**: Scrolled to bottom (useful for load-more)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | — |

**Returns**: `() => void`

### `onPageScroll`

```ts
onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void
```

**Doc**: Page scrolled (carries `scrollTop`)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['page-scroll']) => void` | Yes | — |

**Returns**: `() => void`

### `onResize`

```ts
onResize(cb: (e: PageEventPayloads['resize']) => void): () => void
```

**Doc**: Page size changed (rotation / split view / window resize)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['resize']) => void` | Yes | — |

**Returns**: `() => void`

### `onTabItemTap`

```ts
onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void
```

**Doc**: Tab bar item tapped (carries `index` / `pagePath`)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(e: PageEventPayloads['tab-item-tap']) => void` | Yes | — |

**Returns**: `() => void`

### `setShareAppMessageProvider`

```ts
setShareAppMessageProvider(fn: () => ShareContent): void
```

**Doc**: Share to a friend (**decision-type**: the registered provider return value is the share content)

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setShareTimelineProvider`

```ts
setShareTimelineProvider(fn: () => ShareContent): void
```

**Doc**: Share to timeline (**decision-type**)

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setAddToFavoritesProvider`

```ts
setAddToFavoritesProvider(fn: () => ShareContent): void
```

**Doc**: Favorite the page (**decision-type**)

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => ShareContent` | Yes | — |

**Returns**: `void`

### `setSaveExitStateProvider`

```ts
setSaveExitStateProvider(fn: () => Record<string, unknown>): void
```

**Doc**: Save exit state (**decision-type**: the provider returns the state object to persist)

| Param | Type | Required | Doc |
|---|---|---|---|
| `fn` | `() => Record<string, unknown>` | Yes | — |

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