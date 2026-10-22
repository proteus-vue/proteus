---
title: useBluetooth (capability.bluetooth)
group: 网络与通信
order: 7
---

# useBluetooth

**What it does**: Connect to BLE peripherals and read/write characteristics.

**When to use it**: Wearables, smart scales, BLE printers.

**End support & boundaries**: iOS requires the Bluetooth usage description and a real device; Web Bluetooth is browser-gated and requires a user gesture (no background scanning in a page).

> 技术标识：能力原语 C36 · `capability.bluetooth` · 返回 `BluetoothAPI` · **Hook implemented** (per-end support in the table below)

useBluetooth: Bluetooth status (wx.openBluetoothAdapter / web feature detection)

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

| Method | Doc |
|---|---|
| [`close`](#close) | — |
| [`getAdapterState`](#getadapterstate) | — |
| [`startDiscovery`](#startdiscovery) | — |
| [`stopDiscovery`](#stopdiscovery) | — |
| [`onDeviceFound`](#ondevicefound) | — |
| [`getDevices`](#getdevices) | — |
| [`getConnectedDevices`](#getconnecteddevices) | — |
| [`connect`](#connect) | — |
| [`disconnect`](#disconnect) | — |
| [`onConnectionStateChange`](#onconnectionstatechange) | — |
| [`getServices`](#getservices) | — |
| [`getCharacteristics`](#getcharacteristics) | — |
| [`read`](#read) | — |
| [`write`](#write) | — |
| [`setNotify`](#setnotify) | — |
| [`onCharacteristicValueChange`](#oncharacteristicvaluechange) | — |
| [`getRSSI`](#getrssi) | — |

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
| `bluetooth.unavailable` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.openBluetoothAdapter |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `BluetoothAPI`

★能力颗粒度对齐（docs/capability-granularity-alignment.md）：C36 蓝牙 BLE 操作接口
计划 BluetoothAPI 的落地——连接/服务/特征值/通知/发现/断开全套（原实现只有状态探测）。
方法统一返回 Promise<CapResult<T>>（G-32.4）；订阅类返回取消函数；不支持 → web/缺桥 Err。

| Prop/Method | Type | Doc |
|---|---|---|
| `supported` | `boolean` | 平台是否支持蓝牙 |
| `available` | `boolean` | 适配器已打开（可用） |
| `devices` | `string[]` | 已配对/发现的设备名（wx.getBluetoothDevices；web 需用户手势不列） |

| Prop/Method | Type | Doc |
|---|---|---|
| `close` | `close(): Promise<CapResult<void>>` | 关闭蓝牙适配器（释放系统资源；后续操作需重新 openBluetoothAdapter） |
| `getAdapterState` | `getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>` | 获取适配器状态（available 是否可用 / discovering 是否在搜索） |
| `startDiscovery` | `startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>` | 开始搜索附近 BLE 设备。 |
| `stopDiscovery` | `stopDiscovery(): Promise<CapResult<void>>` | 停止搜索附近设备 |
| `onDeviceFound` | `onDeviceFound(cb: (devices: BleDevice[]) => void): () => void` | 订阅「发现新设备」事件。 |
| `getDevices` | `getDevices(): Promise<CapResult<BleDevice[]>>` | 获取已发现设备列表 |
| `getConnectedDevices` | `getConnectedDevices(): Promise<CapResult<BleDevice[]>>` | 获取已连接设备列表 |
| `connect` | `connect(deviceId: string): Promise<CapResult<void>>` | 连接指定设备。 |
| `disconnect` | `disconnect(deviceId: string): Promise<CapResult<void>>` | 断开指定设备。 |
| `onConnectionStateChange` | `onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void` | 订阅「连接状态变化」事件。 |
| `getServices` | `getServices(deviceId: string): Promise<CapResult<BleService[]>>` | 获取设备的服务（Service）列表。 |
| `getCharacteristics` | `getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>` | 获取服务下的特征值（Characteristic）列表。 |
| `read` | `read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>` | 读特征值。 |
| `write` | `write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>` | 写特征值。 |
| `setNotify` | `setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>` | 订阅 / 取消订阅特征值通知。 |
| `onCharacteristicValueChange` | `onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void` | 订阅「特征值变化」通知数据。 |
| `getRSSI` | `getRSSI(deviceId: string): Promise<CapResult<number>>` | 读取设备信号强度（RSSI）。 |

### `BleDevice`

BLE 设备（wx.BluetoothDevice 子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `deviceId` | `string` | 设备唯一 id |
| `name` | `string` | 设备名称 |
| `RSSI` | `number` | 信号强度（发现/连接后可得） |

### `BleService`

BLE 服务（wx.BLEService 子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `uuid` | `string` | 服务 uuid |
| `isPrimary` | `boolean` | 是否主服务 |

### `BleCharacteristic`

BLE 特征值（wx.BLECharacteristic 子集）

| Prop/Method | Type | Doc |
|---|---|---|
| `uuid` | `string` | 特征值 uuid |
| `properties` | `{ read: boolean; write: boolean; notify: boolean; indicate: boolean }` | 支持的操作（read/write/notify/indicate） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

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