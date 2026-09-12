---
title: useCanvas（capability.canvas）
group: 媒体与扫码
order: 4005
---

# useCanvas

★C57 useCanvas：画布控制器（wx.createCanvasContext/SelectorQuery node/canvasToTempFilePath/OffscreenCanvas；web HTMLCanvasElement）

> 能力原语 C57 · `capability.canvas` · 返回 `CanvasController` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useCanvas(id: string): CapResult<CanvasController>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 地图实例 ID（多地图场景区分） |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `CanvasController` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`createContext`](#createcontext) | `createContext(): CapResult<CanvasContext>` | 创建旧版 2D 绘图上下文（方法名对齐官方 CanvasContext） |
| [`node`](#node) | `node(): Promise<CapResult<CanvasNode>>` | 取画布节点（`<canvas type="2d">` node——用于 requestAnimationFrame / 标准 getContext） |
| [`toTempFilePath`](#totempfilepath) | `toTempFilePath(options?: CanvasExportOptions): Promise<CapResult<string>>` | 导出为临时文件路径（wx.canvasToTempFilePath；web 返回 data URL） |
| [`toDataURL`](#todataurl) | `toDataURL(options?: CanvasExportOptions): Promise<CapResult<string>>` | 导出为 data URL（web 原生；wx 经临时文件读为 base64） |
| [`offscreen`](#offscreen) | `offscreen(width: number, height: number, type?: '2d' \| 'webgl'): CapResult<OffscreenCanvasHandle>` | 创建离屏画布（Skyline 高频渲染 / 离屏合成） |

### `createContext`

```ts
createContext(): CapResult<CanvasContext>
```

**说明**：创建旧版 2D 绘图上下文（方法名对齐官方 CanvasContext）

**返回值**：`CapResult<CanvasContext>`

### `node`

```ts
node(): Promise<CapResult<CanvasNode>>
```

**说明**：取画布节点（`<canvas type="2d">` node——用于 requestAnimationFrame / 标准 getContext）

**返回值**：`Promise<CapResult<CanvasNode>>`

### `toTempFilePath`

```ts
toTempFilePath(options?: CanvasExportOptions): Promise<CapResult<string>>
```

**说明**：导出为临时文件路径（wx.canvasToTempFilePath；web 返回 data URL）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `CanvasExportOptions` | 否 | 配置选项对象 |

**返回值**：`Promise<CapResult<string>>`

### `toDataURL`

```ts
toDataURL(options?: CanvasExportOptions): Promise<CapResult<string>>
```

**说明**：导出为 data URL（web 原生；wx 经临时文件读为 base64）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `CanvasExportOptions` | 否 | 配置选项对象 |

**返回值**：`Promise<CapResult<string>>`

### `offscreen`

```ts
offscreen(width: number, height: number, type?: '2d' | 'webgl'): CapResult<OffscreenCanvasHandle>
```

**说明**：创建离屏画布（Skyline 高频渲染 / 离屏合成）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `width` | `number` | 是 | 数值参数 |
| `height` | `number` | 是 | 数值参数 |
| `type` | `'2d' \| 'webgl'` | 否 | — |

**返回值**：`CapResult<OffscreenCanvasHandle>`

## 类型引用

### `CanvasContext`

★组件实例 API 对齐（2026-09-12）：C57 CanvasContext 2D 绘图上下文。 方法名与参数**逐一对齐微信官方 CanvasContext**（`wx.createCanvasContext` 返回）—— web 由标准 `CanvasRenderingContext2D` 适配（`setFillStyle` → `fillStyle` 等）， 因此同一份绘图代码在小程序端与 Web 端均可运行，业务零平台分支。

| 方法 | 签名 | 说明 |
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

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `width` | `number` | — | 画布像素宽 |
| `height` | `number` | — | 画布像素高 |

| 方法 | 签名 | 说明 |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): unknown` | 取原生上下文（2d / webgl） |

### `CanvasExportOptions`

Canvas 导出参数（wx.canvasToTempFilePath 对齐——web 端取相关字段）

| 属性 | 类型 | 默认值 | 说明 |
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

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `width` | `number` | — | 像素宽 |
| `height` | `number` | — | 像素高 |

| 方法 | 签名 | 说明 |
|---|---|---|
| `getContext` | `getContext(type: '2d' \| 'webgl'): CanvasContext \| null` | 取上下文（2d 返回可绘图上下文） |

### `CanvasTextMetrics`

Canvas 文本度量（measureText 返回——对齐官方 TextMetrics 子集）

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `width` | `number` | — | 文本宽度（px） |
| `height` | `number` | — | 文本高度（部分实现提供） |

### `CanvasGradientLike`

Canvas 线性/径向渐变（createLinearGradient / createCircularGradient 返回）

| 方法 | 签名 | 说明 |
|---|---|---|
| `addColorStop` | `addColorStop(offset: number, color: string): void` | 添加渐变色标。 |

### `CanvasPatternLike`

Canvas 图案填充（createPattern 返回）

## 错误码

| code | 说明 |
|---|---|
| `canvas.unsupported` | 桥未提供 createCanvas（useCanvas 不可用） |
| `canvas.node-missing` | 未取得 canvas 节点（需 <canvas type="2d" id="…">） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.createCanvasContext/canvasToTempFilePath/createOffscreenCanvas |
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
const c = useCanvas('myCanvas') // 同步句柄——无 await、无 res.ok

if (c.ok) {
  const ctx = c.data.createContext()
  if (ctx.ok) {
    ctx.data.setFillStyle('#5b8cff')
    ctx.data.beginPath()
    ctx.data.arc(60, 60, 40, 0, Math.PI * 2)
    ctx.data.fill()
    ctx.data.draw() // 提交绘制（wx 异步；web 即时）
  }
  // 导出：await c.data.toTempFilePath({ fileType: "png" })
  // 2D node（requestAnimationFrame）：await c.data.node()
} else if (c.error.code === 'canvas.unsupported') {
  // 桥未提供画布 API → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->