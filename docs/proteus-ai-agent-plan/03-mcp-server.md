# MCP Server 设计（proteus-mcp）

> Model Context Protocol —— AI 工具标准协议。一次实现，多客户端复用。

## 1. 为什么用 MCP

| 方案 | 缺点 |
|------|------|
| 定制插件 | 每个 IDE 重写一遍 |
| **MCP** | 标准协议，Claude Desktop / Cursor / Cline / 自研统一接入 |

**Agent 的知识（原语库/Token/能力矩阵）通过 MCP 工具暴露，LLM 按需 query，而非预读全部文档（对应 G-36.5 增量上下文）。**

## 2. 工具清单（11 个）

### 只读类（默认可用）

| 工具 | 参数 | 返回 |
|------|------|------|
| `search_primitives` | `query: string, category?: string` | 匹配的原语列表（含语义/属性/降级） |
| `get_primitive` | `name: string` | 单个原语完整定义 |
| `list_primitives` | `category?: string` | 全量或分类清单 |
| `get_design_token` | `name?: string, group?: string` | Token 树（颜色/字号/间距/后端色） |
| `check_capability` | `backend: string, capability: string` | `{supported, fallback, tier}` |
| `get_capability_matrix` | `capability?: string` | 端 × 能力矩阵 |
| `lookup_miniprogram` | `api: string` | 小程序 API → 原语映射 |
| `validate_ir` | `ir: object` | Schema 校验结果 |

### 写入类（需用户确认）

| 工具 | 参数 | 说明 |
|------|------|------|
| `run_conformance` | `ir: object, backends?: string[]` | 跑六端 conformance |
| `generate_code` | `ir: object, format: 'sfc' \| 'ts'` | IR → 代码 |
| `write_file` | `path: string, content: string` | 落盘（**高风险，需确认**） |

## 3. Resources（被动上下文）

```
proteus://primitives/catalog       → 128 原语完整目录
proteus://tokens/design            → design-tokens.json
proteus://capabilities/matrix      → 端×能力矩阵
proteus://ir/schemas/component     → Component IR JSON Schema
proteus://examples/product-detail  → 商品详情页 IR 范例
```

LLM 通过 `resources/read` 拉取，避免 token 浪费。

## 4. Prompts（可复用提示词模板）

| Prompt | 用途 |
|--------|------|
| `proteus-flex-layout` | 柔性布局构造指引 |
| `proteus-migrate-wx` | 小程序迁移 SOP |
| `proteus-token-only` | 强制只用 Token 取色 |

## 5. 鉴权（CMP021）

```yaml
# proteus-mcp 配置
auth:
  mode: token  # none | token | oauth
  token_env: PROTEUS_MCP_TOKEN
tool_policy:
  read_only: [search_primitives, get_design_token, ...]
  write: [write_file, generate_code]
  require_confirm: [write_file]  # 交互式确认
rate_limit: 60/min
```

**防 prompt injection**：所有工具参数经 JSON Schema 校验，拒绝超长/可疑输入。

## 6. 最小实现骨架

```ts
// proteus-mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk'

const server = new Server({
  name: 'proteus-mcp',
  version: '0.1.0',
})

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'search_primitives',
      description: '查询 G-32 语义原语',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string', enum: ['layout','ui','shell','gesture','capability','engineering'] }
        },
        required: ['query']
      }
    },
    // ... 其余工具
  ]
}))

server.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: args } = req.params
  // 参数 Schema 校验（防注入）
  validateToolArgs(name, args)
  switch (name) {
    case 'search_primitives':
      return { content: [{ type: 'json', json: searchPrimitives(args) }] }
    // ...
  }
})
```
