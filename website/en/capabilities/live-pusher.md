---
title: useLivePusher (capability.live-pusher)
group: 媒体与扫码
order: 4009
---

# useLivePusher

**What it does**: Push camera video to a live-streaming service.

**When to use it**: Merchant or event live streaming.

> 技术标识：能力原语 C63 · `capability.live-pusher` · 返回 `LivePusherController` · **Hook implemented** (per-end support in the table below)

useLivePusher: live-stream pusher instance — start/stop/pause/resume/switchCamera/toggleTorch/snapshot/SEI + events (wx.createLivePusherContext; web has no standard → Err)

## Signature

```ts
useLivePusher(id: string): CapResult<LivePusherController>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `id` | `string` | Yes | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `LivePusherController` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`start`](#start) | — |
| [`stop`](#stop) | — |
| [`pause`](#pause) | — |
| [`resume`](#resume) | — |
| [`switchCamera`](#switchcamera) | — |
| [`toggleTorch`](#toggletorch) | — |
| [`snapshot`](#snapshot) | — |
| [`sendMessage`](#sendmessage) | — |
| [`on`](#on) | — |

### `start`

```ts
start(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `stop`

```ts
stop(): Promise<CapResult<void>>
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

### `switchCamera`

```ts
switchCamera(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `toggleTorch`

```ts
toggleTorch(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `snapshot`

```ts
snapshot(): Promise<CapResult<string>>
```

**Returns**: `Promise<CapResult<string>>`

### `sendMessage`

```ts
sendMessage(msg: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `msg` | `string` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

### `on`

```ts
on(event: 'statechange' | 'netstatus' | 'error', cb: (payload: unknown) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `event` | `'statechange' \| 'netstatus' \| 'error'` | Yes | 事件名 |
| `cb` | `(payload: unknown) => void` | Yes | 事件处理器 |

**Returns**: `() => void` -- 取消订阅函数

## Error codes

| code | Doc |
|---|---|
| `live-pusher.unsupported` | wx.createLivePusherContext is missing (web has no standard push API — needs a host bridge) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge createLivePusher is a pure shell (every path returns unsupported, no platform integration) → always Err |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createLivePusherContext |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const pusher = useLivePusher('livePusher') // synchronous handle — no await, no res.ok

if (pusher.ok) {
  await pusher.data.start() // start pushing
  await pusher.data.switchCamera() // front/rear camera
  const shot = await pusher.data.snapshot() // snapshot
  pusher.data.on('netstatus', (s) => console.log('network:', s))
} else if (pusher.error.code === 'live-pusher.unsupported') {
  // no standard push API on Web → degradation path (host bridge)
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->