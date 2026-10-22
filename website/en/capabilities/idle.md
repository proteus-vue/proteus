---
title: useIdle (capability.idle)
group: 应用与生命周期
order: 7010
---

# useIdle

**What it does**: Defer non-urgent work until the device is idle.

**When to use it**: Precomputation, cache warming.

> 技术标识：能力原语 C73 · `capability.idle` · 返回 `IdleAPI` · **Hook implemented** (per-end support in the table below)

useIdle: idle scheduling — run a callback when the host is idle, with cancel (wx.requestIdleCallback/cancelIdleCallback; web requestIdleCallback with setTimeout fallback)

## Signature

```ts
useIdle(): CapResult<IdleAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `IdleAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`request`](#request) | — |
| [`cancel`](#cancel) | — |

### `request`

```ts
request(cb: (deadline: IdleDeadline) => void, timeout?: number): Promise<CapResult<number>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(deadline: IdleDeadline) => void` | Yes | 空闲回调（携带 deadline） |
| `timeout` | `number` | No | 超时（ms，到时即执行） |

**Returns**: `Promise<CapResult<number>>` -- 句柄 id（可传入 cancel）

### `cancel`

```ts
cancel(id: number): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `id` | `number` | Yes | 句柄 id |

**Returns**: `Promise<CapResult<void>>`

## Referenced types

### `IdleDeadline`

空闲回调截止信息（requestIdleCallback 回调载荷子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `didTimeout` | `boolean` | — | 是否因超时触发（非真正空闲） |

| Method | Signature | Doc |
|---|---|---|
| `timeRemaining` | `timeRemaining(): number` | 本次空闲回调剩余时间（ms） |

## Error codes

| code | Doc |
|---|---|
| `idle.unsupported` | The idle-callback API is missing (no requestIdleCallback/setTimeout available) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.requestIdleCallback/cancelIdleCallback |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `IdleAPI`

★权威标尺缺口 C73：空闲调度（`useIdle()`）。
wx：`wx.requestIdleCallback` / `wx.cancelIdleCallback`；web：`requestIdleCallback`（Safari 缺省 → setTimeout 兜底）。

| Prop/Method | Type | Doc |
|---|---|---|
| `request` | `request(cb: (deadline: IdleDeadline) => void, timeout?: number): Promise<CapResult<number>>` | 在浏览器/宿主空闲时执行回调。 |
| `cancel` | `cancel(id: number): Promise<CapResult<void>>` | 取消待执行的空闲回调。 |

### `IdleDeadline`

空闲回调截止信息（requestIdleCallback 回调载荷子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `didTimeout` | `boolean` | 是否因超时触发（非真正空闲） |

| Prop/Method | Type | Doc |
|---|---|---|
| `timeRemaining` | `timeRemaining(): number` | 本次空闲回调剩余时间（ms） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const idle = useIdle() // synchronous handle — no await, no res.ok

if (idle.ok) {
  const id = await idle.data.request((d) => {
    // do non-critical work while idle (d.timeRemaining() ms left)
    console.log("idle time left:", d.timeRemaining(), "ms")
  }, 2000)
  // if (id.ok) await idle.data.cancel(id.data)
} else if (idle.error.code === 'idle.unsupported') {
  // platform unsupported → degradation path
}
```

## Platform notes

### Mini Program (MP)

- **wx.requestIdleCallback** — ★wx returns no id (the callback runs immediately) — this bridge uses an incrementing counter to emulate a cancel handle

### Web

- **requestIdleCallback (native)** — Native browser idle callback (timeRemaining reflects the real budget); Safari support arrived late — honest Err when missing

### App (iOS / Android / Harmony)

- **Shell-provided idle slots** — Idle slots come from the shell (e.g. between frames) — low-priority work (log upload, warming) goes here without competing with the first screen · Planned: Available once the shell implements `idle.request` / `idle.cancel`

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->