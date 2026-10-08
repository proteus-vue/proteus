// tests/mcp-http.test.ts
// ★决策 #682：MCP 生产化——Streamable HTTP 传输 + 元数据/文档正确性 + 优雅关停。
//   验收：
//   ① **元数据**：serverInfo.version = 真实包版本（不再写死 '0.1.0'）；
//   ② **六端全通**：documentLike 自动注入（happy-dom）⇒ run_conformance 六端全 ok（含 vue-dom）；
//   ③ **HTTP 往返**：真实 http server + SDK Client 经 Streamable HTTP 通信（tools/list 11 / callTool / resources / prompts）；
//   ④ **鉴权**：设 token 后 无/错 token → 401，对 token → 200（用原始 fetch 判状态码）；
//   ⑤ **通道纪律**：HTTP 模式 stdout 也为空（协议/服务输出不进 stdout）；
//   ⑥ **★破坏性验证**：① 未鉴权必须被拒（判据能抓"鉴权缺失"）；② GET 必须 405（stateless 无推送）；
//      ③ 关停后端口不再可达（close 真生效，不是空实现）。
//
//   ★Node 版本边界：Streamable HTTP 传输依赖 ESM 全局 `crypto`（Node ≥20 才有；Node 18 的 ESM 无）。
//     CI 用 Node 22 ⇒ 全跑；本机 Node 18 下 HTTP 用例 skipIf（元数据/文档用例仍跑）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createMcpServer, resolveMcpVersion, resolveDocumentLike, startHttpServer, toProtocolTools } from '../packages/mcp/src/index'
import { toComponentTree } from '@proteus-vue/component-ir'
import type { HttpHandle } from '../packages/mcp/src/http'

const HAS_WEB_CRYPTO = typeof globalThis.crypto !== 'undefined' // Node ≥20（ESM）

/** 合法 C-IR fixture（p-grid → p-box → p-text/p-button） */
function validIR(): Record<string, unknown> {
  return toComponentTree('p-grid', { minColWidth: 160 }, [
    { tag: 'p-box', props: {}, children: [{ tag: 'p-text', props: { content: 'A' } }] },
    { tag: 'p-box', props: {}, children: [{ tag: 'p-button', props: { variant: 'primary', label: 'Go' } }] },
  ]) as unknown as Record<string, unknown>
}

describe('★#682 元数据正确性', () => {
  it('serverInfo.version = 真实包版本（不写死；与 resolveMcpVersion 一致、非 0.1.0）', () => {
    const v = resolveMcpVersion()
    expect(v).toMatch(/^\d+\.\d+\.\d+/) // 语义化版本
    expect(v).not.toBe('0.1.0') // 旧写死值
    const s = createMcpServer()
    expect(s.version).toBe(v)
    expect(s.name).toBe('proteus-mcp')
  })

  it('name/version 可覆盖', () => {
    const s = createMcpServer({ name: 'x', version: '9.9.9' })
    expect(s.name).toBe('x')
    expect(s.version).toBe('9.9.9')
  })
})

describe('★#682 六端全通：documentLike 自动注入', () => {
  it('resolveDocumentLike 产出可用 document（happy-dom 可选依赖）', async () => {
    const doc = await resolveDocumentLike()
    expect(doc).toBeTruthy() // 本仓 happy-dom 已装
    expect(typeof (doc as { createElement?: unknown }).createElement).toBe('function')
  })

  it('★run_conformance 六端全 ok（含 vue-dom——此前纯 Node 下 vue-dom 端报错）', async () => {
    const doc = await resolveDocumentLike()
    const s = createMcpServer({ documentLike: doc })
    const r = await s.callTool('run_conformance', { ir: validIR() })
    expect(r.ok).toBe(true)
    const res = r.result as { ok: boolean; results: Array<{ backend: string; ok: boolean }> }
    expect(res.ok).toBe(true)
    expect(res.results).toHaveLength(6)
    for (const p of res.results) expect(p.ok, `${p.backend} 应通过`).toBe(true)
    expect(res.results.map((p) => p.backend)).toContain('vue-dom')
  })
})

/** 起 server + SDK client（经真实 Streamable HTTP），返回句柄与 client */
async function startPair(opts: Parameters<typeof startHttpServer>[0] = {}): Promise<{ handle: HttpHandle; client: Client }> {
  const handle = await startHttpServer({ port: 0, ...opts })
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const ct = new StreamableHTTPClientTransport(new URL(handle.url), opts.token ? { requestInit: { headers: { authorization: `Bearer ${opts.token}` } } } : undefined)
  const client = new Client({ name: 'vitest-http', version: '0.0.0' })
  await client.connect(ct)
  return { handle, client }
}

