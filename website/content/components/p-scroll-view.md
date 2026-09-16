---
title: p-scroll-view
group: 布局
order: 11
---

# p-scroll-view

滚动容器

> 语义组件（Layer 0）· 域 **布局** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| layout.scroll | 布局 | `<scroll-view>`（L1 原语） · `<sticky-header>`（L2 兼容层） · `<sticky-section>`（L2 兼容层） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<scroll-view>`（L1 原语） · `<sticky-header>`（L2 兼容层） · `<sticky-section>`（L2 兼容层） |
| Headless（SSR / 测试） | ✅ | headless · IR 渲染测试档（工具端） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——组件级接线未开始 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——组件级接线未开始 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——组件级接线未开始 |
| Flutter 混合 | 🟡 | flutter · widget 级映射——组件级未验证 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本组件可用；🟡 端原型映射·组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。

## Props

| 属性 | 说明 | 类型 | 默认值 | 必填 |
|---|---|---|---|---|
| `pid` | 组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约） | `String` | `''` | 否 |
| `disabled` | 禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传） | `Boolean` | `false` | 否 |
| `ariaLabel` | 无障碍标签（读屏器朗读文本） | `String` | `''` | 否 |
| `scrollX` | 允许横向滚动 | `Boolean` | `false` | 否 |
| `scrollY` | 允许纵向滚动 | `Boolean` | `true` | 否 |
| `scrollTop` | 纵向滚动位置（px） | `[Number, String]` | `0` | 否 |
| `scrollLeft` | 横向滚动位置（px） | `[Number, String]` | `0` | 否 |
| `upperThreshold` | — | `[Number, String]` | `50` | 否 |
| `lowerThreshold` | 距底部多少 px 触发 scrolltolower 事件 | `[Number, String]` | `50` | 否 |
| `scrollIntoView` | — | `String` | `''` | 否 |
| `scrollIntoViewOffset` | — | `Number` | `0` | 否 |
| `scrollWithAnimation` | — | `Boolean` | `false` | 否 |
| `enableBackToTop` | — | `Boolean` | `false` | 否 |
| `enablePassive` | — | `Boolean` | `false` | 否 |
| `refresherEnabled` | 启用自定义下拉刷新 | `Boolean` | `false` | 否 |
| `refresherThreshold` | — | `Number` | `45` | 否 |
| `refresherDefaultStyle` | — | `String` | `'black'` | 否 |
| `refresherBackground` | — | `String` | `'transparent'` | 否 |
| `refresherTriggered` | — | `Boolean` | `false` | 否 |
| `bounces` | — | `Boolean` | `true` | 否 |
| `showScrollbar` | — | `Boolean` | `false` | 否 |
| `fastDeceleration` | — | `Boolean` | `false` | 否 |
| `scrollAnchoring` | — | `Boolean` | `false` | 否 |
| `type` | 类型变体 | `String` | `''` | 否 |
| `associativeContainer` | — | `String` | `''` | 否 |
| `reverse` | — | `Boolean` | `false` | 否 |
| `clip` | — | `Boolean` | `true` | 否 |
| `cacheExtent` | — | `Number` | `0` | 否 |
| `minDragDistance` | — | `Number` | `0` | 否 |
| `scrollIntoViewWithinExtent` | — | `Boolean` | `false` | 否 |
| `scrollIntoViewAlignment` | — | `String` | `''` | 否 |
| `padding` | — | `Array` | `[]` | 否 |
| `refresherTwoLevelEnabled` | — | `Boolean` | `false` | 否 |
| `refresherTwoLevelTriggered` | — | `Boolean` | `false` | 否 |
| `refresherTwoLevelThreshold` | — | `Number` | `150` | 否 |
| `refresherTwoLevelCloseThreshold` | — | `Number` | `80` | 否 |
| `refresherTwoLevelScrollEnabled` | — | `Boolean` | `false` | 否 |
| `refresherBallisticRefreshEnabled` | — | `Boolean` | `false` | 否 |
| `refresherTwoLevelPinned` | — | `Boolean` | `false` | 否 |
| `enableFlex` | — | `Boolean` | `false` | 否 |
| `enhanced` | — | `Boolean` | `false` | 否 |
| `pagingEnabled` | — | `Boolean` | `false` | 否 |
| `usingSticky` | — | `Boolean` | `false` | 否 |

### 属性详解

#### `pid`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）

#### `disabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）

#### `ariaLabel`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：无障碍标签（读屏器朗读文本）

#### `scrollX`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：允许横向滚动

#### `scrollY`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：允许纵向滚动

#### `scrollTop`

- **类型**：`[Number, String]`　**默认值**：`0`　**必填**：否
- **说明**：纵向滚动位置（px）

#### `scrollLeft`

- **类型**：`[Number, String]`　**默认值**：`0`　**必填**：否
- **说明**：横向滚动位置（px）

#### `upperThreshold`

