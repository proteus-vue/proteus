---
title: p-picker
group: 内容与表单
order: 1017
---

# p-picker

选择器

> 语义组件（Layer 0）· 域 **内容与表单** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| ui.picker | 内容与表单 | `<picker>`（L1 原语） · `<picker-view>`（L1 原语） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<picker>`（L1 原语） · `<picker-view>`（L1 原语） |
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
| `mode` | 选择器类型：selector（单列）/ multiSelector（多列）——与原生 picker 一致 | `String` | `'selector'` | 否 |
| `range` | 选项列表：selector 一维数组；multiSelector 二维数组（各列一个数组） | `Array` | `() => []` | 否 |
| `rangeKey` | range 元素为对象时的显示字段名（原生 range-key） | `String` | `''` | 否 |
| `value` | 选中项索引：selector 为 number；multiSelector 为 number[] | `[Number, Array]` | `0` | 否 |
| `disabled` | 是否禁用（★官方对齐） | `Boolean` | `false` | 否 |
| `headerText` | 选择器标题（★官方 header-text；两端均映射为弹层标题） | `String` | `''` | 否 |
| `showButtons` | ★是否显示底部按钮（默认 true）。false 时**滚动即实时 emit change**，关闭即结束（无需确认键） | `Boolean` | `true` | 否 |
| `buttonMode` | ★底部按钮形态：single 单按钮「确定」（默认）/ double「取消 + 确定」 | `String` | `'single'` | 否 |
| `indicatorStyle` | 滚轮选中指示线样式（原生 picker-view indicator-style；缺省 48px 细线） | `String` | `'height: 48px;'` | 否 |
| `indicatorClass` | 滚轮指示线附加类名（原生 picker-view indicator-class） | `String` | `''` | 否 |
| `maskClass` | 遮罩层附加类名（原生 picker-view mask-class） | `String` | `''` | 否 |
| `maskStyle` | 遮罩层内联样式（原生 picker-view mask-style） | `String` | `''` | 否 |
| `immediateChange` | 滚动即实时触发 change（原生 picker-view immediate-change；亦等价于 showButtons=false 的实时生效语义） | `Boolean` | `false` | 否 |

### 属性详解

#### `mode`

- **类型**：`String`　**默认值**：`'selector'`　**必填**：否
- **说明**：选择器类型：selector（单列）/ multiSelector（多列）——与原生 picker 一致

#### `range`

- **类型**：`Array`　**默认值**：`() => []`　**必填**：否
- **说明**：选项列表：selector 一维数组；multiSelector 二维数组（各列一个数组）

#### `rangeKey`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：range 元素为对象时的显示字段名（原生 range-key）

#### `value`

- **类型**：`[Number, Array]`　**默认值**：`0`　**必填**：否
- **说明**：选中项索引：selector 为 number；multiSelector 为 number[]

#### `disabled`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否禁用（★官方对齐）

#### `headerText`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：选择器标题（★官方 header-text；两端均映射为弹层标题）

#### `showButtons`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：★是否显示底部按钮（默认 true）。false 时**滚动即实时 emit change**，关闭即结束（无需确认键）

#### `buttonMode`

- **类型**：`String`　**默认值**：`'single'`　**必填**：否
- **说明**：★底部按钮形态：single 单按钮「确定」（默认）/ double「取消 + 确定」

#### `indicatorStyle`

- **类型**：`String`　**默认值**：`'height: 48px;'`　**必填**：否
- **说明**：滚轮选中指示线样式（原生 picker-view indicator-style；缺省 48px 细线）

#### `indicatorClass`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：滚轮指示线附加类名（原生 picker-view indicator-class）

#### `maskClass`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：遮罩层附加类名（原生 picker-view mask-class）

#### `maskStyle`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：遮罩层内联样式（原生 picker-view mask-style）

#### `immediateChange`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：滚动即实时触发 change（原生 picker-view immediate-change；亦等价于 showButtons=false 的实时生效语义）

## Events

| 事件 | 说明 | 载荷 |
|---|---|---|
| `change` | 选中值变化 | `{ value: props.mode === 'multiSelector' ? d.slice() : d[0] }` |
| `cancel` | 取消/关闭 | `e` |
| `columnchange` | — | `{ column: i, value: next[i] }` |

### 事件详解

#### `change`

- **说明**：选中值变化
- **载荷**：`{ value: props.mode === 'multiSelector' ? d.slice() : d[0] }`

#### `cancel`

- **说明**：取消/关闭
- **载荷**：`e`

#### `columnchange`

- **说明**：—
- **载荷**：`{ column: i, value: next[i] }`

## 插槽

| 插槽 | 说明 |
|---|---|
| default | 默认插槽（组件主内容） |

## 实现要点

- ★★定位（2026-09-13 用户评审定案）：p-* 内置组件 = 框架统一视觉语言；**两端同一套现代 weui 形态**
- （半屏弹层：× 关闭 + 居中标题 + 滚轮 + 底部主按钮）——
- · Web：中性标签 `<picker>` → defaultScopedPlugin 改写 `<proteus-picker>` → **WebPicker**（weui 半屏）
- · MP ：**原生 `<picker>` 是旧式「取消/确定」顶栏**（非现代设计，按「weui 是参考不是教条」不照搬）
- → 自绘同一套半屏外壳，滚轮用原生 `<picker-view>`（原生吸附、无自带外壳）→ 两端视觉一致
- ★平台分支用**编译期宏** `__WEB__`（死分支消除）：Web 只留 `<picker>`；MP 只留自绘分支。
- ★属性透传原生 picker：mode（selector/multiSelector）/ range / range-key / value / disabled / header-text。
- ★事件契约（框架约定：**裸载荷**）：change `{ value }` / columnchange `{ column, value }` / cancel。
- ★底部按钮可配置：`show-buttons`（默认 true）/ `button-mode`（single 单按钮 / double 取消+确定）；
- 关闭按钮（实测无弹出/关闭动画修正）：**keyframe 进出场**（enter 播放 / leave 播完再卸载）——
- 对齐 p-popup 的 shown + phase 模式（transition 在本组件不可靠：Skyline 下首次渲染不触发）。
- ★诚实边界：`mode=time/date/region` 仅 MP 原生支持（自绘分支当前覆盖 selector/multiSelector）。

## 用法

```vue
<p-picker :mode="'selector'" :rangeKey="'…'" :value="0">
  <p-text>内容</p-text>
</p-picker>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/components/p-picker/index.vue -->