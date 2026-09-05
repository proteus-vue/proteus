// tests/mcp-server.test.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server）：MCP Server 权威 TS 版
//   验收：11 工具 + 5 Resources + 3 Prompts + CMP021 策略（write 双闸/限流/防注入校验）
//   + 数据源 SSOT 消费（原语目录/MP 对照/能力矩阵派生/六端 conformance）
// @vitest-environment happy-dom（vue-dom 引擎 + run_conformance 需要 document）
import { describe, it, expect } from 'vitest'
import { createMcpServer, DESIGN_TOKENS, validateToolArgs } from '@proteus-vue/mcp'
import type { McpToolDef } from '@proteus-vue/mcp'
import { toComponentTree } from '@proteus-vue/component-ir'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'

function makeServer(opts: { writeEnabled?: boolean; rateLimitPerMin?: number } = {}) {
  return createMcpServer(opts)
}

/** 合法 C-IR fixture（p-grid → p-box → p-button——六端控件映射全覆盖） */
function validIR(): Record<string, unknown> {
  const ir = toComponentTree('p-grid', { minColWidth: 160 }, [
    { tag: 'p-box', props: {}, children: [{ tag: 'p-text', props: { content: 'A' } }] },
    { tag: 'p-box', props: {}, children: [{ tag: 'p-button', props: { variant: 'primary', label: 'Go' } }] },
  ])
  return ir as unknown as Record<string, unknown>
}

describe('G-36 B1 MCP Server 协议面', () => {
  it('tools/list：11 工具（只读 10 + 写入 1，write_file 需确认）', () => {
    const s = makeServer()
    const tools = s.listTools()
    expect(tools).toHaveLength(11)
    expect(tools.map((t) => t.name)).toEqual([
      'search_primitives',
      'get_primitive',
      'list_primitives',
      'get_design_token',
      'check_capability',
      'get_capability_matrix',
      'lookup_miniprogram',
      'validate_ir',
      'run_conformance',
      'generate_code',
      'write_file',
    ])
    const wf = tools.find((t) => t.name === 'write_file')
    expect(wf?.readonly).toBe(false)
    expect(wf?.requireConfirm).toBe(true)
    expect(tools.filter((t) => t.readonly).length).toBe(10)
  })

  it('resources/list+read：5 资源（原语目录/token 树/能力矩阵/C-IR Schema/范例）', () => {
    const s = makeServer()
    const rs = s.listResources()
    expect(rs.map((r) => r.uri)).toEqual([
      'proteus://primitives/catalog',
      'proteus://tokens/design',
      'proteus://capabilities/matrix',
      'proteus://ir/schemas/component',
      'proteus://examples/product-detail',
    ])
    const catalog = s.readResource('proteus://primitives/catalog')
    expect(catalog.ok).toBe(true)
    expect((catalog.contents as unknown[]).length).toBe(136) // G-32 128 原语 + #405 语义登记批 8
    const tokens = s.readResource('proteus://tokens/design')
    expect((tokens.contents as Record<string, unknown>).color).toBeDefined()
    const schema = s.readResource('proteus://ir/schemas/component')
    expect(schema.ok).toBe(true)
    expect(s.readResource('proteus://nope').ok).toBe(false)
  })

  it('prompts/list+get：3 模板（flex-layout/migrate-wx/token-only）', () => {
    const s = makeServer()
    expect(s.listPrompts().map((p) => p.name)).toEqual(['proteus-flex-layout', 'proteus-migrate-wx', 'proteus-token-only'])
    const p = s.getPrompt('proteus-migrate-wx')
    expect(p.ok).toBe(true)
    expect(p.messages?.[0].content).toContain('lookup_miniprogram')
    expect(s.getPrompt('nope').ok).toBe(false)
  })
})

