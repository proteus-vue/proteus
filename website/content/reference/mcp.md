---
title: MCP Server（AI 基建）
order: 46
group: 开发者工具
---

# MCP Server（AI 基建）

Proteus 的 **AI 原生开发**落地：`@proteus-vue/mcp` 暴露 MCP（Model Context Protocol）Server——**11 工具 / 5 resources / 3 prompts**，AI Agent 直接操作语义层（原语/Token/能力矩阵/IR/conformance），把「AI 产码」从文本猜测变成**机器可校验的语义操作**。

## 工具（11）

| 工具 | 作用 |
|---|---|
| `search_primitives` | 语义原语搜索 |
| `get_primitive` / `list_primitives` | 原语详情 / 清单（`proteus://primitives/catalog`） |
| `get_design_token` | 设计 Token 查询（`proteus://tokens/design`） |
| `check_capability` | 能力探测（`proteus://capabilities/matrix`） |
| `get_capability_matrix` | 能力矩阵 |
| `lookup_miniprogram` | 小程序对照查询（`proteus://mp/mapping` 数据源——语义 ↔ wx API/组件 反查） |
| `validate_ir` | C-IR 校验（语义枚举/约束） |
| `run_conformance` | 跑 conformance 门禁 |
| `generate_code` | 按语义生成代码 |
| `write_file` | 落盘（护栏内写文件） |

## Resources（5）

| URI | 内容 |
|---|---|
| `proteus://primitives/catalog` | 原语目录（136 项 SSOT） |
| `proteus://tokens/design` | 设计 Token |
| `proteus://capabilities/matrix` | 能力矩阵 |
| `proteus://ir/schemas/component` | C-IR Schema |
| `proteus://examples/product-detail` | 范例（IR 良构示例） |

## Prompts（3）

| Prompt | 作用 |
|---|---|
| `proteus-flex-layout` | 柔性布局构造指引（G-22 原语 + **禁手动断点**） |
| `proteus-migrate-wx` | 小程序迁移 SOP（lookup_miniprogram + 自动/手动分层） |
| `proteus-token-only` | 强制只用 Token 取色（禁硬编码色值） |

## 接入方式

**① 库内调用**：宿主（Agent 框架等）接 `createMcpServer(options)`（`@proteus-vue/mcp`）在**进程内**注册 tools/resources/prompts。

**② CLI stdio server（推荐给 MCP 客户端）**：`proteus mcp serve` 起一个 **stdio MCP server**（JSON-RPC over stdin/stdout），Claude Desktop / Cursor / Cline 等可直接挂载，无需自己接传输层。

```jsonc
// Claude Desktop / Cursor 的 mcpServers 配置示例
{
  "mcpServers": {
    "proteus": {
      "command": "npx",
      "args": ["-y", "@proteus-vue/cli", "mcp", "serve"]
      // 需要写文件时：加 "--allow-write", "--workspace", "/path/to/project"
    }
  }
}
```

- **缺省只读**：`write_file` 默认禁用；加 `--allow-write`（配合 `--workspace <dir>` 限定写根）才开写闸。
- **`--rate-limit <n>`**：每分钟调用上限（缺省 60）。
- **★stdout 是协议的**：server 只把 JSON-RPC 写到 stdout；状态提示一律走 stderr（否则客户端解析失败）。
- **诚实边界**：依赖 `document` 的工具（`run_conformance` / `generate_code`）在纯 Node stdio 下无 document ⇒ 如实报错；HTTP/SSE 传输暂未提供。

## 设计要点

- **写护栏**：`write_file` 在护栏内落盘（AI 产码不绕过仓库门禁）；`validate_ir` + `run_conformance` 是产码后机器校验关
- **语义优先**：工具操作对象是 IR/原语/Token（约束面），非自由文本——AI 产码符合 IR 契约（见[与传统框架的区别](/docs/02-difference)）
- **对照反查**：`lookup_miniprogram` 让 AI 在存量小程序迁移时按语义查 wx 等价物

## 生态联动

- **Agent Kit**（G-36 B2，`@proteus-vue/agent`）：IRBuilder / generateCode / intent-to-flex——MCP 的库级同源（无 MCP 传输时进程内调用）
- **Skill**（G-36 B3）：`migrate-miniprogram` Skill = codemod 复用 + 覆盖率护栏

## 诚实边界

- 工具清单以当前包为准（新增工具需同步本页）
- `generate_code` 语义产码经 `validate_ir` 校验后才可落盘——AI 自由发挥不在此工具语义内

## 下一步

- [语义模型](/docs/framework/11-semantic-model)：工具操作的约束面
- [CLI 与工程命令](/docs/28-cli)
