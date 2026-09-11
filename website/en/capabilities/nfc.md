---
title: useNFC (capability.nfc)
group: 网络与通信
order: 8
---

# useNFC

useNFC: NFC status (wx.getHCEState / web NDEFReader feature detection)

> Capability primitive C37 · `capability.nfc` · returns `NFCAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useNFC(): Promise<CapResult<NFCAPI>>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `NFCAPI` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

#### Properties of the `NFCAPI` object

| Property | Type | Required | Doc |
|---|---|---|---|
| `supported` | `boolean` | Yes | Whether the platform supports NFC |
| `available` | `boolean` | Yes | NFC is currently available (enabled) |

#### Methods of `NFCAPI`

| Method | Signature | Doc |
|---|---|---|
| `startHCE` | `startHCE(aidList: string[]): Promise<CapResult<void>>` | — |
| `stopHCE` | `stopHCE(): Promise<CapResult<void>>` | — |
| `sendHCEMessage` | `sendHCEMessage(data: ArrayBuffer): Promise<CapResult<void>>` | — |
| `onHCEMessage` | `onHCEMessage(cb: (message: { messageType: number; data?: ArrayBuffer }) => void): () => void` | — |
| `onHCEStateChange` | `onHCEStateChange(cb: (available: boolean) => void): () => void` | — |
| `getAdapter` | `getAdapter(): NfcAdapter` | — |

#### Method details

##### `startHCE`

```ts
startHCE(aidList: string[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `aidList` | `string[]` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

##### `stopHCE`

```ts
stopHCE(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

##### `sendHCEMessage`

```ts
sendHCEMessage(data: ArrayBuffer): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `data` | `ArrayBuffer` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

##### `onHCEMessage`

```ts
onHCEMessage(cb: (message: { messageType: number; data?: ArrayBuffer }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(message: { messageType: number; data?: ArrayBuffer }) => void` | No | — |

**Returns**: `() => void`

##### `onHCEStateChange`

```ts
onHCEStateChange(cb: (available: boolean) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(available: boolean) => void` | Yes | — |

**Returns**: `() => void`

##### `getAdapter`

```ts
getAdapter(): NfcAdapter
```

**Returns**: `NfcAdapter`

#### Referenced types

**`NfcAdapter`** — ★能力颗粒度对齐：C37 NFC 读卡模式（wx.getNFCAdapter——发现标签 + Ndef/NfcA/B/F/V/IsoDep/Mifare 连接） 与 HCE（模拟卡）互补：HCE 让手机当卡，Adapter 让手机读卡。

| Prop/Method | Type | Doc |
|---|---|---|
| `startDiscovery` | `startDiscovery(): Promise<CapResult<void>>` | 开始发现附近标签 |
| `stopDiscovery` | `stopDiscovery(): Promise<CapResult<void>>` | 停止发现 |
| `onDiscovered` | `onDiscovered(cb: (tag: NfcTag) => void): () => void` | 订阅发现的标签（返回取消） |
| `connectNdef` | `connectNdef(): Promise<CapResult<NdefHandle>>` | 连接 NDEF 标签（读写 NDEF 消息） |
| `connectIsoDep` | `connectIsoDep(): Promise<CapResult<NfcTagHandle>>` | 连接 IsoDep 标签（ISO-DEP/APDU 透传） |
| `connectNfcA` | `connectNfcA(): Promise<CapResult<NfcTagHandle>>` | 连接 NFC-A 标签 |
| `connectNfcB` | `connectNfcB(): Promise<CapResult<NfcTagHandle>>` | 连接 NFC-B 标签 |
| `connectNfcF` | `connectNfcF(): Promise<CapResult<NfcTagHandle>>` | 连接 NFC-F 标签（FeliCa） |
| `connectNfcV` | `connectNfcV(): Promise<CapResult<NfcTagHandle>>` | 连接 NFC-V 标签 |
| `connectMifareClassic` | `connectMifareClassic(): Promise<CapResult<NfcTagHandle>>` | 连接 Mifare Classic 标签 |
| `connectMifareUltralight` | `connectMifareUltralight(): Promise<CapResult<NfcTagHandle>>` | 连接 Mifare Ultralight 标签 |

## Error codes

| code | Doc |
|---|---|
| `nfc.unsupported` | Bridge does not provide getNfc (useNFC unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.getHCEState |
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
const res = await useNFC()

if (res.ok) {
  console.log('nfc:', res.data.supported, res.data.available)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->