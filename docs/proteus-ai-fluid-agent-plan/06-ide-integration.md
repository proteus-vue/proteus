# IDE 集成

## VS Code 扩展

入口：
- **侧边会话面板**：`Proteus AI` 视图，对话式生成（W1）；
- **CodeLens**：`<p-fluid>` / 硬编码宽度行上方显示「Fluid 化」按钮（W2）；
- **行内建议**：硬编码 `width:320px` 波浪线 → 快速修复 `p-fluid="width(280,480)"`；
- **命令面板**：`Proteus: Fluidize File`、`Proteus: Scan Workspace`。

## LSP 联动

- 诊断来自 Compiler Plugin（FLD001-006），Agent 复用同一诊断源；
- 快速修复 = Agent `suggestFluidProp` + `applyFluidRefactor`；
- 应用后触发 DevTools(G-19) HMR，实时预览。

## JetBrains

共享同一 Language Server（Node.js），IDE 差异只在 UI 层。

## 与 DevTools (G-19) 协同

IDE 负责"写时代码建议"，DevTools 负责"运行时节点洞察"：
- DevTools 里点节点 → 复制为 Agent 上下文 → IDE 侧生成建议；
- 二者共享 `LayoutConstraint` IR（来自 Compiler Plugin）。

## 用户体验原则

- 默认 dry-run，用户显式确认才写；
- 建议附带依据（FLD 规则编号），不黑箱；
- 失败降级为只读 explain，绝不静默改代码。
