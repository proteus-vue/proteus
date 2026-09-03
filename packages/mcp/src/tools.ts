// packages/mcp/src/tools.ts
// ★G-36 B1（proteus-ai-agent-plan 03-mcp-server §2）：MCP 工具实现（11 个——只读 8 + 写入 3）
//   数据源（SSOT）：G-32 原语目录（component-ir PRIMITIVE_CATALOG）/ MP 对照矩阵（MP_MAPPING_MATRIX）/
//   C-IR 校验（validateComponentIR）/ 六引擎能力与 conformance（render-backend）
import {
  PRIMITIVE_CATALOG,
  MP_MAPPING_MATRIX,
  validateComponentIR,
  checkComponentSnapshot,
  primitiveById,
} from '@proteus-vue/component-ir'
import type { ComponentIR } from '@proteus-vue/component-ir'
import {
  ENGINES,
  HOST_ENGINE_MATRIX,
  HOSTS,
  createEngine,
  renderComponentSnapshot,
  createControlReader,
} from '@proteus-vue/render-backend'
import type { BackendCapabilities } from '@proteus-vue/render-backend'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { DESIGN_TOKENS, designTokenAt } from './tokens'

// ============================================================
// 工具元数据（输入 Schema——CMP021 防注入：所有参数经校验，拒绝超长输入）
// ============================================================

export interface McpToolSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  readonly required?: boolean
  readonly maxLength?: number
  readonly enum?: readonly string[]
  readonly description?: string
}

export interface McpToolDef {
  readonly name: string
  readonly description: string
  /** 只读类默认可用；写入类需策略放行（CMP021 tool_policy） */
  readonly readonly: boolean
  /** 高风险操作需交互式确认（03-mcp-server §2 write_file） */
  readonly requireConfirm?: boolean
  readonly inputSchema: Readonly<Record<string, McpToolSchemaProperty>>
}

/** 参数校验（轻量 Schema：required/type/maxLength/enum——拒绝超长与可疑输入） */
export function validateToolArgs(tool: McpToolDef, args: Record<string, unknown> | undefined): { ok: boolean; error?: string } {
  const a = args ?? {}
  for (const [key, prop] of Object.entries(tool.inputSchema)) {
    const v = a[key]
    if (prop.required && (v === undefined || v === null)) return { ok: false, error: `缺少必填参数：${key}` }
    if (v === undefined) continue
    if (prop.type === 'string' && typeof v !== 'string') return { ok: false, error: `参数 ${key} 应为 string` }
    if (prop.type === 'number' && typeof v !== 'number') return { ok: false, error: `参数 ${key} 应为 number` }
    if (prop.type === 'boolean' && typeof v !== 'boolean') return { ok: false, error: `参数 ${key} 应为 boolean` }
    if (prop.type === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) return { ok: false, error: `参数 ${key} 应为 object` }
    if (prop.type === 'array' && !Array.isArray(v)) return { ok: false, error: `参数 ${key} 应为 array` }
    if (prop.type === 'string' && typeof v === 'string' && prop.maxLength !== undefined && v.length > prop.maxLength) {
      return { ok: false, error: `参数 ${key} 超长（>${prop.maxLength}）——拒绝可疑输入` }
    }
    if (prop.enum && !prop.enum.includes(String(v))) return { ok: false, error: `参数 ${key} 应为 ${prop.enum.join('|')}` }
  }
  return { ok: true }
}

// ============================================================
// 能力矩阵（引擎 capabilities 派生——机器事实非手写）
// ============================================================

const CAPABILITY_KEYS = ['layout', 'glass', 'blur', 'animation', 'textureSharing', 'remoteRendering', 'ssr', 'input'] as const

function engineCapabilities(engine: (typeof ENGINES)[number]): BackendCapabilities {
  return createEngine(engine).capabilities
}

function isSupported(v: unknown): boolean {
  return v !== undefined && v !== false && v !== 'none'
}

/** 端 × 能力矩阵（从六引擎 capabilities 派生） */
export function capabilityMatrix(capability?: string): Record<string, Record<string, unknown>> {
  const keys = capability ? ([capability] as const) : CAPABILITY_KEYS
  const out: Record<string, Record<string, unknown>> = {}
  for (const engine of ENGINES) {
    const caps = engineCapabilities(engine)
    const row: Record<string, unknown> = {}
    for (const key of keys) {
      row[key] = (caps as unknown as Record<string, unknown>)[key] ?? null
    }
    out[engine] = row
  }
  return out
}

/** ComponentIR（tag/semantic）→ IRNode（type/semantic）适配——renderComponentSnapshot 消费 IRNode 形状 */
function toIRNodeShape(node: unknown): unknown {
  const n = node as { tag?: string; type?: string; semantic?: string; props?: Record<string, unknown>; children?: unknown[] }
  return {
    type: n.type ?? n.tag ?? 'view',
    semantic: n.semantic,
    props: n.props ?? {},
    children: (n.children ?? []).map(toIRNodeShape),
  }
}

// ============================================================
// 工具清单（11 个）
// ============================================================

