---
title: 语义模型
order: 3
---

# 语义模型（统一语义收敛）

## 不做翻译，做抽象

传统跨端框架的思维是"把 A 平台的 API 翻译成 B 平台的 API"——**翻译永远有损**。Proteus 的思维是"定义一个与任何平台无关的语义，各平台来实现它"——**零损映射**。

```
传统：   Platform A API → 翻译层 → Platform B API   （有损）
Proteus：Business → 语义 IR → Backend SPI → Platform A / B / C   （无损）
```

**框架从不说"小程序 API 是标准"——框架自己定义的语义才是标准。** 小程序组件集（view/text/wx.*）降级为 Layer 1 兼容层（`@proteus-vue/compat-miniprogram`），Proteus 语义组件（p-* + useNative）是 Layer 0。

## 五个支柱

1. **语义优先于实现**：不翻译 API，定义语义
2. **接口与实现彻底解耦**：业务只依赖接口，永远不知道后端的存在
3. **验证先于运行**：conformance 套件 + 编译期约束，能在编译期发现的问题绝不留到运行时
4. **渐进式覆盖**：80% 框架内置 + 18% 官方 Backend + 1.9% 社区 + 0.1% 兜底 = 99% 零原生
5. **方法论可泛化**：同一公式已解决编译、渲染、能力、端接入四类问题

## 语义原语：128 原语 SSOT

`PRIMITIVE_CATALOG` 是全部语义原语的单一事实源（128 条），每条声明：

- 语义名与家族（布局 / UI / Shell / 手势 / Capability / Engineering）
- 各端映射（iOS / Android / 鸿蒙 / Web / 小程序）
- 实现状态（45 条 implemented，全部过 × 6 后端 conformance 门禁）

```bash
proteus audit coverage   # 编译期门禁：语义清单与实现对账
```

## 语义命名铁律

接口命名禁用厂商/技术名词——`<pg-glass>` 而非 `backdrop-filter`、`useCamera()` 而非 `wx.createCameraContext()`。接口里出现实现名词，后端就无法替换。

## 延伸阅读

- [PROTEUS-METHODOLOGY](https://github.com/proteus-vue/proteus/blob/main/docs/proteus-methodology-plan/PROTEUS-METHODOLOGY.md)：哲学根文档
- [SPI-First 五步法](https://github.com/proteus-vue/proteus/blob/main/docs/spi-first-methodology/)：九次泛化的抽象定义
