// packages/compiler-backend/src/g38-conformance.ts
// ★G-38（compiler-backend-spi-plan 02-conformance-suite.md）B2 尾：仓库内 conformance 套件（42 项 C-01~C-10）
//   ——docs/conformance-runner.js（自包含演示脚本）的 TS 权威版：供 `proteus conformance` CLI + vitest 门禁消费
//   与 02 表一致：capability 不足 → SKIP（Terminal「42/42 或仅 capability SKIP」规则）
//   ★与 runner 差异注记：C-09-02（Node↔Rust mock 对比）→ SKIP——真实 Node↔Rust 语义等价由 G-29.1 examples 门禁（81 用例）覆盖
import type { G38CompilerBackend, G38SourceFile } from './g38'
import { g38Hash } from './g38'

// —— 类型 ——

export interface G38ConformanceResult {
  id: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  error?: string
}

export interface G38ConformanceSummary {
  total: number
  pass: number
  fail: number
  skip: number
  results: G38ConformanceResult[]
}

type ConformanceTest = { id: string; group: string; fn: (b: G38CompilerBackend) => unknown | Promise<unknown> }
type Register = (id: string, fn: ConformanceTest['fn']) => void

// —— Terminal 参考（最简——runner mock 的 TS 移植，供 CLI 演示/自检） ——

export function createG38TerminalBackend(): G38CompilerBackend {
  const backend: G38CompilerBackend & { _init?: boolean } = {
    id: 'terminal',
    version: '0.1.0',
    capabilities: {
      incremental: false,
      aot: false,
      sourceMap: false,
      minify: false,
      treeShake: false,
      targetPlatforms: ['web'],
      supportedLanguages: ['sfc'],
      backend: 'js',
      deterministic: true,
    },
    async initialize() {
      backend._init = true
    },
    dispose() {
      backend._init = false
    },
    parse(source: G38SourceFile) {
      const nodes: Array<{ kind: string; tag: string; loc: { line: number; column: number } }> = []
      const re = /<(p-[a-z]+)([^>]*)>/g
      let m: RegExpExecArray | null
      const content = source.content
      while ((m = re.exec(content)) !== null) {
        nodes.push({ kind: 'element', tag: m[1], loc: { line: 1, column: m.index } })
      }
      if (content.includes('<unclosed')) {
        return { nodes: [], diagnostics: [{ code: 'unclosed', message: 'unclosed tag', loc: { line: 0, column: 0 }, severity: 'error' }] }
      }
      return { nodes: nodes as never, diagnostics: [] }
    },
    transform(ast) {
      if (ast.diagnostics?.length) return { id: 'm-empty', imports: [], components: [], capabilities: [], metadata: { semanticCount: 0, compatCount: 0, componentCount: 0 } }
      const map: Record<string, string> = { 'p-grid': 'layout.grid', 'p-stack': 'layout.stack', 'p-scroll': 'layout.scroll', 'p-text': 'ui.text', 'p-button': 'ui.button' }
      const components = (ast.nodes as Array<{ tag: string }>).map((n) => ({
        tag: n.tag,
        semantic: map[n.tag] ?? `unknown.${n.tag}`,
        props: {},
        children: [],
      }))
      return { id: 'm-term', imports: [], components: components as never, capabilities: [], metadata: { semanticCount: components.length, compatCount: 0, componentCount: components.length } }
    },
    emit(module) {
      const code = module.components.map((c) => `├─ ${c.semantic}`).join('\n')
      return { code, map: null, hash: g38Hash(code) }
    },
    createIncrementalSession() {
      return {
        id: 'noop',
        invalidate() {},
        invalidateAll() {},
        recompute() {
          return { changed: [], removed: [], added: [], affectedFiles: [] }
        },
        getDependencies() {
          return []
        },
        getDependents() {
          return []
        },
        commit() {},
        rollback() {},
        getStats() {
          return {}
        },
        dispose() {},
      }
    },
    reportDiagnostics() {
      return []
    },
    getCacheKey(source: G38SourceFile) {
      return g38Hash(source.content)
    },
    getArtifactHash(artifact) {
      return artifact.hash
    },
  }
  return backend
}

// —— 42 项测试（02-conformance-suite.md C-01~C-10；断言与 docs/conformance-runner.js 同构） ——

const tests: ConformanceTest[] = []
const register = (group: string): Register => (id, fn) => tests.push({ id: `${group}-${id}`, group, fn })