export interface McpToolDefWithHandler extends McpToolDef {
  /** 执行（args 已过校验；write 工具的 fs 副作用由 server 策略门控） */
  run(args: Record<string, unknown>, ctx: ToolContext): unknown
}

export interface ToolContext {
  /** 写入类工具策略（CMP021：write_file 默认禁用 + 需确认） */
  writeEnabled: boolean
  /** 写入根目录（resolve 后必须在根内——防逃逸；缺省 process.cwd()） */
  workspaceRoot?: string
  /** generate_code / run_conformance 的 vue-dom document 注入（SSR 场景） */
  documentLike?: unknown
}

const SEARCH_MAX = 20

export const MCP_TOOLS: readonly McpToolDefWithHandler[] = [
  // —— 只读类（默认可用）——
  {
    name: 'search_primitives',
    description: '查询 G-32 语义原语（id/semantic/tag/api 子串匹配）',
    readonly: true,
    inputSchema: {
      query: { type: 'string', required: true, maxLength: 120, description: '关键词' },
      category: { type: 'string', enum: ['layout', 'ui', 'shell', 'gesture', 'capability', 'engineering'], description: '原语类别' },
    },
    run(args) {
      const q = String(args.query).toLowerCase()
      const category = args.category as string | undefined
      const matches = PRIMITIVE_CATALOG.filter((p) => {
        if (category && p.kind !== category) return false
        const hay = [p.id, p.semantic, p.tag ?? '', p.api ?? ''].join(' ').toLowerCase()
        return hay.includes(q)
      })
      return { total: matches.length, truncated: matches.length > SEARCH_MAX, primitives: matches.slice(0, SEARCH_MAX) }
    },
  },
  {
    name: 'get_primitive',
    description: '获取单个原语完整定义',
    readonly: true,
    inputSchema: { name: { type: 'string', required: true, maxLength: 40 } },
    run(args) {
      const p = primitiveById(String(args.name))
      if (!p) return { ok: false, error: `原语不存在：${args.name}` }
      return { ok: true, primitive: p }
    },
  },
  {
    name: 'list_primitives',
    description: '全量或分类原语清单（含统计）',
    readonly: true,
    inputSchema: { category: { type: 'string', enum: ['layout', 'ui', 'shell', 'gesture', 'capability', 'engineering'] } },
    run(args) {
      const category = args.category as string | undefined
      const list = category ? PRIMITIVE_CATALOG.filter((p) => p.kind === category) : PRIMITIVE_CATALOG
      const byKind: Record<string, number> = {}
      for (const p of PRIMITIVE_CATALOG) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1
      return { total: list.length, byKind, primitives: list.map((p) => ({ id: p.id, kind: p.kind, semantic: p.semantic, tag: p.tag, api: p.api, status: p.status })) }
    },
  },
  {
    name: 'get_design_token',
    description: 'design token 查询（颜色/字号/间距/圆角——业务禁硬编码）',
    readonly: true,
    inputSchema: {
      name: { type: 'string', maxLength: 60, description: '点路径（color.primary / font.size.md）；缺省返回全树' },
      group: { type: 'string', enum: ['color', 'font', 'space', 'radius'] },
    },
    run(args) {
      if (typeof args.name === 'string') {
        const v = designTokenAt(args.name)
        if (v === undefined) return { ok: false, error: `token 不存在：${args.name}` }
        return { ok: true, name: args.name, value: v }
      }
      if (typeof args.group === 'string') {
        const g = (DESIGN_TOKENS as Record<string, unknown>)[args.group]
        return { ok: true, group: args.group, tokens: g ?? null }
      }
      return { ok: true, tokens: DESIGN_TOKENS }
    },
  },
  {
    name: 'check_capability',
    description: '查询某引擎某能力（supported/value）',
    readonly: true,
    inputSchema: {
      backend: { type: 'string', required: true, enum: [...ENGINES] },
      capability: { type: 'string', required: true, enum: [...CAPABILITY_KEYS] },
    },
    run(args) {
      const engine = String(args.backend) as (typeof ENGINES)[number]
      const key = String(args.capability)
      const caps = engineCapabilities(engine) as unknown as Record<string, unknown>
      const value = caps[key] ?? null
      return { backend: engine, capability: key, value, supported: isSupported(value) }
    },
  },
  {
    name: 'get_capability_matrix',
    description: '端 × 能力矩阵（六引擎 capabilities 派生）',
    readonly: true,
    inputSchema: { capability: { type: 'string', enum: [...CAPABILITY_KEYS] } },
    run(args) {
      return { matrix: capabilityMatrix(args.capability as string | undefined) }
    },
  },
  {
    name: 'lookup_miniprogram',
    description: '小程序 API/组件 → Proteus 对等物映射',
    readonly: true,
    inputSchema: { api: { type: 'string', required: true, maxLength: 60 } },
    run(args) {
      const q = String(args.api).toLowerCase()
      const hits = MP_MAPPING_MATRIX.filter((m) => m.mp.toLowerCase().includes(q) || m.proteus.toLowerCase().includes(q))
      return { total: hits.length, mappings: hits.slice(0, SEARCH_MAX) }
    },
  },
  {
    name: 'validate_ir',
    description: 'Component IR Schema 校验（G-31 契约：p- 前缀/semantic 合法/CMP006 降级声明/grid 冲突）',
    readonly: true,
    inputSchema: { ir: { type: 'object', required: true, description: 'ComponentIR 树' } },
    run(args) {
      const diagnostics = validateComponentIR(args.ir as ComponentIR)
      return { ok: diagnostics.length === 0, diagnostics }
    },
  },
  // —— 写入类（策略门控）——
  {
    name: 'run_conformance',
    description: '跑六端渲染 conformance（G-31 B5 门禁：语义控件映射 vs 参考表）',
    readonly: true,
    inputSchema: {
      ir: { type: 'object', required: true, description: 'ComponentIR 树' },
      backends: { type: 'array', description: '缺省六引擎全跑' },
    },
    run(args, ctx) {
      const ir = args.ir as ComponentIR
      const diagnostics = validateComponentIR(ir)
      if (diagnostics.length > 0) {
        return { ok: false, stage: 'validate', diagnostics }
      }
      const irNode = toIRNodeShape(ir) as never
      const requested = (Array.isArray(args.backends) && args.backends.length > 0 ? args.backends : [...ENGINES]) as string[]
      const per: Array<Record<string, unknown>> = []
      for (const b of requested) {
        if (!(ENGINES as readonly string[]).includes(b)) {
          per.push({ backend: b, ok: false, error: `未知引擎：${b}` })
          continue
        }
        try {
          const backend = createEngine(b as (typeof ENGINES)[number], ctx.documentLike as never)
          const reader = createControlReader(b)
          const snap = renderComponentSnapshot(backend, irNode, reader)
          const r = checkComponentSnapshot(b, snap)
          per.push({ backend: b, ok: r.ok, nodes: r.nodes, errors: r.errors, unverified: r.unverified })
        } catch (e) {
          per.push({ backend: b, ok: false, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return { ok: per.every((p) => p.ok), results: per }
    },
  },
  {
    name: 'generate_code',
    description: 'IR → 代码产物（json=规范化 IR / ts=类型化模块）',
    readonly: true,
    inputSchema: {
      ir: { type: 'object', required: true },
      format: { type: 'string', required: true, enum: ['json', 'ts'] },
    },
    run(args) {
      const ir = args.ir as ComponentIR
      const diagnostics = validateComponentIR(ir)
      if (diagnostics.length > 0) return { ok: false, stage: 'validate', diagnostics }
      const json = JSON.stringify(ir, null, 2)
      if (args.format === 'json') return { ok: true, format: 'json', code: json }
      const code = [
        '// 由 proteus-mcp generate_code 生成（G-32 原语 ComponentIR）',
        `export const component = ${json} as const`,
        '',
        '// 消费：renderComponentSnapshot(backend, component) → 六端渲染',
        '// 禁止手改生成物——修改源 IR 后重新生成（G-36 铁律）',
      ].join('\n')
      return { ok: true, format: 'ts', code }
    },
  },
  {
    name: 'write_file',
    description: '落盘写入（高风险：默认禁用 + 需交互式确认——CMP021）',
    readonly: false,
    requireConfirm: true,
    inputSchema: {
      path: { type: 'string', required: true, maxLength: 400 },
      content: { type: 'string', required: true, maxLength: 200000 },
      confirmed: { type: 'boolean', description: '用户已交互式确认' },
    },
    run(args, ctx) {
      // 策略双闸：server 级 writeEnabled + 调用级 confirmed（缺一拒绝）
      if (!ctx.writeEnabled) return { ok: false, code: 'write_disabled', error: '写入类工具未启用（tool_policy.write）' }
      if (args.confirmed !== true) return { ok: false, code: 'confirmation_required', error: 'write_file 需用户交互式确认（CMP021 require_confirm）' }
      const raw = String(args.path)
      // 防路径逃逸：resolve 后必须落在 workspaceRoot 内（相对路径按根解析；绝对路径必须在根内）
      const root = resolve(ctx.workspaceRoot ?? process.cwd())
      const target = resolve(root, raw)
      if (target !== root && !target.startsWith(root + sep)) {
        return { ok: false, code: 'path_refused', error: '路径逃逸：写入目标必须在工作区根内' }
      }
      try {
        writeFileSync(target, String(args.content), 'utf8')
        readFileSync(target, 'utf8') // 写后读回自证
        return { ok: true, path: target, bytes: Buffer.byteLength(String(args.content)) }
      } catch (e) {
        return { ok: false, code: 'io_error', error: e instanceof Error ? e.message : String(e) }
      }
    },
  },
]

/** G-30 Tier：引擎在各宿主的最高可用 Tier（1 = 任一宿主 Tier 1） */
export function engineTier(engine: string): 0 | 1 | 3 {
  let best: 0 | 1 | 3 = 0
  for (const host of HOSTS) {
    const t = HOST_ENGINE_MATRIX[host][engine as keyof (typeof HOST_ENGINE_MATRIX)['web']]
    if (t === 1) return 1
    if (t === 3 && best === 0) best = 3
  }
  return best
}
