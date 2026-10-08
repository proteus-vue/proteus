// tests/mcp-stdio.test.ts
// ★决策 #681：MCP stdio 传输适配器（Claude Desktop / Cursor / Cline 直连）。
//   验收四层：
//   ① **协议往返（in-memory）**：SDK Client ↔ 我们的 Server（InMemoryTransport 对）
//      ——initialize / tools/list(11) / tools/call / resources/list+read / prompts/list+get 全通；
//   ② **Tool 契约**：tools/list 的每个工具都能被 **SDK 自己的 ToolSchema（zod）** 解析
//      ——这是"核心自定义形状 → 协议形状"翻译的判据（不是"看看有没有 type 字段"）；
//   ③ **端到端 stdio 子进程**：spawn 真实 `proteus mcp serve`，SDK Client 经真 stdout/stdin 通信；
//   ④ **★破坏性验证**：往 server 的 stdout 打一行杂散日志 ⇒ 该往返**必须红**（锁住"stdout 让给协议"），
//      干净 server 同款断言必须绿（证明判据抓的是"污染"而非"总是红"）。
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { buildStdioServer, toJsonSchema, toProtocolTools } from '../packages/mcp/src/stdio'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI_DIST = join(REPO, 'packages', 'cli', 'dist', 'index.js')
const MCP_DIST = join(REPO, 'packages', 'mcp', 'dist', 'index.js')

/** 从 callTool 结果里取第一段 text（协议把负载包进 content[]） */
function resultText(res: { content?: unknown }): string {
  const c = res.content as Array<{ type: string; text: string }> | undefined
  return c?.[0]?.text ?? ''
}

/** 把 SDK Client 连到我们的 server（in-memory 对），返回已 initialize 的 client */
async function connectedPair(opts: Parameters<typeof buildStdioServer>[0] = {}): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = buildStdioServer(opts)
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'vitest-client', version: '0.0.0' })
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  return {
    client,
    close: async () => {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    },
  }
}

describe('★#681 MCP stdio 适配器 · 协议往返（in-memory）', () => {
  it('tools/list：11 工具 + 只读注解（write_file readOnlyHint=false）', async () => {
    const { client, close } = await connectedPair()
    try {
      const { tools } = await client.listTools()
      expect(tools).toHaveLength(11)
      const names = tools.map((t) => t.name)
      for (const n of ['search_primitives', 'validate_ir', 'run_conformance', 'write_file']) expect(names).toContain(n)
      expect(tools.find((t) => t.name === 'write_file')!.annotations?.readOnlyHint).toBe(false)
      expect(tools.find((t) => t.name === 'search_primitives')!.annotations?.readOnlyHint).toBe(true)
    } finally {
      await close()
    }
  })

  it('tools/call：search_primitives 真返回（经协议封装为 text content）', async () => {
    const { client, close } = await connectedPair()
    try {
      const res = await client.callTool({ name: 'search_primitives', arguments: { query: 'grid' } })
      expect(res.isError).toBeFalsy()
      expect(JSON.parse(resultText(res)).total).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })

  it('tools/call：未知工具 → isError=true（失败不抛穿协议）', async () => {
    const { client, close } = await connectedPair()
    try {
      const res = await client.callTool({ name: 'nope_tool', arguments: {} })
      expect(res.isError).toBe(true)
      expect(resultText(res)).toContain('unknown_tool')
    } finally {
      await close()
    }
  })

  it('write_file 默认禁用（只读安全）→ isError + write_disabled', async () => {
    const { client, close } = await connectedPair()
    try {
      const res = await client.callTool({ name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } })
      expect(res.isError).toBe(true)
      expect(resultText(res)).toContain('write_disabled')
    } finally {
      await close()
    }
  })

  it('write_file 开闸（writeEnabled）+ confirmed=true → 落盘成功（双闸正向）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-write-'))
    const { client, close } = await connectedPair({ writeEnabled: true, workspaceRoot: dir })
    try {
      const res = await client.callTool({ name: 'write_file', arguments: { path: 'out.txt', content: 'hello proteus', confirmed: true } })
      expect(res.isError).toBeFalsy()
      expect(JSON.parse(resultText(res)).ok).toBe(true)
      expect(existsSync(join(dir, 'out.txt'))).toBe(true)
    } finally {
      await close()
    }
  })

  it('resources/list + read：5 资源，读回 JSON 文本（原语目录 >100 项）', async () => {
    const { client, close } = await connectedPair()
    try {
      const { resources } = await client.listResources()
      expect(resources).toHaveLength(5)
      expect(resources.map((r) => r.uri)).toContain('proteus://primitives/catalog')
      const read = await client.readResource({ uri: 'proteus://primitives/catalog' })
      expect(read.contents[0].uri).toBe('proteus://primitives/catalog')
      const parsed = JSON.parse((read.contents[0] as { text: string }).text)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBeGreaterThan(100)
    } finally {
      await close()
    }
  })

  it('resources/read：不存在的 uri → 报错（不静默空）', async () => {
    const { client, close } = await connectedPair()
    try {
      await expect(client.readResource({ uri: 'proteus://nope' })).rejects.toThrow()
    } finally {
      await close()
    }
  })

  it('prompts/list + get：3 模板，get 返回 text content', async () => {
    const { client, close } = await connectedPair()
    try {
      const { prompts } = await client.listPrompts()
      expect(prompts).toHaveLength(3)
      const got = await client.getPrompt({ name: 'proteus-token-only' })
      expect(got.messages).toHaveLength(1)
      expect(got.messages[0].content.type).toBe('text')
    } finally {
      await close()
    }
  })
})

