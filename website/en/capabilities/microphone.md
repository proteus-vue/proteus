---
title: useMicrophone (capability.microphone)
group: 媒体与扫码
order: 4002
---

# useMicrophone

useMicrophone: microphone access (wx.authorize / web getUserMedia)

> Capability primitive C2 · `capability.microphone` · returns `Result<AudioBuffer>` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useMicrophone(): Promise<CapResult<MediaAccess>>
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
| `microphone.unsupported` | The bridge does not provide getMicrophone (useMicrophone unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → RecorderManager |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Extension interfaces

Beyond the primary hook `useMicrophone`, this capability also exposes these operation interfaces:

### `useRecorder`

```ts
useRecorder(): CapResult<RecorderController>
```

#### `RecorderController` methods

| Method | Signature | Doc |
|---|---|---|
| `start` | `start(options?: RecordOptions): Promise<CapResult<void>>` | 开始录音。 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止录音（结果经 on('stop') 回调返回） |
| `pause` | `pause(): Promise<CapResult<void>>` | 暂停录音（可从当前位置 resume） |
| `resume` | `resume(): Promise<CapResult<void>>` | 恢复录音 |
| `on` | `on(event: 'start' \| 'stop' \| 'pause' \| 'resume' \| 'error', cb: (payload: unknown) => void): () => void` | 订阅录音生命周期事件。 |
| `onFrameRecorded` | `onFrameRecorded(cb: (frame: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void): () => void` | 订阅录音帧（录 per-frame 数据，用于实时波形/编码）。 |

#### `start`

```ts
start(options?: RecordOptions): Promise<CapResult<void>>
```

**Doc**: 开始录音。

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `RecordOptions` | No | 录音参数（时长/采样率/声道/码率/格式） |

**Returns**: `Promise<CapResult<void>>`

#### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**Doc**: 停止录音（结果经 on('stop') 回调返回）

**Returns**: `Promise<CapResult<void>>`

#### `pause`

```ts
pause(): Promise<CapResult<void>>
```

**Doc**: 暂停录音（可从当前位置 resume）

**Returns**: `Promise<CapResult<void>>`

#### `resume`

```ts
resume(): Promise<CapResult<void>>
```

**Doc**: 恢复录音

**Returns**: `Promise<CapResult<void>>`

#### `on`

```ts
on(event: 'start' | 'stop' | 'pause' | 'resume' | 'error', cb: (payload: unknown) => void): () => void
```

**Doc**: 订阅录音生命周期事件。

| Param | Type | Required | Doc |
|---|---|---|---|
| `event` | `'start' \| 'stop' \| 'pause' \| 'resume' \| 'error'` | Yes | 事件名（start / stop / pause / resume / error） |
| `cb` | `(payload: unknown) => void` | Yes | 事件处理器（stop 携带录音结果） |

**Returns**: `() => void` -- 取消订阅函数

#### `onFrameRecorded`

```ts
onFrameRecorded(cb: (frame: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void): () => void
```

**Doc**: 订阅录音帧（录 per-frame 数据，用于实时波形/编码）。

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(frame: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void` | Yes | 帧回调（frameBuffer 帧数据、isLastFrame 是否末帧） |

**Returns**: `() => void` -- 取消订阅函数

#### Referenced types

**`RecordOptions`** — 录音状态（wx RecorderManager onStart/onStop 等）

| Prop/Method | Type | Doc |
|---|---|---|
| `duration` | `number` | 录音时长（ms；到时自动停止） |
| `sampleRate` | `number` | 采样率（Hz，如 44100） |
| `numberOfChannels` | `number` | 声道数 |
| `encodeBitRate` | `number` | 编码码率（bps） |
| `format` | `'mp3' \| 'aac' \| 'wav' \| 'PCM'` | 音频格式 |

## Usage

```ts
const res = await useMicrophone()

if (res.ok) {
  console.log('microphone:', res.data.supported, 'granted:', res.data.granted)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->