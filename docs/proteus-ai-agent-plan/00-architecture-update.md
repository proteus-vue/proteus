# Architecture Update — G-36 AI Agent 接入

> 增量合并进 `proteus-architecture.md`。

## 1. 原则 #0（PROTEUS-METHODOLOGY）新增 #0.7

> **#0.7 Agent 驱动**：代码的生成过程也必须服从语义收敛——AI 产出的是符合 IR 契约的标准代码，而非自由文本。Agent 是语义层的"自动化生产者"。

方法论五支柱由此覆盖**完整生命周期**：设计（语义定义）→ 生成（Agent）→ 验证（conformance）→ 运行（六端渲染）。

## 2. 全景图更新

```
PROTEUS-METHODOLOGY（原则 #0，五支柱 + #0.7 Agent 驱动）
    ↓ 归纳
proteus-positioning（门面话术）
    ↓ 编排
proteus-roadmap（执行）
    ↓ 落地
G-27 渲染 / G-28 能力 / G-29 编译 / G-30 端 / G-31 入口 / G-32 原语
    ↓ 对外表达
★ G-36 AI Agent ──→ 按柔性规则生成标准代码
    ↓
Website v3（首页 + 柔性多端 + Agent Playground + LLM 规则包）
    ↓
六端各自原生呈现 ✅
```

## 3. 铁律总表新增

| 编号 | 内容 |
|------|------|
| G-36.1 | Agent 输出必经 conformance + verify-llm |
| G-36.2 | 禁小程序组件名 |
| G-36.3 | 禁裸平台 API |
| G-36.4 | Skill 组合性审查 |
| G-36.5 | 上下文走 MCP 按需 |
| G-36.6 | 自修复上限 3 次 |
| G-36.7 | 代码可追溯至 IR |
| CMP017 | 取色限 tokens |
| CMP018 | 页面类型声明 |
| CMP019 | 迁移映射日志 |
| CMP020 | adapt-device 不改语义 |
| CMP021 | MCP 鉴权 |
| CMP022 | 评测含车机+手表 |

## 4. 体系规模

**55 份 plan + 1 哲学 + 1 规约 + 1 官网 = 完整体系。**

（原 52 份 + G-36 AI Agent + G-37 RenderBackend SPI + G-38 CompilerBackend SPI 同期入库 = 55 份）

## 5. 路线图落点

| 批次 | 里程碑 |
|------|--------|
| B1 | **M1**（与 G-32 B1 同批）：MCP Server + design-token 工具 |
| B2-B4 | M2：Agent Kit + migrate + Guardrails |
| B5-B6 | M2-M3：adapt-device + 评测 + Agent Playground |

## 6. 风险边界（诚实声明）

- Agent 生成**不能保证 100% 一次正确**——依赖 Guardrails + 自修复 + 人工兜底
- LLM 能力波动会影响生成质量（不同模型/版本）
- 复杂业务语义仍需人工审查
- 本模块是 **G-23（AI 层）的第一个落地**，后续需持续演进评测集

## 7. 与既有文档关系

| 文档 | 关系 |
|------|------|
| PROTEUS-METHODOLOGY | 原则 #0.7 来源 |
| G-29 | Agent 操作 Compiler IR |
| G-31 / G-32 | Agent 产出约束 |
| G-22 柔性框架 | Agent 代码运行验证场 |
| Website v3 | Agent Playground 宿主 |