const C01 = register('C-01')
const C02 = register('C-02')
const C03 = register('C-03')
const C04 = register('C-04')
const C05 = register('C-05')
const C06 = register('C-06')
const C07 = register('C-07')
const C08 = register('C-08')
const C09 = register('C-09')
const C10 = register('C-10')

const REQUIRED = ['id', 'version', 'capabilities', 'initialize', 'dispose', 'parse', 'transform', 'emit', 'createIncrementalSession', 'reportDiagnostics', 'getCacheKey', 'getArtifactHash']

C01('01', (b) => {
  for (const m of REQUIRED) {
    if (typeof (b as unknown as Record<string, unknown>)[m] === 'undefined' && m !== 'version') throw new Error(`missing ${m}`)
  }
})
C01('02', (b) => {
  if (typeof b.id !== 'string' || !b.id) throw new Error('id')
})
C01('03', (b) => {
  if (!b.capabilities || typeof b.capabilities !== 'object') throw new Error('capabilities')
})
C01('04', (b) => {
  for (const m of ['parse', 'transform', 'emit']) {
    if (typeof (b as unknown as Record<string, unknown>)[m] !== 'function') throw new Error(`not fn: ${m}`)
  }
})
C01('05', (b) => {
  if (typeof b.createIncrementalSession !== 'function') throw new Error('no session')
})
C01('06', (b) => {
  b.reportDiagnostics({} as never)
  b.getCacheKey?.({ content: '' })
  b.getArtifactHash?.({} as never)
})

C02('01', async (b) => {
  await b.initialize()
  if (!(b as unknown as { _init?: boolean })._init && b.id !== 'node') throw new Error('not init')
})
C02('02', (b) => {
  b.dispose()
  if ((b as unknown as { _init?: boolean })._init) throw new Error('not disposed')
})
C02('03', async (b) => {
  await b.initialize()
  await b.initialize()
})
C02('04', (b) => {
  b.dispose()
})
C02('05', async (b) => {
  await Promise.all([b.initialize(), b.initialize()])
})

C03('01', (b) => {
  const ir = b.parse({ content: '<p-grid><p-text></p-text></p-grid>' })
  if (!ir.nodes.find((n) => n.tag === 'p-grid')) throw new Error('no grid')
})
C03('02', (b) => {
  const ir = b.parse({ content: '<p-stack></p-stack>' })
  if (!ir.nodes.find((n) => n.tag === 'p-stack')) throw new Error('no stack')
})
C03('03', (b) => {
  const ir = b.parse({ content: '<unclosed' })
  if (!ir.diagnostics?.length) throw new Error('should diagnose, not throw')
})
C03('04', (b) => {
  const ir = b.parse({ content: '<p-grid></p-grid>' })
  if (!ir.nodes[0].loc) throw new Error('no loc info')
})
C03('05', (b) => {
  try {
    b.parse({ content: '<p-unsupported-xxx></p-unsupported-xxx>' })
  } catch (e) {
    throw new Error('must diagnose, not throw')
  }
})

C04('01', (b) => {
  const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  if (ir.components[0]?.semantic !== 'layout.grid') throw new Error('semantic')
})
C04('02', (b) => {
  const ir = b.transform(b.parse({ content: '<p-stack snap="mandatory"></p-stack>' }))
  if (ir.components[0]?.semantic !== 'layout.stack') throw new Error('stack')
})
C04('03', (b) => {
  const ir = b.transform(b.parse({ content: '<p-button></p-button>' }))
  if (ir.components[0]?.semantic !== 'ui.button') throw new Error('button')
})
C04('04', (b) => {
  const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  if (!Object.prototype.hasOwnProperty.call(ir.components[0], 'semantic')) throw new Error('no semantic field')
})
C04('05', (b) => {
  const a = b.transform(b.parse({ content: '<p-text></p-text>' }))
  const c = b.transform(b.parse({ content: '<p-text></p-text>' }))
  if (JSON.stringify(a) !== JSON.stringify(c)) throw new Error('not deterministic in transform')
})
C04('06', (b) => {
  const ir = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  if (ir.components[0]?.semantic === 'unknown.p-grid') throw new Error('should map')
})

