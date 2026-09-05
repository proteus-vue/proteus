---
title: Proteus 简介
order: 1
group: 起步
---

# Proteus 简介

Proteus 是一个**语义收敛的跨端应用框架**：业务代码只写一份**标准 Vue SFC + 标准 HTML 标签**，渲染到多个终端——

- **Web 端**（✅ 已落地）：标准 Vite + Vue，零转换直跑，devtools / HMR / 代码分割全部可用
- **微信小程序端**（✅ 已落地）：编译器把同一份源码转为 Skyline 原生四件套（WXML / WXSS / `Page()` JS / JSON）
- **App（iOS / Android / 鸿蒙）**（🟡 原型映射）：RenderBackend SPI 原生控件——按路线图接线
- **Flutter / 快应用**（🟡 / ⬜）：同一语义模型，端实现按路线图推进

> 全部 8 端的状态与架构对照见 [端与成熟度](/docs/framework/ends-matrix)；组件/能力页自带终端兼容表。

> **One semantic model. Any render engine. Zero native glue.**
> 一套语义内核，任意渲染引擎，任意原生能力。

## 它解决什么问题

同时交付 Web 与小程序的团队，今天要维护两套心智：

| 痛点 | 传统做法 | Proteus |
|---|---|---|
| 两套语法 | Web 写 HTML，小程序写 WXML + `setData` | 只写标准 Vue SFC，编译器完成映射 |
| 两套配置 | vue-router 路由表 + `app.json` 页面配置各写一份 | 页面 `<route>` 块就近声明，编译期**按端生成**（Web 路由表 / 小程序 `app.json`…） |
| 样式两套 | CSS 与 WXSS 手工同步 | 一份样式编译期转换（px→rpx 可配） |

## 核心机制（一段话）

你写的页面是**标准 Vue SFC**。Web 端它就是普通 Vue 组件；小程序端编译器把它转成小程序四件套——标签映射（`div→view` 等）、响应式重写（`ref` → `setData` 批量合并）、样式转换全部自动完成。业务代码里没有一行 `wx.`、没有条件编译。

## 适合谁，不适合谁

**适合**：

- 需要 **Web + 微信小程序双端交付**的团队（Web 全功能，小程序 Skyline 优先；App/鸿蒙按路线图接线）
- 想让 **AI Agent 参与开发**的团队（AI 产出符合 IR 契约的标准代码，编译期强制校验）
- 有**存量小程序**要渐进迁移（兼容层 + `proteus migrate mp` codemod）

**不适合**（诚实边界）：

- 目标平台包含支付宝 / 抖音 / 快手小程序——明确非目标
- 需要现在就在 iOS / Android 真机跑原生渲染——原生后端为原型映射，按路线图推进
- 依赖运行时动态注册页面/路由——Proteus 编译期静态声明

## 为什么叫 Proteus

普罗透斯（Proteus）是希腊神话中的海神，同一存在可化作多种形态而本质恒定——正如同一份业务语义，可渲染为 DOM、原生控件或小程序，而业务代码不变。

## 下一步

- [Proteus 与传统跨端框架的区别](/docs/02-difference)：一分钟理解设计取舍
- [体验 Playground](/docs/03-playground)：不装任何东西，浏览器里跑第一个页面
- [创建你的第一个工程](/docs/05-create-project)：脚手架从零到双端跑通
