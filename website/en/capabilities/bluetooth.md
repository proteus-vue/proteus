---
title: useBluetooth (capability.bluetooth)
group: 网络与通信
order: 7
---

# useBluetooth

useBluetooth: Bluetooth status (wx.openBluetoothAdapter / web feature detection)

> Capability primitive C36 · `capability.bluetooth` · returns `BluetoothAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useBluetooth(): Promise<CapResult<BluetoothAPI>>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `BluetoothAPI` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`close`](#close) | `close(): Promise<CapResult<void>>` | — |
| [`getAdapterState`](#getadapterstate) | `getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>` | — |
| [`startDiscovery`](#startdiscovery) | `startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>` | — |
| [`stopDiscovery`](#stopdiscovery) | `stopDiscovery(): Promise<CapResult<void>>` | — |
| [`onDeviceFound`](#ondevicefound) | `onDeviceFound(cb: (devices: BleDevice[]) => void): () => void` | — |
| [`getDevices`](#getdevices) | `getDevices(): Promise<CapResult<BleDevice[]>>` | — |
| [`getConnectedDevices`](#getconnecteddevices) | `getConnectedDevices(): Promise<CapResult<BleDevice[]>>` | — |
| [`connect`](#connect) | `connect(deviceId: string): Promise<CapResult<void>>` | — |
| [`disconnect`](#disconnect) | `disconnect(deviceId: string): Promise<CapResult<void>>` | — |
| [`onConnectionStateChange`](#onconnectionstatechange) | `onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void` | — |
| [`getServices`](#getservices) | `getServices(deviceId: string): Promise<CapResult<BleService[]>>` | — |
| [`getCharacteristics`](#getcharacteristics) | `getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>` | — |
| [`read`](#read) | `read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>` | — |
| [`write`](#write) | `write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>` | — |
| [`setNotify`](#setnotify) | `setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>` | — |
| [`onCharacteristicValueChange`](#oncharacteristicvaluechange) | `onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void` | — |
| [`getRSSI`](#getrssi) | `getRSSI(deviceId: string): Promise<CapResult<number>>` | — |

### `close`

```ts
close(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `getAdapterState`

```ts
getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>
```

**Returns**: `Promise<CapResult<{ available: boolean; discovering: boolean }>>`

### `startDiscovery`

```ts
startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `allowDuplicatesKey` | `boolean` | No | 是否允许重复上报同一设备（缺省 false） |

**Returns**: `Promise<CapResult<void>>`

### `stopDiscovery`

```ts
stopDiscovery(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `onDeviceFound`

```ts
onDeviceFound(cb: (devices: BleDevice[]) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(devices: BleDevice[]) => void` | Yes | 回调（devices 本次新发现设备列表） |

**Returns**: `() => void` -- 取消订阅函数

### `getDevices`

```ts
getDevices(): Promise<CapResult<BleDevice[]>>
```

**Returns**: `Promise<CapResult<BleDevice[]>>`

### `getConnectedDevices`

```ts
getConnectedDevices(): Promise<CapResult<BleDevice[]>>
```

**Returns**: `Promise<CapResult<BleDevice[]>>`

### `connect`

```ts
connect(deviceId: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id（来自发现结果） |

**Returns**: `Promise<CapResult<void>>`

### `disconnect`

```ts
disconnect(deviceId: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id |

**Returns**: `Promise<CapResult<void>>`

### `onConnectionStateChange`

```ts
onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(deviceId: string, connected: boolean) => void` | Yes | 回调（deviceId / connected） |

**Returns**: `() => void` -- 取消订阅函数

### `getServices`

```ts
getServices(deviceId: string): Promise<CapResult<BleService[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id（需先连接） |

**Returns**: `Promise<CapResult<BleService[]>>`

### `getCharacteristics`

```ts
getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id |
| `serviceId` | `string` | Yes | 服务 uuid |

**Returns**: `Promise<CapResult<BleCharacteristic[]>>`

### `read`

```ts
read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id |
| `serviceId` | `string` | Yes | 服务 uuid |
| `characteristicId` | `string` | Yes | 特征值 uuid（须支持 read） |

**Returns**: `Promise<CapResult<ArrayBuffer>>`

### `write`

```ts
write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id |
| `serviceId` | `string` | Yes | 服务 uuid |
| `characteristicId` | `string` | Yes | 特征值 uuid（须支持 write） |
| `value` | `ArrayBuffer` | Yes | 待写入字节（≤ 20 字节，长包需分包） |

**Returns**: `Promise<CapResult<void>>`

### `setNotify`

```ts
setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id |
| `serviceId` | `string` | Yes | 服务 uuid |
| `characteristicId` | `string` | Yes | 特征值 uuid（须支持 notify/indicate） |
| `state` | `boolean` | Yes | true 订阅 / false 取消 |

**Returns**: `Promise<CapResult<void>>`

### `onCharacteristicValueChange`

```ts
onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void` | Yes | 回调（deviceId / serviceId / characteristicId / value） |

**Returns**: `() => void` -- 取消订阅函数

### `getRSSI`

```ts
getRSSI(deviceId: string): Promise<CapResult<number>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `deviceId` | `string` | Yes | 设备 id（需先连接） |

**Returns**: `Promise<CapResult<number>>`

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `supported` | `boolean` | Yes | Whether the platform supports Bluetooth |
| `available` | `boolean` | Yes | The adapter is open (available) |
| `devices` | `string[]` | Yes | Names of paired/discovered devices (wx.getBluetoothDevices; on the web, listed only after a user gesture) |

## Referenced types

### `BleDevice`

BLE 设备（wx.BluetoothDevice 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `deviceId` | `string` | — | 设备唯一 id |
| `name` | `string` | — | 设备名称 |
| `RSSI` | `number` | — | 信号强度（发现/连接后可得） |

### `BleService`

BLE 服务（wx.BLEService 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `uuid` | `string` | — | 服务 uuid |
| `isPrimary` | `boolean` | — | 是否主服务 |

### `BleCharacteristic`

BLE 特征值（wx.BLECharacteristic 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `uuid` | `string` | — | 特征值 uuid |
| `properties` | `{ read: boolean; write: boolean; notify: boolean; indicate: boolean }` | — | 支持的操作（read/write/notify/indicate） |

## Error codes

| code | Doc |
|---|---|
| `bluetooth.unsupported` | Bridge does not provide getBluetooth (useBluetooth unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.openBluetoothAdapter |
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
const res = await useBluetooth()

if (res.ok) {
  console.log('bluetooth available:', res.data.available)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->