---
title: 什么是 Proteus
order: 1
---

# 什么是 Proteus

Proteus 是一个**语义收敛的跨端应用框架**：

> **One semantic model. Any render engine. Zero native glue.**
> 一套语义内核，任意渲染引擎，任意原生能力。

## 核心公式

```
任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）
```

框架只做两件事：**定义"你要什么"**（语义接口 / IR），**定义"怎么验证做对了"**（conformance / 铁律 / 编译期约束）。平台只做一件事：提供"怎么做"（Backend 实现）。业务开发者只消费语义接口，对后端零感知。

## 不绑定任何单一平台

「不绑定」是同一个设计动作在全部架构维度上的重复应用：

| 「不绑定」系列 | 语义层 | 后端 SPI | 状态 |
|---|---|---|---|
| 平台 API（G-31/32） | p-* 语义组件 + 128 原语 | 各端语义实现 | ✅ |
| 渲染引擎（G-27/37） | VNode / Component IR | RenderBackend（VueDom / Native / Flutter / Headless） | ✅ |
| 编译器（G-29/38） | Compiler IR | CompilerBackend（Node / Rust / WASM） | 🟡 |
| 容器形态（G-42） | 页面生命周期状态机 | 六容器策略 | ✅ |
| 宿主运行时（G-39） | HostRuntime 接口 | 宿主实现 | 📋 |
| 执行载体（G-40） | ExecutionCarrier SPI | JSI（默认）/ bytecode / AOT | 📋 |
| 端（G-30） | Platform = (R, C, J) 三元组 | 任意端 | 📋 |

## 为什么叫 Proteus

普罗透斯是希腊神话中的海神，化作狮子、蛇、野猪、流水与大树——**形态可变，本质恒定**。业务代码只依赖语义内核（本质），渲染形态由后端决定（变形）。

## 下一步

- [快速开始](/docs/quick-start)：两分钟跑通 Web + 小程序双端
- [语义模型](/docs/semantic-model)：理解"语义定义 + 后端实现"
