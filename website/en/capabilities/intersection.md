---
title: useIntersection (capability.intersection)
group: 设备与系统
order: 1013
---

# useIntersection

**What it does**: Observe whether an element enters or leaves the visible area.

**When to use it**: Impression tracking, infinite scroll, lazy loading.

**End support & boundaries**: **Works on Web / WeChat / App-iOS / App-Android** (intersection math runs in JS; the host only pushes geometry ticks). **Not on HarmonyOS** — observers cannot survive across renders in its one-shot VM. Honest limit: it reacts to "geometry may have changed" moments such as scrolling; **pure layout changes and animated movement do not fire**.

> 技术标识：能力原语 C59 · `capability.intersection` · 返回 `IntersectionHandle` · **Hook implemented** (per-end support in the table below)

useIntersection: intersection observer — relativeTo/relativeToViewport + observe + disconnect (wx.createIntersectionObserver; web IntersectionObserver)

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

| Method | Doc |
|---|---|
| [`relativeTo`](#relativeto) | — |
| [`relativeToViewport`](#relativetoviewport) | — |
| [`observe`](#observe) | — |
| [`disconnect`](#disconnect) | — |

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
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `IntersectionOptions`

交叉观察配置（wx.createIntersectionObserver options）

| Prop/Method | Type | Doc |
|---|---|---|
| `thresholds` | `number[]` | 相交阈值数组（缺省 [0]） |
| `initialRatio` | `number` | 初始相交比例（用于立即上报初始态） |
| `observeAll` | `boolean` | 是否同时观察所有满足选择器的元素 |

### `IntersectionHandle`

交叉观察句柄（IntersectionHandle.observe / relativeTo* / disconnect）

| Prop/Method | Type | Doc |
|---|---|---|
| `relativeTo` | `relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 指定参照元素（相对该元素观察）。 |
| `relativeToViewport` | `relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 以显示区域（视口）为参照。 |
| `observe` | `observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle` | 开始观察目标元素。 |
| `disconnect` | `disconnect(): void` | 停止观察（释放） |

### `IntersectionResult`

交叉观察结果（IntersectionObserver 回调载荷——对齐官方字段）

| Prop/Method | Type | Doc |
|---|---|---|
| `id` | `string` | 元素 id |
| `dataset` | `Record<string, unknown>` | dataset 数据 |
| `intersectionRatio` | `number` | 相交比例（0–1） |
| `intersectionRect` | `{ left: number; top: number; right: number; bottom: number; width: number; height: number }` | 相交区域 |
| `boundingClientRect` | `ElementRect` | 目标边界 |
| `relativeRect` | `{ left: number; top: number; right: number; bottom: number; width: number; height: number }` | 相对参照物的区域 |
| `time` | `number` | 时间戳 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const obs = useIntersection({ thresholds: [0.5] }) // synchronous handle — no await, no res.ok

if (obs.ok) {
  obs.data
    .relativeToViewport()
    .observe('.lazy-item', (res) => {
      if (res.intersectionRatio >= 0.5) console.log('entered viewport:', res.id)
    })
  // obs.data.disconnect() stops observing (releases)
} else if (obs.error.code === 'element.unsupported') {
  // bridge has no intersection API → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->