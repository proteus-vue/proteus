---
title: useNFC（capability.nfc）
group: 网络与通信
order: 8
---

# useNFC

useNFC：NFC 状态（wx.getHCEState / web NDEFReader 特性探测）

> 能力原语 C37 · `capability.nfc` · 返回 `NFCAPI` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useNFC(): Promise<CapResult<NFCAPI>>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `NFCAPI` | 成功载荷（结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`startHCE`](#starthce) | `startHCE(aidList: string[]): Promise<CapResult<void>>` | 启动 HCE（模拟卡；aidList 应用标识） |
| [`stopHCE`](#stophce) | `stopHCE(): Promise<CapResult<void>>` | 停止 HCE |
| [`sendHCEMessage`](#sendhcemessage) | `sendHCEMessage(data: ArrayBuffer): Promise<CapResult<void>>` | 发送 APDU 响应（收到 onHCEMessage 后回） |
| [`onHCEMessage`](#onhcemessage) | `onHCEMessage(cb: (message: { messageType: number; data?: ArrayBuffer }) => void): () => void` | 订阅 HCE 消息（返回取消） |
| [`onHCEStateChange`](#onhcestatechange) | `onHCEStateChange(cb: (available: boolean) => void): () => void` | 订阅 HCE 状态变化（返回取消） |
| [`getAdapter`](#getadapter) | `getAdapter(): NfcAdapter` | ★能力颗粒度对齐：读卡模式适配器（wx.getNFCAdapter）——发现标签 + 各技术类型连接 |

### `startHCE`

```ts
startHCE(aidList: string[]): Promise<CapResult<void>>
```

**说明**：启动 HCE（模拟卡；aidList 应用标识）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `aidList` | `string[]` | 是 | 数组参数 |

**返回值**：`Promise<CapResult<void>>`

### `stopHCE`

```ts
stopHCE(): Promise<CapResult<void>>
```

**说明**：停止 HCE

**返回值**：`Promise<CapResult<void>>`

### `sendHCEMessage`

```ts
sendHCEMessage(data: ArrayBuffer): Promise<CapResult<void>>
```

**说明**：发送 APDU 响应（收到 onHCEMessage 后回）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `data` | `ArrayBuffer` | 是 | 数据 |

**返回值**：`Promise<CapResult<void>>`

### `onHCEMessage`

```ts
onHCEMessage(cb: (message: { messageType: number; data?: ArrayBuffer }) => void): () => void
```

**说明**：订阅 HCE 消息（返回取消）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(message: { messageType: number; data?: ArrayBuffer }) => void` | 否 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `onHCEStateChange`

```ts
onHCEStateChange(cb: (available: boolean) => void): () => void
```

**说明**：订阅 HCE 状态变化（返回取消）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(available: boolean) => void` | 是 | 事件 / 结果回调函数 |

**返回值**：`() => void`

### `getAdapter`

```ts
getAdapter(): NfcAdapter
```

**说明**：★能力颗粒度对齐：读卡模式适配器（wx.getNFCAdapter）——发现标签 + 各技术类型连接

**返回值**：`NfcAdapter`

## 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `supported` | `boolean` | 是 | 平台是否支持 NFC |
| `available` | `boolean` | 是 | NFC 当前可用（已开启） |

## 类型引用

### `NfcAdapter`

★能力颗粒度对齐：C37 NFC 读卡模式（wx.getNFCAdapter——发现标签 + Ndef/NfcA/B/F/V/IsoDep/Mifare 连接） 与 HCE（模拟卡）互补：HCE 让手机当卡，Adapter 让手机读卡。

| 方法 | 签名 | 说明 |
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

### `NfcTag`

NFC 发现的标签

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | `ArrayBuffer` | — | — |
| `techs` | `string[]` | — | — |
| `messages` | `Array<{ records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }>` | — | — |

### `NdefHandle`

NDEF 句柄（额外：读写 NDEF 消息 + onNdefMessage）

| 方法 | 签名 | 说明 |
|---|---|---|
| `writeNdefMessage` | `writeNdefMessage(message: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }): Promise<CapResult<void>>` | — |
| `onNdefMessage` | `onNdefMessage(cb: (message: { records: Array<{ id: ArrayBuffer; payload: ArrayBuffer; tnf: number; type: ArrayBuffer }> }) => void): () => void` | — |

### `NfcTagHandle`

NFC 标签连接句柄（各技术类型公共面：connect/close/isConnected/setTimeout/transceive）

| 方法 | 签名 | 说明 |
|---|---|---|
| `connect` | `connect(): Promise<CapResult<void>>` | — |
| `close` | `close(): Promise<CapResult<void>>` | — |
| `isConnected` | `isConnected(): boolean` | — |
| `setTimeout` | `setTimeout(timeout: number): Promise<CapResult<void>>` | — |
| `transceive` | `transceive(data: ArrayBuffer): Promise<CapResult<ArrayBuffer>>` | — |

## 错误码

| code | 说明 |
|---|---|
| `nfc.unsupported` | 桥未提供 getNfc（useNFC 不可用） |
| `nfc.failed` | wx  |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.getHCEState |
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
const res = await useNFC()

if (res.ok) {
  console.log('NFC:', res.data.supported, res.data.available)
} else if (res.error.code.endsWith('.unsupported')) {
  // 平台不支持 → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->