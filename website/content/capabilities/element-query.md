---
title: useElement（capability.element-query）
group: 设备与系统
order: 1011
---

# useElement

★C58 useElement：元素查询句柄（wx.createSelectorQuery / web querySelector + getBoundingClientRect）

> 能力原语 C58 · `capability.element-query` · 返回 `ElementQuery` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useElement(id?: string): CapResult<ElementQuery>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 否 | 地图实例 ID（多地图场景区分） |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `ElementQuery` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`boundingClientRect`](#boundingclientrect) | `boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>` | 查询元素几何。 |
| [`scrollOffset`](#scrolloffset) | `scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>` | 查询元素滚动位置。 |
| [`fields`](#fields) | `fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>` | 按需查询元素字段（node/rect/size/scrollOffset/computedStyle）。 |
| [`size`](#size) | `size(selector?: string): Promise<CapResult<{ width: number; height: number }>>` | 查询元素尺寸（boundingClientRect 的常用投影）。 |
| [`batch`](#batch) | `batch(selectors: string[]): Promise<CapResult<Array<ElementRect \| null>>>` | 批量查询（同一查询内选择器数组——对齐官方 selectAll 的批量语义）。 |

### `boundingClientRect`

```ts
boundingClientRect(selector?: string): Promise<CapResult<ElementRect>>
```

**说明**：查询元素几何。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selector` | `string` | 否 | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**返回值**：`Promise<CapResult<ElementRect>>`

### `scrollOffset`

```ts
scrollOffset(selector?: string): Promise<CapResult<ElementScrollOffset>>
```

**说明**：查询元素滚动位置。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selector` | `string` | 否 | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**返回值**：`Promise<CapResult<ElementScrollOffset>>`

### `fields`

```ts
fields(options: ElementFieldsOptions, selector?: string): Promise<CapResult<ElementFieldsResult>>
```

**说明**：按需查询元素字段（node/rect/size/scrollOffset/computedStyle）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `ElementFieldsOptions` | 是 | 字段开关 |
| `selector` | `string` | 否 | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**返回值**：`Promise<CapResult<ElementFieldsResult>>`

### `size`

```ts
size(selector?: string): Promise<CapResult<{ width: number; height: number }>>
```

**说明**：查询元素尺寸（boundingClientRect 的常用投影）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selector` | `string` | 否 | CSS 选择器（缺省 = 句柄初始 id/选择器） |

**返回值**：`Promise<CapResult<{ width: number; height: number }>>`

### `batch`

```ts
batch(selectors: string[]): Promise<CapResult<Array<ElementRect | null>>>
```

**说明**：批量查询（同一查询内选择器数组——对齐官方 selectAll 的批量语义）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selectors` | `string[]` | 是 | CSS 选择器数组 |

**返回值**：`Promise<CapResult<Array<ElementRect \| null>>>`

## 类型引用

### `ElementRect`

元素几何（SelectorQuery.boundingClientRect 结果——对齐官方字段）

| 属性 | 类型 | 默认值 | 说明 |
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

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | `string` | — | 元素 id |
| `dataset` | `Record<string, unknown>` | — | dataset 数据 |
| `scrollTop` | `number` | — | 纵向滚动距离 |
| `scrollLeft` | `number` | — | 横向滚动距离 |

### `ElementFieldsOptions`

fields 查询选项（对齐官方 SelectorQuery.fields）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `node` | `boolean` | — | 返回节点（`<canvas type="2d">` / 自定义组件实例） |
| `rect` | `boolean` | — | 返回几何（left/top/right/bottom/width/height） |
| `size` | `boolean` | — | 返回尺寸（width/height） |
| `scrollOffset` | `boolean` | — | 返回滚动位置 |
| `computedStyle` | `string[]` | — | 返回 computedStyle（属性名数组） |
| `context` | `boolean` | — | 返回类名/自定义属性 dataset 等上下文 |

### `ElementFieldsResult`

fields 查询结果（含请求到的各维度——未请求字段为 undefined）

| 属性 | 类型 | 默认值 | 说明 |
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

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `width` | `number` | — | 画布像素宽 |
| `height` | `number` | — | 画布像素高 |

| 方法 | 签名 | 说明 |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): unknown` | 取原生上下文（2d / webgl） |

## 错误码

| code | 说明 |
|---|---|
| `element.unsupported` | 桥未提供 createElementQuery（useElement 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.createSelectorQuery |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——能力桥未接线 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const q = useElement('box') // 同步句柄——无 await、无 res.ok

if (q.ok) {
  const rect = await q.data.boundingClientRect() // 几何
  if (rect.ok) console.log('宽高:', rect.data.width, rect.data.height)
  // await q.data.scrollOffset() / q.data.size() / q.data.fields({ node: true })
  // await q.data.batch([".item", "#footer"]) 批量
} else if (q.error.code === 'element.unsupported') {
  // 桥未提供查询 API → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->