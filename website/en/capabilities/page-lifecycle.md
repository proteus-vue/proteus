---
title: usePageLifecycle (capability.page-lifecycle)
group: 应用与生命周期
order: 7002
---

# usePageLifecycle

**What it does**: Observe page load/show/hide/unload.

**When to use it**: Fetching on enter, cleaning up on leave.

> 技术标识：能力原语 C24 · `capability.page-lifecycle` · 返回 `LifecycleHooks` · **Hook implemented** (per-end support in the table below)

usePageLifecycle: page lifecycle subscription handle (wx Page hooks / web load + visibilitychange)

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
- `onRouteDone`: MP `Page.onRouteDone (base library 2.32.1+)` · Web `transitionend (pushed by the router layer)` · App `Kairos transition finished` — Requires a recent base library; older versions generate the hook but never fire (honest degradation)
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

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `phase` | `PageLifecyclePhase` | Yes | — |

## Referenced types

### `PageEventPayloads`

页面级事件载荷（按事件类型区分——订阅方按事件取用；未列出的端不产生该载荷）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `resize` | `{ size: { windowWidth: number; windowHeight: number } }` | — | — |

### `ShareContent`

分享内容（决策型事件的返回值——微信 `onShareAppMessage` 语义）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `title` | `string` | — | — |
| `path` | `string` | — | — |
| `imageUrl` | `string` | — | — |
| `query` | `string` | — | — |

### `PageLifecyclePhase`

页面阶段（与 C24 `PageLifecycle.phase` 同值域）

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
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · device-verified on both ends (check:host-runtime) |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `PageLifecycle`

★★C24 页面生命周期句柄（**扩展为完整事件面**——2026-09-30）。

【类型收口】定义在 `capability-app.ts` 的 `PageLifecycleHandle`，此处仅别名导出。
覆盖 15 个页面事件（`PAGE_EVENTS`）：阶段事件（load/show/ready/hide/unload）+
页面事件（route-done/pull-down-refresh/reach-bottom/page-scroll/resize/tab-item-tap）+
决策型（share-app-message/share-timeline/add-to-favorites/save-exit-state——单处理器）。

| Prop/Method | Type | Doc |
|---|---|---|
| `phase` | `PageLifecyclePhase` | — |

| Prop/Method | Type | Doc |
|---|---|---|
| `onLoad` | `onLoad(cb: () => void): () => void` | — |
| `onShow` | `onShow(cb: () => void): () => void` | — |
| `onReady` | `onReady(cb: () => void): () => void` | — |
| `onHide` | `onHide(cb: () => void): () => void` | — |
| `onUnload` | `onUnload(cb: () => void): () => void` | — |
| `onRouteDone` | `onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void` | 路由动画完成（MP `onRouteDone` / App 转场结束 / Web transitionend） |
| `onPullDownRefresh` | `onPullDownRefresh(cb: () => void): () => void` | 下拉刷新（MP `onPullDownRefresh` / App 宿主手势；★Web 无原生——诚实不触发） |
| `onReachBottom` | `onReachBottom(cb: () => void): () => void` | 触底（MP `onReachBottom` / Web 滚动到底 / App 滚动到底） |
| `onPageScroll` | `onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void` | 页面滚动（★**高频**：微信文档明确会引起两线程通信 ⇒ MP 端仅"声明过 onPageScroll"才派发） |
| `onResize` | `onResize(cb: (e: PageEventPayloads['resize']) => void): () => void` | 尺寸变化（MP `onResize` / Web resize / App 旋转分屏） |
| `onTabItemTap` | `onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void` | tab 点击（MP `onTabItemTap` / App tab 栏） |
| `setShareAppMessageProvider` | `setShareAppMessageProvider(fn: () => ShareContent): void` | 转发给好友（返回分享内容；MP 端声明后右上角出现"转发"入口） |
| `setShareTimelineProvider` | `setShareTimelineProvider(fn: () => ShareContent): void` | 分享到朋友圈（同上；声明后才显示入口） |
| `setAddToFavoritesProvider` | `setAddToFavoritesProvider(fn: () => ShareContent): void` | 收藏（同上） |
| `setSaveExitStateProvider` | `setSaveExitStateProvider(fn: () => Record<string, unknown>): void` | 保存退出状态（MP `onSaveExitState`——返回需保存的状态对象） |

### `PageEventPayloads`

页面级事件载荷（按事件类型区分——订阅方按事件取用；未列出的端不产生该载荷）

| Prop/Method | Type | Doc |
|---|---|---|
| `resize` | `{ size: { windowWidth: number; windowHeight: number } }` | — |

### `ShareContent`

分享内容（决策型事件的返回值——微信 `onShareAppMessage` 语义）

| Prop/Method | Type | Doc |
|---|---|---|
| `title` | `string` | — |
| `path` | `string` | — |
| `imageUrl` | `string` | — |
| `query` | `string` | — |

### `PageLifecyclePhase`

页面阶段（与 C24 `PageLifecycle.phase` 同值域）

| 取值 | 说明 |
|---|---|
| `'IDLE'` | — |
| `'LOAD'` | — |
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
const page = usePageLifecycle() // synchronous handle — no await, no res.ok

console.log('page phase:', page.phase)
const off = page.onShow(() => console.log('page visible'))
// page.onLoad(...) / page.onHide(...); off() unsubscribes
```

## Platform notes

### Mini Program (MP)

- **Page stack & tab semantics** — Up to a 10-page stack; switchTab destroys non-tab pages while keeping other tabs alive (no re-init on return) — semantics Web/App lack
- **Pull-down refresh & reach-bottom** — ★Requires enablePullDownRefresh in page.json; onReachBottomDistance controls the bottom threshold (Web has no native equivalent)
- **onRouteDone (transition finished)** — Base library 2.32.1+: the moment a custom transition actually finishes (not when the call returns)
- **High-frequency onPageScroll** — WeChat docs state this causes logical/render layer IPC — the framework dispatches it **only when you declared onPageScroll**

### Web

- **No native pull-to-refresh / no page stack** — No pull-to-refresh or page stack in browsers — `onPullDownRefresh` never fires (honest degradation); back navigation comes from history · Planned: Page-stack semantics (push/pop/popTo) belong to the router layer, not rebuilt here
- **beforeunload semantics** — The return value drives **leave confirmation** (browsers do not persist state) — unlike Mini Program onSaveExitState which saves state
- **Scroll is rAF-throttled** — Browser scroll fires far more often than Mini Programs — the framework coalesces bursts into one dispatch per rAF

### App (iOS / Android / Harmony)

- **Visibility driven by the virtual stack** — Page show/hide comes from virtual-stack enter/exit commands (not native Fragment/VC callbacks) — the G-39 + M5 combination
- **Transition completion via Kairos** — route-done fires when the kernel transition animation finishes (platform-zero path) — same semantics as Mini Program onRouteDone

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->