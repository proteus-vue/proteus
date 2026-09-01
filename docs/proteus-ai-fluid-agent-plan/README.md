# Proteus AI Fluid Agent (G-23)

开发阶段 AI Agent 自动接入柔性布局框架：把硬编码布局重构为 `p-*` 语义，并经 Compiler Plugin 校验合规。

## 一句话

> Agent 不写字符串替换，而是在 Compiler Plugin 暴露的 `LayoutConstraint` IR 上操作，识别反模式 → 生成 `p-fluid`/`p-grid` → 经 FLD + Style Safety 校验 → 合法才写回。

## 文档清单

- `00-architecture-update.md` — 规约合并（G-23 + 原则#12 + 铁律 + AI001-005）
- `01-ai-fluid-agent.md` — 主文档（动机/边界/四工作流/信任）
- `02-agent-core.md` — Orchestrator + Tool Registry + Prompt
- `03-tools-registry.md` — 4 大工具 Zod Schema
- `04-workflows.md` — 对话生成/存量迁移/DevTools/约束跟随
- `05-trust-safety.md` — 信任分级/沙箱/审计/回滚
- `06-ide-integration.md` — VS Code / JetBrains / LSP
- `07-cli-integration.md` — `proteus ai` 子命令
- `08-compiler-plugin-synergy.md` — G-21 协同（Agent=Plugin）
- `09-fluid-layout-synergy.md` — G-22 四原语映射
- `10-style-safety-synergy.md` — G-16 合规闸门
- `11-benchmark-batches.md` — 预算/B1-B5/单测

## 依赖

G-21 (Compiler Plugin) · G-22 (Fluid Layout) · G-19 (DevTools) · G-16 (Style Safety) · G-20 (App Config)

## 快速上手

```bash
proteus ai scan ./src --dry-run
proteus ai fluidize ./src --apply
```

## 校验

```bash
bash pack.sh    # 生成 zip + SHA256
```
