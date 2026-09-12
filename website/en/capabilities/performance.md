---
title: usePerformance (capability.performance)
group: 可观测与调试
order: 8003
---

# usePerformance

usePerformance: performance handle — entries (navigation/render/script) + real-time observer + setBufferSize + report a custom metric (wx.getPerformance/reportPerformance; web performance.getEntries*)

> Capability primitive C66 · `capability.performance` · returns `PerformanceAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
usePerformance(): CapResult<PerformanceAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `PerformanceAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`getEntries`](#getentries) | `getEntries(entryType?: 'navigation' \| 'render' \| 'script'): Promise<CapResult<PerformanceEntry[]>>` | — |
| [`getEntriesByName`](#getentriesbyname) | `getEntriesByName(name: string, entryType?: string): Promise<CapResult<PerformanceEntry[]>>` | — |
| [`createObserver`](#createobserver) | `createObserver(): PerformanceObserverHandle` | — |
| [`setBufferSize`](#setbuffersize) | `setBufferSize(size: number): void` | — |
| [`report`](#report) | `report(id: number, value: number, dimensions?: string \| unknown[]): Promise<CapResult<void>>` | — |

### `getEntries`

```ts
getEntries(entryType?: 'navigation' | 'render' | 'script'): Promise<CapResult<PerformanceEntry[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `entryType` | `'navigation' \| 'render' \| 'script'` | No | — |

**Returns**: `Promise<CapResult<PerformanceEntry[]>>`

### `getEntriesByName`

```ts
getEntriesByName(name: string, entryType?: string): Promise<CapResult<PerformanceEntry[]>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `name` | `string` | Yes | — |
| `entryType` | `string` | No | — |

**Returns**: `Promise<CapResult<PerformanceEntry[]>>`

### `createObserver`

```ts
createObserver(): PerformanceObserverHandle
```

**Returns**: `PerformanceObserverHandle`

### `setBufferSize`

```ts
setBufferSize(size: number): void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `size` | `number` | Yes | — |

**Returns**: `void`

### `report`

```ts
report(id: number, value: number, dimensions?: string | unknown[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `id` | `number` | Yes | 指标 id |
| `value` | `number` | Yes | 指标值 |
| `dimensions` | `string \| unknown[]` | No | 自定义维度（字符串或数组） |

**Returns**: `Promise<CapResult<void>>`

## Referenced types

### `PerformanceEntry`

性能条目（wx PerformanceEntry 子集——navigation 导航 / render 渲染 / script 脚本）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `name` | `string` | — | 条目名（路由名 / 脚本路径等） |
| `entryType` | `'navigation' \| 'render' \| 'script'` | — | 条目类型 |
| `duration` | `number` | — | 时长（ms） |
| `startTime` | `number` | — | 开始时间（ms） |
| `fileList` | `string[]` | — | 关联文件列表（script 类） |
| `moduleName` | `string` | — | 模块名（script 类） |

### `PerformanceObserverHandle`

性能观察器句柄（wx PerformanceObserver 子集）

| Method | Signature | Doc |
|---|---|---|
| `observe` | `observe(cb: (entries: PerformanceEntry[]) => void, entryTypes?: string[]): void` | 开始观察新性能条目。 |
| `disconnect` | `disconnect(): void` | 取消观察（释放） |

## Error codes

| code | Doc |
|---|---|
| `performance.unsupported` | The performance API is missing (or the web performance API is unavailable; report needs the Mini Program platform) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.getPerformance/reportPerformance |
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
const res = await usePerformance()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->