---
title: useLive (capability.live)
group: 媒体与扫码
order: 4004
---

# useLive

useLive: live room (wx live component form / host bridge — Err by default)

> Capability primitive C49 · `capability.live` · returns `LiveRoom` · **Hook implemented** (API ready — target bridges in the table below)

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

#### Methods of `LiveRoomHandle`

| Method | Signature | Doc |
|---|---|---|
| `play` | `play(): Promise<CapResult<void>>` | — |
| `pause` | `pause(): Promise<CapResult<void>>` | — |
| `resume` | `resume(): Promise<CapResult<void>>` | — |
| `stop` | `stop(): Promise<CapResult<void>>` | — |
| `mute` | `mute(): void` | — |
| `snapshot` | `snapshot(): Promise<CapResult<string>>` | — |
| `requestFullScreen` | `requestFullScreen(direction?: number): Promise<CapResult<void>>` | — |
| `exitFullScreen` | `exitFullScreen(): Promise<CapResult<void>>` | — |
| `status` | `status(): LivePlayState` | — |
| `onStateChange` | `onStateChange(cb: (state: LivePlayState) => void): () => void` | — |
| `leave` | `leave(): Promise<CapResult<void>>` | — |

#### Method details

##### `play`

```ts
play(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `pause`

```ts
pause(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `resume`

```ts
resume(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `mute`

```ts
mute(): void
```

**Returns**: `void`

##### `snapshot`

```ts
snapshot(): Promise<CapResult<string>>
```

**Returns**: `Promise<CapResult<string>>`

##### `requestFullScreen`

```ts
requestFullScreen(direction?: number): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `direction` | `number` | No | — |

**Returns**: `Promise<CapResult<void>>`

##### `exitFullScreen`

```ts
exitFullScreen(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `status`

```ts
status(): LivePlayState
```

**Returns**: `LivePlayState`

##### `onStateChange`

```ts
onStateChange(cb: (state: LivePlayState) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(state: LivePlayState) => void` | Yes | — |

**Returns**: `() => void`

##### `leave`

```ts
leave(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

## Error codes

| code | Doc |
|---|---|
| `live.unsupported` | The bridge does not provide joinLiveRoom (useLive unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → (wx-native equivalent; exact mapping in the zh version) |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

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