---
title: useElement (capability.element-query)
group: 设备与系统
order: 1011
---

# useElement

useElement: element query handle — geometry / scroll offset / fields (node/rect/size/computedStyle) / batch (wx.createSelectorQuery; web querySelector + getBoundingClientRect)

> Capability primitive C58 · `capability.element-query` · returns `ElementQuery` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useElement(id?: string): CapResult<ElementQuery>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `id` | `string` | No | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `ElementQuery` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`boundingClientRect`](#boundingclientrect) | `boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>` | — |
| [`scrollOffset`](#scrolloffset) | `scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>` | — |
| [`fields`](#fields) | `fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>` | — |
| [`size`](#size) | `size(selector?: string): Promise<CapResult<{ width: number; height: number }>>` | — |
| [`batch`](#batch) | `batch(selectors: string[]): Promise<CapResult<Array<ElementRect \| null>>>` | — |

### `boundingClientRect`

```ts
boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `selector` | `string` | No | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**Returns**: `Promise<CapResult<ElementRect>>`

### `scrollOffset`

```ts
scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `selector` | `string` | No | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**Returns**: `Promise<CapResult<ElementScrollOffset>>`

### `fields`

```ts
fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `ElementFieldsOptions` | Yes | 字段开关 |
| `selector` | `string` | No | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**Returns**: `Promise<CapResult<ElementFieldsResult>>`

### `size`

```ts
size(selector?: string): Promise<CapResult<{ width: number; height: number }>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `selector` | `string` | No | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**Returns**: `Promise<CapResult<{ width: number; height: number }>>`

### `batch`

```ts
batch(selectors: string[]): Promise<CapResult<Array<ElementRect | null>>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `selectors` | `string[]` | Yes | CSS 选择器数组 |

**Returns**: `Promise<CapResult<Array<ElementRect \| null>>>`

## Referenced types

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

### `ElementScrollOffset`

滚动位置（SelectorQuery.scrollOffset 结果）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `id` | `string` | — | 元素 id |
| `dataset` | `Record<string, unknown>` | — | dataset 数据 |
| `scrollTop` | `number` | — | 纵向滚动距离 |
| `scrollLeft` | `number` | — | 横向滚动距离 |

### `ElementFieldsOptions`

fields 查询选项（对齐官方 SelectorQuery.fields）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `node` | `boolean` | — | 返回节点（`<canvas type="2d">` / 自定义组件实例） |
| `rect` | `boolean` | — | 返回几何（left/top/right/bottom/width/height） |
| `size` | `boolean` | — | 返回尺寸（width/height） |
| `scrollOffset` | `boolean` | — | 返回滚动位置 |
| `computedStyle` | `string[]` | — | 返回 computedStyle（属性名数组） |
| `context` | `boolean` | — | 返回类名/自定义属性 dataset 等上下文 |

### `ElementFieldsResult`

fields 查询结果（含请求到的各维度——未请求字段为 undefined）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `id` | `string` | — | 元素 id |
| `dataset` | `Record<string, unknown>` | — | dataset 数据 |
| `node` | `CanvasNode` | — | 节点（node: true） |
| `left` | `number` | — | 几何（rect: true） |
| `top` | `number` | — | — |
| `right` | `number` | — | — |
| `bottom` | `number` | — | — |
| `width` | `number` | — | 尺寸（rect/size: true） |
| `height` | `number` | — | — |
| `scrollTop` | `number` | — | 滚动位置（scrollOffset: true） |
| `scrollLeft` | `number` | — | — |

### `CanvasNode`

Canvas 画布节点（`<canvas type="2d">`——wx fields({node:true}) / web HTMLCanvasElement）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `width` | `number` | — | 画布像素宽 |
| `height` | `number` | — | 画布像素高 |

| Method | Signature | Doc |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): unknown` | 取原生上下文（2d / webgl） |

## Error codes

| code | Doc |
|---|---|
| `element.unsupported` | The bridge does not provide createElementQuery (useElement unavailable) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createSelectorQuery |
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
const res = await useElement()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->