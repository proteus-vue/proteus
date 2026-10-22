---
title: useCacheManager（capability.cache-manager）
group: 设备与系统
order: 1016
---

# useCacheManager

**它能做什么**：为网络请求配置缓存规则（最大存活时间、弱网策略），并清理缓存。

**什么时候用**：离线可用、弱网加速、按域名清缓存。

**端实现边界**：App 端**无对等物**（HTTP 缓存策略由各端网络栈自行决定），三端均返回 `unsupported`。需要离线能力请用 `useStorage` / `useFileSystem` + 本地 ETag 策略自行实现。

> 技术标识：能力原语 C72 · `capability.cache-manager` · 返回 `CacheManagerHandle` · **Hook 已实现**（各端支持情况见下方兼容进度表）

★C72 useCacheManager：缓存管理（wx.createCacheManager；web → throw）

## 签名

```ts
useCacheManager(options?: { maxAge?: number; mode?: 'weakNetwork' | 'always' | 'none'; origin?: string }): CapResult<CacheManagerHandle>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `{ maxAge?: number; mode?: 'weakNetwork' \| 'always' \| 'none'; origin?: string }` | 否 | 选项对象（字段见下表） |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `CacheManagerHandle` | 成功载荷（结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 说明 |
|---|---|
| [`addRules`](#addrules) | 添加缓存规则。 |
| [`deleteRules`](#deleterules) | 删除缓存规则。 |
| [`clearRules`](#clearrules) | 清空全部规则 |
| [`start`](#start) | 启动缓存 |
| [`stop`](#stop) | 停止缓存 |
| [`deleteCache`](#deletecache) | 删除指定 URL 的缓存。 |
| [`deleteCaches`](#deletecaches) | 批量删除缓存。 |
| [`clearCaches`](#clearcaches) | 清空全部缓存 |
| [`getState`](#getstate) | 读取当前配置 |
| [`on`](#on) | 订阅缓存事件。 |

### `addRules`

```ts
addRules(rules: CacheRule[]): Promise<CapResult<string[]>>
```

**说明**：添加缓存规则。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rules` | `CacheRule[]` | 是 | 规则列表 |

**返回值**：`Promise<CapResult<string[]>>`——规则 id 列表

### `deleteRules`

```ts
deleteRules(ids: string[]): Promise<CapResult<void>>
```

**说明**：删除缓存规则。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `string[]` | 是 | 规则 id 列表 |

**返回值**：`Promise<CapResult<void>>`

### `clearRules`

```ts
clearRules(): Promise<CapResult<void>>
```

**说明**：清空全部规则

**返回值**：`Promise<CapResult<void>>`

### `start`

```ts
start(): Promise<CapResult<void>>
```

**说明**：启动缓存

**返回值**：`Promise<CapResult<void>>`

### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**说明**：停止缓存

**返回值**：`Promise<CapResult<void>>`

### `deleteCache`

```ts
deleteCache(id: string): Promise<CapResult<void>>
```

**说明**：删除指定 URL 的缓存。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 缓存 id |

**返回值**：`Promise<CapResult<void>>`

### `deleteCaches`

```ts
deleteCaches(ids: string[]): Promise<CapResult<void>>
```

**说明**：批量删除缓存。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `string[]` | 是 | 缓存 id 列表 |

**返回值**：`Promise<CapResult<void>>`

### `clearCaches`

```ts
clearCaches(): Promise<CapResult<void>>
```

**说明**：清空全部缓存

**返回值**：`Promise<CapResult<void>>`

### `getState`

```ts
getState(): CacheManagerState
```

**说明**：读取当前配置

**返回值**：`CacheManagerState`

### `on`

```ts
on(event: 'request' | 'enterWeakNetwork' | 'exitWeakNetwork', cb: (payload: unknown) => void): () => void
```

**说明**：订阅缓存事件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `event` | `'request' \| 'enterWeakNetwork' \| 'exitWeakNetwork'` | 是 | 事件（request 命中规则 / enterWeakNetwork 进入弱网 / exitWeakNetwork 退出弱网） |
| `cb` | `(payload: unknown) => void` | 是 | 事件处理器 |

**返回值**：`() => void`——取消订阅函数

## 属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rules` | `CacheRule[]` | 是 | 缓存规则（可读写） |

## 类型引用

### `CacheManagerHandle`

★权威标尺缺口 C72：缓存管理（`useCacheManager(options?)`）。
wx：`wx.createCacheManager`（HTTP 请求缓存——规则/启停/清理/删除 + 事件）；
web：无对等（可用 Service Worker / Cache Storage）→ 创建时 throw 诚实降级。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `rules` | `CacheRule[]` | — | 缓存规则（可读写） |

| 方法 | 签名 | 说明 |
|---|---|---|
| `addRules` | `addRules(rules: CacheRule[]): Promise<CapResult<string[]>>` | 添加缓存规则。 |
| `deleteRules` | `deleteRules(ids: string[]): Promise<CapResult<void>>` | 删除缓存规则。 |
| `clearRules` | `clearRules(): Promise<CapResult<void>>` | 清空全部规则 |
| `start` | `start(): Promise<CapResult<void>>` | 启动缓存 |
| `stop` | `stop(): Promise<CapResult<void>>` | 停止缓存 |
| `deleteCache` | `deleteCache(id: string): Promise<CapResult<void>>` | 删除指定 URL 的缓存。 |
| `deleteCaches` | `deleteCaches(ids: string[]): Promise<CapResult<void>>` | 批量删除缓存。 |
| `clearCaches` | `clearCaches(): Promise<CapResult<void>>` | 清空全部缓存 |
| `getState` | `getState(): CacheManagerState` | 读取当前配置 |
| `on` | `on(event: 'request' \| 'enterWeakNetwork' \| 'exitWeakNetwork', cb: (payload: unknown) => void): () => void` | 订阅缓存事件。 |

### `CacheRule`

缓存规则（wx.addRules 的字符串 / 正则形态简化为声明式）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `pattern` | `string` | — | 匹配 URL 的字符串或正则源 |
| `method` | `string` | `GET` | 缓存方法（缺省 GET） |
| `maxAge` | `number` | — | 最大缓存时长（秒） |

### `CacheManagerState`

缓存管理器状态

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mode` | `'weakNetwork' \| 'always' \| 'none'` | — | 缓存模式（weakNetwork 弱网 / always 总是 / none 关闭） |
| `state` | `number` | — | 运行状态（0 未启动 / 1 运行中 / 2 已停止——对齐 wx state） |
| `origin` | `string` | — | 缓存域名 |
| `maxAge` | `number` | — | 默认最大缓存时长（秒） |

### `CapError`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `code` | `string` | — | — |
| `message` | `string` | — | — |
| `cause` | `unknown` | — | — |

## 错误码

| code | 说明 |
|---|---|
| `cache-manager.unsupported` | 桥未提供 createCacheManager（useCacheManager 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge createCacheManager 是纯空壳（全部出口 unsupported）→ 恒 Err |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.createCacheManager |
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
const cm = useCacheManager({ mode: 'weakNetwork', maxAge: 60 }) // 同步句柄

if (cm.ok) {
  await cm.data.addRules([{ pattern: 'https://api.example.com/*', method: 'GET' }])
  await cm.data.start()
  cm.data.on('enterWeakNetwork', () => console.log('进入弱网，启用缓存'))
} else if (cm.error.code === 'cache-manager.unsupported') {
  // Web 无对等 → 降级路径（Service Worker / Cache Storage）
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->