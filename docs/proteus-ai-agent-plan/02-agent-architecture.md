# Agent 接入架构

> 配套：01-ai-agent-integration.md §3

## 1. 四层职责边界

| 层 | 职责 | 不做什么 |
|----|------|---------|
| **L0 MCP Server** | 把框架知识（原语/Token/能力矩阵）暴露为工具 | 不生成代码、不调 LLM |
| **L1 Agent Kit** | 编排 Skill、管理 IR、调 LLM | 不存业务知识 |
| **L2 Skills** | 具体能力（意图→柔性 / 迁移 / 修复） | 不绕过 Guardrails |
| **L3 Guardrails** | 校验 + 自修复 | 不修改业务逻辑 |

**关键解耦**：L0 是协议层（MCP 标准），可换任意 MCP 客户端（Claude Desktop / Cursor / Cline / 自研 IDE）。L1 是框架专属编排。

## 2. 核心组件表

| 组件 | 所在层 | 接口 |
|------|--------|------|
| `ProteusMCPServer` | L0 | MCP `tools` / `resources` / `prompts` |
| `search_primitives` | L0 工具 | `(query: string) → Primitive[]` |
| `get_design_token` | L0 工具 | `(name?: string) → TokenTree` |
| `check_capability` | L0 工具 | `(backend, cap) → {supported, fallback}` |
| `run_conformance` | L0 工具 | `(ir) → Report` |
| `AgentKit` | L1 | `generatePage(intent)` / `migrate(code)` |
| `IRBuilder` | L1 | 构造 Component IR |
| `LLMBridge` | L1 | 统一 `AgentProvider`（可换模型） |
| `SkillRunner` | L2 | `execute(skill, input, ctx)` |
| `GuardrailPipeline` | L3 | `validate(ir, code) → Result` |

## 3. AgentProvider 接口（解耦 LLM 厂商）

```ts
interface AgentProvider {
  complete(opts: {
    system: string
    messages: Message[]
    tools?: Tool[]
  }): Promise<{ text: string; toolCalls?: ToolCall[] }>
}
// 实现：ClaudeProvider / GPTProvider / QwenProvider / LocalProvider
```

业务代码只依赖 `AgentProvider`，不依赖具体 SDK。

## 4. 安全模型

| 风险 | 防护 |
|------|------|
| Prompt Injection（恶意代码诱导 Agent） | MCP 工具调用**白名单 + 参数 Schema 校验** |
| 越权工具调用 | 工具分只读（search）/ 写入（write_file）两级，写入需确认 |
| 生成恶意代码 | Guardrails L3 conformance 拦截 |
| Token 泄露 | Agent 上下文不持久化敏感凭证 |
| 无限自修复 | G-36.6：≤3 次上限 |

## 5. 降级策略

| 情形 | 行为 |
|------|------|
| LLM 不可用 | Agent Kit 走 IR 模板库（规则引擎兜底，不依赖 LLM） |
| MCP Server 不可达 | 本地缓存原语库快照 |
| conformance 反复失败 | 标记 `need-human-review`，交付部分结果 |
| 目标端能力不足 | 插入 `@conditional` 降级节点，保留 IR |
