---
title: useWebSocket (capability.websocket)
group: 网络与通信
order: 2
---

# useWebSocket

**What it does**: Open a persistent bidirectional connection to a server.

**When to use it**: Chat, real-time collaboration, market data.

**End support & boundaries**: **Available on four targets** (Web / WeChat / App-iOS / App-Android, both App ends device-verified); **not wired on HarmonyOS** (no ws channel in the host). One easy mistake: a successful `useWebSocket()` only means the **connection was accepted** — the `open` event is the proof it is connected (especially on App, where `ws.open` returns immediately instead of blocking the JS thread on the handshake). Send failures surface through the `error` event (`send` does not throw, matching the browser). The two App implementations differ because the platforms do: iOS uses the system `URLSessionWebSocketTask`; Android hand-writes RFC 6455 because the build has no dependency manager. **Security chain (#1344 P4)**: WebSocket now goes through the **same egress governance as HTTP** — `createCapabilityHooks({ allowedDomains })` configures **one rule for both channels** (shared `isHostAllowed`: unset = unrestricted; `*.example.com` matches **one** level only). A blocked connection never reaches the host (error code `websocket.forbidden`), and the allowlist check runs **before** the concurrency quota so a hostile domain cannot exhaust the 64 slots. Transport-level hostname verification was a real defect on Android (`createSocket()` + `connect()` validates the chain but **not the hostname**) — now sets `setEndpointIdentificationAlgorithm("HTTPS")` and calls `startHandshake()` explicitly. iOS keeps `delegate: nil` (the system default is what performs hostname checking). **Honest limit**: SPKI pinning for `wss://` is **not implemented on any target**.

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

## Referenced types

### `WebSocketConnection`

C27 WebSocket 连接句柄（wx SocketTask / web WebSocket / App 宿主 ws.* 适配）。

★**句柄 ≠ 已连接**：`useWebSocket()` 成功只代表"连接已受理"；
真正的连接建立以 `on('open')` 回调为准（与浏览器 `WebSocket` 同语义）。
App 端尤其如此——`ws.open` 受理即返（不阻塞 JS 线程等握手）。

| Prop/Method | Type | Doc |
|---|---|---|
| `send` | `send(data: string \| ArrayBuffer): void` | 发送消息（字符串或二进制）。★发送失败经 `error` 事件回报（不抛，与浏览器一致）。 |
| `close` | `close(code?: number, reason?: string): void` | 关闭连接（`close` 事件仍由对端/宿主推回——本调用不等于已断开） |
| `on` | `on(event: 'open' \| 'message' \| 'close' \| 'error', handler: (payload?: unknown) => void): () => void` | 订阅事件（返回取消订阅函数）。 - `open`：连接建立（**唯一**的"已连上"证据） - `message`：收到的消息（`{ data }`；二进制为字节数组） - `close`：连接关闭（`{ code, reason }`） - `error`：连接或发送出错（`{ message, missing? }`） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

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