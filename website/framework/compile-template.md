---
title: 模板转换
order: 6
group: 编译期
---

# 模板转换

`<template>` 的标签映射由编译规则表驱动（`transforms/template.ts`）。业务写标准 HTML，产物是合法 WXML。

## 标签映射规则

| 规则 ID | 映射 | 说明 |
|---|---|---|
| `tag/div-to-view` | `div → view` | 容器原子 |
| `tag/inline-to-text` | `span → text` | 行内文本 |
| `tag/heading-to-text` | `h1–h6 → text` | 标题转文本（含语义权重） |
| `tag/para-to-text` | `p → text` | 段落 |
| `tag/link-to-view` | `a → view` | 链接转可点容器（导航语义） |
| `tag/image` | `img → image` | 图片 |
| `tag/router-link` | `router-link → view` | 声明式导航组件 |
| `tag/passthrough` | 同名保留 | `button` / `input` / `textarea` / `video` / `canvas` / `scroll-view` / `slot`——小程序同名标签直接透传 |
| `tag/rich-text` | `v-html 容器 → rich-text` | 富文本 |
| `tag/unknown-kebab` | 未注册标签原样输出 | kebab-case 透传 |

> 完整映射可反查：`npx proteus rules` 输出全部规则（每条自带 AI 说明书），`TAG_RULE_BY_TAG` 提供标签 → 规则 ID 的 O(1) 反查。

## 指令映射

`v-if` / `v-for` / `v-show` / `@tap` 等指令映射为 WXML 对应语法（`wx:if` / `wx:for` / `hidden` / `bindtap`）——规则同样可枚举、可追溯。

## 设计要点

- **映射是规则不是硬编码**：每条规则有 before/after 示例与 why，AI 与人都能读懂
- **同名标签透传**：小程序与 HTML 同名的标签不做转换，避免二次语义
- **语义节点例外**：p-* 语义组件不走标签映射，而是进语义树由后端按语义实现（见[语义模型](/docs/framework/11-semantic-model)）

## 下一步

- [脚本转换](/docs/framework/compile-script)
