---
title: 什么是 Proteus
order: 1
group: 入门
---

# 什么是 Proteus

Proteus 是一个**语义收敛的跨端应用框架**：业务代码只写一份**标准 Vue SFC + 标准 HTML 标签**——Web 端零转换直跑（标准 Vite + Vue DOM），微信小程序端由编译器转为 Skyline 原生四件套（WXML / WXSS / `Page()` JS / JSON）。渲染底座、编译器、宿主容器、执行载体全部可插拔：换后端，不改业务代码。

> **One semantic model. Any render engine. Zero native glue.**
> 一套语义内核，任意渲染引擎，任意原生能力。
>
> **不跨端翻译，做跨端操作系统：语义是内核，后端是驱动。**

## 核心公式

> **任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）**

框架只做两件事：

- **定义「你要什么」**：语义接口 / IR（Compiler IR、Component IR、渲染树）
- **定义「怎么验证做对了」**：conformance 套件 / 铁律 / 编译期约束

平台只做一件事：提供「怎么做」（Backend 实现）。**业务开发者只消费语义接口，对后端零感知。**

## 六层架构

```
┌─ 应用层（业务）      标准 Vue SFC / 路由 / 状态 / 页面
├─ 语义层（框架核心）  p-* 语义组件 / 128 原语 SSOT / Capability Hook / Fluid
├─ 编译层             Compiler + Plugin API + CompilerBackend SPI（Node / Rust / WASM）
├─ 渲染层             RenderBackend SPI（VueDom / Native / Flutter / Skia / Headless）
├─ 宿主层             HostRuntime SPI + 六容器策略 + 所有权 / 借用检查
└─ 能力层             NativeBackend SPI（📋 规划）+ Capability Hook（50 个）
```

核心洞察：框架通过 IR 只描述「要什么」（一个网格、一次扫码调用），后端决定「怎么做」（`UICollectionView` 还是 CSS Grid、`AVCapture` 还是 `CameraX`）。渲染与能力两套后端共用同一套 SPI 方法论。

## 「不绑定」总表

「不绑定」不是口号，而是同一个设计动作在全部架构维度上的重复应用：每一层先定义语义契约，再把具体实现做成可插拔后端。

| 「不绑定」系列 | 语义层（框架定义） | 后端 SPI（可插拔实现） | 状态 |
|---|---|---|---|
| 平台 API（G-31/32） | p-* 语义组件 + 128 原语 SSOT + Capability Hook | 各端语义实现（小程序降级为 Layer 1 兼容层） | ✅ |
| 渲染引擎（G-27/37） | VNode / Component IR / LayoutConstraint IR | `ProteusRenderBackend`（VueDom / Native×3 / Flutter / Headless） | ✅ |
| 编译器（G-29/38） | Compiler IR | `ProteusCompilerBackend`（Node ✅ / Rust ✅ / WASM 📋） | 🟡 |
| 容器形态（G-42） | 页面生命周期状态机 + IR 单一 Owner | 六容器策略（Stack / SuperApp / Window / MiniProgram / Embedded / SinglePage） | ✅ |
| 宿主运行时（G-39） | Host Runtime 接口（bootstrap / worker / engine / native 桥） | 宿主实现（Web / Terminal 参考实现已备） | 📋 |
| 执行载体（G-40） | ExecutionCarrier SPI（JSI 默认 / bytecode / AOT） | 载体实现（JSI 是默认实现，不是架构绑定） | 📋 |
| 端（G-30） | Platform = (R, C, J) 三元组 + Tier 1-4 | 任意能提供渲染宿主 / 能力宿主 / JS 运行时之一的端 | 📋 |

> 状态图例：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库（plan + 参考实现，无可运行集成）。

每层 SPI 都配 conformance 套件并由 CI 强制校验——**约束挂在 IR 上，而不是挂在某个平台上**。这也是 AI Agent 能安全介入的原因：它操作的是 IR，IR 上有约束。

## 与「跨端翻译」的区别

| 维度 | 常见跨端框架 | Proteus |
|---|---|---|
| 业务写法 | 平台 DSL（view / text）或单端语法锁定 | 标准 HTML + 标准 Vue SFC |
| 渲染底座 | WebView 或锁定单一引擎 | 可插拔，同一 App 按页面选引擎 |
| AI 介入方式 | 无 IR，只能文本替换 | 操作 IR + 编译期强制校验 |
| 工具链 | IDE 锁定 | 纯 Vite 插件，任何 CI 可跑 |

竞品缺的不是某个 API，而是「显式语义 + 可编程 IR + 后端原生映射 + 强制校验」这套方法论——普通 DSL 映射是「换种语法写原生代码」，Proteus 是「定义语义，让任何后端实现它」。

## 为什么叫 Proteus

普罗透斯（Proteus）是希腊神话中的海神，《奥德赛》中他在法罗斯岛被擒时化作狮子、蛇、野猪、流水与大树，英语 **protean（千变万化）** 一词即源于他的名字。

| 神格 | 框架对应 |
|---|---|
| **变形**：同一存在变换出多种形态 | 同一份业务语义 → Vue DOM / 原生 / Flutter / 小程序，形态可变 |
| **本质恒定**：变形后本体不变 | 业务代码只依赖语义内核，平台差异全部下沉为后端实现细节 |
| **先知**：预知未来 | 编译期优先：能编译期发现的问题绝不留到运行时 |
| **通晓万物**：知过去、现在、未来 | 可验证：每层 SPI 都有 conformance 门禁，合规性机器可判、CI 强制 |

## 适合谁，不适合谁

**适合**：

- 需要 **Web + 微信小程序双端交付**的团队：Web 全功能，小程序 Skyline 优先（WebView 降级仅保证可运行）
- 想让 **AI Agent 参与开发**的团队：AI 产出符合 IR 契约的标准代码并经编译期强制校验，而非自由文本
- 有**存量小程序**要渐进迁移：兼容层 `@proteus-vue/compat-miniprogram` + `proteus migrate mp` codemod
- 关注**内存与生命周期治理**：所有权 / 借用检查在编译期拦截 use-after-move、借用逃逸

**不适合**（诚实边界）：

- 目标平台包含**支付宝 / 抖音 / 快手**小程序——明确非目标
- 需要**现在就在 iOS / Android 真机跑原生渲染**：五后端中 Native×3 / Flutter 为 widget 级原型映射，原生工程接线按路线图分批推进
- **强实时 / 强安全隔离**场景（航空、医疗）
- 依赖**运行时动态注册页面 / 路由**——Proteus 编译期静态声明，运行时禁止动态注册

## 下一步

- [快速开始](/docs/02-quick-start)：用脚手架创建双端工程，跑通 Web 与小程序
- [语义模型](/docs/03-semantic-model)：理解 Compiler IR、语义树与「语义 → 多端渲染」的完整流程
- [可插拔架构](/docs/09-architecture)：渲染 / 编译 / 宿主 / 执行载体 SPI 全景与设计铁律
