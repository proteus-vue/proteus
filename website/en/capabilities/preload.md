---
title: usePreload (capability.preload)
group: 应用与生命周期
order: 7009
---

# usePreload

**What it does**: Preload assets or pages ahead of time.

**When to use it**: Faster first paint, preloading the next page.

> 技术标识：能力原语 C67 · `capability.preload` · 返回 `PreloadAPI` · **Hook implemented** (per-end support in the table below)

usePreload: preload handle — assets (font/image) / skyline view / webview / subpackage pre-download with progress (wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage; web has no standard → Err, use <link rel=preload>)

## Signature

```ts
usePreload(): CapResult<PreloadAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `PreloadAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`assets`](#assets) | — |
| [`skylineView`](#skylineview) | — |
| [`webview`](#webview) | — |
| [`subpackage`](#subpackage) | — |

### `assets`

```ts
assets(data: PreloadAsset[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `data` | `PreloadAsset[]` | Yes | 资源列表 |

**Returns**: `Promise<CapResult<void>>`

### `skylineView`

```ts
skylineView(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `webview`

```ts
webview(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `subpackage`

```ts
subpackage(packageType: string): Promise<CapResult<PreDownloadTask>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `packageType` | `string` | Yes | 分包类型（'workers'） |

**Returns**: `Promise<CapResult<PreDownloadTask>>`

## Referenced types

### `PreloadAsset`

预加载资源项（wx.preloadAssets——字体/图片）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `src` | `string` | — | 资源地址 |
| `type` | `'font' \| 'image'` | — | 资源类型（font 字体 / image 图片） |

### `PreDownloadTask`

分包预下载任务句柄（wx.preDownloadSubpackage 返回）

| Method | Signature | Doc |
|---|---|---|
| `onProgressUpdate` | `onProgressUpdate(cb: (res: { progress: number; totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void): () => void` | 订阅下载进度。 |

## Error codes

| code | Doc |
|---|---|
| `preload.unsupported` | The preload API is missing (web has no standard preload API — use <link rel=preload> or dynamic import) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge getPreload is a pure shell (every path returns unsupported, no platform integration) → always Err |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `PreloadAPI`

★权威标尺缺口 C67：预加载（wx.preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage）。
「用空间换时间」——提前拉取资源 / 视图 / 分包，降低首屏与页面切换等待。
web：无标准预加载 API（可用 `<link rel=preload>` 或动态 import 替代）→ 各方法 Err 诚实降级。

| Prop/Method | Type | Doc |
|---|---|---|
| `assets` | `assets(data: PreloadAsset[]): Promise<CapResult<void>>` | 预加载资源（字体 / 图片）。 |
| `skylineView` | `skylineView(): Promise<CapResult<void>>` | 预加载 Skyline 视图（配合 Skyline 渲染器的页面预载） |
| `webview` | `webview(): Promise<CapResult<void>>` | 预加载 WebView 页面 |
| `subpackage` | `subpackage(packageType: string): Promise<CapResult<PreDownloadTask>>` | 预下载分包（目前仅 workers 分包）。 |

### `PreloadAsset`

预加载资源项（wx.preloadAssets——字体/图片）

| Prop/Method | Type | Doc |
|---|---|---|
| `src` | `string` | 资源地址 |
| `type` | `'font' \| 'image'` | 资源类型（font 字体 / image 图片） |

### `PreDownloadTask`

分包预下载任务句柄（wx.preDownloadSubpackage 返回）

| Prop/Method | Type | Doc |
|---|---|---|
| `onProgressUpdate` | `onProgressUpdate(cb: (res: { progress: number; totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void): () => void` | 订阅下载进度。 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const pre = usePreload() // synchronous handle — no await, no res.ok

if (pre.ok) {
  await pre.data.assets([{ src: "/assets/title.woff", type: "font" }])
  await pre.data.subpackage("workers") // prefetch the workers subpackage
  // await pre.data.skylineView() / await pre.data.webview()
} else if (pre.error.code === 'preload.unsupported') {
  // no standard preload on Web → degradation path (<link rel=preload>)
}
```

## Platform notes

### Mini Program (MP)

- **wx.preload* family** — preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage — each warms a different resource kind

### Web

- **link rel=preload** — The Web has no unified preload API — use `<link rel=preload>` or dynamic import (this bridge honestly errors and points to the alternatives)

### App (iOS / Android / Harmony)

- **Shell pre-initialized modules** — App preloading means the shell initializing native modules/fonts/resources ahead of time (moving first-use cost off the first screen) · Planned: Available once the shell implements `preload.assets`

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->