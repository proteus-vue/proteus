---
title: p-textarea
group: 内容与表单
order: 1029
---

# p-textarea

多行文本域

> 语义组件（Layer 0）· 域 **内容与表单** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| ui.textarea | 内容与表单 | `<textarea>`（L1 原语） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<textarea>`（L1 原语） |
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
| `value` | 绑定值 | `String` | `''` | 否 |
| `maxlength` | 最大输入长度（≤ 0 = 不限） | `Number` | `-1` | 否 |
| `placeholder` | 占位提示文本 | `String` | `''` | 否 |
| `placeholderStyle` | ★官方 placeholder-style：占位符内联样式（仅 color/font-size/font-weight/line-height 有效） | `String` | `''` | 否 |
| `placeholderClass` | ★官方 placeholder-class：占位符类名 | `String` | `''` | 否 |
| `focus` | 自动聚焦 | `Boolean` | `false` | 否 |
| `autoHeight` | ★官方 auto-height：自动增高（设 style.height 不生效） | `Boolean` | `false` | 否 |
| `cursorSpacing` | ★官方 cursor-spacing：光标与键盘距离 | `Number` | `0` | 否 |
| `cursor` | ★官方 cursor：focus 时光标位置 | `Number` | `-1` | 否 |
| `selectionStart` | ★官方 selection-start：自动聚焦时光标起始位置（需与 selection-end 搭配） | `Number` | `-1` | 否 |
| `selectionEnd` | ★官方 selection-end：自动聚焦时光标结束位置 | `Number` | `-1` | 否 |
| `adjustPosition` | ★官方 adjust-position：键盘弹起时自动上推页面 | `Boolean` | `true` | 否 |
| `holdKeyboard` | ★官方 hold-keyboard：focus 时点击页面不收起键盘 | `Boolean` | `false` | 否 |
| `disableDefaultPadding` | ★官方 disable-default-padding：去掉 iOS 默认内边距 | `Boolean` | `false` | 否 |
| `confirmType` | ★官方 confirm-type：键盘右下角按钮文字（send/search/next/go/done） | `String` | `''` | 否 |
| `confirmHold` | ★官方 confirm-hold：点击键盘右下角按钮时保持键盘不收起 | `Boolean` | `false` | 否 |
| `adjustKeyboardTo` | ★官方 adjust-keyboard-to：键盘对齐位置（cursor/none） | `String` | `''` | 否 |
| `fixed` | ★官方 fixed：fixed 定位（MP 私有布局语义） | `Boolean` | `false` | 否 |
| `showConfirmBar` | ★官方 show-confirm-bar：是否显示键盘上方完成横条（iOS） | `Boolean` | `true` | 否 |

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

#### `value`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：绑定值

#### `maxlength`

- **类型**：`Number`　**默认值**：`-1`　**必填**：否
- **说明**：最大输入长度（≤ 0 = 不限）

#### `placeholder`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：占位提示文本

#### `placeholderStyle`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：★官方 placeholder-style：占位符内联样式（仅 color/font-size/font-weight/line-height 有效）

#### `placeholderClass`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：★官方 placeholder-class：占位符类名

#### `focus`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：自动聚焦

#### `autoHeight`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：★官方 auto-height：自动增高（设 style.height 不生效）

#### `cursorSpacing`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：★官方 cursor-spacing：光标与键盘距离

#### `cursor`

- **类型**：`Number`　**默认值**：`-1`　**必填**：否
- **说明**：★官方 cursor：focus 时光标位置

#### `selectionStart`

- **类型**：`Number`　**默认值**：`-1`　**必填**：否
- **说明**：★官方 selection-start：自动聚焦时光标起始位置（需与 selection-end 搭配）

#### `selectionEnd`

- **类型**：`Number`　**默认值**：`-1`　**必填**：否
- **说明**：★官方 selection-end：自动聚焦时光标结束位置

#### `adjustPosition`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：★官方 adjust-position：键盘弹起时自动上推页面

#### `holdKeyboard`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：★官方 hold-keyboard：focus 时点击页面不收起键盘

#### `disableDefaultPadding`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：★官方 disable-default-padding：去掉 iOS 默认内边距

#### `confirmType`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：★官方 confirm-type：键盘右下角按钮文字（send/search/next/go/done）

#### `confirmHold`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：★官方 confirm-hold：点击键盘右下角按钮时保持键盘不收起

#### `adjustKeyboardTo`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：★官方 adjust-keyboard-to：键盘对齐位置（cursor/none）

#### `fixed`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：★官方 fixed：fixed 定位（MP 私有布局语义）

#### `showConfirmBar`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：★官方 show-confirm-bar：是否显示键盘上方完成横条（iOS）

## Events

| 事件 | 说明 | 载荷 |
|---|---|---|
| `input` | 输入变化（载荷 { value } 跨端归一——MP 自定义组件 v-model 仅覆盖原生 input/textarea，故显式事件契约） | `{ value: eventValue(e) }` |
| `confirm` | 键盘确认（回车/完成键） | `{ value: eventValue(e) }` |
| `focus` | 获得焦点 | `e` |
| `blur` | 失去焦点 | `e` |

### 事件详解

#### `input`

- **说明**：输入变化（载荷 { value } 跨端归一——MP 自定义组件 v-model 仅覆盖原生 input/textarea，故显式事件契约）
- **载荷**：`{ value: eventValue(e) }`

#### `confirm`

- **说明**：键盘确认（回车/完成键）
- **载荷**：`{ value: eventValue(e) }`

#### `focus`

- **说明**：获得焦点
- **载荷**：`e`

#### `blur`

- **说明**：失去焦点
- **载荷**：`e`

## 实现要点

- 矩阵 01 §6：value / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
- 事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model）
- 双端同源码：textarea 原生透传（tag/passthrough）；MP textarea 原生支持 bindconfirm
- ★属性全覆盖（官方 21/21）：value/placeholder/placeholder-style/placeholder-class/disabled/
- maxlength/auto-focus(→focus 等价)/focus/auto-height/cursor-spacing/cursor/selection-start/
- selection-end/adjust-position/hold-keyboard/disable-default-padding/confirm-type/confirm-hold/
- adjust-keyboard-to/fixed/show-confirm-bar。
- ★诚实边界：MP 私有键盘/光标类属性（cursor-spacing/selection-*/adjust-*/hold-keyboard/
- confirm-type/confirm-hold/adjust-keyboard-to/fixed/show-confirm-bar）在 Web 端由原生 <textarea>
- 透传为 DOM 属性——浏览器不解释（无副作用，不伪造行为）；纯 MP 能力，属平台差异。

## 用法

```vue
<p-textarea :disabled="true" :value="'…'" :maxlength="0">
  <p-text>内容</p-text>
</p-textarea>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：src/components/p-textarea/index.vue -->