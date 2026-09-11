---
title: useBluetooth（capability.bluetooth）
group: 网络与通信
order: 7
---

# useBluetooth

useBluetooth：蓝牙状态（wx.openBluetoothAdapter / web 特性探测）

> 能力原语 C36 · `capability.bluetooth` · 返回 `BluetoothAPI` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useBluetooth(): Promise<CapResult<BluetoothAPI>>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `BluetoothAPI` | 成功载荷（结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`close`](#close) | `close(): Promise<CapResult<void>>` | 关闭蓝牙适配器（释放系统资源；后续操作需重新 openBluetoothAdapter） |
| [`getAdapterState`](#getadapterstate) | `getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>` | 获取适配器状态（available 是否可用 / discovering 是否在搜索） |
| [`startDiscovery`](#startdiscovery) | `startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>` | 开始搜索附近 BLE 设备。 |
| [`stopDiscovery`](#stopdiscovery) | `stopDiscovery(): Promise<CapResult<void>>` | 停止搜索附近设备 |
| [`onDeviceFound`](#ondevicefound) | `onDeviceFound(cb: (devices: BleDevice[]) => void): () => void` | 订阅「发现新设备」事件。 |
| [`getDevices`](#getdevices) | `getDevices(): Promise<CapResult<BleDevice[]>>` | 获取已发现设备列表 |
| [`getConnectedDevices`](#getconnecteddevices) | `getConnectedDevices(): Promise<CapResult<BleDevice[]>>` | 获取已连接设备列表 |
| [`connect`](#connect) | `connect(deviceId: string): Promise<CapResult<void>>` | 连接指定设备。 |
| [`disconnect`](#disconnect) | `disconnect(deviceId: string): Promise<CapResult<void>>` | 断开指定设备。 |
| [`onConnectionStateChange`](#onconnectionstatechange) | `onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void` | 订阅「连接状态变化」事件。 |
| [`getServices`](#getservices) | `getServices(deviceId: string): Promise<CapResult<BleService[]>>` | 获取设备的服务（Service）列表。 |
| [`getCharacteristics`](#getcharacteristics) | `getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>` | 获取服务下的特征值（Characteristic）列表。 |
| [`read`](#read) | `read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>` | 读特征值。 |
| [`write`](#write) | `write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>` | 写特征值。 |
| [`setNotify`](#setnotify) | `setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>` | 订阅 / 取消订阅特征值通知。 |
| [`onCharacteristicValueChange`](#oncharacteristicvaluechange) | `onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void` | 订阅「特征值变化」通知数据。 |
| [`getRSSI`](#getrssi) | `getRSSI(deviceId: string): Promise<CapResult<number>>` | 读取设备信号强度（RSSI）。 |

### `close`

```ts
close(): Promise<CapResult<void>>
```

**说明**：关闭蓝牙适配器（释放系统资源；后续操作需重新 openBluetoothAdapter）

**返回值**：`Promise<CapResult<void>>`

### `getAdapterState`

```ts
getAdapterState(): Promise<CapResult<{ available: boolean; discovering: boolean }>>
```

**说明**：获取适配器状态（available 是否可用 / discovering 是否在搜索）

**返回值**：`Promise<CapResult<{ available: boolean; discovering: boolean }>>`

### `startDiscovery`

```ts
startDiscovery(allowDuplicatesKey?: boolean): Promise<CapResult<void>>
```

**说明**：开始搜索附近 BLE 设备。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `allowDuplicatesKey` | `boolean` | 否 | 是否允许重复上报同一设备（缺省 false） |

**返回值**：`Promise<CapResult<void>>`

### `stopDiscovery`

```ts
stopDiscovery(): Promise<CapResult<void>>
```

**说明**：停止搜索附近设备

**返回值**：`Promise<CapResult<void>>`

### `onDeviceFound`

```ts
onDeviceFound(cb: (devices: BleDevice[]) => void): () => void
```

**说明**：订阅「发现新设备」事件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(devices: BleDevice[]) => void` | 是 | 回调（devices 本次新发现设备列表） |

**返回值**：`() => void`——取消订阅函数

### `getDevices`

```ts
getDevices(): Promise<CapResult<BleDevice[]>>
```

**说明**：获取已发现设备列表

**返回值**：`Promise<CapResult<BleDevice[]>>`

### `getConnectedDevices`

```ts
getConnectedDevices(): Promise<CapResult<BleDevice[]>>
```

**说明**：获取已连接设备列表

**返回值**：`Promise<CapResult<BleDevice[]>>`

### `connect`

```ts
connect(deviceId: string): Promise<CapResult<void>>
```

**说明**：连接指定设备。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id（来自发现结果） |

**返回值**：`Promise<CapResult<void>>`

### `disconnect`

```ts
disconnect(deviceId: string): Promise<CapResult<void>>
```

**说明**：断开指定设备。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id |

**返回值**：`Promise<CapResult<void>>`

### `onConnectionStateChange`

```ts
onConnectionStateChange(cb: (deviceId: string, connected: boolean) => void): () => void
```

**说明**：订阅「连接状态变化」事件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(deviceId: string, connected: boolean) => void` | 是 | 回调（deviceId / connected） |

**返回值**：`() => void`——取消订阅函数

### `getServices`

```ts
getServices(deviceId: string): Promise<CapResult<BleService[]>>
```

**说明**：获取设备的服务（Service）列表。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id（需先连接） |

**返回值**：`Promise<CapResult<BleService[]>>`

### `getCharacteristics`

```ts
getCharacteristics(deviceId: string, serviceId: string): Promise<CapResult<BleCharacteristic[]>>
```

**说明**：获取服务下的特征值（Characteristic）列表。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id |
| `serviceId` | `string` | 是 | 服务 uuid |

**返回值**：`Promise<CapResult<BleCharacteristic[]>>`

### `read`

```ts
read(deviceId: string, serviceId: string, characteristicId: string): Promise<CapResult<ArrayBuffer>>
```

**说明**：读特征值。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id |
| `serviceId` | `string` | 是 | 服务 uuid |
| `characteristicId` | `string` | 是 | 特征值 uuid（须支持 read） |

**返回值**：`Promise<CapResult<ArrayBuffer>>`

### `write`

```ts
write(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer): Promise<CapResult<void>>
```

**说明**：写特征值。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id |
| `serviceId` | `string` | 是 | 服务 uuid |
| `characteristicId` | `string` | 是 | 特征值 uuid（须支持 write） |
| `value` | `ArrayBuffer` | 是 | 待写入字节（≤ 20 字节，长包需分包） |

**返回值**：`Promise<CapResult<void>>`

### `setNotify`

```ts
setNotify(deviceId: string, serviceId: string, characteristicId: string, state: boolean): Promise<CapResult<void>>
```

**说明**：订阅 / 取消订阅特征值通知。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id |
| `serviceId` | `string` | 是 | 服务 uuid |
| `characteristicId` | `string` | 是 | 特征值 uuid（须支持 notify/indicate） |
| `state` | `boolean` | 是 | true 订阅 / false 取消 |

**返回值**：`Promise<CapResult<void>>`

### `onCharacteristicValueChange`

```ts
onCharacteristicValueChange(cb: (deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void): () => void
```

**说明**：订阅「特征值变化」通知数据。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(deviceId: string, serviceId: string, characteristicId: string, value: ArrayBuffer) => void` | 是 | 回调（deviceId / serviceId / characteristicId / value） |

**返回值**：`() => void`——取消订阅函数

### `getRSSI`

```ts
getRSSI(deviceId: string): Promise<CapResult<number>>
```

**说明**：读取设备信号强度（RSSI）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | 是 | 设备 id（需先连接） |

**返回值**：`Promise<CapResult<number>>`

## 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `supported` | `boolean` | 是 | 平台是否支持蓝牙 |
| `available` | `boolean` | 是 | 适配器已打开（可用） |
| `devices` | `string[]` | 是 | 已配对/发现的设备名（wx.getBluetoothDevices；web 需用户手势不列） |

## 类型引用

### `BleDevice`

BLE 设备（wx.BluetoothDevice 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `deviceId` | `string` | — | 设备唯一 id |
| `name` | `string` | — | 设备名称 |
| `RSSI` | `number` | — | 信号强度（发现/连接后可得） |

### `BleService`

BLE 服务（wx.BLEService 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `uuid` | `string` | — | 服务 uuid |
| `isPrimary` | `boolean` | — | 是否主服务 |

### `BleCharacteristic`

BLE 特征值（wx.BLECharacteristic 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `uuid` | `string` | — | 特征值 uuid |
| `properties` | `{ read: boolean; write: boolean; notify: boolean; indicate: boolean }` | — | 支持的操作（read/write/notify/indicate） |

## 错误码

| code | 说明 |
|---|---|
| `bluetooth.unsupported` | 桥未提供 getBluetooth（useBluetooth 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.openBluetoothAdapter |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——能力桥未接线 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const res = await useBluetooth()

if (res.ok) {
  console.log('蓝牙可用:', res.data.available)
} else if (res.error.code.endsWith('.unsupported')) {
  // 平台不支持 → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->