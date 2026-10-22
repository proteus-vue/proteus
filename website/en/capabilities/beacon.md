---
title: useBeacon (capability.beacon)
group: 设备与系统
order: 1018
---

# useBeacon

**What it does**: Scan nearby iBeacon BLE beacons and read their identifiers and signal strength to estimate proximity.

**When to use it**: Indoor positioning, proximity prompts, museum audio guides, venue check-in — when GPS is not accurate indoors.

**End support & boundaries**: **Usable on WeChat; honestly unavailable elsewhere.** One step is easy to miss: you **must call `startBeaconDiscovery(uuids)` before `onUpdate` fires** — subscribing without starting discovery yields no callbacks on WeChat (error 11004 usually means location/Bluetooth permission is missing). Browsers expose no iBeacon scanning API (Web Bluetooth needs a user gesture and does not parse beacon frames); no App host implements BLE scanning yet.

> 技术标识：能力原语 C77 · `capability.beacon` · 返回 `BeaconAPI` · **Hook implemented** (per-end support in the table below)

useBeacon: iBeacon — service state change + device update events (wx.onBeaconServiceChange/onBeaconUpdate; web has no equivalent → empty subscription, use Web Bluetooth)

## Signature

```ts
useBeacon(): CapResult<BeaconAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `BeaconAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`startBeaconDiscovery`](#startbeacondiscovery) | — |
| [`stopBeaconDiscovery`](#stopbeacondiscovery) | — |
| [`onServiceChange`](#onservicechange) | — |
| [`onUpdate`](#onupdate) | — |

### `startBeaconDiscovery`

```ts
startBeaconDiscovery(uuids: string[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `uuids` | `string[]` | Yes | 要搜索的 iBeacon UUID 列表（**至少一个**；传全 0 UUID 表示匹配所有信标） |

**Returns**: `Promise<CapResult<void>>` -- 成功 = 搜索已开始（真正发现设备仍靠 `onUpdate`）

### `stopBeaconDiscovery`

```ts
stopBeaconDiscovery(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>` -- 成功 = 搜索已停止

### `onServiceChange`

```ts
onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: { available: boolean; discovering: boolean }) => void` | Yes | 状态回调（available 服务可用 / discovering 搜索中） |

**Returns**: `() => void` -- 取消订阅函数

### `onUpdate`

```ts
onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: { beacons: BeaconInfo[] }) => void` | Yes | 设备回调（beacons 发现的设备列表） |

**Returns**: `() => void` -- 取消订阅函数

## Referenced types

### `BeaconInfo`

iBeacon 设备信息（wx `BeaconInfo`）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `uuid` | `string` | — | 设备 uuid |
| `major` | `number` | — | major 值 |
| `minor` | `number` | — | minor 值 |
| `accuracy` | `number` | — | 距离（米） |
| `rssi` | `number` | — | 信号强度 |
| `proximity` | `0 \| 1 \| 2 \| 3` | — | 距离档位（0 未知 / 1 极近 / 2 近 / 3 远） |

## Error codes

| code | Doc |
|---|---|
| `beacon.unsupported` | The bridge does not provide getBeacon (useBeacon unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge missing getBeacon → explicit Err degradation (no direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.onBeaconServiceChange/onBeaconUpdate |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `BeaconAPI`

iBeacon（`useBeacon()`）。

★★**关键语义：必须先 `startBeaconDiscovery` 才会收到 `onUpdate`** ——
微信端不搜索就订阅，上层永远收不到任何更新（错误码 11004）。
这是本能力最容易被漏掉的一步，也是原契约（只有两个订阅）对业务不可用的原因。

端边界：只有微信提供；Web 无 iBeacon 扫描标准、App 三端宿主未实现 BLE 扫描 ⇒ Hook 返回 `beacon.unsupported`。

| Prop/Method | Type | Doc |
|---|---|---|
| `startBeaconDiscovery` | `startBeaconDiscovery(uuids: string[]): Promise<CapResult<void>>` | 开始搜索 iBeacon。 ★**必须先调用它才会收到 `onUpdate`**——订阅本身不会启动搜索。 |
| `stopBeaconDiscovery` | `stopBeaconDiscovery(): Promise<CapResult<void>>` | 停止搜索。停止后不再收到 `onUpdate`（订阅仍保留，下次 start 后继续回调）。 |
| `onServiceChange` | `onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void` | 订阅 Beacon 服务状态变化（蓝牙开关 / 搜索开始与结束）。 |
| `onUpdate` | `onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void` | 订阅 Beacon 设备更新（**需先 `startBeaconDiscovery`**）。 |

### `BeaconInfo`

iBeacon 设备信息（wx `BeaconInfo`）

| Prop/Method | Type | Doc |
|---|---|---|
| `uuid` | `string` | 设备 uuid |
| `major` | `number` | major 值 |
| `minor` | `number` | minor 值 |
| `accuracy` | `number` | 距离（米） |
| `rssi` | `number` | 信号强度 |
| `proximity` | `0 \| 1 \| 2 \| 3` | 距离档位（0 未知 / 1 极近 / 2 近 / 3 远） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const beacon = useBeacon() // synchronous handle — no await, no res.ok

if (beacon.ok) {
  // ★subscribe first, then start discovery — without discovery onUpdate never fires (WeChat 11004)
  beacon.data.onServiceChange((res) => console.log("beacon service:", res.available))
  beacon.data.onUpdate((res) => console.log("found", res.beacons.length, "beacons"))
  const started = await beacon.data.startBeaconDiscovery(["FDA50693-A4E2-4FB1-AFCF-C6EB07647825"])
  if (!started.ok) console.log('discovery failed:', started.error.code) // beacon.failed / unsupported
  // beacon.data.stopBeaconDiscovery() stops discovery (subscriptions stay)
} else if (beacon.error.code === 'beacon.unsupported') {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->