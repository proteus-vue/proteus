---
title: useAlbum (capability.album)
group: 媒体与扫码
order: 4005
---

# useAlbum

**What it does**: Pick images/videos from the album, or save images to it.

**When to use it**: Avatar upload, sharing photos, saving generated images.

> 技术标识：能力原语 C52 · `capability.album` · 返回 `AlbumAPI` · **Hook implemented** (per-end support in the table below)

useAlbum: album handle — pick media + save to the system album + preview (wx.chooseMedia/saveImageToPhotosAlbum/previewMedia; web <input type=file>)

## Signature

```ts
useAlbum(): CapResult<AlbumAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `AlbumAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`pick`](#pick) | — |
| [`saveImage`](#saveimage) | — |
| [`saveVideo`](#savevideo) | — |
| [`preview`](#preview) | — |

### `pick`

```ts
pick(options?: AlbumPickOptions): Promise<CapResult<MediaFile[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `AlbumPickOptions` | No | — |

**Returns**: `Promise<CapResult<MediaFile[]>>`

### `saveImage`

```ts
saveImage(filePath: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `filePath` | `string` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

### `saveVideo`

```ts
saveVideo(filePath: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `filePath` | `string` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

### `preview`

```ts
preview(urls: string[], current?: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `urls` | `string[]` | Yes | — |
| `current` | `string` | No | — |

**Returns**: `Promise<CapResult<void>>`

## Referenced types

### `AlbumPickOptions`

| Prop | Type | Default | Doc |
|---|---|---|---|
| `count` | `number` | `1` | 选择数量上限（默认 1；小程序上限 9） |
| `mediaType` | `'image' \| 'video' \| 'all'` | — | 媒体类型：image（默认）/ video / all |
| `source` | `'album' \| 'camera'` | — | 来源：album 相册（默认）/ camera 拍照 |

### `MediaFile`

★颗粒度对齐 C3：C52 相册（wx.chooseMedia / saveImageToPhotosAlbum / previewImage）
选择媒体 + 保存到系统相册 + 预览——对齐小程序媒体类 API 组。
Web 端：pick 走 <input type=file>（需宿主/用户手势），save 无标准（下载替代）∪ 缺省 Err（诚实降级）。

| Prop | Type | Default | Doc |
|---|---|---|---|
| `tempFilePath` | `string` | — | 临时文件路径（wx 临时文件 / web Blob URL） |
| `type` | `'image' \| 'video'` | — | 媒体类型 |
| `size` | `number` | — | 字节大小 |
| `duration` | `number` | — | 时长 ms（视频） |
| `width` | `number` | — | — |
| `height` | `number` | — | — |

## Error codes

| code | Doc |
|---|---|
| `album.unsupported` | wx.chooseMedia / saveImageToPhotosAlbum is missing (or Web has no standard album write API) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.chooseMedia/saveImageToPhotosAlbum/previewMedia |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `AlbumAPI`

| Prop/Method | Type | Doc |
|---|---|---|
| `pick` | `pick(options?: AlbumPickOptions): Promise<CapResult<MediaFile[]>>` | 选择图片/视频（wx.chooseMedia；web <input type=file>） |
| `saveImage` | `saveImage(filePath: string): Promise<CapResult<void>>` | 保存图片到系统相册（wx.saveImageToPhotosAlbum——需 scope.writePhotosAlbum 授权；web 无标准 → Err） |
| `saveVideo` | `saveVideo(filePath: string): Promise<CapResult<void>>` | 保存视频到系统相册（wx.saveVideoToPhotosAlbum；web 无标准 → Err） |
| `preview` | `preview(urls: string[], current?: string): Promise<CapResult<void>>` | 预览媒体（wx.previewImage / previewMedia；web 宿主视图） |

### `AlbumPickOptions`

| Prop/Method | Type | Doc |
|---|---|---|
| `count` | `number` | 选择数量上限（默认 1；小程序上限 9） |
| `mediaType` | `'image' \| 'video' \| 'all'` | 媒体类型：image（默认）/ video / all |
| `source` | `'album' \| 'camera'` | 来源：album 相册（默认）/ camera 拍照 |

### `MediaFile`

★颗粒度对齐 C3：C52 相册（wx.chooseMedia / saveImageToPhotosAlbum / previewImage）
选择媒体 + 保存到系统相册 + 预览——对齐小程序媒体类 API 组。
Web 端：pick 走 <input type=file>（需宿主/用户手势），save 无标准（下载替代）∪ 缺省 Err（诚实降级）。

| Prop/Method | Type | Doc |
|---|---|---|
| `tempFilePath` | `string` | 临时文件路径（wx 临时文件 / web Blob URL） |
| `type` | `'image' \| 'video'` | 媒体类型 |
| `size` | `number` | 字节大小 |
| `duration` | `number` | 时长 ms（视频） |
| `width` | `number` | — |
| `height` | `number` | — |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const album = useAlbum()   // synchronous handle — no await, no res.ok on the handle itself

if (!album.ok) {
  // album.error.code tells you why (e.g. *.unsupported → this end cannot do it)
} else {
  // call its methods — THOSE return Promise<CapResult<T>>:
  //   const r = await album.data.<method>()
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->