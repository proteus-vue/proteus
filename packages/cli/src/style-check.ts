// packages/cli/src/style-check.ts
// G-31 style-safety B1：proteus style:check —— 扫描 .vue 模板 :style 绑定 → 白名单校验（08 §2 STS001-006）
// 编译期静态检查（--strict-style 默认开）：对象字面量键提取 + 白名单对照 + 静态值类型校验
// 动态源（标识符/三元等）→ STS006 提示（值由运行时 validateStyle 兜底，06）
import fs from 'node:fs'
import path from 'node:path'
import { ALLOWED_STYLE_PROPS, isValidStyleProp } from '@proteus-vue/runtime/style-safety'
import type { StylePlatform } from '@proteus-vue/runtime/style-safety'

export interface StyleCheckOptions {
  platform: StylePlatform
}

export interface StyleViolation {
  code: string // STS001-006
  prop: string
  value: string
  file: string
  line: number
  message: string
}

export interface StyleCheckResult {
  violations: StyleViolation[]
  /** 静态可校验项 / 动态源项（08 §3 stats.staticCoverage 数据源） */
  stats: { staticChecked: number; dynamic: number }
  ok: boolean
}

// :style 绑定提取：:style="..." 或 :style='...'（v-bind:style 同）；反向引用配对引号
// ★值内可含另一引号（:style="{ width: '10px' }"），[^"']* 会提前截断 → 用 \2 配对（组2 是引号，组1 是 style）
const STYLE_BINDING_RE = /(?::|v-bind:)(style)\s*=\s*(["'])([\s\S]*?)\2/g

/** 顶层逗号分割（括号/引号/模板串感知）——与 compiler/style.ts splitTopLevelSelectors 同模式 */
function splitTopLevel(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      cur += ch
      if (ch === quote && input[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 对象字面量 → [{ key, valueExpr, staticValue? }]；非对象字面量（变量/三元）返回 null */
function parseStyleObject(expr: string): Array<{ key: string; valueExpr: string; staticValue?: unknown }> | null {
  const trimmed = expr.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  const inner = trimmed.slice(1, -1)
  const props: Array<{ key: string; valueExpr: string; staticValue?: unknown }> = []
  for (const item of splitTopLevel(inner)) {
    const seg = item.trim()
    if (!seg) continue
    const colon = findTopLevelColon(seg)
    if (colon < 0) continue // 展开符 ...x 等跳过
    let key = seg.slice(0, colon).trim()
    // key 形态：标识符 / 'string' / "string" / [computed]（跳过）
    if (key.startsWith('[')) continue
    const keyStr = /^(['"])(.*)\1$/.exec(key)
    key = keyStr ? keyStr[2] : key
    // ★CSS 变量（--*）保持原样（Theme token，编译期展开）；普通键 kebab-case → camelCase 归一
    if (!key.startsWith('--')) {
      key = key.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
    }
    const valueExpr = seg.slice(colon + 1).trim()
    props.push({ key, valueExpr, staticValue: tryStaticValue(valueExpr) })
  }
  return props
}

function findTopLevelColon(s: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote && s[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ':' && depth === 0) return i
  }
  return -1
}

/** 静态字面量求值：字符串/数字/布尔/null → 值；否则 undefined（动态源） */
function tryStaticValue(expr: string): unknown | undefined {
  const t = expr.trim()
  if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) || (t.startsWith('"') && t.endsWith('"') && t.length >= 2)) {
    return t.slice(1, -1)
  }
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  return undefined
}

/** 单文件 :style 绑定校验 */
function checkVueFile(file: string, opts: StyleCheckOptions): StyleCheckResult {
  const source = fs.readFileSync(file, 'utf8')
  const violations: StyleViolation[] = []
  const stats = { staticChecked: 0, dynamic: 0 }
  const lines = source.split('\n')
  const rel = path.relative(process.cwd(), file)

  let m: RegExpExecArray | null
  STYLE_BINDING_RE.lastIndex = 0
  while ((m = STYLE_BINDING_RE.exec(source)) !== null) {
    const expr = m[3]
    const lineNo = source.slice(0, m.index).split('\n').length
    const props = parseStyleObject(expr)
    if (props === null) {
      // 动态源（变量 / 三元 / 函数调用）：STS006 提示，值由运行时 Validator 兜底
      stats.dynamic++
      violations.push({
        code: 'STS006',
        prop: ':style',
        value: expr,
        file: rel,
        line: lineNo,
        message: ':style 含动态源（运行时 validateStyle 校验兜底）',
      })
      continue
    }
    for (const { key, valueExpr, staticValue } of props) {
      // ★CSS 变量（--*）= Theme token（03 §2 允许：编译期展开为 CSS 变量，不走原生属性）→ 放行
      if (key.startsWith('--')) {
        stats.staticChecked++
        continue
      }
      // 动态值只查属性名（值运行时 validateStyle 兜底）；静态值额外查类型
      const kind = ALLOWED_STYLE_PROPS[key as keyof typeof ALLOWED_STYLE_PROPS]
      if (kind === undefined) {
        stats.dynamic++
        violations.push({ code: 'STS001', prop: key, value: valueExpr, file: rel, line: lineNo, message: describe('STS001', key, staticValue) })
        continue
      }
      if (kind === 'FORBIDDEN') {
        stats.staticChecked++
        violations.push({ code: 'STS004', prop: key, value: valueExpr, file: rel, line: lineNo, message: describe('STS004', key, staticValue) })
        continue
      }
      if (kind === 'SEMANTIC_ONLY') {
        stats.staticChecked++
        violations.push({ code: 'STS003', prop: key, value: valueExpr, file: rel, line: lineNo, message: describe('STS003', key, staticValue) })
        continue
      }
      if (staticValue !== undefined) {
        stats.staticChecked++
        if (!isValidStyleProp(key, staticValue, opts.platform)) {
          violations.push({ code: 'STS002', prop: key, value: valueExpr, file: rel, line: lineNo, message: describe('STS002', key, staticValue) })
        }
        continue
      }
      stats.dynamic++
    }
  }
  return { violations, stats, ok: violations.filter((v) => v.code !== 'STS006').length === 0 }
}

/** 按 08 §2 报错码归类（先精确语义，再回退白名单/类型） */
function detectCode(prop: string, staticValue: unknown): string {
  if (prop === 'backdropFilter' || prop === 'filter') return 'STS003'
  if (prop === 'display' || prop === 'float' || prop === 'clear' || prop === 'verticalAlign') return 'STS004'
  if (staticValue !== undefined) return 'STS002'
  return 'STS001'
}

/** 按 08 §2 报错码归类（先精确语义，再回退白名单/类型） */
function describe(code: string, prop: string, staticValue: unknown): string {
  switch (code) {
    case 'STS003':
      return `${prop} 必须用语义组件（→ <p-glass> / <p-filter>）`
    case 'STS004':
      return `${prop} 禁用（→ <p-flex> / <p-stack>）`
    case 'STS002':
      return `${prop} 静态值类型非法: ${String(staticValue)}`
    case 'STS001':
      return `${prop} 不在白名单（→ 改用 p-* 语义组件或白名单属性）`
    default:
      return `${prop} 待运行时校验`
  }
}

/** 扫描目录/文件（.vue） */
export function runStyleCheck(target: string, opts: StyleCheckOptions = { platform: 'web' }): StyleCheckResult {
  const files = collectVueFiles(target)
  if (!files.length) throw new Error(`未找到 .vue 文件：${target}`)
  const violations: StyleViolation[] = []
  const stats = { staticChecked: 0, dynamic: 0 }
  for (const f of files) {
    const r = checkVueFile(f, opts)
    violations.push(...r.violations)
    stats.staticChecked += r.stats.staticChecked
    stats.dynamic += r.stats.dynamic
  }
  return { violations, stats, ok: violations.filter((v) => v.code !== 'STS006').length === 0 }
}

function collectVueFiles(target: string, acc: string[] = []): string[] {
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.vue')) acc.push(target)
    return acc
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) collectVueFiles(full, acc)
    else if (entry.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

/** 文本报告（08 §3 报告 + 门禁） */
export function formatStyleCheck(result: StyleCheckResult): string {
  const lines: string[] = []
  lines.push(`[proteus-style] --strict-style 校验：违规 ${result.violations.filter((v) => v.code !== 'STS006').length} / 动态源提示 ${result.violations.filter((v) => v.code === 'STS006').length}`)
  for (const v of result.violations) {
    lines.push(`  ${v.code === 'STS006' ? '△' : '✗'} ${v.code} ${v.message}（${v.file}:${v.line}）`)
  }
  const total = result.stats.staticChecked + result.stats.dynamic
  const coverage = total > 0 ? (result.stats.staticChecked / total).toFixed(2) : '1.00'
  lines.push(`[proteus-style] 静态推导覆盖率 ${coverage}（static ${result.stats.staticChecked} / dynamic ${result.stats.dynamic}）`)
  return lines.join('\n')
}
