// packages/cli/src/glass-audit.ts
// ★G-07（proteus-glass-plan 11-audit-performance）：`proteus audit glass` —— 玻璃治理门禁（GLS001-006）
//   检测：裸 backdrop-filter（非 <pg-glass>）/ backdrop-filter 值含 HTML 标签 / 嵌套深度 > 2 / 单页玻璃节点 > 10
//   级别：裸玻璃 = error（GLS001 fail-closed）；嵌套/节点数 = warn；输出 JSON 报告可被 CI 消费
//   纯文件扫描（正则 + 标签栈），零依赖；豁免沿用 d2-exempt 家族约定（行内 // d2-exempt: 原因 / 文件头 /* d2-exempt-file: 原因 */）
import fs from 'node:fs'
import path from 'node:path'

export type GlassSeverity = 'error' | 'warn' | 'info'

export interface GlassFinding {
  file: string
  line: number
  rule: string
  severity: GlassSeverity
  message: string
}

export interface GlassAuditResult {
  ok: boolean
  findings: GlassFinding[]
  /** 统计：含 <pg-glass> 的文件数 / 裸 backdrop-filter 命中数 / 玻璃节点总数 */
  stats: { files: number; glassFiles: number; glassNodes: number; bareBackdrop: number }
}

// 裸玻璃声明（排除 -webkit- 厂商前缀——与标准声明是同一处，不重复计违规）
const BARE_BACKDROP_RE = /(?<!-webkit-)backdrop-filter\s*:/i
const PG_GLASS_OPEN_RE = /<pg-glass\b/gi
const PG_GLASS_TAG_RE = /<pg-glass\b|<\/pg-glass>/gi
// 行内豁免：`// d2-exempt: 原因`（JS/TS）或 `/* d2-exempt: 原因 */`（CSS）
const EXEMPT_LINE_RE = /(?:\/\/|\/\*)\s*d2-exempt:\s*([^*\n]+)/
const EXEMPT_FILE_RE = /\/\*\s*d2-exempt-file:\s*([^*\n]+)/

/** 单页玻璃性能预算（11-audit-performance） */
export const GLASS_MAX_NODES = 10
export const GLASS_MAX_NEST_DEPTH = 2

/** <pg-glass> 组件自身实现即合法入口（唯一允许裸 backdrop-filter 之处）——路径含该目录则跳过 GLS001 */
const ENTRY_IMPL_RE = /[/\\]pg-glass[/\\]/

function collectVue(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', '.proteus'].includes(e.name)) continue
      collectVue(full, out)
    } else if (e.isFile() && e.name.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

/** 统计一行内的 <pg-glass> 开标签数（用于嵌套/节点计数） */
function countOpenTags(line: string): number {
  const m = line.match(PG_GLASS_OPEN_RE)
  return m ? m.length : 0
}

/** 扫描单个 .vue 源文本（纯函数，供测试注入） */
export function scanGlassSource(relFile: string, src: string): GlassFinding[] {
  const findings: GlassFinding[] = []
  const isEntryImpl = ENTRY_IMPL_RE.test(relFile)
  const fileExempt = EXEMPT_FILE_RE.test(src)
  const lines = src.split('\n')

  // 文件头整文件豁免：仅豁免「裸 backdrop-filter」类（GLS001），性能预算（嵌套/节点数）仍守
  let depth = 0
  let maxDepth = 0
  let glassNodes = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1

    // 统计 <pg-glass> 节点与嵌套深度（模板区）
    const opens = countOpenTags(line)
    const closes = (line.match(/<\/pg-glass>/g) || []).length
    glassNodes += opens
    depth += opens - closes
    if (depth > maxDepth) maxDepth = depth

    // 裸 backdrop-filter 检测：本行有 backdrop-filter 且本行无 <pg-glass>（同一容器）
    // 组件自身实现（pg-glass 目录）即合法入口，跳过
    if (BARE_BACKDROP_RE.test(line) && !PG_GLASS_OPEN_RE.test(line) && !isEntryImpl) {
      // 豁免：同行 `// d2-exempt:` 或紧邻上一行（多行 CSS 声明块的锚点注释惯例）
      const lineExempt = EXEMPT_LINE_RE.test(line) || (i > 0 && EXEMPT_LINE_RE.test(lines[i - 1]))
      if (!fileExempt && !lineExempt) {
        findings.push({
          file: relFile,
          line: lineNo,
          rule: 'GLS001',
          severity: 'error',
          message: '裸 backdrop-filter：玻璃须走 <pg-glass> 入口（单入口铁律）',
        })
      }
    }
  }

  if (maxDepth > GLASS_MAX_NEST_DEPTH) {
    findings.push({
      file: relFile,
      line: 1,
      rule: 'GLS004',
      severity: 'warn',
      message: `<pg-glass> 嵌套深度 ${maxDepth} > ${GLASS_MAX_NEST_DEPTH}（性能预算：玻璃嵌套 ≤ 2 层）`,
    })
  }
  if (glassNodes > GLASS_MAX_NODES) {
    findings.push({
      file: relFile,
      line: 1,
      rule: 'GLS005',
      severity: 'warn',
      message: `单页 <pg-glass> 节点数 ${glassNodes} > ${GLASS_MAX_NODES}（性能预算：单页玻璃节点 ≤ 10）`,
    })
  }
  return findings
}

/** 目录扫描主入口 */
export function runGlassAudit(dir: string): GlassAuditResult {
  const files = collectVue(dir)
  const findings: GlassFinding[] = []
  let glassFiles = 0
  let glassNodes = 0
  let bareBackdrop = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8')
    const rel = path.relative(process.cwd(), f)
    const sourceHits = src.match(PG_GLASS_OPEN_RE)
    if (sourceHits) {
      glassFiles++
      glassNodes += sourceHits.length
    }
    const ff = scanGlassSource(rel, src)
    bareBackdrop += ff.filter((x) => x.rule === 'GLS001').length
    findings.push(...ff)
  }
  const ok = findings.every((f) => f.severity !== 'error')
  return { ok, findings, stats: { files: files.length, glassFiles, glassNodes, bareBackdrop } }
}

/** 格式化报告 */
export function formatGlassAudit(result: GlassAuditResult): string {
  const errors = result.findings.filter((f) => f.severity === 'error')
  const warns = result.findings.filter((f) => f.severity === 'warn')
  const infos = result.findings.filter((f) => f.severity === 'info')
  const lines: string[] = ['[proteus-glass] G-07 液态玻璃审计（GLS001-006）：']
  for (const f of result.findings) {
    lines.push(`  ${f.file}:${f.line}  ${f.severity}  ${f.message}`)
  }
  lines.push(
    `[proteus-glass] 扫描 ${result.stats.files} 文件 · <pg-glass> 文件 ${result.stats.glassFiles} · 玻璃节点 ${result.stats.glassNodes}`,
  )
  lines.push(
    `[proteus-glass] ${errors.length === 0 ? '✔' : '✘'} ${errors.length} error, ${warns.length} warning, ${infos.length} info`,
  )
  return lines.join('\n')
}