describe('G-36 B1 只读工具', () => {
  it('search_primitives：子串匹配 + 分类过滤 + 截断标记', async () => {
    const s = makeServer()
    const r = await s.callTool('search_primitives', { query: 'grid' })
    expect(r.ok).toBe(true)
    const result = r.result as { total: number; primitives: Array<{ semantic: string }> }
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.primitives.some((p) => p.semantic === 'layout.grid')).toBe(true)

    const byCat = await s.callTool('search_primitives', { query: 'p', category: 'gesture' })
    const catResult = byCat.result as { primitives: Array<{ kind: string }> }
    expect(catResult.primitives.every((p) => p.kind === 'gesture')).toBe(true)
  })

  it('get_primitive：存在/不存在；list_primitives：136 统计', async () => {
    const s = makeServer()
    const ok = await s.callTool('get_primitive', { name: 'L1' })
    expect((ok.result as { ok: boolean }).ok).toBe(true)
    const bad = await s.callTool('get_primitive', { name: 'nope' })
    expect((bad.result as { ok: boolean }).ok).toBe(false)

    const list = await s.callTool('list_primitives', {})
    const result = list.result as { total: number; byKind: Record<string, number> }
    expect(result.total).toBe(136)
    expect(Object.values(result.byKind).reduce((a, b) => a + b, 0)).toBe(136)
  })

  it('get_design_token：点路径/分组/全树 + 未命中', async () => {
    const s = makeServer()
    const one = await s.callTool('get_design_token', { name: 'color.primary' })
    expect((one.result as { value: string }).value).toBe(DESIGN_TOKENS.color.primary)
    const group = await s.callTool('get_design_token', { group: 'space' })
    expect(group.ok).toBe(true)
    const miss = await s.callTool('get_design_token', { name: 'color.nope' })
    expect((miss.result as { ok: boolean }).ok).toBe(false)
    expect((miss.result as { error: string }).error).toContain('token 不存在')
  })

  it('check_capability + get_capability_matrix：引擎 capabilities 派生（机器事实）', async () => {
    const s = makeServer()
    const r = await s.callTool('check_capability', { backend: 'native-ios', capability: 'glass' })
    const cap = r.result as { backend: string; supported: boolean; value: unknown }
    expect(cap.backend).toBe('native-ios')
    expect(cap.supported).toBe(true) // native glass: L3
    const matrix = await s.callTool('get_capability_matrix', {})
    const rows = (matrix.result as { matrix: Record<string, Record<string, unknown>> }).matrix
    expect(Object.keys(rows)).toHaveLength(6) // 六引擎
  })

  it('lookup_miniprogram：API → Proteus 对等映射（G-32 对照矩阵）', async () => {
    const s = makeServer()
    const r = await s.callTool('lookup_miniprogram', { api: 'scroll-view' })
    const result = r.result as { total: number; mappings: Array<{ mp: string }> }
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.mappings.some((m) => m.mp.includes('scroll-view'))).toBe(true)
  })

  it('validate_ir：合法 IR 零诊断 / 非法 tag 报错', async () => {
    const s = makeServer()
    const ok = await s.callTool('validate_ir', { ir: validIR() })
    expect((ok.result as { ok: boolean }).ok).toBe(true)
    const bad = await s.callTool('validate_ir', { ir: { tag: 'div', semantic: 'layout.box', props: {}, children: [] } })
    expect((bad.result as { ok: boolean }).ok).toBe(false)
  })

  it('run_conformance：六端渲染 conformance（合法 IR → 全 ok）', async () => {
    const s = makeServer()
    const r = await s.callTool('run_conformance', { ir: validIR() })
    const result = r.result as { ok: boolean; results: Array<{ backend: string; ok: boolean }> }
    expect(result.results).toHaveLength(6)
    expect(result.ok).toBe(true)
    expect(result.results.every((x) => x.ok)).toBe(true)
  })

  it('generate_code：json/ts 两格式（ts 含禁改注记）', async () => {
    const s = makeServer()
    const json = await s.callTool('generate_code', { ir: validIR(), format: 'json' })
    expect(((json.result as { code: string }).code).startsWith('{')).toBe(true)
    const ts = await s.callTool('generate_code', { ir: validIR(), format: 'ts' })
    const code = (ts.result as { code: string }).code
    expect(code).toContain('export const component')
    expect(code).toContain('禁止手改生成物')
  })
})

