// packages/mcp/src/http.ts —— Streamable HTTP 传输适配器（2026-10-08 · 决策 #682）
//
// 【为什么有它】stdio 只适合"本地进程拉起"的客户端（Claude Desktop/Cursor 的 command 模式）；
//   而"远端/共享/多客户端/容器内"的接法要 HTTP。生产可用的 MCP server 应同时具备两种传输。
//
// 【拓扑选型：stateless per-request（借鉴 SDK simpleStatelessStreamableHttp 示例）】
//   每个 POST 请求建**独立** Server+Transport 处理，响应后即拆。理由：
//   · 本 server 是**只读知识面**（原语/token/能力矩阵/校验）——无跨请求状态，stateless 最简且天然并发安全；
//   · 免会话表管理/清理（有状态会引入 session 生命周期、超时回收、内存增长等运维面）；
//   · 代价：不支持 server→client 的主动推送（如日志通知）——本 server 不需要。
//   ★但与示例的差异：示例允许 GET 返回 405；本实现 GET/DELETE 一律 405（明确"只支持 POST"）。
//
// 【安全边界（生产必读）】
//   · 缺省只绑 **127.0.0.1**（不暴露公网）；`--host 0.0.0.0` 才对外，且此时**强烈建议** `--token`。
//   · `--token` ⇒ 校验 `Authorization: Bearer <token>`；无 token 直接 401（不进入 MCP 层）。
//   · write_file 仍受 core 策略门控（缺省只读）——HTTP 不改变写闸语义。
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from './server'
import type { McpServerOptions, ProteusMcpServer } from './server'
import { toProtocolTools, toProtocolCallResult } from './stdio'

export interface ServeHttpOptions extends McpServerOptions {
  /** 监听端口（缺省 7802） */
  port?: number
  /** 监听地址（缺省 127.0.0.1——仅本机；对外用 0.0.0.0 并务必配 --token） */
  host?: string
  /** MCP 端点路径（缺省 /mcp） */
  path?: string
  /** 可选 Bearer token（设置后所有请求须带 `Authorization: Bearer <token>`） */
  token?: string
  /** serverInfo 覆盖 */
  serverInfo?: { name: string; version: string }
  /** 结构化请求日志（每请求一行——写 stderr；--quiet 时不传） */
  onRequest?: (line: { method?: string; path: string; tool?: string; ok?: boolean; ms: number; status: number }) => void
  /** 就绪回调（用真实 host/port——端口 0 时为实际分配值；**务必走 stderr**） */
  onReady?: (info: { url: string; host: string; port: number; path: string; auth: boolean; tools: number }) => void
}

export interface HttpHandle {
  readonly url: string
  readonly port: number
  /** 优雅关停（停止接受新连接 + 拆 server） */
  close(): Promise<void>
}

/** Bearer 校验（常量时间比较；未配 token ⇒ 恒通过） */
function authorized(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true
  if (!header) return false
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 构建一个"每请求独立"的 SDK Server（绑定同一份 core 知识面） */
function buildPerRequestServer(core: ProteusMcpServer, serverInfo: { name: string; version: string }): Server {
  const server = new Server(serverInfo, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions:
      'Proteus MCP Server：AI 操作语义层（原语库 / design token / 能力矩阵 / C-IR 校验 / 六端 conformance）。' +
      '写工具 write_file 默认禁用，需服务端 --allow-write 且调用参数 confirmed=true 双闸。',
  })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toProtocolTools(core) }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => toProtocolCallResult(await core.callTool(req.params.name, req.params.arguments as Record<string, unknown> | undefined)))
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: core.listResources().map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: 'application/json' })),
  }))
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = core.readResource(req.params.uri)
    if (!r.ok) throw new Error(r.error ?? `资源不存在：${req.params.uri}`)
    return { contents: [{ uri: r.uri, mimeType: 'application/json', text: JSON.stringify(r.contents) }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: core.listPrompts().map((p) => ({ name: p.name, description: p.description })) }))
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const r = core.getPrompt(req.params.name)
    if (!r.ok) throw new Error(r.error ?? `提示词模板不存在：${req.params.name}`)
    return { messages: (r.messages ?? []).map((m) => ({ role: 'user' as const, content: { type: 'text' as const, text: m.content } })) }
  })
  return server
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** 起 Streamable HTTP MCP server（stateless per-request；返回 handle 便于测试与优雅关停） */
export async function startHttpServer(options: ServeHttpOptions = {}): Promise<HttpHandle> {
  const port = options.port ?? 7802
  const host = options.host ?? '127.0.0.1'
  const path = options.path ?? '/mcp'
  const core = createMcpServer(options)
  const serverInfo = options.serverInfo ?? { name: core.name, version: core.version }
  const log = options.onRequest

  const httpServer = http.createServer(async (req, res) => {
    const started = Date.now()
    const reqPath = (req.url ?? '').split('?')[0]
    const done = (status: number, tool?: string) => log?.({ method: req.method, path: reqPath, tool, ok: status < 400, ms: Date.now() - started, status })

    if (reqPath !== path) { sendJson(res, 404, { error: 'not found', hint: `MCP 端点为 ${path}` }); done(404); return }
    if (req.method !== 'POST') {
      // GET/DELETE 不支持（stateless 无服务端推送/会话）
      sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed（本 server 仅支持 POST）' }, id: null })
      done(405); return
    }
    if (!authorized(req.headers.authorization, options.token)) {
      res.setHeader('www-authenticate', 'Bearer')
      sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: '未授权：需要 Bearer token' }, id: null })
      done(401); return
    }

    const server = buildPerRequestServer(core, serverInfo)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await transport.handleRequest(req, res)
      done(res.statusCode || 200)
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: e instanceof Error ? e.message : String(e) }, id: null })
      done(500)
    }
  })

  let boundPort = port
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      const addr = httpServer.address()
      if (addr && typeof addr === 'object') boundPort = addr.port
      resolve()
    })
  })

  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}${path}`
  options.onReady?.({ url, host, port: boundPort, path, auth: Boolean(options.token), tools: core.listTools().length })

  return {
    url,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
        // close() 不再接受新连接；已处理的请求自然结束
      }),
  }
}