describe('★#681 Tool 契约：inputSchema 必须是合法协议 Tool（SDK ToolSchema 判定）', () => {
  it('toJsonSchema：核心自定义形状 → type:object + properties + required[]', () => {
    const s = toJsonSchema({
      query: { type: 'string', required: true, maxLength: 120, description: '关键词' },
      category: { type: 'string', enum: ['a', 'b'] },
    })
    expect(s.type).toBe('object')
    expect(s.required).toEqual(['query'])
    expect(s.properties.query).toMatchObject({ type: 'string', maxLength: 120 })
    expect(s.properties.category).toMatchObject({ type: 'string', enum: ['a', 'b'] })
  })

  it('★11 工具全部被 SDK ToolSchema 解析通过（真 schema 校验，非"看字段"）', () => {
    const { core } = buildStdioServer()
    for (const t of toProtocolTools(core)) {
      const parsed = ToolSchema.safeParse(t)
      expect(parsed.success, `${t.name} 应为合法协议 Tool：${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
    }
  })

  it('★破坏性：required 抽取逻辑退化 ⇒ 判据能抓', () => {
    const s = toJsonSchema({ a: { type: 'string', required: true }, b: { type: 'number' } })
    expect(s.required).toEqual(['a'])
  })
})

/** 用 SDK Client + 真实 stdio 子进程跑一次完整往返（listTools + callTool） */
async function stdioRoundtrip(command: string, args: string[]): Promise<{ tools: number }> {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const transport = new StdioClientTransport({ command, args, env: { ...process.env }, stderr: 'pipe' })
  const client = new Client({ name: 'vitest-stdio', version: '0.0.0' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    const res = await client.callTool({ name: 'search_primitives', arguments: { query: 'button' } })
    expect(res.isError).toBeFalsy()
    return { tools: tools.length }
  } finally {
    await client.close().catch(() => {})
  }
}

describe('★#681 端到端 stdio（真实子进程 `proteus mcp serve`）', () => {
  beforeAll(() => {
    if (!existsSync(CLI_DIST)) throw new Error(`CLI dist 不存在：${CLI_DIST}（测试前需 build-packages）`)
    if (!existsSync(MCP_DIST)) throw new Error(`MCP dist 不存在：${MCP_DIST}（测试前需 build-packages）`)
  })

  it('spawn 真实 CLI → initialize/listTools(11)/callTool 全通', async () => {
    const { tools } = await stdioRoundtrip(process.execPath, [CLI_DIST, 'mcp', 'serve'])
    expect(tools).toBe(11)
  }, 30000)
})

/**
 * ★低层探针：spawn server，喂一条 initialize，收集**原始 stdout** 行，等回包（有完成条件，非盲等）。
 *   判据 = **stdout 每一行都必须是合法 JSON-RPC**（stdout 是协议的）。
 *   为什么不用 SDK Client 判：实测 SDK Client 的 ReadBuffer 对"解析失败的行"是**宽容跳过**
 *   （processReadBuffer 的 catch 只 onerror 不中断）⇒ 一行杂散日志它照样能跑通，抓不住污染。
 *   故直接在原始 stdout 层判——这才是"stdout 只出协议帧"的直接编码。
 */
function collectStdoutLines(command: string, args: string[]): Promise<{ lines: string[]; gotResponse: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (gotResponse: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      resolve({ lines: stdout.split('\n').filter((l) => l.trim().length > 0), gotResponse })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      // 完成条件：收到 initialize 的响应帧（有 result/error + 我们的 id）
      if (stdout.includes('"id":1')) finish(true)
    })
    child.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e) } })
    // 安全网（有界，非盲等）：只要没收到响应就最多等 8s——超时按"未响应"处理
    const timer = setTimeout(() => finish(false), 8000)
    // 发 initialize（握手请求）
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }) + '\n')
  })
}

describe('★#681 破坏性验证：stdout 只出协议帧（污染必红）', () => {
  it('干净 server（只写 stderr）→ stdout 每行都是合法 JSON-RPC', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-clean-'))
    const script = join(dir, 'server.mjs')
    writeFileSync(
      script,
      `import { serveStdio } from ${JSON.stringify(MCP_DIST)}\n` +
        `await serveStdio({ onReady: (i) => process.stderr.write('[clean] ' + i.tools + ' tools\\n') })\n`,
      'utf-8',
    )
    const { lines, gotResponse } = await collectStdoutLines(process.execPath, [script])
    expect(gotResponse).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) {
      const msg = JSON.parse(l) // 非 JSON-RPC 会抛 ⇒ 红
      expect(msg.jsonrpc).toBe('2.0')
    }
  }, 30000)

  it('★污染 stdout（打一行杂散日志）→ 该行**破**"每行皆 JSON-RPC"判据', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-dirty-'))
    const script = join(dir, 'server.mjs')
    writeFileSync(
      script,
      `import { serveStdio } from ${JSON.stringify(MCP_DIST)}\n` +
        `process.stdout.write('STRAY LOG LINE (not JSON-RPC)\\n') // ← 违规：stdout 是协议的\n` +
        `await serveStdio({})\n`,
      'utf-8',
    )
    const { lines } = await collectStdoutLines(process.execPath, [script])
    // 污染行存在 ⇒ "每行皆可 JSON.parse" 必失败（干净形态则通过）
    const allValid = lines.every((l) => { try { JSON.parse(l); return true } catch { return false } })
    expect(allValid, `stdout 混入非 JSON-RPC 行：${JSON.stringify(lines)}`).toBe(false)
  }, 30000)
})
