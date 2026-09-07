# Proteus CLI 落地执行文档

> **★实现状态（2026-08）**：✅ 已实现——@proteus-vue/cli 完整落地（build/explain/rules/router:check/module:check/module:duplicates/audit module/init module/capabilities:manifest/capabilities:check），587 测试覆盖（2026-08 组件库 P0 收官后基线）。

> **一句话定位**：CLI 是 Compiler 与开发者（以及 AI）之间的唯一入口。它不发明编译逻辑，只负责**把 `proteus.config.ts` 的意图，确定性地转成 Compiler + 各层 plan 的执行动作**，且全程可观测、可审计。
>
> **核心原则**：和前面 8 份 plan 完全一致 —— 透明化、AI 可读、产物可追溯、`proteus audit` 硬卡口。CLI 本身不做"隐式魔法"，每一条命令的行为都能在 `--explain` 里看到完整展开。

---

## 这份文档覆盖什么

- `proteus` 命令体系（dev / build / preview / audit / doctor / create）
- 配置加载与校验（`proteus.config.ts` 统一 schema）
- 多端产物输出结构（`dist/web` `dist/mp` `dist/app`）
- `audit` 子命令族（route / module / api / capability / lifecycle / compile）
- 插件系统（Compiler transform + CLI middleware）
- 工程脚手架（`create-proteus`）

## 防止上下文撑爆的规则（重要）

和 Compiler plan 相同，每条必须遵守：

1. **单文件 < 500 行**，超过必拆
2. **单 PR 只做 1 个 Batch**，绝不合并 Batch
3. **上下文分层**：每个 Batch 只需 `00-overview + 当前模块 + 直接依赖` 三份
4. **LLM 喂料顺序**：先 `00-overview`（快速回顾）→ 再当前模块 → 最后直接依赖模块
5. **绝不一次性把所有 plan 塞给 LLM**

---

## 与其他 plan 的关系

| 层 | 文档 | 调用方式 |
|----|------|---------|
| Compiler | `proteus-compiler-plan` | CLI `dev/build` 内部调用 Compiler |
| **CLI** | ← 本份 | 用户/AI 直接调用 |
| Router | `proteus-router-plan` | `proteus audit route` 触发 Router M8.6 |
| Module | `proteus-module-plan` | `proteus audit module` 触发 M8 |
| API | `proteus-api-plan` | `proteus audit api` 触发 08-code-splitting-ci |
| Platform | `proteus-platform-plan` | `proteus audit capability` 触发 M8 |
| Lifecycle | `proteus-lifecycle-plan` | `proteus dev` 启动编排器 |
| Pinia | `proteus-pinia-plan` | 通过 Compiler transform 接入 |
| Component | `proteus-component-plan` | 通过 Compiler codegen 接入 |

**关键**：CLI 是"命令面"，Compiler 是"执行面"。CLI 不重复实现编译，只编排。

详见 `00-overview.md`。
