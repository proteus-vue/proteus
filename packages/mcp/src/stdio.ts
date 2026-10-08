// packages/mcp/src/stdio.ts —— ★★★MCP stdio 传输适配器（2026-10-08 · 决策 #681）
//
// 【为什么有它（用户：「评估把 stdio 适配器接上」→「按这个方案落地」）】
//   `@proteus-vue/mcp` 此前是**传输无关核心**（11 工具 / 5 resources / 3 prompts / CMP021 策略），
//   但**没有任何传输层** ⇒ Claude Desktop / Cursor / Cline 这些 MCP 客户端**连不上**——
//   只能进程内 `createMcpServer()` 调用（`@proteus-vue/agent` 就是这么用的）。
//   本模块把核心接上 `@modelcontextprotocol/sdk` 的 **stdio 传输**（JSON-RPC over stdin/stdout），
//   让客户端能真正挂载它。
//
// 【★三处"形状翻译"——这是适配器的主要智力成本（不是写样板）】
//   ① **工具 inputSchema**：核心是自定义轻量形状 `{type, required, maxLength, enum}`；
//      MCP 协议要求 **JSON Schema（type:"object"）**。直接塞自定义形状会被客户端拒解析。
//      ⇒ `toJsonSchema()` 转换（required 抽取成数组、enum/maxLength/description 搬运）。
//   ② **callTool 结果**：核心 `{ok, result, error}` → 协议 `{content:[{type:"text",text}], isError}`。
//   ③ **resources/prompts**：裸 JSON → `contents:[{uri,mimeType,text}]` / `{messages:[{role,content:{type,text}}]}`。
//
// 【★硬约束：stdout 是协议的（踩坑预警）】
//   stdio 传输下 **stdout 只能输出 JSON-RPC 帧**——任何杂散 `console.log`（本仓 `ui.ts` 全走 stdout）
//   都会破坏协议 ⇒ 表现为"客户端就是连不上、看起来能跑"。故本模块**绝不写 stdout**，
//   所有状态提示走 `onReady` 回调（调用方接 stderr）。dev/CLI 走 `proteus mcp serve` 时也须绕开 `ui.ts`。
//
// 【诚实边界】
//   · 依赖 `document` 的工具（`run_conformance` / `generate_code` 的 vue-dom 路径）在纯 Node stdio 下
//     无 document ⇒ 需调用方经 `documentLike` 注入（如 happy-dom），否则该工具如实报错（不静默）。
//   · `write_file` 默认**禁用**（`writeEnabled:false`）——需调用方显式开写闸 + `workspaceRoot`（防逃逸）。
//   · 本适配器只做 stdio；HTTP/SSE 传输不在本批（另说）。
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from './server'
import type { McpCallResult, McpServerOptions, ProteusMcpServer } from './server'
import type { McpToolSchemaProperty } from './tools'

export interface ServeStdioOptions extends McpServerOptions {
  /** serverInfo 覆盖（缺省取 core.name/core.version——后者为真实包版本，见 meta.ts） */
  serverInfo?: { name: string; version: string }
  /** initialize 后回调（调用方在此打"已就绪"——**务必走 stderr**，stdout 留给协议） */
  onReady?: (info: { name: string; version: string; tools: number }) => void
}

/** 核心轻量 schema → MCP 协议要求的 JSON Schema（`type:"object"`） */
export function toJsonSchema(input: Readonly<Record<string, McpToolSchemaProperty>>): {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required: string[]
  additionalProperties: false
} {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []
  for (const [key, prop] of Object.entries(input)) {
    const schema: Record<string, unknown> = { type: prop.type }
    if (prop.description) schema.description = prop.description
    if (prop.enum) schema.enum = [...prop.enum]
    if (prop.maxLength !== undefined) schema.maxLength = prop.maxLength
    properties[key] = schema
    if (prop.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** core 工具定义 → MCP 协议 Tool[]（inputSchema 转 JSON Schema） */
export function toProtocolTools(core: ProteusMcpServer): Array<{
  name: string
  description: string
  inputSchema: ReturnType<typeof toJsonSchema>
  annotations: { readOnlyHint: boolean }
}> {
  return core.listTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.inputSchema as Readonly<Record<string, McpToolSchemaProperty>>),
    // MCP 工具注解：只读提示（客户端据此判断是否需确认）——requireConfirm 的写工具标 readOnly:false
    annotations: { readOnlyHint: t.readonly === true },
  }))
}

/** core callTool 结果 → 协议 CallToolResult（失败落 isError，绝不抛穿）
 *
 * ★两层失败语义（实测踩到）：core 的 `McpCallResult.ok` 表示"**工具执行了**"（分发成功），
 *   而**操作本身**的成败在 payload 里——工具 run() 会返回 `{ok:false, code, error}`
 *   （如 write_file 未开写闸 → `write_disabled`）。若只看外层 `r.ok`，这类业务失败会被
 *   当成成功返回（丢 isError），客户端就无法识别失败。故需**两层都判**。 */
export function toProtocolCallResult(r: McpCallResult): {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
} {
  if (!r.ok) {
    return { content: [{ type: 'text', text: `${r.code ?? 'error'}: ${r.error ?? '调用失败'}` }], isError: true }
  }
  const payload = r.result
  if (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
    const p = payload as { code?: string; error?: string }
    return { content: [{ type: 'text', text: `${p.code ?? 'error'}: ${p.error ?? '操作失败'}` }], isError: true }
  }
  return { content: [{ type: 'text', text: payload === undefined ? 'ok' : JSON.stringify(payload) }] }
}

/** 创建已接好 stdio 传输的 SDK Server（导出以便单测用内存/桩 transport 驱动） */
export function buildStdioServer(options: ServeStdioOptions = {}): { core: ProteusMcpServer; server: Server } {
  const core = createMcpServer(options)
  const serverInfo = options.serverInfo ?? { name: core.name, version: core.version }
  const server = new Server(serverInfo, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions:
      'Proteus MCP Server：AI 操作语义层（原语库 / design token / 能力矩阵 / C-IR 校验 / 六端 conformance）。' +
      '写工具 write_file 默认禁用，需服务端 --allow-write 且调用参数 confirmed=true 双闸。',
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toProtocolTools(core) }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await core.callTool(req.params.name, req.params.arguments as Record<string, unknown> | undefined)
    return toProtocolCallResult(r)
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: core.listResources().map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: 'application/json' })),
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = core.readResource(req.params.uri)
    if (!r.ok) throw new Error(r.error ?? `资源不存在：${req.params.uri}`)
    return { contents: [{ uri: r.uri, mimeType: 'application/json', text: JSON.stringify(r.contents) }] }
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: core.listPrompts().map((p) => ({ name: p.name, description: p.description })),
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const r = core.getPrompt(req.params.name)
    if (!r.ok) throw new Error(r.error ?? `提示词模板不存在：${req.params.name}`)
    return {
      messages: (r.messages ?? []).map((m) => ({ role: 'user' as const, content: { type: 'text' as const, text: m.content } })),
    }
  })

  return { core, server }
}

/** 把 Proteus MCP Server 接到 stdio（`proteus mcp serve` / 独立宿主进程入口） */
export async function serveStdio(options: ServeStdioOptions = {}): Promise<void> {
  const { core, server } = buildStdioServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  options.onReady?.({ name: core.name, version: core.version, tools: core.listTools().length })
}
