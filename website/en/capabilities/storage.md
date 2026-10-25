---
title: useStorage (capability.storage)
group: 存储与文件
order: 2001
---

# useStorage

**What it does**: Persist key-value data locally.

**When to use it**: Sessions, drafts, user preferences.

> 技术标识：能力原语 C15 · `capability.storage` · 返回 `StorageAPI` · **Hook implemented** (per-end support in the table below)

useStorage: storage handle (see createReactiveStorage for the reactive enhancement)

## Signature

```ts
useStorage(): CompatStorage
```

## Returns

Returns `CompatStorage` (synchronous handle/state object).

## Methods

| Method | Doc |
|---|---|
| [`set`](#set) | — |
| [`remove`](#remove) | — |
| [`clear`](#clear) | — |
| [`setAsync`](#setasync) | — |
| [`removeAsync`](#removeasync) | — |
| [`clearAsync`](#clearasync) | — |
| [`info`](#info) | — |
| [`batchGet`](#batchget) | — |
| [`batchSet`](#batchset) | — |

### `set`

```ts
set(key: string, value: unknown): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `key` | `string` | Yes | — |
| `value` | `unknown` | Yes | — |

**Returns**: `void`

### `remove`

```ts
remove(key: string): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `key` | `string` | Yes | — |

**Returns**: `void`

### `clear`

```ts
clear(): void
```

**Returns**: `void`

### `setAsync`

```ts
setAsync(key: string, value: unknown): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `key` | `string` | Yes | — |
| `value` | `unknown` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

### `removeAsync`

```ts
removeAsync(key: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `key` | `string` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

### `clearAsync`

```ts
clearAsync(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `info`

```ts
info(): Promise<CapResult<{ keys: string[]; currentSize: number; limitSize: number }>>
```

**Returns**: `Promise<CapResult<{ keys: string[]; currentSize: number; limitSize: number }>>`

### `batchGet`

```ts
batchGet(keys: string[]): Promise<CapResult<Array<{ key: string; value: unknown }>>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `keys` | `string[]` | Yes | — |

**Returns**: `Promise<CapResult<Array<{ key: string; value: unknown }>>>`

### `batchSet`

```ts
batchSet(kvList: Array<{ key: string; value: unknown }>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `kvList` | `Array<{ key: string; value: unknown }>` | Yes | — |

**Returns**: `Promise<CapResult<void>>`

## Error codes

| code | Doc |
|---|---|
| `storage.unsupported` | Bridge does not provide getStorage (useStorage unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.set/getStorage |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | ✅ | native-harmony (ArkUI RenderNode) · Harmony host wired (proteus_fs.h) |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `CompatStorage`

存储契约（useStorage / reactive storage 底座）

| Prop/Method | Type | Doc |
|---|---|---|
| `set` | `set(key: string, value: unknown): void` | 同步写入 |
| `remove` | `remove(key: string): void` | 同步删除 |
| `clear` | `clear(): void` | 同步清空 |
| `setAsync` | `setAsync(key: string, value: unknown): Promise<CapResult<void>>` | 异步写入（大值不阻塞主线程） |
| `removeAsync` | `removeAsync(key: string): Promise<CapResult<void>>` | 异步删除 |
| `clearAsync` | `clearAsync(): Promise<CapResult<void>>` | 异步清空 |
| `info` | `info(): Promise<CapResult<{ keys: string[]; currentSize: number; limitSize: number }>>` | 存储信息（keys / 已用 / 上限） |
| `batchGet` | `batchGet(keys: string[]): Promise<CapResult<Array<{ key: string; value: unknown }>>>` | 批量读 |
| `batchSet` | `batchSet(kvList: Array<{ key: string; value: unknown }>): Promise<CapResult<void>>` | 批量写 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const store = useStorage() // synchronous handle — no await, no res.ok

store.set('theme', 'dark')
console.log('theme =', store.get('theme'))
// store.remove(key) / store.clear(); reactivity booster: createReactiveStorage(store, reactive)
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->