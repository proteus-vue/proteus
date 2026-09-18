# Proteus AI Agent — 柔性布局自动接入

## 动机

柔性布局（G-22）把"布局决策"从开发者脑子里移到框架约束系统（`p-grid` / `p-fluid` / `p-stack` / `p-fit` + FLD001-006）。但存量项目迁移仍要手工改写。本方案在**开发期**提供 AI Agent 入口，自动把硬编码布局重构为柔性语义。

## 边界（什么做、什么不做）

**做**：
- 扫描硬编码宽度/媒体查询/`Dimensions.get()`；
- 生成 `p-*` 语义代码；
- 经 Compiler Plugin 校验后写回。

**不做**：
- 不做运行时 AI 推理（纯离线 dev-time）；
- 不臆测设计意图（只做确定性重构，颜色、间距语义由 DesignSystem token 提供）；
- 不直连大模型写任意代码（工具调用受 FLD 规则约束）。

## 四工作流

1. **对话式生成**：`"首页改成卡片网格，手机一列平板多列"` → 生成含 `p-grid` 的 SFC；
2. **存量迁移**：扫描 `width:320px` / `@media` → 重构为 `p-fluid`；
3. **DevTools 协同**：点节点 → Agent 解释 + 建议 + 一键应用；
4. **约束跟随**：产物经 Plugin 校验 → 100% 合规。

## 信任模型

| 操作 | 级别 | 审批 |
|------|------|------|
| generate（新文件） | 自动 | 分支内 commit |
| migrate（重构） | PR | Diff Review |
| refactor（跨文件） | 人工 | 审批 |
| explain | 只读 | 无 |

## 架构一句话

> Agent 不写字符串替换，而是在 Compiler Plugin 暴露的 `getLayoutIR()` 上操作，识别反模式 → `suggestFluidProp()` → `verifyViaCompilerPlugin()`（跑 FLD + `--strict-css`）→ 合法才 `applyFluidRefactor()` 写回。