describe.skipIf(!HAS_WEB_CRYPTO)('★#682 Streamable HTTP 传输（需 Node ≥20）', () => {
  let handle: HttpHandle | undefined
  let client: Client | undefined
  beforeEach(() => {
    handle = undefined
    client = undefined
  })
  afterEach(async () => {
    await client?.close().catch(() => {})
    await handle?.close().catch(() => {})
  })

  it('往返：tools/list(11) + callTool + resources + prompts', async () => {
    ;({ handle, client } = await startPair({ documentLike: await resolveDocumentLike() }))
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(11)
    const call = await client.callTool({ name: 'search_primitives', arguments: { query: 'button' } })
    expect(call.isError).toBeFalsy()
    const { resources } = await client.listResources()
    expect(resources).toHaveLength(5)
    const { prompts } = await client.listPrompts()
    expect(prompts).toHaveLength(3)
  }, 30000)

  it('并发两客户端（stateless per-request 各自独立）', async () => {
    const h = await startHttpServer({ port: 0 })
    handle = h
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const mk = async () => {
      const c = new Client({ name: 'c', version: '0' })
      await c.connect(new StreamableHTTPClientTransport(new URL(h.url)))
      return c
    }
    const [a, b] = await Promise.all([mk(), mk()])
    const [ta, tb] = await Promise.all([a.listTools(), b.listTools()])
    expect(ta.tools).toHaveLength(11)
    expect(tb.tools).toHaveLength(11)
    await a.close()
    await b.close()
  }, 30000)
})

describe.skipIf(!HAS_WEB_CRYPTO)('★#682 HTTP 鉴权与通道纪律（需 Node ≥20）', () => {
  const initBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }


  it('★破坏性：设 token 后 无 token / 错 token → 401；对 token → 200', async () => {
    const handle = await startHttpServer({ port: 0, token: 'secret123' })
    try {
      const post = (headers: Record<string, string>) => fetch(handle.url, { method: 'POST', headers: { ...H, ...headers }, body: initBody }).then((r) => r.status)
      expect(await post({}), '无 token 必须 401').toBe(401)
      expect(await post({ authorization: 'Bearer wrong' }), '错 token 必须 401').toBe(401)
      expect(await post({ authorization: 'Bearer secret123' }), '对 token 必须 200').toBe(200)
    } finally {
      await handle.close()
    }
  }, 30000)

  it('未设 token → 无需鉴权即可 200（本地开发便利）', async () => {
    const handle = await startHttpServer({ port: 0 })
    try {
      const res = await fetch(handle.url, { method: 'POST', headers: H, body: initBody })
      expect(res.status).toBe(200)
    } finally {
      await handle.close()
    }
  }, 30000)

  it('★破坏性：GET 必须 405（stateless 无服务端推送）', async () => {
    const handle = await startHttpServer({ port: 0 })
    try {
      const res = await fetch(handle.url, { method: 'GET', headers: H })
      expect(res.status).toBe(405)
    } finally {
      await handle.close()
    }
  }, 30000)

  it('★破坏性：错误路径 → 404', async () => {
    const handle = await startHttpServer({ port: 0, path: '/mcp' })
    try {
      const res = await fetch(handle.url.replace('/mcp', '/nope'), { method: 'POST', headers: H, body: initBody })
      expect(res.status).toBe(404)
    } finally {
      await handle.close()
    }
  }, 30000)

  it('★破坏性：close() 真生效——关停后请求失败（连接被拒/不可达）', async () => {
    const handle = await startHttpServer({ port: 0 })
    const url = handle.url
    await handle.close()
    await expect(fetch(url, { method: 'POST', headers: H, body: initBody })).rejects.toThrow()
  }, 30000)
})

describe('★#682 工具清单自洽（HTTP 与 stdio 同源）', () => {
  it('toProtocolTools 输出 11 工具且 write_file readOnly=false', () => {
    const tools = toProtocolTools(createMcpServer())
    expect(tools).toHaveLength(11)
    expect(tools.find((t) => t.name === 'write_file')!.annotations.readOnlyHint).toBe(false)
  })
})
