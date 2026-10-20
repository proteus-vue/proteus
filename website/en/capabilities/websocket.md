---
title: useWebSocket (capability.websocket)
group: 网络与通信
order: 2
---

# useWebSocket

**What it does**: Open a persistent bidirectional connection to a server.

**When to use it**: Chat, real-time collaboration, market data.

**End support & boundaries**: **Available on four targets** (Web / WeChat / App-iOS / App-Android, both App ends device-verified); **not wired on HarmonyOS** (no ws channel in the host). One easy mistake: a successful `useWebSocket()` only means the **connection was accepted** — the `open` event is the proof it is connected (especially on App, where `ws.open` returns immediately instead of blocking the JS thread on the handshake). Send failures surface through the `error` event (`send` does not throw, matching the browser). The two App implementations differ because the platforms do: iOS uses the system `URLSessionWebSocketTask`; Android hand-writes RFC 6455 because the build has no dependency manager.

> 技术标识：能力原语 C27 · `capability.websocket` · 返回 `WSConnection` · **Hook implemented** (per-end support in the table below)

useWebSocket: WebSocket connection handle (wx.connectSocket / web WebSocket)

## Signature

```ts
useWebSocket(url: string, protocols?: string[]): Promise<CapResult<WebSocketConnection>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `url` | `string` | Yes | Target URL (HTTPS) |
| `protocols` | `string[]` | No | WebSocket subprotocols (optional) |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `WebSocketConnection` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`send`](#send) | Send a message (string or binary) |
| [`close`](#close) | Close the connection |
| [`on`](#on) | Subscribe to events (returns an unsubscribe function) — open/message/close/error |

### `send`

```ts
send(data: string | ArrayBuffer): void
```

**Doc**: Send a message (string or binary)

| Param | Type | Required | Doc |
|---|---|---|---|
| `data` | `string \| ArrayBuffer` | Yes | — |

**Returns**: `void`

### `close`

```ts
close(code?: number, reason?: string): void
```

**Doc**: Close the connection

| Param | Type | Required | Doc |
|---|---|---|---|
| `code` | `number` | No | — |
| `reason` | `string` | No | — |

**Returns**: `void`

### `on`

```ts
on(event: 'open' | 'message' | 'close' | 'error', handler: (payload?: unknown) => void): () => void
```

**Doc**: Subscribe to events (returns an unsubscribe function) — open/message/close/error

| Param | Type | Required | Doc |
|---|---|---|---|
| `event` | `'open' \| 'message' \| 'close' \| 'error'` | Yes | — |
| `handler` | `(payload?: unknown) => void` | No | — |

**Returns**: `() => void`

## Error codes

| code | Doc |
|---|---|
| `websocket.unsupported` | The bridge does not provide connectWebSocket (useWebSocket unavailable) |
| `websocket.failed` | WebSocket construction failed |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.connectSocket |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const res = await useWebSocket('wss://echo.example.com')

if (res.ok) {
  const ws = res.data // ★handle != connected: the open event proves the connection
  ws.on('open', () => ws.send('hello')) // send after open so the first frame is not lost
  ws.on('message', (payload) => console.log('received:', payload))
  ws.on('error', (e) => console.log('connection/send error:', e.message))
  ws.on('close', (c) => console.log('closed:', c.code, c.reason))
  // ws.close(1000, 'done') requests close (the close event is the real confirmation)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->