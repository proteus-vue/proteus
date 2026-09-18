// packages/compiler/src/style-safety/reachability.ts
// G-31 style-safety B3：可达值集推导（05 §2 deriveReachableValues）
// 表达式字符串 → { values, isFullyStatic, dynamicSources }；纯函数零依赖
// 分类：Literal → 静态值；Identifier → 常量表折叠或动态；Conditional → union 两侧；
//       Binary（+ - * /）→ 两侧静态则折叠；其他（调用/成员/模板串）→ 动态
// ★与 CLI style-check 的轻量解析同风格（零 AST 依赖，字符串分类器）

export interface ReachableSet {
  values: unknown[]
  isFullyStatic: boolean
  dynamicSources: string[]
}

export const DYNAMIC_UNKNOWN = 'unknown'

const LITERAL_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/
const IDENT_RE = /^[A-Za-z_$][\w$]*$/

/** 顶层分割（括号/引号感知）：' + ' / ' ? : ' 分割用 */
function splitTopLevel(input: string, seps: string[]): string[] {
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
    if (depth === 0 && seps.indexOf(ch) >= 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 顶层定位分割符（返回第一个顶层 sep 的索引） */
function findTopLevel(input: string, seps: string[]): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote && input[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (depth === 0 && seps.indexOf(ch) >= 0) return i
  }
  return -1
}

function parseLiteral(s: string): unknown {
  if (LITERAL_RE.test(s)) return Number(s)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if ((s.startsWith("'") && s.endsWith("'") && s.length >= 2) || (s.startsWith('"') && s.endsWith('"') && s.length >= 2)) {
    return s.slice(1, -1)
  }
  return undefined
}

function dynamic(source: string): ReachableSet {
  return { values: [], isFullyStatic: false, dynamicSources: [source] }
}

/** 可达值集推导（05 §2）——expr 为 :style 值表达式字符串 */
export function deriveReachableValues(expr: string, constants: Record<string, unknown> = {}): ReachableSet {
  const t = expr.trim()
  if (!t) return dynamic(DYNAMIC_UNKNOWN)

  // Literal
  const lit = parseLiteral(t)
  if (lit !== undefined) return { values: [lit], isFullyStatic: true, dynamicSources: [] }

  // Identifier → 常量表折叠
  if (IDENT_RE.test(t)) {
    const v = constants[t]
    if (v !== undefined) return { values: [v], isFullyStatic: true, dynamicSources: [] }
    return dynamic(t)
  }

  // ConditionalExpression：cond ? a : b（顶层 ? 与 : 配对）
  const qIdx = findTopLevel(t, ['?'])
  if (qIdx >= 0) {
    const rest = t.slice(qIdx + 1)
    const colonIdx = findTopLevel(rest, [':'])
    if (colonIdx >= 0) {
      const a = deriveReachableValues(rest.slice(0, colonIdx), constants)
      const b = deriveReachableValues(rest.slice(colonIdx + 1), constants)
      return {
        values: a.values.concat(b.values),
        isFullyStatic: a.isFullyStatic && b.isFullyStatic,
        dynamicSources: a.dynamicSources.concat(b.dynamicSources),
      }
    }
  }

  // BinaryExpression：a + b / a - b / a * b / a / b（顶层）
  for (const op of ['+', '-', '*', '/'] as const) {
    const idx = findTopLevel(t, [op])
    if (idx <= 0 || idx >= t.length - 1) continue
    const left = deriveReachableValues(t.slice(0, idx), constants)
    const right = deriveReachableValues(t.slice(idx + 1), constants)
    if (left.isFullyStatic && right.isFullyStatic && left.values.length === 1 && right.values.length === 1) {
      const l = left.values[0]
      const r = right.values[0]
      if (typeof l === 'number' && typeof r === 'number') {
        const folded = op === '+' ? l + r : op === '-' ? l - r : op === '*' ? l * r : l / r
        if (Number.isFinite(folded)) return { values: [folded], isFullyStatic: true, dynamicSources: [] }
      }
    }
    return dynamic('binary')
  }

  // 成员/调用/其他 → 动态（保留原始表达式作为来源名）
  return dynamic(t)
}
