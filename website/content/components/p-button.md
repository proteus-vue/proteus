---
title: p-button
group: 内容与表单
order: 1002
---

# p-button

按钮

> 语义组件（Layer 0）· 域 **内容与表单** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| ui.button | 内容与表单 | `<button>`（L1 原语） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<button>`（L1 原语） |
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
| `loading` | 加载中状态 | `Boolean` | `false` | 否 |
| `throttle` | 点击节流间隔（ms，防重复触发——runtime 内置） | `Number` | `0` | 否 |
| `size` | 按钮大小：default / mini | `String` | `''` | 否 |
| `type` | 样式类型：default（白）/ primary（绿）/ warn（红） | `String` | `''` | 否 |
| `plain` | 是否镂空（背景透明） | `Boolean` | `false` | 否 |
| `formType` | form 内行为：submit / reset | `String` | `''` | 否 |
| `openType` | 微信开放能力（contact/share/getPhoneNumber/openSetting/launchApp/chooseAvatar/…） | `String` | `''` | 否 |
| `hoverClass` | 按下样式类：缺省（''）→ 用微信原生 button-hover 默认点击反馈（★勿传空串覆盖）； | `String` | `''` | 否 |
| `hoverStopPropagation` | 是否阻止祖先节点出现点击态 | `Boolean` | `false` | 否 |
| `hoverStartTime` | 按住多久出现点击态（ms） | `Number` | `20` | 否 |
| `hoverStayTime` | 松开后点击态保留时间（ms） | `Number` | `70` | 否 |
| `lang` | 返回用户信息的语言：zh_CN / zh_TW / en | `String` | `''` | 否 |
| `sessionFrom` | 会话来源（open-type=contact 有效） | `String` | `''` | 否 |
| `sendMessageTitle` | 会话内消息卡片标题（contact） | `String` | `''` | 否 |
| `sendMessagePath` | 会话内消息卡片跳转路径（contact） | `String` | `''` | 否 |
| `sendMessageImg` | 会话内消息卡片图片（contact） | `String` | `''` | 否 |
| `appParameter` | 打开 APP 时传递的参数（launchApp） | `String` | `''` | 否 |
| `showMessageCard` | 是否显示会话内消息卡片（contact） | `Boolean` | `false` | 否 |
| `phoneNumberNoQuotaToast` | 手机号额度用尽时是否展示提示（getPhoneNumber） | `Boolean` | `true` | 否 |
| `needShowEntrance` | 转发的文本消息是否带小程序入口 | `Boolean` | `false` | 否 |
| `entrancePath` | 从消息入口打开小程序的路径 | `String` | `''` | 否 |

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

#### `loading`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：加载中状态

#### `throttle`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：点击节流间隔（ms，防重复触发——runtime 内置）

#### `size`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：按钮大小：default / mini

#### `type`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：样式类型：default（白）/ primary（绿）/ warn（红）

#### `plain`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否镂空（背景透明）

#### `formType`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：form 内行为：submit / reset

#### `openType`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：微信开放能力（contact/share/getPhoneNumber/openSetting/launchApp/chooseAvatar/…）

#### `hoverClass`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：按下样式类：缺省（''）→ 用微信原生 button-hover 默认点击反馈（★勿传空串覆盖）；

#### `hoverStopPropagation`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否阻止祖先节点出现点击态

#### `hoverStartTime`

- **类型**：`Number`　**默认值**：`20`　**必填**：否
- **说明**：按住多久出现点击态（ms）

#### `hoverStayTime`

- **类型**：`Number`　**默认值**：`70`　**必填**：否
- **说明**：松开后点击态保留时间（ms）

#### `lang`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：返回用户信息的语言：zh_CN / zh_TW / en

#### `sessionFrom`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：会话来源（open-type=contact 有效）

#### `sendMessageTitle`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：会话内消息卡片标题（contact）

#### `sendMessagePath`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：会话内消息卡片跳转路径（contact）

#### `sendMessageImg`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：会话内消息卡片图片（contact）

#### `appParameter`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：打开 APP 时传递的参数（launchApp）

#### `showMessageCard`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否显示会话内消息卡片（contact）

#### `phoneNumberNoQuotaToast`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：手机号额度用尽时是否展示提示（getPhoneNumber）

#### `needShowEntrance`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：转发的文本消息是否带小程序入口

#### `entrancePath`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：从消息入口打开小程序的路径

## Events

| 事件 | 说明 | 载荷 |
|---|---|---|
| `click` | 点击/轻触（throttle 节流后触发） | `e, { bubbles: true, composed: true }` |
| `getuserinfo` | — | — |
| `contact` | — | — |
| `getphonenumber` | — | — |
| `getrealtimephonenumber` | — | — |
| `error` | 加载/执行失败 | — |
| `opensetting` | — | — |
| `launchapp` | — | — |
| `chooseavatar` | — | — |
| `agreeprivacyauthorization` | — | — |
| `createliveactivity` | — | — |

### 事件详解

#### `click`

- **说明**：点击/轻触（throttle 节流后触发）
- **载荷**：`e, { bubbles: true, composed: true }`

#### `getuserinfo`

- **说明**：—
- **载荷**：无

#### `contact`

- **说明**：—
- **载荷**：无

#### `getphonenumber`

- **说明**：—
- **载荷**：无

#### `getrealtimephonenumber`

- **说明**：—
- **载荷**：无

#### `error`

- **说明**：加载/执行失败
- **载荷**：无

#### `opensetting`

- **说明**：—
- **载荷**：无

#### `launchapp`

- **说明**：—
- **载荷**：无

#### `chooseavatar`

- **说明**：—
- **载荷**：无

#### `agreeprivacyauthorization`

- **说明**：—
- **载荷**：无

#### `createliveactivity`

- **说明**：—
- **载荷**：无

## 插槽

| 插槽 | 说明 |
|---|---|
| default | 默认插槽（组件主内容） |

## 实现要点

- 矩阵 01 §7：disabled/loading 原生映射 + throttle 防重复点击（runtime 内置）
- ★2026-09-13 官方属性对齐：补齐官方 <button> 的属性透传（size/type/plain/form-type/open-type/hover-*）
- 与开放能力事件（getuserinfo/contact/getphonenumber/…）——此前只声明 5 个 props（覆盖 2/22）。
- Web 端 proteus-button 已实现同套 API（视觉变体 + open-type 降级），两端语义一致。

## 用法

```vue
<p-button :disabled="true" :loading="true" :throttle="0">
  <p-text>内容</p-text>
</p-button>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：src/components/p-button/index.vue -->