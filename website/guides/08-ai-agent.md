---
title: AI 原生开发
order: 8
group: 工程化
---

# AI 原生开发

Proteus 的语义模型不只是给人用的——**语义 IR 是 AI 与框架之间的契约**。LLM 负责生成语义代码，框架负责正确性（IR 校验 + 六端一致性门禁），两端通过机器可读的中间表示对接，而不是靠 prompt 祈祷。

> 传统模式：AI 生成平台代码 → 人工逐行 review 平台细节 → 错了改到天亮
> Proteus 模式：AI 生成语义 IR → 机器校验（schema + conformance）→ 通过即六端一致

## MCP Server

`@proteus-vue/mcp` 实现了 Model Context Protocol 标准面（tools/list、tools/call、resources、prompts），把框架知识直接挂进支持 MCP 的 AI 客户端（Claude、Cursor 等）。

### 工具清单（11 个）

| 工具 | 用途 | 风险级 |
|---|---|---|
| `search_primitives` | 查询 G-32 语义原语（id/semantic/tag/api 子串匹配，按 layout/ui/shell/gesture/capability/engineering 分类） | 只读 |
| `get_primitive` | 获取单个原语完整定义 | 只读 |
| `list_primitives` | 全量或分类原语清单（含统计） | 只读 |
| `get_design_token` | design token 查询（颜色/字号/间距/圆角——业务禁硬编码色值） | 只读 |
| `check_capability` | 查询某引擎某能力（supported/value） | 只读 |
| `get_capability_matrix` | 端 × 能力矩阵（六引擎 capabilities 派生） | 只读 |
| `lookup_miniprogram` | 小程序 API/组件 → Proteus 对等物映射（迁移用） | 只读 |
| `validate_ir` | Component IR Schema 校验（p- 前缀 / semantic 合法 / CMP006 降级声明 / grid 冲突） | 只读 |
| `run_conformance` | 跑六端渲染 conformance（语义控件映射 vs 参考表，缺省六引擎全跑） | 只读 |
| `generate_code` | IR → 代码产物（json=规范化 IR / ts=类型化模块） | 只读 |
| `write_file` | 落盘写入 | **高风险：默认禁用 + 需交互式确认（CMP021）** |

除工具外还内置 **resources**（原语完整目录、Design Tokens、端×能力矩阵、Component IR Schema、商品详情页范例）与 **prompts**（`proteus-flex-layout` 柔性布局指引、`proteus-migrate-wx` 小程序迁移 SOP、`proteus-token-only` 禁硬编码取色）。

## Agent 运行时

`@proteus-vue/agent` 是框架侧的 agent 运行时，围绕「生成→校验→修正」闭环组织：

- **ir-builder**：把 AI 输出规整为合法 Component IR
- **guardrails**：护栏校验（配合 validateComponentIR 的诊断面）
- **codegen**：IR → 类型化代码产物
- **rules**：规则驱动（与全局 CMP 编号体系同源）

## 推荐工作流

```text
1. AI 检索语义原语        search_primitives / get_primitive
2. 取设计规范             get_design_token（禁硬编码取色）
3. 生成 Component IR      （LLM 按 IR Schema 产出）
4. 机器校验               validate_ir —— schema/语义/降级声明/网格冲突
5. 一致性门禁             run_conformance —— 六端语义控件映射全绿
6. 出码                   generate_code → ts/json
7. 落盘                   write_file（默认禁用，需用户显式确认）
```

第 4、5 步是关键：AI 的产出在进入代码库之前，先被机器验证「六端渲染一致」。错误在 IR 层被拦截，而不是在线上被用户发现。

## 现状与边界

| 能力 | 状态 |
|---|---|
| MCP Server（11 工具 + resources + prompts） | ✅ |
| Agent 运行时（ir-builder / guardrails / codegen / rules） | ✅ |
| `write_file` 交互式确认门禁（CMP021） | ✅ |
| Agent 自主多轮迭代生成完整工程 | 📋 规划中 |

## 下一步

- [一致性验证](/docs/26-conformance) —— AI 产物的机器验收体系
- [语义模型](/docs/03-semantic-model) —— AI 消费的 IR 从哪来
- [CLI 与工程命令](/docs/25-cli) —— 本地跑 MCP / 门禁的命令
