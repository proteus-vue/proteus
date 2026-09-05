---
title: 框架总览
order: 1
group: 总览
---

# 框架总览

Proteus 的内核是一台「语义机器」：业务代码声明**要什么**，框架把它编译为与平台无关的中间表示（IR），后端按 IR 上的语义字段实现**怎么做**。本分区把这台机器拆开讲清楚——架构、编译期、运行期、渲染层、宿主与内存、质量门禁。

## 六层架构

```
┌─ 应用层（业务）      标准 Vue SFC / 路由 / 状态 / 页面
├─ 语义层（框架核心）  p-* 语义组件 / 128 原语 SSOT / Capability Hook / Fluid
├─ 编译层             Compiler + Plugin API + CompilerBackend SPI（Node / Rust / WASM）
├─ 渲染层             RenderBackend SPI（VueDom / Native / Flutter / Skia / Headless）
├─ 宿主层             HostRuntime SPI + 六容器策略 + 所有权 / 借用检查
└─ 能力层             NativeBackend SPI（📋 规划）+ Capability Hook（50 个）
```

核心洞察：框架通过 IR 只描述「要什么」（一个网格、一次扫码调用），后端决定「怎么做」（`UICollectionView` 还是 CSS Grid、`AVCapture` 还是 `CameraX`）。

## 核心公式

> **任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）**

每层 SPI 都配 conformance 套件并由 CI 强制校验——**约束挂在 IR 上，而不是挂在某个平台上**。

## 一次编写，两端产物

```
                    ┌─ Web 端 ─── 标准 Vite + Vue ──► DOM（零转换）
page.vue（标准 SFC）─┤
                    └─ 小程序端 ─ 编译管线 ────────► WXML / WXSS / Page() JS / JSON
```

- **Web 端零转换**：标准 Vite + `@vitejs/plugin-vue`，devtools / HMR / 代码分割全部可用
- **小程序端编译期转换**：标签映射 / 响应式重写 / 样式转换 / 路由生成，四条管线在编译期完成

## 本分区导航

| 组 | 内容 |
|---|---|
| 语义模型 | CompilerIR 与语义树——「业务代码 → 语义 IR」的契约 |
| 编译期 | 编译管线五讲：总览 / 模板 / 脚本 / 样式 / 路由 / 规则链 |
| 运行期 | Web 运行时 / 小程序运行时 / 启动流程 |
| 渲染层 | RenderBackend SPI + Flutter / Headless 后端 |
| 宿主与内存 | 容器与宿主、所有权工程 |
| 质量与兼容 | 一致性验证、语义版本 |

## 下一步

- [可插拔架构](/docs/framework/22-architecture)：SPI 全景与「不绑定」总表
- [语义模型](/docs/framework/11-semantic-model)：两份契约（CompilerIR / 语义树）
