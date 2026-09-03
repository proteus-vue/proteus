// packages/mcp/src/server.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server）：MCP Server 核心（传输无关——stdio/HTTP 适配器后续接入）
//   · tools/list / tools/call / resources/list / resources/read / prompts/list / prompts/get 协议面
//   · CMP021 鉴权与策略：tool_policy（read_only / write + require_confirm）+ 速率限制（60/min）
//   · 防注入：所有工具参数经 Schema 校验（tools.ts validateToolArgs——拒绝超长/非法输入）
import { MCP_TOOLS, validateToolArgs } from './tools'
import type { McpToolDefWithHandler, ToolContext } from './tools'
import { MCP_RESOURCES } from './resources'
import { MCP_PROMPTS } from './prompts'

export interface McpServerOptions {
  /** 写入类工具策略（CMP021 tool_policy.write——默认禁用） */
  writeEnabled?: boolean
  /** 写入根目录（write_file 解析基准——防逃逸；缺省 process.cwd()） */
  workspaceRoot?: string
  /** 每分钟调用上限（缺省 60——03-mcp-server §5 rate_limit） */
  rateLimitPerMin?: number
  /** vue-dom 的 document 注入（SSR/Node 场景） */
  documentLike?: unknown
}

export interface McpCallResult {
  ok: boolean
  tool: string
  /** 成功负载 / 错误说明 */
  result?: unknown
  error?: string
  code?: 'unknown_tool' | 'rate_limited' | 'write_disabled' | 'invalid_args' | 'handler_error'
}

/** ★G-36 B1：MCP Server（传输无关核心——一次实现，Claude Desktop / Cursor / Cline / 自研统一接入） */
export interface ProteusMcpServer {
  readonly name: string
  readonly version: string
  /** tools/list */
  listTools(): ReadonlyArray<{ name: string; description: string; readonly: boolean; requireConfirm?: boolean; inputSchema: unknown }>
  /** tools/call（校验 + 策略 + 限流 + 分发） */
  callTool(name: string, args?: Record<string, unknown>): Promise<McpCallResult>
  /** resources/list */
  listResources(): ReadonlyArray<{ uri: string; name: string; description: string }>
  /** resources/read */
  readResource(uri: string): { ok: boolean; uri: string; contents?: unknown; error?: string }
  /** prompts/list */
  listPrompts(): ReadonlyArray<{ name: string; description: string }>
  /** prompts/get */
  getPrompt(name: string): { ok: boolean; name: string; messages?: ReadonlyArray<{ role: 'user'; content: string }>; error?: string }
}

export function createMcpServer(options: McpServerOptions = {}): ProteusMcpServer {
  const writeEnabled = options.writeEnabled ?? false
  const rateLimit = options.rateLimitPerMin ?? 60
  const toolMap = new Map<string, McpToolDefWithHandler>(MCP_TOOLS.map((t) => [t.name, t]))
  const resourceMap = new Map(MCP_RESOURCES.map((r) => [r.uri, r]))
  const promptMap = new Map(MCP_PROMPTS.map((p) => [p.name, p]))
  const callTimestamps: number[] = []

  function checkRateLimit(): boolean {
    const now = Date.now()
    // 滑动窗口：清 60s 外
    while (callTimestamps.length > 0 && now - callTimestamps[0] > 60000) callTimestamps.shift()
    if (callTimestamps.length >= rateLimit) return false
    callTimestamps.push(now)
    return true
  }

  const ctx: ToolContext = { writeEnabled, workspaceRoot: options.workspaceRoot, documentLike: options.documentLike }

  return {
    name: 'proteus-mcp',
    version: '0.1.0',
    listTools() {
      return MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, readonly: t.readonly, requireConfirm: t.requireConfirm, inputSchema: t.inputSchema }))
    },
    async callTool(name, args) {
      const tool = toolMap.get(name)
      if (!tool) return { ok: false, tool: name, code: 'unknown_tool', error: `未知工具：${name}` }
      if (!checkRateLimit()) return { ok: false, tool: name, code: 'rate_limited', error: `速率超限（${rateLimit}/min）——稍后重试` }
      const v = validateToolArgs(tool, args)
      if (!v.ok) return { ok: false, tool: name, code: 'invalid_args', error: v.error }
      try {
        const result = tool.run(args ?? {}, ctx)
        return { ok: true, tool: name, result }
      } catch (e) {
        return { ok: false, tool: name, code: 'handler_error', error: e instanceof Error ? e.message : String(e) }
      }
    },
    listResources() {
      return MCP_RESOURCES.map((r) => ({ uri: r.uri, name: r.name, description: r.description }))
    },
    readResource(uri: string) {
      const r = resourceMap.get(uri)
      if (!r) return { ok: false, uri, error: `资源不存在：${uri}` }
      return { ok: true, uri, contents: r.read() }
    },
    listPrompts() {
      return MCP_PROMPTS.map((p) => ({ name: p.name, description: p.description }))
    },
    getPrompt(name: string) {
      const p = promptMap.get(name)
      if (!p) return { ok: false, name, error: `提示词模板不存在：${name}` }
      return { ok: true, name, messages: p.messages }
    },
  }
}