- **类型**：`[Number, String]`　**默认值**：`50`　**必填**：否
- **说明**：—

#### `lowerThreshold`

- **类型**：`[Number, String]`　**默认值**：`50`　**必填**：否
- **说明**：距底部多少 px 触发 scrolltolower 事件

#### `scrollIntoView`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：—

#### `scrollIntoViewOffset`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：—

#### `scrollWithAnimation`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `enableBackToTop`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `enablePassive`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `refresherEnabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：启用自定义下拉刷新

#### `refresherThreshold`

- **类型**：`Number`　**默认值**：`45`　**必填**：否
- **说明**：—

#### `refresherDefaultStyle`

- **类型**：`String`　**默认值**：`'black'`　**必填**：否
- **说明**：—

#### `refresherBackground`

- **类型**：`String`　**默认值**：`'transparent'`　**必填**：否
- **说明**：—

#### `refresherTriggered`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `bounces`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：—

#### `showScrollbar`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `fastDeceleration`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `scrollAnchoring`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `type`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：类型变体

#### `associativeContainer`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：—

#### `reverse`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `clip`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：—

#### `cacheExtent`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：—

#### `minDragDistance`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：—

#### `scrollIntoViewWithinExtent`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `scrollIntoViewAlignment`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：—

#### `padding`

- **类型**：`Array`　**默认值**：`[]`　**必填**：否
- **说明**：—

#### `refresherTwoLevelEnabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `refresherTwoLevelTriggered`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `refresherTwoLevelThreshold`

- **类型**：`Number`　**默认值**：`150`　**必填**：否
- **说明**：—

#### `refresherTwoLevelCloseThreshold`

- **类型**：`Number`　**默认值**：`80`　**必填**：否
- **说明**：—

#### `refresherTwoLevelScrollEnabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `refresherBallisticRefreshEnabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `refresherTwoLevelPinned`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `enableFlex`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `enhanced`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `pagingEnabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

#### `usingSticky`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：—

## Events

| 事件 | 说明 | 载荷 |
|---|---|---|
| `scroll` | 滚动（eventScrollTop 归一：MP e.detail.scrollTop / Web e.target.scrollTop） | — |
| `scrolltoupper` | — | — |
| `scrolltolower` | 滚动到底部（lowerThreshold 触发） | — |
| `refresherpulling` | — | — |
| `refresherrefresh` | 自定义下拉刷新触发 | — |
| `refresherrestore` | — | — |
| `refresherabort` | — | — |
| `refresherwillrefresh` | — | — |
| `refresherstatuschange` | — | — |
| `dragstart` | — | — |
| `dragging` | — | — |
| `dragend` | — | — |
| `scrollstart` | — | — |
| `scrollend` | — | — |

### 事件详解

#### `scroll`

- **说明**：滚动（eventScrollTop 归一：MP e.detail.scrollTop / Web e.target.scrollTop）
- **载荷**：无

#### `scrolltoupper`

- **说明**：—
- **载荷**：无

#### `scrolltolower`

- **说明**：滚动到底部（lowerThreshold 触发）
- **载荷**：无

#### `refresherpulling`

- **说明**：—
- **载荷**：无

#### `refresherrefresh`

- **说明**：自定义下拉刷新触发
- **载荷**：无

#### `refresherrestore`

- **说明**：—
- **载荷**：无

#### `refresherabort`

- **说明**：—
- **载荷**：无

#### `refresherwillrefresh`

- **说明**：—
- **载荷**：无

#### `refresherstatuschange`

- **说明**：—
- **载荷**：无

#### `dragstart`

- **说明**：—
- **载荷**：无

#### `dragging`

- **说明**：—
- **载荷**：无

#### `dragend`

- **说明**：—
- **载荷**：无

#### `scrollstart`

- **说明**：—
- **载荷**：无

#### `scrollend`

- **说明**：—
- **载荷**：无

## 插槽

| 插槽 | 说明 |
|---|---|
| default | 默认插槽（组件主内容） |

## 实现要点

- 矩阵 01 §4：Skyline 必备（页面滚动禁全局滚动）；scroll-x/y、scroll-top/left、refresher、lower-threshold
- 性能约束（超大数量复用场景）：薄包装 —— 不引入组件层逻辑，事件透传，无节流/无状态
- ★2026-09-14 官方属性对齐（end-alignment 批次 2）：补齐官方 <scroll-view> 全量属性（scroll-into-view/
- upper-threshold/refresher 全家桶/enhanced 增强族/padding/type 渲染模式等）——全部透传原生，
- 框架不消费（薄包装原则不破）；Web 模拟层选择性映射（见 packages/built-in-components/src/components/scroll-view.ts）

## 用法

```vue
<p-scroll-view :disabled="true" :scrollX="true" :scrollY="true">
  <p-text>内容</p-text>
</p-scroll-view>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/components/p-scroll-view/index.vue -->