---
title: useCanvas (capability.canvas)
group: 媒体与扫码
order: 4005
---

# useCanvas

useCanvas: canvas component instance — 2D drawing context + node (type=2d) + export to temp file / data URL + offscreen canvas (wx.createCanvasContext/SelectorQuery node/canvasToTempFilePath/createOffscreenCanvas; web HTMLCanvasElement + standard 2D context)

> Capability primitive C57 · `capability.canvas` · returns `CanvasController` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useCanvas(id: string): CapResult<CanvasController>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `id` | `string` | Yes | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `CanvasController` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`createContext`](#createcontext) | `createContext(): CapResult<CanvasContext>` | — |
| [`node`](#node) | `node(): Promise<CapResult<CanvasNode>>` | — |
| [`toTempFilePath`](#totempfilepath) | `toTempFilePath(options?: CanvasExportOptions): Promise<CapResult<string>>` | — |
| [`toDataURL`](#todataurl) | `toDataURL(options?: CanvasExportOptions): Promise<CapResult<string>>` | — |
| [`offscreen`](#offscreen) | `offscreen(width: number, height: number, type?: '2d' \| 'webgl'): CapResult<OffscreenCanvasHandle>` | — |

### `createContext`

```ts
createContext(): CapResult<CanvasContext>
```

**Returns**: `CapResult<CanvasContext>`

### `node`

```ts
node(): Promise<CapResult<CanvasNode>>
```

**Returns**: `Promise<CapResult<CanvasNode>>`

### `toTempFilePath`

```ts
toTempFilePath(options?: CanvasExportOptions): Promise<CapResult<string>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `CanvasExportOptions` | No | — |

**Returns**: `Promise<CapResult<string>>`

### `toDataURL`

```ts
toDataURL(options?: CanvasExportOptions): Promise<CapResult<string>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `options` | `CanvasExportOptions` | No | — |

**Returns**: `Promise<CapResult<string>>`

### `offscreen`

```ts
offscreen(width: number, height: number, type?: '2d' | 'webgl'): CapResult<OffscreenCanvasHandle>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `width` | `number` | Yes | — |
| `height` | `number` | Yes | — |
| `type` | `'2d' \| 'webgl'` | No | — |

**Returns**: `CapResult<OffscreenCanvasHandle>`

## Referenced types

### `CanvasContext`

★组件实例 API 对齐（2026-09-12）：C57 CanvasContext 2D 绘图上下文。 方法名与参数**逐一对齐微信官方 CanvasContext**（`wx.createCanvasContext` 返回）—— web 由标准 `CanvasRenderingContext2D` 适配（`setFillStyle` → `fillStyle` 等）， 因此同一份绘图代码在小程序端与 Web 端均可运行，业务零平台分支。

| Method | Signature | Doc |
|---|---|---|
| `setFillStyle` | `setFillStyle(color: string): void` | 设置填充色（CSS 颜色串） |
| `setStrokeStyle` | `setStrokeStyle(color: string): void` | 设置描边色（CSS 颜色串） |
| `setLineWidth` | `setLineWidth(lineWidth: number): void` | 设置线宽 |
| `setLineCap` | `setLineCap(lineCap: 'butt' \| 'round' \| 'square'): void` | 设置线帽（butt 平头 / round 圆头 / square 方头） |
| `setLineJoin` | `setLineJoin(lineJoin: 'bevel' \| 'round' \| 'miter'): void` | 设置连线拐角（bevel 斜角 / round 圆角 / miter 尖角） |
| `setMiterLimit` | `setMiterLimit(miterLimit: number): void` | 设置最大斜接长度 |
| `setGlobalAlpha` | `setGlobalAlpha(alpha: number): void` | 设置全局透明度（0–1） |
| `setShadow` | `setShadow(offsetX: number, offsetY: number, blur: number, color?: string): void` | 设置阴影（offsetX/offsetY 偏移、blur 模糊、color 颜色） |
| `setLineDash` | `setLineDash(pattern: number[], offset?: number): void` | 设置虚线（pattern 为线段与间隔长度数组，offset 起始偏移） |
| `setFontSize` | `setFontSize(fontSize: number): void` | 设置字号（px） |
| `setTextAlign` | `setTextAlign(align: 'left' \| 'center' \| 'right'): void` | 设置文本水平对齐（left / center / right） |
| `setTextBaseline` | `setTextBaseline(textBaseline: 'top' \| 'bottom' \| 'middle' \| 'normal' \| 'alphabetic' \| 'hanging' \| 'ideographic'): void` | 设置文本基线 |
| `setTransform` | `setTransform(scaleX: number, skewY: number, skewX: number, scaleY: number, translateX: number, translateY: number): void` | 设置变换矩阵（等价标准 setTransform） |
| `save` | `save(): void` | 保存绘图上下文（与 restore 配对，栈式） |
| `restore` | `restore(): void` | 恢复最近保存的绘图上下文 |
| `translate` | `translate(x: number, y: number): void` | 平移坐标系 |
| `rotate` | `rotate(rotate: number): void` | 旋转坐标系（弧度） |
| `scale` | `scale(scaleX: number, scaleY: number): void` | 缩放坐标系 |
| `beginPath` | `beginPath(): void` | 开始新路径（清空当前路径） |
| `closePath` | `closePath(): void` | 闭合当前路径 |
| `moveTo` | `moveTo(x: number, y: number): void` | 移动路径起点 |
| `lineTo` | `lineTo(x: number, y: number): void` | 连线到坐标 |
| `arc` | `arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void` | 画圆弧（startAngle/endAngle 弧度；counterclockwise 逆时针） |
| `arcTo` | `arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void` | 画圆弧并连线 |
| `quadraticCurveTo` | `quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void` | 二次贝塞尔曲线 |
| `bezierCurveTo` | `bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void` | 三次贝塞尔曲线 |
| `rect` | `rect(x: number, y: number, width: number, height: number): void` | 矩形路径 |
| `fill` | `fill(): void` | 填充当前路径 |
| `stroke` | `stroke(): void` | 描边当前路径 |
| `clip` | `clip(): void` | 按当前路径裁剪 |
| `fillRect` | `fillRect(x: number, y: number, width: number, height: number): void` | 填充矩形 |
| `strokeRect` | `strokeRect(x: number, y: number, width: number, height: number): void` | 描边矩形 |
| `clearRect` | `clearRect(x: number, y: number, width: number, height: number): void` | 清除矩形区域 |
| `fillText` | `fillText(text: string, x: number, y: number, maxWidth?: number): void` | 填充文本（maxWidth 可选，超宽压缩） |
| `measureText` | `measureText(text: string): CanvasTextMetrics` | 测量文本尺寸 |
| `drawImage` | `drawImage(imageResource: string \| unknown, ...args: number[]): void` | 绘制图片（对齐官方 9 参 / 5 参 / 3 参重载：source 后接目标/裁剪参数） |
| `createLinearGradient` | `createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike` | 创建线性渐变 |
| `createCircularGradient` | `createCircularGradient(x: number, y: number, radius: number): CanvasGradientLike` | 创建径向渐变（圆心 x,y 半径 radius） |
| `createPattern` | `createPattern(image: string \| unknown, repetition: 'repeat' \| 'repeat-x' \| 'repeat-y' \| 'no-repeat'): CanvasPatternLike \| null` | 创建图案填充 |
| `draw` | `draw(reserve?: boolean \| (() => void), callback?: () => void): void` | 提交绘制（wx 异步提交到画布；web 即时绘制 → 直接回调。reserve 为 true 时保留上次绘制内容） |

### `CanvasNode`

Canvas 画布节点（`<canvas type="2d">`——wx fields({node:true}) / web HTMLCanvasElement）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `width` | `number` | — | 画布像素宽 |
| `height` | `number` | — | 画布像素高 |

| Method | Signature | Doc |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): unknown` | 取原生上下文（2d / webgl） |

### `CanvasExportOptions`

Canvas 导出参数（wx.canvasToTempFilePath 对齐——web 端取相关字段）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `x` | `number` | `0` | 源区域左上角 x（缺省 0） |
| `y` | `number` | `0` | 源区域左上角 y（缺省 0） |
| `width` | `number` | — | 源区域宽（缺省画布宽） |
| `height` | `number` | — | 源区域高（缺省画布高） |
| `destWidth` | `number` | `源宽` | 输出图宽（缺省 = 源宽） |
| `destHeight` | `number` | `源高` | 输出图高（缺省 = 源高） |
| `fileType` | `'png' \| 'jpg'` | `png` | 图片格式（缺省 png） |
| `quality` | `number` | — | 图片质量（仅 jpg 生效，0–1） |

### `OffscreenCanvasHandle`

离屏画布（wx.createOffscreenCanvas / web OffscreenCanvas——Skyline 高频渲染）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `width` | `number` | — | 像素宽 |
| `height` | `number` | — | 像素高 |

| Method | Signature | Doc |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): CanvasContext \| null` | 取上下文（2d 返回可绘图上下文） |

### `CanvasTextMetrics`

Canvas 文本度量（measureText 返回——对齐官方 TextMetrics 子集）

| Prop | Type | Default | Doc |
|---|---|---|---|
| `width` | `number` | — | 文本宽度（px） |
| `height` | `number` | — | 文本高度（部分实现提供） |

### `CanvasGradientLike`

Canvas 线性/径向渐变（createLinearGradient / createCircularGradient 返回）

| Method | Signature | Doc |
|---|---|---|
| `addColorStop` | `addColorStop(offset: number, color: string): void` | 添加渐变色标。 |

### `CanvasPatternLike`

Canvas 图案填充（createPattern 返回）

## Error codes

| code | Doc |
|---|---|
| `canvas.unsupported` | The canvas API is missing (wx.createCanvasContext / SelectorQuery / OffscreenCanvas, or no canvas element matched on web) |
| `canvas.node-missing` | Canvas node not resolved (needs <canvas type="2d" id="…">) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createCanvasContext/canvasToTempFilePath/createOffscreenCanvas |
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
const res = await useCanvas(id)

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->