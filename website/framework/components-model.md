---
title: 组件化与语义命名
order: 15
group: 组件框架
---

# 组件化与语义命名

p-* 语义组件是 Proteus 组件框架的基本单元。它就是**标准 Vue SFC**，加上三条纪律：

1. **语义命名（铁律 G-31.1）**：组件与标签必须 `p-` 前缀语义命名（`p-grid` 表达网格意图），禁止与小程序/HTML 同名
2. **对象形式 defineProps**：props 用对象字面量（编译器静态提取；契约见 `@proteus-vue/contracts` 的 BaseProps）
3. **审计零违规**：`components:audit` 机器审计（平台 API 直调 / 同步存储 / 清单完整性）

## 语义即 IR

每个 p-* 组件经 `toComponentIR` 产出 **C-IR 语义节点**：`tag → semantic`（如 `p-grid → layout.grid`）+ props + children。渲染后端消费 **semantic 字段**而非标签字符串——这正是「后端按语义实现」的落点（128 原语 SSOT 见 [PRIMITIVE_CATALOG](/docs/framework/22-architecture)）。

## 组件审计

审计由 component-ir 契约驱动（`tests/component-audit.test.ts`）：

- 目录结构：`src/components/p-*/index.vue`（每个组件一个目录）
- props 对象形式（编译器静态提取的前提）
- 平台 API 红线：组件内禁止 `document.*` / `window.*` / `wx.*` 直调（no-platform-api）
- 语义链接：TAG_SEMANTIC_MAP 双登记（组件 ↔ 语义）

## 三层形态

| 形态 | 特征 | 例子 |
|---|---|---|
| Tier 0 纯数据 | 能用 JSON 表达完，零代码 | 主题 / 片段 / 配置 |
| Tier 1 声明式 | 轻量 WASM 行为 | 命令 / 面板 |
| Tier 2 完整 | 完整 WASM 运行时 | 复杂交互插件 |

（Tier 0/1/2 同时是[插件 API](/docs/plugin/host)的形态分界。）

## 下一步

- [组件引用与注册](/docs/framework/components-registration)
