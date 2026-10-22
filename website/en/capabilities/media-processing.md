---
title: useMediaProcessing (capability.media-processing)
group: 媒体与扫码
order: 4011
---

# useMediaProcessing

**What it does**: Mux media files, decode video and process audio/video tracks.

**When to use it**: Re-muxing, frame extraction.

> 技术标识：能力原语 C70 · `capability.media-processing` · 返回 `MediaProcessingAPI` · **Hook implemented** (per-end support in the table below)

useMediaProcessing: advanced media — MediaContainer (track compose/export) / VideoDecoder (frame grabbing) / MediaAudioPlayer (multi-source mixing) (wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer; web has no standard compose → container/audioPlayer throw, VideoDecoder uses WebCodecs)

## Signature

```ts
useMediaProcessing(): CapResult<MediaProcessingAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `MediaProcessingAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`container`](#container) | — |
| [`videoDecoder`](#videodecoder) | — |
| [`audioPlayer`](#audioplayer) | — |

### `container`

```ts
container(): MediaContainerHandle
```

**Returns**: `MediaContainerHandle`

### `videoDecoder`

```ts
videoDecoder(): VideoDecoderHandle
```

**Returns**: `VideoDecoderHandle`

### `audioPlayer`

```ts
audioPlayer(): MediaAudioPlayerHandle
```

**Returns**: `MediaAudioPlayerHandle`

## Referenced types

### `MediaContainerHandle`

| Method | Signature | Doc |
|---|---|---|
| `addTrack` | `addTrack(track: MediaTrackInfo): Promise<CapResult<void>>` | 添加音视频轨道。 |
| `removeTrack` | `removeTrack(track: MediaTrackInfo): Promise<CapResult<void>>` | 移除轨道。 |
| `extractDataSource` | `extractDataSource(src: string): Promise<CapResult<MediaTrackInfo[]>>` | 分离视频源为轨道（不自动加入容器）。 |
| `export` | `export(): Promise<CapResult<string>>` | 合成并导出视频。 |
| `destroy` | `destroy(): void` | 销毁容器（释放资源） |

### `VideoDecoderHandle`

| Method | Signature | Doc |
|---|---|---|
| `start` | `start(options: { source: string; mode?: number; abortAudio?: boolean }): Promise<CapResult<void>>` | 开始解码。 |
| `getFrameData` | `getFrameData(): Promise<CapResult<{ data: ArrayBuffer; width?: number; height?: number }>>` | 解码下一帧（返回帧数据） |
| `seek` | `seek(position: number): Promise<CapResult<void>>` | 跳转到指定时间。 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止解码（释放） |

### `MediaAudioPlayerHandle`

| Method | Signature | Doc |
|---|---|---|
| `addAudioSource` | `addAudioSource(src: string, startTime?: number): Promise<CapResult<void>>` | 添加音源。 |
| `removeAudioSource` | `removeAudioSource(src: string): Promise<CapResult<void>>` | 移除音源。 |
| `start` | `start(): Promise<CapResult<void>>` | 开始混音播放 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止播放 |
| `destroy` | `destroy(): void` | 销毁（释放） |

### `MediaTrackInfo`

★权威标尺缺口 C70：媒体高级（wx.createMediaContainer / createVideoDecoder / createMediaAudioPlayer）。
MediaContainer 视频轨道合成 / VideoDecoder 视频解码取帧 / MediaAudioPlayer 多音源混音。
wx 侧真实接入；web：MediaContainer/MediaAudioPlayer 无标准 → Err（可用 WebCodecs 之 VideoDecoder
做尽力承接），VideoDecoder 有 WebCodecs 标准 → 承接。

| Prop | Type | Default | Doc |
|---|---|---|---|
| `kind` | `'audio' \| 'video'` | — | 轨道类型 |
| `src` | `string` | — | 源地址 |
| `startTime` | `number` | — | 轨道起点（秒，可选） |

## Error codes

| code | Doc |
|---|---|
| `media-processing.unsupported` | The media-processing API is missing (web has no standard compose/mixer; VideoDecoder needs WebCodecs + EncodedVideoChunk) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createMediaContainer/createVideoDecoder/createMediaAudioPlayer |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `MediaProcessingAPI`

★权威标尺缺口 C70：媒体处理句柄（`useMediaProcessing()`）。

| Prop/Method | Type | Doc |
|---|---|---|
| `container` | `container(): MediaContainerHandle` | 创建视频轨道合成容器 |
| `videoDecoder` | `videoDecoder(): VideoDecoderHandle` | 创建视频解码器（取帧） |
| `audioPlayer` | `audioPlayer(): MediaAudioPlayerHandle` | 创建多音源混音播放器 |

### `MediaContainerHandle`

| Prop/Method | Type | Doc |
|---|---|---|
| `addTrack` | `addTrack(track: MediaTrackInfo): Promise<CapResult<void>>` | 添加音视频轨道。 |
| `removeTrack` | `removeTrack(track: MediaTrackInfo): Promise<CapResult<void>>` | 移除轨道。 |
| `extractDataSource` | `extractDataSource(src: string): Promise<CapResult<MediaTrackInfo[]>>` | 分离视频源为轨道（不自动加入容器）。 |
| `export` | `export(): Promise<CapResult<string>>` | 合成并导出视频。 |
| `destroy` | `destroy(): void` | 销毁容器（释放资源） |

### `VideoDecoderHandle`

| Prop/Method | Type | Doc |
|---|---|---|
| `start` | `start(options: { source: string; mode?: number; abortAudio?: boolean }): Promise<CapResult<void>>` | 开始解码。 |
| `getFrameData` | `getFrameData(): Promise<CapResult<{ data: ArrayBuffer; width?: number; height?: number }>>` | 解码下一帧（返回帧数据） |
| `seek` | `seek(position: number): Promise<CapResult<void>>` | 跳转到指定时间。 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止解码（释放） |

### `MediaAudioPlayerHandle`

| Prop/Method | Type | Doc |
|---|---|---|
| `addAudioSource` | `addAudioSource(src: string, startTime?: number): Promise<CapResult<void>>` | 添加音源。 |
| `removeAudioSource` | `removeAudioSource(src: string): Promise<CapResult<void>>` | 移除音源。 |
| `start` | `start(): Promise<CapResult<void>>` | 开始混音播放 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止播放 |
| `destroy` | `destroy(): void` | 销毁（释放） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const mp = useMediaProcessing() // synchronous handle — no await, no res.ok

if (mp.ok) {
  const c = mp.data.container()
  await c.addTrack({ kind: 'video', src: 'a.mp4' })
  const out = await c.export() // mux and export video
  const d = mp.data.videoDecoder()
  await d.start({ source: 'a.mp4' })
  const frame = await d.getFrameData() // grab a frame
} else if (mp.error.code === 'media-processing.unsupported') {
  // no standard media muxing on Web → degradation path (compose with WebCodecs)
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->