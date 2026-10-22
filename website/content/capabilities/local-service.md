---
title: useLocalService（capability.local-service）
group: 网络与通信
order: 11
---

# useLocalService

**它能做什么**：在局域网里发现/广播服务（mDNS）。

**什么时候用**：同一 WiFi 下发现打印机、投屏设备、局域网协作。

**端实现边界**：**微信 + App 两端可用；Web 不可用**（浏览器没有 mDNS 服务发现 API）。用法上有个容易漏的步骤：**必须先调 `startDiscovery(serviceType)` 才会收到 `onFound`**——订阅本身不会启动搜索。★这个契约缺陷本轮才补：此前只有四个订阅、没有启停开关，等于给业务一个"照文档写完什么都不会发生"的接口（与 `useBeacon` 同一族缺陷）。两端形态差异：Android 用 `NsdManager`（`onServiceFound` 之后需**二次 resolve** 才拿得到 ip/port）；iOS 用 `NWBrowser` + `NetService` 解析。

> 技术标识：能力原语 C78 · `capability.local-service` · 返回 `LocalServiceAPI` · **Hook 已实现**（各端支持情况见下方兼容进度表）

★C78 useLocalService：局域网 mDNS（wx.onLocalService*；web 空订阅）

## 签名

```ts
useLocalService(): CapResult<LocalServiceAPI>
```

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `LocalServiceAPI` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`startDiscovery`](#startdiscovery) | ★#1097：**必须先 startDiscovery 才会收到 onFound**（与 useBeacon 同形态——订阅不启动搜索）。 |
| [`stopDiscovery`](#stopdiscovery) | 停止搜索（订阅保留；会触发一次 `onDiscoveryStop`）。 |
| [`onFound`](#onfound) | 订阅发现新服务（**需先 `startDiscovery`**）。 |
| [`onLost`](#onlost) | 订阅服务离开。 |
| [`onResolveFail`](#onresolvefail) | 订阅服务解析失败。 |
| [`onDiscoveryStop`](#ondiscoverystop) | 订阅搜索停止。 |

### `startDiscovery`

```ts
startDiscovery(serviceType: string): Promise<CapResult<void>>
```

**说明**：★#1097：**必须先 startDiscovery 才会收到 onFound**（与 useBeacon 同形态——订阅不启动搜索）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `serviceType` | `string` | 是 | mDNS 类型（如 `'_http._tcp'`） |

**返回值**：`Promise<CapResult<void>>`

### `stopDiscovery`

```ts
stopDiscovery(): Promise<CapResult<void>>
```

**说明**：停止搜索（订阅保留；会触发一次 `onDiscoveryStop`）。

**返回值**：`Promise<CapResult<void>>`

### `onFound`

```ts
onFound(cb: (res: LocalServiceInfo) => void): () => void
```

**说明**：订阅发现新服务（**需先 `startDiscovery`**）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | 是 | 服务回调 |

**返回值**：`() => void`——取消订阅函数

### `onLost`

```ts
onLost(cb: (res: LocalServiceInfo) => void): () => void
```

**说明**：订阅服务离开。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | 是 | 服务回调 |

**返回值**：`() => void`——取消订阅函数

### `onResolveFail`

```ts
onResolveFail(cb: (res: LocalServiceInfo) => void): () => void
```

**说明**：订阅服务解析失败。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `(res: LocalServiceInfo) => void` | 是 | 服务回调 |

**返回值**：`() => void`——取消订阅函数

### `onDiscoveryStop`

```ts
onDiscoveryStop(cb: () => void): () => void
```

**说明**：订阅搜索停止。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cb` | `() => void` | 是 | 停止回调 |

**返回值**：`() => void`——取消订阅函数

## 类型引用

### `LocalServiceAPI`

★权威标尺缺口 C78：局域网服务发现（`useLocalService()`，mDNS）。
wx：`wx.onLocalServiceFound` / `onLocalServiceLost` / `onLocalServiceResolveFail`
/ `onLocalServiceDiscoveryStop`；web：无标准 mDNS → Err 诚实降级。

| 方法 | 签名 | 说明 |
|---|---|---|
| `startDiscovery` | `startDiscovery(serviceType: string): Promise<CapResult<void>>` | ★#1097：**必须先 startDiscovery 才会收到 onFound**（与 useBeacon 同形态——订阅不启动搜索）。 |
| `stopDiscovery` | `stopDiscovery(): Promise<CapResult<void>>` | 停止搜索（订阅保留；会触发一次 `onDiscoveryStop`）。 |
| `onFound` | `onFound(cb: (res: LocalServiceInfo) => void): () => void` | 订阅发现新服务（**需先 `startDiscovery`**）。 |
| `onLost` | `onLost(cb: (res: LocalServiceInfo) => void): () => void` | 订阅服务离开。 |
| `onResolveFail` | `onResolveFail(cb: (res: LocalServiceInfo) => void): () => void` | 订阅服务解析失败。 |
| `onDiscoveryStop` | `onDiscoveryStop(cb: () => void): () => void` | 订阅搜索停止。 |

### `LocalServiceInfo`

mDNS 局域网服务（wx OnLocalServiceFound/Lost）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `serviceName` | `string` | — | 服务名 |
| `serviceType` | `string` | — | 服务类型（如 _http._tcp） |
| `ip` | `string` | — | 服务 IP |
| `port` | `number` | — | 服务端口 |

### `CapError`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `code` | `string` | — | — |
| `message` | `string` | — | — |
| `cause` | `unknown` | — | — |

## 错误码

| code | 说明 |
|---|---|
| `local-service.unsupported` | 桥未提供 getLocalService（useLocalService 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge 未提供 getLocalService → Err 显式降级（平台无直通 API） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.onLocalServiceFound/Lost/ResolveFail/DiscoveryStop |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | ✅ | native-ios（UIKit + CoreAnimation） · App 宿主桥（capability-app.ts）· 桥方法已接入 |
| Android 原生 | ✅ | native-android（自绘 Canvas） · App 宿主桥（capability-app.ts）· 桥方法已接入 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI RenderNode） · App 桥已就绪（平台中立）——鸿蒙宿主壳未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供**或桥是纯空壳**→Err 显式降级（方法存在但每一条路径都返回 unsupported 不算可用）；🟡 能力桥未接线；⬜ 端未开始。★**各端判据严格度不同**：微信/Web 要求桥方法存在**且方法体真有平台对接**；iOS/Android 要求 App 桥工厂里有该方法；鸿蒙要求 JS 桥 + 宿主分派**双证据**。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const mdns = useLocalService() // 同步句柄——无 await、无 res.ok

if (mdns.ok) {
  mdns.data.onFound((svc) => console.log("发现服务:", svc.serviceName, svc.ip, svc.port))
  mdns.data.onLost((svc) => console.log("服务离开:", svc.serviceName))
  mdns.data.onDiscoveryStop(() => console.log("搜索停止"))
} else if (mdns.error.code === 'local-service.unsupported') {
  // 平台不支持 mDNS → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->