describe('G-36 B1 策略与防护（CMP021）', () => {
  it('write_file 双闸：默认禁用 / 启用后需 confirmed / 确认后真实落盘（写后读回自证）——业务 code 在 result 内层', async () => {
    const disabled = makeServer()
    const d = await disabled.callTool('write_file', { path: 'x.txt', content: 'hi' })
    expect((d.result as { code: string }).code).toBe('write_disabled')

    const tmp = mkdtempSync(join(tmpdir(), 'mcp-'))
    const enabled = makeServer({ writeEnabled: true, workspaceRoot: tmp })
    const file = join(tmp, 'out.txt')
    const needConfirm = await enabled.callTool('write_file', { path: 'out.txt', content: 'hi' })
    expect((needConfirm.result as { code: string }).code).toBe('confirmation_required')

    const done = await enabled.callTool('write_file', { path: 'out.txt', content: 'hello proteus', confirmed: true })
    expect(done.ok).toBe(true)
    expect((done.result as { bytes: number }).bytes).toBe(13)
    expect(readFileSync(file, 'utf8')).toBe('hello proteus')
  })

  it('write_file 路径逃逸防护（workspaceRoot 外绝对路径 / .. 穿越——resolve 后拒绝）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mcp-'))
    const enabled = makeServer({ writeEnabled: true, workspaceRoot: tmp })
    const abs = await enabled.callTool('write_file', { path: '/etc/passwd', content: 'x', confirmed: true })
    expect((abs.result as { code: string }).code).toBe('path_refused')
    const dotdot = await enabled.callTool('write_file', { path: '../escape.txt', content: 'x', confirmed: true })
    expect((dotdot.result as { code: string }).code).toBe('path_refused')
    expect(existsSync('/tmp/escape.txt')).toBe(false)
  })

  it('速率限制：rateLimitPerMin=3 → 第 4 次调用 rate_limited', async () => {
    const s = makeServer({ rateLimitPerMin: 3 })
    for (let i = 0; i < 3; i++) {
      const r = await s.callTool('list_primitives', {})
      expect(r.code).toBeUndefined()
    }
    const blocked = await s.callTool('list_primitives', {})
    expect(blocked.code).toBe('rate_limited')
  })

  it('防注入校验：缺必填/超长/非法枚举 → invalid_args；未知工具 → unknown_tool', async () => {
    const s = makeServer()
    const missing = await s.callTool('search_primitives', {})
    expect(missing.code).toBe('invalid_args')
    const tooLong = await s.callTool('search_primitives', { query: 'x'.repeat(500) })
    expect(tooLong.code).toBe('invalid_args')
    const badEnum = await s.callTool('check_capability', { backend: 'nope', capability: 'glass' })
    expect(badEnum.code).toBe('invalid_args')
    const unknown = await s.callTool('nope', {})
    expect(unknown.code).toBe('unknown_tool')
  })
})

describe('G-36 B1 validateToolArgs 单元', () => {
  it('类型/enum/maxLength 校验', () => {
    const tool: McpToolDef = {
      name: 't',
      description: '',
      readonly: true,
      inputSchema: {
        q: { type: 'string', required: true, maxLength: 5 },
        n: { type: 'number' },
        e: { type: 'string', enum: ['a', 'b'] },
      },
    }
    expect(validateToolArgs(tool, { q: 'abc' }).ok).toBe(true)
    expect(validateToolArgs(tool, {}).ok).toBe(false)
    expect(validateToolArgs(tool, { q: 'toolong' }).ok).toBe(false)
    expect(validateToolArgs(tool, { q: 'a', n: 'x' }).ok).toBe(false)
    expect(validateToolArgs(tool, { q: 'a', e: 'c' }).ok).toBe(false)
    expect(validateToolArgs(tool, { q: 'a', e: 'b' }).ok).toBe(true)
  })
})
