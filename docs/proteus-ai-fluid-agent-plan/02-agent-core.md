# Agent Core 架构

## 三层结构

```
┌─ IDE 扩展 (VS Code / JetBrains)
│     ↓ LSP / Extension API
├─ Agent Core (Node.js, 框架内置)
│     - Orchestrator：意图识别 → 工具编排
│     - Tool Registry：注册可用工具 + Zod 校验
│     - Prompt 策略：注入 FLD 规则 + DesignSystem token
│     ↓ 工具调用
├─ 工具层
│     - scanHardcodedWidth / suggestFluidProp /
│       applyFluidRefactor / verifyViaCompilerPlugin
│     ↓ Plugin API (G-21)
└─ Compiler + FluidLayout(G-22) + DevTools(G-19) + StyleSafety(G-16)
```

## Orchestrator 流程

```
userInput
  → 意图分类（generate / migrate / explain）
  → 读项目上下文（DesignSystem token、breakpoints、已有 p-* 用法）
  → 调用工具链（顺序由工作流决定）
  → 收集 verify 结果
  → 生成 Diff + 依据（FLD 规则编号）
  → 按信任级别决定 apply / PR / 审批
```

## Prompt 策略

系统提示词固定注入：
- FLD001-006 全文；
- `p-*` 四原语签名（来自 G-22 API）；
- 禁止清单（手写 `@media`、硬编码 `width:NNNpx`、`Dimensions.get()`）；
- 少样本：3 个"硬编码 → p-fluid"示例。

## 与 Compiler Plugin (G-21) 的关系

Agent 工具**就是** Compiler Plugin：通过 `definePlugin()` 注册，复用 `transform` / `buildIR` 钩子读取 `LayoutConstraint` IR。这保证 Agent 与框架其他插件走同一套扩展机制（dogfooding）。
