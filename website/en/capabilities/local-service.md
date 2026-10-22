---
title: useLocalService (capability.local-service)
group: 网络与通信
order: 11
---

# useLocalService

**What it does**: Discover or advertise services on the local network (mDNS).

**When to use it**: Finding printers or cast devices on the same Wi-Fi.

**End support & boundaries**: **Usable on WeChat and both App targets; not on Web** (browsers expose no mDNS discovery API). One step is easy to miss: you **must call `startDiscovery(serviceType)` before `onFound` fires** — subscribing alone does not start discovery. ★That contract gap was fixed in this batch: it previously had four subscriptions and no start/stop switch, i.e. an interface where following the docs produces no events at all (the same family as `useBeacon`). The two App implementations differ: Android uses `NsdManager` (a second **resolve** is required after `onServiceFound` to get ip/port); iOS uses `NWBrowser` plus `NetService` resolution.

> 技术标识：能力原语 C78 · `capability.local-service` · 返回 `LocalServiceAPI` · **Hook implemented** (per-end support in the table below)

useLocalService: LAN service discovery (mDNS) — found / lost / resolve-fail / discovery-stop events (wx.onLocalService*; web has no standard mDNS → empty subscription)

## Signature

```ts
useLocalService(): CapResult<LocalServiceAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `LocalServiceAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`startDiscovery`](#startdiscovery) | — |
| [`stopDiscovery`](#stopdiscovery) | — |
| [`onFound`](#onfound) | — |
| [`onLost`](#onlost) | — |
| [`onResolveFail`](#onresolvefail) | — |
| [`onDiscoveryStop`](#ondiscoverystop) | — |

### `startDiscovery`

```ts
startDiscovery(serviceType: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `serviceType` | `string` | Yes | mDNS 类型（如 `'_http._tcp'`） |

**Returns**: `Promise<CapResult<void>>`

### `stopDiscovery`

```ts
stopDiscovery(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `onFound`

```ts
onFound(cb: (res: LocalServiceInfo) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | Yes | 服务回调 |

**Returns**: `() => void` -- 取消订阅函数

### `onLost`

```ts
onLost(cb: (res: LocalServiceInfo) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | Yes | 服务回调 |

**Returns**: `() => void` -- 取消订阅函数

### `onResolveFail`

```ts
onResolveFail(cb: (res: LocalServiceInfo) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | Yes | 服务回调 |

**Returns**: `() => void` -- 取消订阅函数

### `onDiscoveryStop`

```ts
onDiscoveryStop(cb: () => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `() => void` | Yes | 停止回调 |

**Returns**: `() => void` -- 取消订阅函数

## Referenced types

### `LocalServiceInfo`

mDNS 局域网服务（wx OnLocalServiceFound/Lost）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `serviceName` | `string` | — | 服务名 |
| `serviceType` | `string` | — | 服务类型（如 _http._tcp） |
| `ip` | `string` | — | 服务 IP |
| `port` | `number` | — | 服务端口 |

## Error codes

| code | Doc |
|---|---|
| `local-service.unsupported` | The bridge does not provide getLocalService (useLocalService unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge missing getLocalService → explicit Err degradation (no direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.onLocalServiceFound/Lost/ResolveFail/DiscoveryStop |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `LocalServiceAPI`

★权威标尺缺口 C78：局域网服务发现（`useLocalService()`，mDNS）。
wx：`wx.onLocalServiceFound` / `onLocalServiceLost` / `onLocalServiceResolveFail`
/ `onLocalServiceDiscoveryStop`；web：无标准 mDNS → Err 诚实降级。

| Prop/Method | Type | Doc |
|---|---|---|
| `startDiscovery` | `startDiscovery(serviceType: string): Promise<CapResult<void>>` | ★#1097：**必须先 startDiscovery 才会收到 onFound**（与 useBeacon 同形态——订阅不启动搜索）。 |
| `stopDiscovery` | `stopDiscovery(): Promise<CapResult<void>>` | 停止搜索（订阅保留；会触发一次 `onDiscoveryStop`）。 |
| `onFound` | `onFound(cb: (res: LocalServiceInfo) => void): () => void` | 订阅发现新服务（**需先 `startDiscovery`**）。 |
| `onLost` | `onLost(cb: (res: LocalServiceInfo) => void): () => void` | 订阅服务离开。 |
| `onResolveFail` | `onResolveFail(cb: (res: LocalServiceInfo) => void): () => void` | 订阅服务解析失败。 |
| `onDiscoveryStop` | `onDiscoveryStop(cb: () => void): () => void` | 订阅搜索停止。 |

### `LocalServiceInfo`

mDNS 局域网服务（wx OnLocalServiceFound/Lost）

| Prop/Method | Type | Doc |
|---|---|---|
| `serviceName` | `string` | 服务名 |
| `serviceType` | `string` | 服务类型（如 _http._tcp） |
| `ip` | `string` | 服务 IP |
| `port` | `number` | 服务端口 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const mdns = useLocalService() // synchronous handle — no await, no res.ok

if (mdns.ok) {
  mdns.data.onFound((svc) => console.log("found service:", svc.serviceName, svc.ip, svc.port))
  mdns.data.onLost((svc) => console.log("service left:", svc.serviceName))
  mdns.data.onDiscoveryStop(() => console.log("discovery stopped"))
} else if (mdns.error.code === 'local-service.unsupported') {
  // mDNS unsupported on this platform → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->