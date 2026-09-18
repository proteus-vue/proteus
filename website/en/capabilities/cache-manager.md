---
title: useCacheManager (capability.cache-manager)
group: 设备与系统
order: 1015
---

# useCacheManager

useCacheManager: HTTP request cache manager — add/delete rules, start/stop, delete/clear caches, events (wx.createCacheManager; web has no equivalent → throws, use Service Worker / Cache Storage)

> Capability primitive C72 · `capability.cache-manager` · returns `CacheManagerHandle` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useCacheManager(options?: { maxAge?: number; mode?: 'weakNetwork' | 'always' | 'none'; origin?: string }): CapResult<CacheManagerHandle>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `options` | `{ maxAge?: number; mode?: 'weakNetwork' \| 'always' \| 'none'; origin?: string }` | No | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `CacheManagerHandle` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`addRules`](#addrules) | `addRules(rules: CacheRule[]): Promise<CapResult<string[]>>` | — |
| [`deleteRules`](#deleterules) | `deleteRules(ids: string[]): Promise<CapResult<void>>` | — |
| [`clearRules`](#clearrules) | `clearRules(): Promise<CapResult<void>>` | — |
| [`start`](#start) | `start(): Promise<CapResult<void>>` | — |
| [`stop`](#stop) | `stop(): Promise<CapResult<void>>` | — |
| [`deleteCache`](#deletecache) | `deleteCache(id: string): Promise<CapResult<void>>` | — |
| [`deleteCaches`](#deletecaches) | `deleteCaches(ids: string[]): Promise<CapResult<void>>` | — |
| [`clearCaches`](#clearcaches) | `clearCaches(): Promise<CapResult<void>>` | — |
| [`getState`](#getstate) | `getState(): CacheManagerState` | — |
| [`on`](#on) | `on(event: 'request' \| 'enterWeakNetwork' \| 'exitWeakNetwork', cb: (payload: unknown) => void): () => void` | — |

### `addRules`

```ts
addRules(rules: CacheRule[]): Promise<CapResult<string[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `rules` | `CacheRule[]` | Yes | 规则列表 |

**Returns**: `Promise<CapResult<string[]>>` -- 规则 id 列表

### `deleteRules`

```ts
deleteRules(ids: string[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `string[]` | Yes | 规则 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `clearRules`

```ts
clearRules(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `start`

```ts
start(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `stop`

```ts
stop(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `deleteCache`

```ts
deleteCache(id: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `id` | `string` | Yes | 缓存 id |

**Returns**: `Promise<CapResult<void>>`

### `deleteCaches`

```ts
deleteCaches(ids: string[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `string[]` | Yes | 缓存 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `clearCaches`

```ts
clearCaches(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `getState`

```ts
getState(): CacheManagerState
```

**Returns**: `CacheManagerState`

### `on`

```ts
on(event: 'request' | 'enterWeakNetwork' | 'exitWeakNetwork', cb: (payload: unknown) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `event` | `'request' \| 'enterWeakNetwork' \| 'exitWeakNetwork'` | Yes | 事件（request 命中规则 / enterWeakNetwork 进入弱网 / exitWeakNetwork 退出弱网） |
| `cb` | `(payload: unknown) => void` | Yes | 事件处理器 |

**Returns**: `() => void` -- 取消订阅函数

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `rules` | `CacheRule[]` | Yes | 缓存规则（可读写） |

## Referenced types

### `CacheRule`

缓存规则（wx.addRules 的字符串 / 正则形态简化为声明式）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `pattern` | `string` | — | 匹配 URL 的字符串或正则源 |
| `method` | `string` | `GET` | 缓存方法（缺省 GET） |
| `maxAge` | `number` | — | 最大缓存时长（秒） |

### `CacheManagerState`

缓存管理器状态

| Prop | Type | Default | Doc |
|---|---|---|---|
| `mode` | `'weakNetwork' \| 'always' \| 'none'` | — | 缓存模式（weakNetwork 弱网 / always 总是 / none 关闭） |
| `state` | `number` | — | 运行状态（0 未启动 / 1 运行中 / 2 已停止——对齐 wx state） |
| `origin` | `string` | — | 缓存域名 |
| `maxAge` | `number` | — | 默认最大缓存时长（秒） |

## Error codes

| code | Doc |
|---|---|
| `cache-manager.unsupported` | The cache-manager API is missing (web has no WeChat request cache manager — use Service Worker / Cache Storage) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createCacheManager |
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
const res = await useCacheManager()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->