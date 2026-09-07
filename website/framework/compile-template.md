---
title: 模板转换
order: 6
group: 编译期
---

# 模板转换

`<template>` 的标签映射由编译规则表驱动（`transforms/template.ts`）。业务写标准 HTML，产物是合法 WXML。

> **端范围**：本页描述 **mp-weixin** 目标的编译管线（Layer 1 兼容层）。Web 端无此管线——标准 Vue 直跑（p-* 语义组件原生渲染）；其余端随桥接线启用。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。每次编译触发的规则可在 trace 里逐条观察（`proteus explain <file>` / Playground 转换面板）。

## 标签映射规则

| 规则 ID | 映射 | 说明 |
|---|---|---|
| `tag/div-to-view` | `div → view` | 容器原子 |
| `tag/inline-to-text` | `span → text` | 行内文本 |
| `tag/heading-to-text` | `h1–h6 → text` | 标题转文本，**追加语义类**：`<h1 class="title">` → `<text class="proteus-h1 title">`（样式选择器 `.proteus-h1` 由样式管线注入基础 WXSS） |
| `tag/para-to-text` | `p → text` | 段落（同上追加 `.proteus-p`） |
| `tag/link-to-view` | `a → view` | 链接转可点容器：`href` → `data-url` + `bindtap="proteusNavigateTo"` |
| `tag/image` | `img → image` | 图片；`:src` → `src="{{url}}"` |
| `tag/router-link` | `router-link → view` | 声明式导航：`to` → `data-url` + `bindtap="proteusNavigateTo"`（wx.router） |
| `tag/passthrough` | 同名保留 | `button` / `input` / `textarea` / `video` / `canvas` / `scroll-view` / `slot`——小程序同名标签直接透传，避免二次语义 |
| `tag/rich-text` | `v-html 容器 → rich-text` | 富文本：`<div v-html="html">` → `<rich-text nodes="{{html}}" />` |
| `tag/unknown-kebab` | 未注册标签原样输出 | kebab-case 透传（自定义组件） |

> 完整映射可反查：`npx proteus rules` 输出全部规则（每条自带 before/after 示例与 why），`TAG_RULE_BY_TAG` 提供标签 → 规则 ID 的 O(1) 反查。

## 指令映射

| 规则 ID | 业务写法 | 产物 | 说明 |
|---|---|---|---|
| `directive/v-if` | `<p v-if="show">` | `wx:if="{{show}}"` | |
| `directive/v-else-if` | `v-else-if="b"` | `wx:elif="{{b}}"` | |
| `directive/v-else` | `v-else` | `wx:else` | |
| `directive/v-for` | `v-for="(item, idx) in list" :key="idx"` | `wx:for="{{list}}" wx:for-item="item" wx:for-index="idx" wx:key="idx"` | item/index 命名显式展开 |
| `directive/v-show` | `v-show="show"` | `hidden="{{!show}}"` | 注意取反语义 |
| `directive/v-bind` | `:src="url"` | `src="{{url}}"` | 插值绑定 |
| `directive/v-bind-class` | `:class="[a, { b: on }]"` | `class="{{…}}"`（三元拼接表达式） | 数组/对象语法编译期展开为字符串拼接 |
| `directive/v-bind-style` | `:style="{ backgroundColor: bg }"` | `style="background-color:{{bg}}"` | camelCase → kebab-case |
| `directive/v-bind-key` | `:key="idx"` | `wx:key="idx"` | |
| `directive/v-model` | `<input v-model="name" />` | `value="{{name}}" bindinput="proteusOnNameInput"` | MP 自定义组件 v-model 仅覆盖原生 input/textarea——**显式事件契约**（`proteusOnXxxInput` 内 setData 回写） |
| `directive/v-html` | `v-html="html"` | `<rich-text nodes>` | 富文本降级 |
| `directive/custom` | `v-focus` 等自定义指令 | 剥离 + 警告 | 小程序无对等机制，显式警告不静默 |

## 事件映射

| 规则 ID | 业务写法 | 产物 | 说明 |
|---|---|---|---|
| `event/click-to-tap` | `@click="handleTap"` | `bindtap="handleTap"` | 简单方法引用直映射 |
| `event/modifier-catch` | `@click.stop="stopFn"` | `catchtap="stopFn"` | `.stop` → catch（阻止冒泡） |
| `event/modifier-self-once` | `@click.self` / `@click.once` | `bindtap="proteusSelfHandleTap"` | 包装方法生成于 Page methods（运行时实现 self/once 语义） |
| `event/inline-expression` | `@click="count++"` | `bindtap="proteusInlineIncCount"` | 内联表达式提升为方法 + `setData({ count: … })`；**复杂表达式（三元调用等）编译期警告原样输出**——产物需人工处理 |

## 语义组件例外（p-* 不走标签映射）

p-* 语义组件**不进标签映射**，而是产出 C-IR 语义节点、由渲染后端按语义实现：

| 规则 ID | 说明 |
|---|---|
| `semantic/base-class` | 语义组件根节点追加语义类（`.proteus-*`，样式锚点） |
| `layout/auto-flex-row` | row 布局语义自动展开 |
| `fluid/p-fluid` | clamp 表达式编译期生成（设计稿宽度来自 proteus.config 的 `layout.designWidth`） |
| `component/progress-degrade` | progress 等无原生对等的组件降级 |
| `transition/component` / `transition/leave-state` | `<transition>` 显隐动画：`__tv0` / `__tl0` data 字段 + `proteusTransitionToggle0()`（keyframes 由样式管线注入） |
| `slot/scoped-slot` | 作用域插槽剥离 + 警告（MP 无模板传参——替代模式：props 传子 + triggerEvent 回调） |
| `template/template-ref` | `ref="el"` 剥离 + 警告（MP 无模板 ref） |
| `template/is-component` | `<component :is>` 警告 + 原样输出（无效标签） |
| `nav/navigate-link` / `nav/route-type` | 导航类标签的路由接线（wx.router） |
| `node/interpolation` | `{{ }}` 插值直通 WXML |
| `annotation/line-note` | `--debug` 产物注入源码行号注释 |

## 诚实边界

- `event/inline-expression` 对复杂表达式（方法调用三元等）**警告 + 原样输出**，不静默产出错误产物
- 自定义指令 / 模板 ref / 作用域插槽 / `<component :is>` 显式警告剥离——能力边界见 [脚本转换](/docs/framework/compile-script) 的诚实边界
- 全部规则可经 `proteus.config.ts` 的 `rules.disabled` 禁用、`rules.mapping` 覆盖

## 下一步

- [脚本转换](/docs/framework/compile-script)
- [样式转换](/docs/framework/compile-style)