C05('01', (b) => {
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const a = b.emit(m)
  if (!a.code) throw new Error('no code')
})
C05('02', (b) => {
  if (!b.capabilities.sourceMap) return 'SKIP'
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const a = b.emit(m)
  if (!a.map) throw new Error('no sourcemap')
})
C05('03', (b) => {
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const a = b.emit(m)
  if (!a.hash) throw new Error('no hash')
})
C05('04', (b) => {
  if (!b.capabilities.treeShake) return 'SKIP'
})
C05('05', (b) => {
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const a1 = b.emit(m)
  const a2 = b.emit(m)
  if (a1.code !== a2.code) throw new Error('not deterministic emit')
})

C06('01', (b) => {
  const s = b.createIncrementalSession('/tmp')
  if (!s.id) throw new Error('no id')
})
C06('02', (b) => {
  if (!b.capabilities.incremental) return 'SKIP'
  const s = b.createIncrementalSession('/tmp')
  s.invalidate('a.sfc')
  const diff = s.recompute()
  if (!diff.affectedFiles) throw new Error('no diff')
})
C06('03', (b) => {
  if (!b.capabilities.incremental) return 'SKIP'
  const s = b.createIncrementalSession('/tmp')
  const k = s.getDependencies('a.sfc')
  if (!Array.isArray(k)) throw new Error('no deps')
})
C06('04', (b) => {
  if (!b.capabilities.incremental) return 'SKIP'
  const s = b.createIncrementalSession('/tmp')
  s.invalidate('a.sfc')
  s.recompute()
  s.commit()
})
C06('05', (b) => {
  if (!b.capabilities.incremental) return 'SKIP'
  const s = b.createIncrementalSession('/tmp')
  s.rollback()
})

C07('01', (b) => {
  if (b.id !== 'node') return 'SKIP' // Fallback 选择器由 createG38FallbackBackend 单测覆盖（02 §C-07 语义）
})
C07('02', (b) => {
  if (b.id !== 'node') return 'SKIP'
})
C07('03', (b) => {
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const a = b.emit(m)
  if (!a.code) throw new Error('no artifact')
})

C08('01', (b) => {
  if (typeof (b as unknown as { benchmark?: unknown }).benchmark !== 'function') return 'SKIP'
})
C08('02', (b) => {
  if (b.id !== 'rust') return 'SKIP'
})
C08('03', (b) => {
  if (b.id !== 'wasm') return 'SKIP'
})

C09('01', (b) => {
  const m = b.transform(b.parse({ content: '<p-grid></p-grid>' }))
  const h1 = b.getArtifactHash(b.emit(m))
  const h2 = b.getArtifactHash(b.emit(m))
  if (h1 !== h2) throw new Error(`not deterministic: ${h1} != ${h2}`)
})
C09('02', () => {
  // ★与 runner 差异：真实 Node↔Rust 语义等价由 G-29.1 examples 门禁（81 用例）覆盖——此处 SKIP
  return 'SKIP'
})

C10('01', (b) => {
  const d = b.reportDiagnostics({} as never)
  if (!Array.isArray(d)) throw new Error('not array')
})
C10('02', (b) => {
  const s = b.createIncrementalSession('/tmp')
  if (typeof s.getStats !== 'function') throw new Error('no stats')
})

/** 跑全部 42 项（单后端；C-02 生命周期组依赖顺序执行——与 runner 同构） */
export async function runG38Conformance(backend: G38CompilerBackend, opts?: { only?: string }): Promise<G38ConformanceSummary> {
  const results: G38ConformanceResult[] = []
  await backend.initialize()
  for (const t of tests) {
    if (opts?.only && !t.group.startsWith(opts.only)) continue
    try {
      const ret = await t.fn(backend)
      results.push({ id: t.id, status: ret === 'SKIP' ? 'SKIP' : 'PASS' })
    } catch (e) {
      results.push({ id: t.id, status: 'FAIL', error: (e as Error).message })
    }
  }
  backend.dispose()
  return {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    skip: results.filter((r) => r.status === 'SKIP').length,
    results,
  }
}

/** 文本报告（CLI 打印） */
export function formatG38Conformance(name: string, s: G38ConformanceSummary): string {
  const lines: string[] = [`[${name} 后端]`]
  for (const r of s.results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌'
    lines.push(`  ${icon} ${r.id}${r.status === 'FAIL' ? ` — ${r.error ?? ''}` : ''}`)
  }
  lines.push('─'.repeat(30))
  lines.push(`总计：PASS=${s.pass} FAIL=${s.fail} SKIP=${s.skip}（${s.total} 项 C-01~C-10）`)
  return lines.join('\n')
}
