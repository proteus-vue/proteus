# @proteus-vue/mcp

G-36 B1（proteus-ai-agent-plan 03-mcp-server）——**Proteus MCP Server**：把 Agent 需要的知识（原语库 / Token / 能力矩阵 / IR 校验）通过 MCP 工具暴露，LLM 按需 query 而非预读全部文档（G-36.5 增量上下文）。标准协议一次实现，Claude Desktop / Cursor / Cline / 自研统一接入。

## 11 工具（03-mcp-server §2）

| 工具 | 类别 | 说明 |
|------|------|------|
| `search_primitives` | 只读 | 查询 G-32 语义原语（id/semantic/tag/api 子串匹配） |
| `get_primitive` | 只读 | 单个原语完整定义 |
| `list_primitives` | 只读 | 全量/分类清单 + 统计 |
| `get_design_token` | 只读 | design token 查询（点路径/分组/全树——业务禁硬编码） |
| `check_capability` | 只读 | 某引擎某能力（supported/value——引擎 capabilities 派生） |
| `get_capability_matrix` | 只读 | 端 × 能力矩阵 |
| `lookup_miniprogram` | 只读 | 小程序 API/组件 → Proteus 对等物（G-32 对照矩阵） |
| `validate_ir` | 只读 | Component IR Schema 校验（G-31 契约） |
| `run_conformance` | 只读 | 六端渲染 conformance（G-31 B5 门禁） |
| `generate_code` | 只读 | IR → 代码（json/ts） |
| `write_file` | **写入** | 落盘（**默认禁用 + 需交互式确认——CMP021**） |

## 鉴权与工具策略（CMP021）

- `tool_policy`：只读类默认可用；写入类需 `writeEnabled`（server 级）+ `confirmed`（调用级）双闸
- `rate_limit`：默认 60/min（滑动窗口）
- 防注入：所有工具参数经轻量 Schema 校验（required/type/maxLength/enum——拒绝超长输入）
- 路径逃逸防护：write_file 拒绝绝对路径与 `..` 穿越

## 用法

```ts
import { createMcpServer } from '@proteus-vue/mcp'

const server = createMcpServer({ writeEnabled: false, rateLimitPerMin: 60 })

server.listTools()                      // tools/list
await server.callTool('search_primitives', { query: 'grid' })
await server.callTool('get_design_token', { name: 'color.primary' })
server.listResources()                  // resources/list
server.readResource('proteus://primitives/catalog')
server.getPrompt('proteus-migrate-wx')  // prompts/get
```

## 传输适配：stdio + Streamable HTTP（决策 #681 / #682）

本包是传输无关核心（tools/resources/prompts 注册表 + 校验 + 策略 + 分发）+ **两个传输适配器**：

```ts
import { serveStdio, startHttpServer } from '@proteus-vue/mcp'
await serveStdio({ writeEnabled: false })                 // ① JSON-RPC over stdin/stdout
const h = await startHttpServer({ port: 7802 })           // ② Streamable HTTP（stateless per-request）
```

或经 CLI（Claude Desktop / Cursor 可直接挂）：

```bash
proteus mcp serve                                       # stdio，只读（write_file 禁用）
proteus mcp serve --allow-write --workspace ./          # 开写闸（限定写根）
proteus mcp serve --http --host 0.0.0.0 --token s3cr3t  # HTTP 对外 + Bearer 鉴权
```

- **stdio**：**★stdout 只出 JSON-RPC**，状态提示一律走 stderr（`onReady` 回调）。
- **HTTP**：缺省绑 `127.0.0.1:7802/mcp`；`--host 0.0.0.0` 对外时**务必**配 `--token`；**需 Node ≥ 20**（ESM 全局 `crypto`）。
- 适配器做三处形状翻译：工具 `inputSchema` → **JSON Schema**、`callTool` → `content[]`+`isError`（**两层失败语义**）、resources/prompts → 协议结构。
- **documentLike 自动注入**：`run_conformance` 的 vue-dom 端需 `document` ⇒ server 懒加载 **happy-dom**（**可选依赖**）注入 ⇒ 六端开箱全通；未装则 vue-dom 端如实报错（不静默假装通过）。
- **诚实边界**：HTTP 为 **stateless per-request**（无会话/无服务端推送；GET/DELETE → 405）；写闸与 stdio 同语义（缺省只读）。

## 数据源（SSOT）

原语目录与小程序对照矩阵来自 `@proteus-vue/component-ir`（G-32 机器事实）；能力矩阵与 conformance 来自 `@proteus-vue/render-backend` 六引擎实例（运行时派生，非手写）；design token 为本包初版 SSOT（`tokens.ts`，后续可外接）。
