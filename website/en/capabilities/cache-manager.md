---
title: useCacheManager (capability.cache-manager)
group: 设备与系统
order: 1016
---

# useCacheManager

**What it does**: Configure HTTP caching rules (max-age, weak-network policy) and clear cache.

**When to use it**: Offline support, weak-network speed-up, per-origin cache clearing.

**End support & boundaries**: No App-end equivalent (HTTP caching is owned by each platform network stack); all three App ends return `unsupported`. For offline needs, use `useStorage` / `useFileSystem` with your own ETag strategy.

> 技术标识：能力原语 C72 · `capability.cache-manager` · 返回 `CacheManagerHandle` · **Hook implemented** (per-end support in the table below)

useCacheManager: HTTP request cache manager — add/delete rules, start/stop, delete/clear caches, events (wx.createCacheManager; web has no equivalent → throws, use Service Worker / Cache Storage)

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

| Method | Doc |
|---|---|
| [`addRules`](#addrules) | — |
| [`deleteRules`](#deleterules) | — |
| [`clearRules`](#clearrules) | — |
| [`start`](#start) | — |
| [`stop`](#stop) | — |
| [`deleteCache`](#deletecache) | — |
| [`deleteCaches`](#deletecaches) | — |
| [`clearCaches`](#clearcaches) | — |
| [`getState`](#getstate) | — |
| [`on`](#on) | — |

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
| Web SPA | ⚠️ | vue-dom · webBridge createCacheManager is a pure shell (every path returns unsupported, no platform integration) → always Err |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createCacheManager |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const cm = useCacheManager({ mode: 'weakNetwork', maxAge: 60 }) // synchronous handle

if (cm.ok) {
  await cm.data.addRules([{ pattern: 'https://api.example.com/*', method: 'GET' }])
  await cm.data.start()
  cm.data.on('enterWeakNetwork', () => console.log('entered weak network — caching on'))
} else if (cm.error.code === 'cache-manager.unsupported') {
  // no Web equivalent → degradation path (Service Worker / Cache Storage)
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->