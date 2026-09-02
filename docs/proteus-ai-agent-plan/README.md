# Proteus AI Agent 接入（G-36）

> 让 AI 自动用 Proteus 框架写出符合柔性 IR 的标准业务代码。
> ★编号避让：规划文档（website-v3 G-33 内容）入库时 G-33 已被 cli-plus（CLI & 工程化）占用，按规约编号避让纪律重编号为 **G-36**；本文档内部引用以 G-36 为准。

## 10 份文档

```
01-ai-agent-integration.md   ★ 主文档（动机/架构/契约/工作流/护栏/分批/铁律）
02-agent-architecture.md     4 层架构 + 组件表 + 安全模型 + 降级
03-mcp-server.md             ★ MCP Server（11 工具 + 资源 + 提示词 + 鉴权）
04-agent-kit.md              SDK API + 4 Skill 详解 + IRBuilder
05-guardrails.md             ★ 三层护栏 + 自修复循环
06-token-optimization.md      上下文管理 + 缓存 + 成本模型
07-batches.md                B1-B6 + 评测集 + DoD + 协同矩阵
08-rules.md                  G-36.1-7 + CMP017-022（编号已避让）
00-architecture-update.md    规约增量（原则 #0.7 + 全景图 + 51 份 + M 落点）
README.md                    本文件
```

## 快速理解

**一句话**：柔性框架定义了"什么是标准代码"，Agent 负责"按标准自动写出来"。

```
设计期：意图 → Agent → 符合 IR 的标准代码
运行时：同一份代码 → 柔性框架 → 六端各自原生呈现
```

## 铁律速查

- G-36.1：输出必经 conformance + verify-llm
- G-36.2：禁小程序组件名
- G-36.3：禁裸平台 API
- G-36.5：上下文走 MCP 按需
- CMP017：取色限 tokens

详见 `08-rules.md`。

## 与柔性框架的闭环

Agent 生成的代码 → 进入柔性框架官网（website-v3 的 `flexible-multi-device.html`）→ 同一份 SFC 在手机/平板/PC/车机/TV/手表各自原生渲染。

**这就是 G-36 的终极证明**：不是"Agent 生成了代码"，而是"Agent 生成的代码能在六端正确呈现"。

## 与既有体系关系

```
G-23 AI 层（AI Fluid Agent）  →  G-36 是 G-23 的第一个具体落地  ← ★ 本模块
G-29 编译层（Compiler IR）     → Agent 操作 Compiler IR
G-31 语义入口（128 原语）      → Agent 只产出语义原语，禁小程序组件名
G-32 原语库（128 SSOT）        → Agent 工具的数据源（search_primitives）
G-22 柔性框架（六端渲染）      → Agent 代码的最终运行验证场
```