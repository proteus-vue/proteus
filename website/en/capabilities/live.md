---
title: useLive (capability.live)
group: 媒体与扫码
order: 4004
---

# useLive

**What it does**: Embed a live room for watching and interaction.

**When to use it**: Livestream commerce, event viewing.

**End support & boundaries**: Only mini programs provide a live component; App ends must integrate a third-party live SDK.

> 技术标识：能力原语 C49 · `capability.live` · 返回 `LiveRoom` · **Hook implemented** (per-end support in the table below)

useLive: live room (wx live component form / host bridge — Err by default)

## Signature

```ts
useLive(options: LiveRoomOptions): Promise<CapResult<LiveRoomHandle>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `options` | `LiveRoomOptions` | Yes | C49 live room (wx live component form / host bridge — Err by default) |

#### Properties of `options`

| Property | Type | Required | Doc |
|---|---|---|---|
| `roomId` | `string` | Yes | Live room ID |
| `mode` | `'video' \| 'audio'` | No | Stream mode |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `LiveRoomHandle` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`play`](#play) | — |
| [`pause`](#pause) | — |
| [`resume`](#resume) | — |
| [`stop`](#stop) | — |
| [`mute`](#mute) | — |
| [`snapshot`](#snapshot) | — |
| [`requestFullScreen`](#requestfullscreen) | — |
| [`exitFullScreen`](#exitfullscreen) | — |
| [`status`](#status) | — |
| [`onStateChange`](#onstatechange) | — |
| [`leave`](#leave) | — |

### `play`

```ts
play(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `pause`

```ts
pause(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `resume`

```ts
resume(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `mute`

```ts
mute(): void
```

**Returns**: `void`

### `snapshot`

```ts
snapshot(): Promise<CapResult<string>>
```

**Returns**: `Promise<CapResult<string>>`

### `requestFullScreen`

```ts
requestFullScreen(direction?: number): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `direction` | `number` | No | — |

**Returns**: `Promise<CapResult<void>>`

### `exitFullScreen`

```ts
exitFullScreen(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `status`

```ts
status(): LivePlayState
```

**Returns**: `LivePlayState`

### `onStateChange`

```ts
onStateChange(cb: (state: LivePlayState) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(state: LivePlayState) => void` | Yes | — |

**Returns**: `() => void`

### `leave`

```ts
leave(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

## Referenced types

### `LivePlayState`

直播播放状态（LivePlayerContext.onXxx 归一）

## Error codes

| code | Doc |
|---|---|
| `live.unsupported` | The bridge does not provide joinLiveRoom (useLive unavailable) |
| `live.failed` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge joinLiveRoom is a pure shell (every path returns unsupported, no platform integration) → always Err |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → (wx-native equivalent; exact mapping in the zh version) |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `LiveRoomOptions`

C49 直播房间（wx live 组件形态/宿主桥——缺省 Err）

| Prop/Method | Type | Doc |
|---|---|---|
| `roomId` | `string` | 直播间 ID（同时作为 `<live-player id>` 组件 id——wx.createLivePlayerContext(roomId)） |
| `mode` | `'video' \| 'audio'` | 拉流模式 |

### `LiveRoomHandle`

★能力颗粒度对齐：C49 直播房间操作句柄（原仅 leave/status → 播放控制全套）
观看端（LivePlayerContext）；推流端（LivePusherContext：美颜/连麦/推流）为诚实边界（需推流类目，未纳入）。
注：live-player 组件需在页面声明 + 直播类目资质；Web 无对等 → Err。

| Prop/Method | Type | Doc |
|---|---|---|
| `play` | `play(): Promise<CapResult<void>>` | 开始播放 |
| `pause` | `pause(): Promise<CapResult<void>>` | 暂停播放 |
| `resume` | `resume(): Promise<CapResult<void>>` | 从暂停处恢复播放 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止播放 |
| `mute` | `mute(): void` | 静音切换（同步，无 Promise） |
| `snapshot` | `snapshot(): Promise<CapResult<string>>` | 截图（返回临时文件路径） |
| `requestFullScreen` | `requestFullScreen(direction?: number): Promise<CapResult<void>>` | 请求全屏（direction 0 竖屏 / 90 横屏；缺省不变） |
| `exitFullScreen` | `exitFullScreen(): Promise<CapResult<void>>` | 退出全屏 |
| `status` | `status(): LivePlayState` | 当前播放状态 |
| `onStateChange` | `onStateChange(cb: (state: LivePlayState) => void): () => void` | 订阅播放状态变化（返回取消） |
| `leave` | `leave(): Promise<CapResult<void>>` | 离开直播间（= stop 的语义别名） |

### `LivePlayState`

直播播放状态（LivePlayerContext.onXxx 归一）

| 取值 | 说明 |
|---|---|
| `'playing'` | — |
| `'paused'` | — |
| `'stopped'` | — |
| `'error'` | — |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const res = await useLive({ roomId: 'room-42', mode: 'video' })

if (res.ok) {
  console.log('room status:', res.data.status())
  // await res.data.leave() exits the room
} else if (res.error.code.endsWith('.unsupported')) {
  // live streaming requires a host bridge → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->