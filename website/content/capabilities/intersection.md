---
title: useIntersection（capability.intersection）
group: 设备与系统
order: 1012
---

# useIntersection

★C59 useIntersection：交叉观察句柄（wx.createIntersectionObserver / web IntersectionObserver）

> 能力原语 C59 · `capability.intersection` · 返回 `IntersectionHandle` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useIntersection(options?: IntersectionOptions): CapResult<IntersectionHandle>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `IntersectionOptions` | 否 | 交叉观察配置（wx.createIntersectionObserver options） |

#### `options` 的属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `thresholds` | `number[]` | 否 | 相交阈值数组（缺省 [0]） |
| `initialRatio` | `number` | 否 | 初始相交比例（用于立即上报初始态） |
| `observeAll` | `boolean` | 否 | 是否同时观察所有满足选择器的元素 |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `IntersectionHandle` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

## 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| [`relativeTo`](#relativeto) | `relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 指定参照元素（相对该元素观察）。 |
| [`relativeToViewport`](#relativetoviewport) | `relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 以显示区域（视口）为参照。 |
| [`observe`](#observe) | `observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle` | 开始观察目标元素。 |
| [`disconnect`](#disconnect) | `disconnect(): void` | 停止观察（释放） |

### `relativeTo`

```ts
relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
```

**说明**：指定参照元素（相对该元素观察）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selector` | `string` | 是 | 参照元素选择器 |
| `margins` | `{ left?: number; right?: number; top?: number; bottom?: number }` | 否 | 参照物扩展/收缩边界 |

**返回值**：`IntersectionHandle`

### `relativeToViewport`

```ts
relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle
```

**说明**：以显示区域（视口）为参照。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `margins` | `{ left?: number; right?: number; top?: number; bottom?: number }` | 否 | 视口扩展/收缩边界 |

**返回值**：`IntersectionHandle`

### `observe`

```ts
observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle
```

**说明**：开始观察目标元素。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `targetSelector` | `string` | 是 | 目标元素选择器 |
| `cb` | `(result: IntersectionResult) => void` | 是 | 相交状态变化回调 |

**返回值**：`IntersectionHandle`

### `disconnect`

```ts
disconnect(): void
```

**说明**：停止观察（释放）

**返回值**：`void`

## 类型引用

### `IntersectionHandle`

交叉观察句柄（IntersectionHandle.observe / relativeTo* / disconnect）

| 方法 | 签名 | 说明 |
|---|---|---|
| `relativeTo` | `relativeTo(selector: string, margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 指定参照元素（相对该元素观察）。 |
| `relativeToViewport` | `relativeToViewport(margins?: { left?: number; right?: number; top?: number; bottom?: number }): IntersectionHandle` | 以显示区域（视口）为参照。 |
| `observe` | `observe(targetSelector: string, cb: (result: IntersectionResult) => void): IntersectionHandle` | 开始观察目标元素。 |
| `disconnect` | `disconnect(): void` | 停止观察（释放） |

### `IntersectionResult`

交叉观察结果（IntersectionObserver 回调载荷——对齐官方字段）

| 属性 | 类型 | 默认值 | 说明 |
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

## 错误码

| code | 说明 |
|---|---|
| `element.unsupported` | 桥未提供 createIntersection（useIntersection 不可用） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.createIntersectionObserver |
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
const obs = useIntersection({ thresholds: [0.5] }) // 同步句柄——无 await、无 res.ok

if (obs.ok) {
  obs.data
    .relativeToViewport()
    .observe('.lazy-item', (res) => {
      if (res.intersectionRatio >= 0.5) console.log('进入视口:', res.id)
    })
  // obs.data.disconnect() 停止观察（释放）
} else if (obs.error.code === 'element.unsupported') {
  // 桥未提供交叉观察 API → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->