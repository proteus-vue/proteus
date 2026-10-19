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
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.preloadAssets/preloadSkylineView/preloadWebview/preDownloadSubpackage |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const preload = usePreload()   // synchronous handle — no await, no res.ok on the handle itself

if (!preload.ok) {
  // preload.error.code tells you why (e.g. *.unsupported → this end cannot do it)
} else {
  // call its methods — THOSE return Promise<CapResult<T>>:
  //   const r = await preload.data.<method>()
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