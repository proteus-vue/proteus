---
title: useBeacon（capability.beacon）
group: 设备与系统
order: 1018
---

# useBeacon

**它能做什么**：扫描身边的 iBeacon 蓝牙信标，拿到信标标识与信号强度（据此估算距离）。

**什么时候用**：室内定位、到店提醒、博物馆展项讲解、场馆签到打卡——GPS 在室内不准时用它。

**端实现边界**：**微信端可用，其余端如实不可用**。用法上有个容易漏的步骤：**必须先调 `startBeaconDiscovery(uuids)` 才会收到 `onUpdate`**——不搜索就订阅，微信端不会有任何回调（错误码 11004 通常意味着缺少定位/蓝牙授权）。Web 端浏览器没有 iBeacon 扫描 API（Web Bluetooth 需用户手势且不自带信标帧解析）；App 三端宿主均未实现 BLE 扫描。

> 技术标识：能力原语 C77 · `capability.beacon` · 返回 `BeaconAPI` · **Hook 已实现**（各端支持情况见下方兼容进度表）

★C77 useBeacon：iBeacon（wx.onBeaconServiceChange/onBeaconUpdate；web 空订阅）

## 签名

```ts
useBeacon(): CapResult<BeaconAPI>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `BeaconAPI` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`startBeaconDiscovery`](#startbeacondiscovery) | 开始搜索 iBeacon。 ★**必须先调用它才会收到 `onUpdate`**——订阅本身不会启动搜索。 |
| [`stopBeaconDiscovery`](#stopbeacondiscovery) | 停止搜索。停止后不再收到 `onUpdate`（订阅仍保留，下次 start 后继续回调）。 |
| [`onServiceChange`](#onservicechange) | 订阅 Beacon 服务状态变化（蓝牙开关 / 搜索开始与结束）。 |
| [`onUpdate`](#onupdate) | 订阅 Beacon 设备更新（**需先 `startBeaconDiscovery`**）。 |

### `startBeaconDiscovery`

```ts
startBeaconDiscovery(uuids: string[]): Promise<CapResult<void>>
```

**说明**：开始搜索 iBeacon。

★**必须先调用它才会收到 `onUpdate`**——订阅本身不会启动搜索。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `uuids` | `string[]` | 是 | 要搜索的 iBeacon UUID 列表（**至少一个**；传全 0 UUID 表示匹配所有信标） |

**返回值**：`Promise<CapResult<void>>`——成功 = 搜索已开始（真正发现设备仍靠 `onUpdate`）

### `stopBeaconDiscovery`

```ts
stopBeaconDiscovery(): Promise<CapResult<void>>
```

**说明**：停止搜索。停止后不再收到 `onUpdate`（订阅仍保留，下次 start 后继续回调）。

**返回值**：`Promise<CapResult<void>>`——成功 = 搜索已停止

### `onServiceChange`

```ts
onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void
```

**说明**：订阅 Beacon 服务状态变化（蓝牙开关 / 搜索开始与结束）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(res: { available: boolean; discovering: boolean }) => void` | 是 | 状态回调（available 服务可用 / discovering 搜索中） |

**返回值**：`() => void`——取消订阅函数

### `onUpdate`

```ts
onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void
```

**说明**：订阅 Beacon 设备更新（**需先 `startBeaconDiscovery`**）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(res: { beacons: BeaconInfo[] }) => void` | 是 | 设备回调（beacons 发现的设备列表） |

**返回值**：`() => void`——取消订阅函数

## 类型引用

### `BeaconAPI`

iBeacon（`useBeacon()`）。

★★**关键语义：必须先 `startBeaconDiscovery` 才会收到 `onUpdate`** ——
微信端不搜索就订阅，上层永远收不到任何更新（错误码 11004）。
这是本能力最容易被漏掉的一步，也是原契约（只有两个订阅）对业务不可用的原因。

端边界：只有微信提供；Web 无 iBeacon 扫描标准、App 三端宿主未实现 BLE 扫描 ⇒ Hook 返回 `beacon.unsupported`。

| 方法 | 签名 | 说明 |
|---|---|---|
| `startBeaconDiscovery` | `startBeaconDiscovery(uuids: string[]): Promise<CapResult<void>>` | 开始搜索 iBeacon。 ★**必须先调用它才会收到 `onUpdate`**——订阅本身不会启动搜索。 |
| `stopBeaconDiscovery` | `stopBeaconDiscovery(): Promise<CapResult<void>>` | 停止搜索。停止后不再收到 `onUpdate`（订阅仍保留，下次 start 后继续回调）。 |
| `onServiceChange` | `onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void` | 订阅 Beacon 服务状态变化（蓝牙开关 / 搜索开始与结束）。 |
| `onUpdate` | `onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void` | 订阅 Beacon 设备更新（**需先 `startBeaconDiscovery`**）。 |

### `BeaconInfo`

iBeacon 设备信息（wx `BeaconInfo`）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `uuid` | `string` | — | 设备 uuid |
| `major` | `number` | — | major 值 |
| `minor` | `number` | — | minor 值 |
| `accuracy` | `number` | — | 距离（米） |
| `rssi` | `number` | — | 信号强度 |
| `proximity` | `0 \| 1 \| 2 \| 3` | — | 距离档位（0 未知 / 1 极近 / 2 近 / 3 远） |

### `CapError`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `code` | `string` | — | — |
| `message` | `string` | — | — |
| `cause` | `unknown` | — | — |

## 错误码

| code | 说明 |
|---|---|
| `beacon.unsupported` | 桥未提供 getBeacon（useBeacon 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge 未提供 getBeacon → Err 显式降级（平台无直通 API） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.onBeaconServiceChange/onBeaconUpdate |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit + CoreAnimation） · 渲染核心已落地——能力桥未接线 |
| Android 原生 | 🟡 | native-android（自绘 Canvas） · 渲染核心已落地——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI RenderNode） · 渲染核心已落地——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供**或桥是纯空壳**→Err 显式降级（方法存在但每一条路径都返回 unsupported 不算可用）；🟡 能力桥未接线；⬜ 端未开始。★**各端判据严格度不同**：微信/Web 要求桥方法存在**且方法体真有平台对接**；iOS/Android 要求 App 桥工厂里有该方法；鸿蒙要求 JS 桥 + 宿主分派**双证据**。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const beacon = useBeacon() // 同步句柄——无 await、无 res.ok

if (beacon.ok) {
  // ★先订阅，再开始搜索——不搜索就收不到任何 onUpdate（微信端 11004）
  beacon.data.onServiceChange((res) => console.log("Beacon 服务:", res.available))
  beacon.data.onUpdate((res) => console.log("发现:", res.beacons.length, "个 Beacon"))
  const started = await beacon.data.startBeaconDiscovery(["FDA50693-A4E2-4FB1-AFCF-C6EB07647825"])
  if (!started.ok) console.log('搜索失败:', started.error.code) // beacon.failed / unsupported
  // beacon.data.stopBeaconDiscovery() 停止搜索（订阅仍保留）
} else if (beacon.error.code === 'beacon.unsupported') {
  // 平台不支持 → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->