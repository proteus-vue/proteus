---
title: useIntersection (capability.intersection)
group: 设备与系统
order: 1012
---

# useIntersection

useIntersection: intersection observer — relativeTo/relativeToViewport + observe + disconnect (wx.createIntersectionObserver; web IntersectionObserver)

> Capability primitive C59 · `capability.intersection` · returns `IntersectionHandle` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useIntersection(options?: IntersectionOptions): CapResult<IntersectionHandle>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `options` | `IntersectionOptions` | No | — |

#### Properties of `options`

| Property | Type | Required | Doc |
|---|---|---|---|
| `thresholds` | `number[]` | No | — |
| `initialRatio` | `number` | No | — |
| `observeAll` | `boolean` | No | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `IntersectionHandle` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`relativeTo`](#relativeto) | `relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | — |
| [`relativeToViewport`](#relativetoviewport) | `relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | — |
| [`observe`](#observe) | `observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle` | — |
| [`disconnect`](#disconnect) | `disconnect(): void` | — |

### `relativeTo`

```ts
relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `selector` | `string` | Yes | 参照元素选择器 |
| `margins` | `{ left?: number; right?: number; top?: number; bottom?: number }` | No | 参照物扩展/收缩边界 |

**Returns**: `IntersectionHandle`

### `relativeToViewport`

```ts
relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `margins` | `{ left?: number; right?: number; top?: number; bottom?: number }` | No | 视口扩展/收缩边界 |

**Returns**: `IntersectionHandle`

### `observe`

```ts
observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `targetSelector` | `string` | Yes | 目标元素选择器 |
| `cb` | `(result: IntersectionResult) => void` | Yes | 相交状态变化回调 |

**Returns**: `IntersectionHandle`

### `disconnect`

```ts
disconnect(): void
```

**Returns**: `void`

## Referenced types

### `IntersectionHandle`

交叉观察句柄（IntersectionHandle.observe / relativeTo* / disconnect）

| Method | Signature | Doc |
|---|---|---|
| `relativeTo` | `relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 指定参照元素（相对该元素观察）。 |
| `relativeToViewport` | `relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 以显示区域（视口）为参照。 |
| `observe` | `observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle` | 开始观察目标元素。 |
| `disconnect` | `disconnect(): void` | 停止观察（释放） |

### `IntersectionResult`

交叉观察结果（IntersectionObserver 回调载荷——对齐官方字段）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `id` | `string` | — | 元素 id |
| `dataset` | `Record<string, unknown>` | — | dataset 数据 |
| `intersectionRatio` | `number` | — | 相交比例（0–1） |
| `intersectionRect` | `{ left: number; top: number; right: number; bottom: number; width: number; height: number }` | — | 相交区域 |
| `boundingClientRect` | `ElementRect` | — | 目标边界 |
| `relativeRect` | `{ left: number; top: number; right: number; bottom: number; width: number; height: number }` | — | 相对参照物的区域 |
| `time` | `number` | — | 时间戳 |

### `ElementRect`

元素几何（SelectorQuery.boundingClientRect 结果——对齐官方字段）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `id` | `string` | — | 元素 id |
| `dataset` | `Record<string, unknown>` | — | dataset 数据 |
| `left` | `number` | — | 左边界（相对显示区域） |
| `top` | `number` | — | 上边界 |
| `right` | `number` | — | 右边界 |
| `bottom` | `number` | — | 下边界 |
| `width` | `number` | — | 宽度 |
| `height` | `number` | — | 高度 |

## Error codes

| code | Doc |
|---|---|
| `element.unsupported` | The bridge does not provide createIntersection (useIntersection unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createIntersectionObserver |
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
const res = await useIntersection()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->