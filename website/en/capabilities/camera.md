---
title: useCamera (capability.camera)
group: 媒体与扫码
order: 4001
---

# useCamera

useCamera: camera access (wx.authorize / web getUserMedia)

> Capability primitive C1 · `capability.camera` · returns `Result<Media>` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useCamera(): Promise<CapResult<MediaAccess>>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `MediaAccess` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `kind` | `'camera' \| 'microphone'` | Yes | Media device type |
| `supported` | `boolean` | Yes | Platform capability/device is present |
| `granted` | `boolean` | Yes | User has granted access |

## Error codes

| code | Doc |
|---|---|
| `camera.unsupported` | The bridge does not provide getCamera (useCamera unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createCameraContext |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Extension interfaces

Beyond the primary hook `useCamera`, this capability also exposes these operation interfaces:

### `useCameraContext`

```ts
useCameraContext(id: string): CapResult<CameraController>
```

#### `CameraController` methods

| Method | Signature | Doc |
|---|---|---|
| `takePhoto` | `takePhoto(quality?: 'high' \| 'normal' \| 'low'): Promise<CapResult<PhotoResult>>` | 拍照。 |
| `startRecord` | `startRecord(): Promise<CapResult<void>>` | 开始录像（与 stopRecord 配对；超时可用 WxCameraContextLike.timeoutCallback 回调，超出本控制器范围） |
| `stopRecord` | `stopRecord(): Promise<CapResult<VideoResult>>` | 停止录像并返回视频临时路径 / 缩略图 / 时长 / 大小 |
| `setZoom` | `setZoom(zoom: number): Promise<CapResult<void>>` | 设置缩放级别。 |
| `onCameraFrame` | `onCameraFrame(cb: (data: { data: ArrayBuffer; width: number; height: number }) => void): () => void` | 订阅相机实时帧。 |

#### `takePhoto`

```ts
takePhoto(quality?: 'high' | 'normal' | 'low'): Promise<CapResult<PhotoResult>>
```

**Doc**: 拍照。

| Param | Type | Required | Doc |
|---|---|---|---|
| `quality` | `'high' \| 'normal' \| 'low'` | No | 画质（high 高清 / normal 普通 / low 低清；缺省 normal） |

**Returns**: `Promise<CapResult<PhotoResult>>` -- 照片临时路径 + 宽高

#### `startRecord`

```ts
startRecord(): Promise<CapResult<void>>
```

**Doc**: 开始录像（与 stopRecord 配对；超时可用 WxCameraContextLike.timeoutCallback 回调，超出本控制器范围）

**Returns**: `Promise<CapResult<void>>`

#### `stopRecord`

```ts
stopRecord(): Promise<CapResult<VideoResult>>
```

**Doc**: 停止录像并返回视频临时路径 / 缩略图 / 时长 / 大小

**Returns**: `Promise<CapResult<VideoResult>>`

#### `setZoom`

```ts
setZoom(zoom: number): Promise<CapResult<void>>
```

**Doc**: 设置缩放级别。

| Param | Type | Required | Doc |
|---|---|---|---|
| `zoom` | `number` | Yes | 缩放倍数（1 为原始） |

**Returns**: `Promise<CapResult<void>>`

#### `onCameraFrame`

```ts
onCameraFrame(cb: (data: { data: ArrayBuffer; width: number; height: number }) => void): () => void
```

**Doc**: 订阅相机实时帧。

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(data: { data: ArrayBuffer; width: number; height: number }) => void` | Yes | 每帧回调（data = RGBA 像素、width/height 帧尺寸） |

**Returns**: `() => void` -- 取消订阅函数（web 无对等 → 空订阅）

#### Referenced types

**`PhotoResult`** — 拍照结果（wx.takePhoto 子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `tempImagePath` | `string` | 照片临时文件路径 |
| `width` | `number` | 照片宽度（px） |
| `height` | `number` | 照片高度（px） |
| `dataUrl` | `string` | web dataURL（blob: / data:） |

**`VideoResult`** — 录像结果（wx.stopRecord 子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `tempThumbPath` | `string` | 视频封面缩略图路径 |
| `tempVideoPath` | `string` | 视频临时文件路径 |
| `duration` | `number` | 视频时长（ms） |
| `size` | `number` | 视频大小（字节） |

## Usage

```ts
const res = await useCamera()

if (res.ok) {
  console.log('camera:', res.data.supported, 'granted:', res.data.granted)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->