// packages/compiler/src/style-safety/index.ts
// G-31 style-safety B3：编译期 :style 静态分析（05 编译期推导 + 08 STS 报错码）
// 模板 :style 绑定 → 对象字面量解析 → 白名单校验（contracts 同源）+ 值可达性分类（reachability）
// 输出：违规列表（STS001-006）+ 静态推导覆盖率（05 §4 目标 > 80%）
import { STYLE_PROP_LEVELS } from '@proteus-vue/contracts/style'
import { deriveReachableValues } from './reachability'

export type StylePlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

export interface StyleBindingViolation {
  code: string // STS001-006
  prop: string
  value: string
  line: number
  message: string
}

export interface StyleBindingStats {
  staticChecked: number
  dynamic: number
  /** 静态推导覆盖率（05 §4：staticChecked / (staticChecked + dynamic)） */
  coverage: number
}

export interface StyleBindingAnalysis {
  violations: StyleBindingViolation[]
  stats: StyleBindingStats
}

// :style 绑定提取（反向引用配对引号：组1 style、组2 引号、组3 表达式）
const STYLE_BINDING_RE = /(?::|v-bind:)(style)\s*=\s*(["'])([\s\S]*?)\2/g

/** 顶层逗号分割（括号/引号感知） */
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
export function tryStaticValue(expr: string): unknown | undefined {
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

/** 对象字面量 → [{ key, valueExpr, staticValue? }]；非对象字面量返回 null */
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
    if (key.startsWith('[')) continue // computed key 跳过
    const keyStr = /^(['"])(.*)\1$/.exec(key)
    key = keyStr ? keyStr[2] : key
    // ★CSS 变量（--*）保持原样（Theme token）；普通键 kebab-case → camelCase 归一
    if (!key.startsWith('--')) {
      key = key.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
    }
    const valueExpr = seg.slice(colon + 1).trim()
    props.push({ key, valueExpr, staticValue: tryStaticValue(valueExpr) })
  }
  return props
}

/** 模板 :style 绑定分析（B3 主入口；scriptSource 提供常量表 → 常量折叠，05 §5） */
export function analyzeStyleBindings(templateSource: string, constants: Record<string, unknown> = {}): StyleBindingAnalysis {
  const violations: StyleBindingViolation[] = []
  let staticChecked = 0
  let dynamic = 0

  let m: RegExpExecArray | null
  STYLE_BINDING_RE.lastIndex = 0
  while ((m = STYLE_BINDING_RE.exec(templateSource)) !== null) {
    const expr = m[3]
    const line = templateSource.slice(0, m.index).split('\n').length
    const props = parseStyleObject(expr)
    if (props === null) {
      // 动态源（变量/三元/调用）：STS006 提示，值运行时 validateStyle 兜底
      dynamic++
      violations.push({ code: 'STS006', prop: ':style', value: expr, line, message: ':style 含动态源（运行时 validateStyle 校验兜底）' })
      continue
    }
    for (const { key, valueExpr, staticValue } of props) {
      // CSS 变量（--*）= Theme token（03 §2 允许）→ 放行；但动态值计入 dynamic（值运行时决定）
      if (key.startsWith('--')) {
        if (staticValue !== undefined) staticChecked++
        else dynamic++
        continue
      }
      const level = STYLE_PROP_LEVELS[key as keyof typeof STYLE_PROP_LEVELS]
      if (level === undefined) {
        dynamic++
        violations.push({ code: 'STS001', prop: key, value: valueExpr, line, message: `${key} 不在白名单（→ 改用 p-* 语义组件或白名单属性）` })
        continue
      }
      if (level === 'FORBIDDEN') {
        staticChecked++
        violations.push({ code: 'STS004', prop: key, value: valueExpr, line, message: `${key} 禁用（→ <p-flex> / <p-stack>）` })
        continue
      }
      if (level === 'SEMANTIC_ONLY') {
        staticChecked++
        violations.push({ code: 'STS003', prop: key, value: valueExpr, line, message: `${key} 必须用语义组件（→ <p-glass> / <p-filter>）` })
        continue
      }
      // ✅ 白名单直映射：静态字面量查类型（STS002）；动态值仅属性名已过（值运行时兜底）
      if (staticValue !== undefined) {
        staticChecked++
        if (!isStaticValueValid(level, staticValue)) {
          violations.push({ code: 'STS002', prop: key, value: valueExpr, line, message: `${key} 静态值类型非法: ${String(staticValue)}` })
        }
      } else {
        // 常量折叠（05 §5）：constants 表内标识符/简单表达式 → 折叠后仍静态
        const { isFullyStatic } = deriveReachableValues(valueExpr, constants)
        if (isFullyStatic) staticChecked++
        else dynamic++
      }
    }
  }

  const total = staticChecked + dynamic
  return { violations, stats: { staticChecked, dynamic, coverage: total > 0 ? staticChecked / total : 1 } }
}

/** 静态值类型校验（按 contracts 级别，与 runtime PROP_TYPES 同语义——编译期近似校验） */
function isStaticValueValid(level: string, value: unknown): boolean {
  switch (level) {
    case 'Length': {
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'string') return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rpx|rem|%)?$/.test(value.trim())
      return false
    }
    case 'Opacity':
      return typeof value === 'number' && value >= 0 && value <= 1
    case 'Integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'Color':
      return typeof value === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/i.test(value) || value === 'transparent' || value === 'inherit')
    case 'FlexNumber':
      return (typeof value === 'number' && Number.isFinite(value)) || value === 'auto'
    case 'FlexAlign':
      return ['flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'auto'].indexOf(String(value)) >= 0
    case 'FlexJustify':
      return ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'].indexOf(String(value)) >= 0
    case 'Transform':
      return typeof value === 'string' && /^(translate|scale|rotate|skew)/i.test(value)
    case 'TransformOrigin':
      return typeof value === 'string'
    default:
      return true
  }
}

export { deriveReachableValues } from './reachability'
export type { ReachableSet } from './reachability'
export { extractScriptConstants } from './constants'
