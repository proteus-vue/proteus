// packages/render-backend/src/pss.ts
// ★G-43 B5（proteus-ownership-plan batches B5）：PSS 编译器支持（权威 TS 版）
//   对齐 borrow-checker.md §2（PSS 三级 + P1~P9 限制）/ §5（编译器集成——transform 插件形态）/ §6（CMP071）：
//   · resolvePssMode：模块级声明解析（文件头 pragma `@proteus-pss: strict|loose|off`——渐进采用 §7.1）
//   · analyzePss：P1~P9 限制检测（strict 全量 error / loose 仅 P1+P2 主路径 / off 跳过）+ CMP071 ref(Owned) 拦截
//     （P6 跨页容器写入由 B-07 承接——同一违规的规则面，避免双报）
//   · insertScopeDrops：作用域级自动 drop 插入（strict 验收「业务不写 drop 也能正确释放」——
//     函数作用域内未处置 Owned 在函数闭合前插入 drop()；模块级资源不插——生命周期同应用）
//   · runPss：管线组合（analyzeOwnershipSource B-01~B-08 + analyzePss + autoDrop + blocksBuild）
//   源码级轻量分析（同 B2 诚实边界：行级顺序流，无完整 AST/CFG——IR 级插入归 G-38 后续）
import { analyzeOwnershipSource } from './borrow-checker'
import type { BorrowDiagnostic, BorrowSeverity, PssMode } from './borrow-checker'

export type PssRule = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'CMP071'

export interface PssDiagnostic {
  rule: PssRule
  severity: BorrowSeverity
  line: number
  message: string
}

export interface PssAnalysisResult {
  diagnostics: PssDiagnostic[]
  /** 声明的 PSS 模式（pragma 覆盖后） */
  mode: PssMode
}

// ============================================================
// 模块级 PSS 声明（渐进采用——文件头 pragma）
// ============================================================

const PSS_PRAGMA_RE = /@proteus-pss\s*[:=]?\s*(strict|loose|off)/i

/** ★G-43 B5：解析模块级 PSS 声明（文件头 pragma `@proteus-pss: strict`；未声明 → fallback） */
export function resolvePssMode(source: string, fallback: PssMode = 'off'): PssMode {
  // 只看文件头 20 行（pragma 惯例置顶）
  const head = source.split('\n', 20).join('\n')
  const m = head.match(PSS_PRAGMA_RE)
  return (m?.[1]?.toLowerCase() as PssMode | undefined) ?? fallback
}

// ============================================================
// P1~P9 限制检测（strict 全量 / loose 仅 P1+P2 主路径）
// ============================================================

/** 与 owned 变量无关的静态限制（行级模式——loose 只查 P1/P2） */
interface StaticPssRule {
  rule: Exclude<PssRule, 'P5' | 'P6' | 'P7' | 'CMP071'>
  re: RegExp
  loose: boolean
  message: string
}

const STATIC_PSS_RULES: StaticPssRule[] = [
  // P1 禁 any/unknown（类型不可推导——borrow-checker.md §2.1）
  { rule: 'P1', re: /:\s*(?:any|unknown)\b|\bas\s+(?:any|unknown)\b|<(?:any|unknown)>/, loose: true, message: 'G4011: PSS 禁用 any/unknown——类型不可推导，所有权分析失效' },
  // P2 动态属性写入（`obj[keyVar] =`——字符串字面量键放行；布局不稳定）
  { rule: 'P2', re: /\[[A-Za-z_$][\w$]*\]\s*=\s/, loose: true, message: 'G4012: PSS 禁用动态属性写入——对象形状不可静态推导' },
  // P3 delete（破坏所有权登记）
  { rule: 'P3', re: /\bdelete\s+[A-Za-z_$][\w$]*/, loose: false, message: 'G4013: PSS 禁用 delete 操作符——破坏所有权登记' },
  // P4 eval / new Function（完全不可分析）
  { rule: 'P4', re: /\beval\s*\(|\bnew\s+Function\s*\(/, loose: false, message: 'G4014: PSS 禁用 eval/new Function——代码完全不可分析' },
  // P8 with（作用域动态）
  { rule: 'P8', re: /\bwith\s*\(/, loose: false, message: 'G4018: PSS 禁用 with 语句——作用域动态不可分析' },
  // P9 原型链动态修改（破坏类型契约）
  { rule: 'P9', re: /\.\s*prototype\s*\.\s*[\w$]+\s*=\s/, loose: false, message: 'G4019: PSS 禁用原型链动态修改——破坏类型契约' },
]

/** 闭包捕获行（同 borrow-checker closureCaptureLine 形态——setTimeout/then 等更长寿执行体） */
function closureCaptureLine(text: string, varName: string): boolean {
  return /(setTimeout|setInterval|addEventListener|then|subscribe|queueMicrotask)\s*\(/.test(text) && text.includes(varName)
}

export interface PssAnalysisOptions {
  mode?: PssMode
  /** 已分析的 Owned 变量（缺省内部调 analyzeOwnershipSource 获取） */
  ownedVars?: string[]
}

/** ★G-43 B5：P1~P9 限制检测 + CMP071 ref(Owned) 拦截 */
export function analyzePss(source: string, opts: PssAnalysisOptions = {}): PssAnalysisResult {
  const mode = opts.mode ?? resolvePssMode(source)
  const diagnostics: PssDiagnostic[] = []
  if (mode === 'off') return { diagnostics, mode }

  const ownedVars = opts.ownedVars ?? analyzeOwnershipSource(source, { mode }).ownedVars
  const ownedSet = new Set(ownedVars)

  const add = (rule: PssRule, severity: BorrowSeverity, line: number, message: string): void => {
    diagnostics.push({ rule, severity, line, message })
  }

  const lines = source.split('\n')
  lines.forEach((raw, i) => {
    const txt = raw.trim()
    const line = i + 1
    // 注释行跳过（`//` 前缀——轻量去噪，块注释不处理为诚实边界）
    if (txt.startsWith('//') || txt.startsWith('*') || txt.startsWith('/*')) return

    // —— P1~P4/P8/P9 静态限制（loose 仅 P1/P2——文档 §2.2）——
    for (const r of STATIC_PSS_RULES) {
      if (r.re.test(txt) && (mode === 'strict' || r.loose)) {
        add(r.rule, 'error', line, r.message)
      }
    }

    // —— P5：Owned 逃逸到全局（globalThis/window/global/self 属性赋值右侧为 owned 变量）——
    const globalAssign = txt.match(/(?:globalThis|window|global|self)\s*\.\s*[\w$]+\s*=\s*([A-Za-z_$][\w$]*)/)
    if (globalAssign && ownedSet.has(globalAssign[1])) {
      add('P5', 'error', line, `G4015: Owned ${globalAssign[1]} 逃逸到全局——所有权脱离作用域（strict 禁止）`)
    }

    // —— P6：Owned 存入跨页面 store——由 B-07 承接（borrow-checker G4007 同一违规的规则面）——
    // 此处不重复检测（见文件头注记）

    // —— P7：闭包捕获 Owned（作用域不可控）——
    for (const name of ownedSet) {
      if (closureCaptureLine(txt, name)) {
        add('P7', 'error', line, `G4017: 闭包捕获 Owned ${name}——作用域不可控，应显式 transferTo 或 drop`)
      }
    }

    // —— CMP071：Owned 禁止 ref/reactive 包装（Proxy 破坏所有权语义）——
    const refWrap = txt.match(/\b(?:ref|reactive|shallowRef|readonly)\s*\(\s*([A-Za-z_$][\w$]*)/)
    if (refWrap && ownedSet.has(refWrap[1])) {
      add('CMP071', mode === 'strict' ? 'error' : 'warning', line, `CMP071: ${refWrap[1]}（Owned）被 ref/reactive 包装——Proxy 破坏所有权语义，改用 useOwned()（响应式元信息）`)
    }
  })

  return { diagnostics, mode }
}

// ============================================================
// 作用域级自动 drop 插入（strict「业务不写 drop 也能正确释放」）
// ============================================================

export interface ScopeDropInsertion {
  readonly varName: string
  /** drop 语句插入后所在行号（1-based） */
  readonly line: number
}

export interface ScopeDropResult {
  /** 插入后的源码（无插入 = 原样） */
  readonly code: string
  readonly insertions: ScopeDropInsertion[]
}

interface PendingOwned {
  varName: string
  declDepth: number
  declLine: number
  indent: string
  disposed: boolean
}

/** ★G-43 B5：作用域级自动 drop 插入——函数内未处置的 Owned 在函数闭合前插入 `<var>.drop()` */
export function insertScopeDrops(source: string): ScopeDropResult {
  const rawLines = source.split('\n')
  // 行前深度（同 borrow-checker tokenizeLines）
  const depths: number[] = []
  let depth = 0
  for (const raw of rawLines) {
    depths.push(depth)
    const t = raw.trim()
    depth += (t.match(/\{/g) ?? []).length - (t.match(/\}/g) ?? []).length
  }

  const pending = new Set<PendingOwned>()
  const insertionsByLine = new Map<number, PendingOwned[]>() // 闭合行号 → 该作用域未处置 owned（按声明序）

  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim()
    const d = depths[i]
    const line = i + 1

    const decl = t.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pageContext|ctx|cp|host|container|this)?\.?(?:alloc|allocShared|createOwned|new Owned)\(/)
    if (decl) {
      if (d > 0) {
        const indent = rawLines[i].match(/^\s*/)?.[0] ?? ''
        pending.add({ varName: decl[1], declDepth: d, declLine: line, indent, disposed: false })
      }
      continue
    }

    // 处置标记（drop/transferTo——同变量名任意后续处置调用）
    const call = t.match(/([A-Za-z_$][\w$]*)\s*\.\s*(?:drop|transferTo)\s*\(/)
    if (call) {
      for (const p of pending) {
        if (p.varName === call[1] && !p.disposed) {
          p.disposed = true
          break
        }
      }
    }

    // 作用域闭合：行含 '}' 且行前深度 === 某未闭合声明的作用域深度 → 该函数在此行结束
    if (t.includes('}')) {
      for (const p of [...pending]) {
        if (p.declDepth === d) {
          // 函数闭合行——未处置的插入 drop
          if (!p.disposed) {
            const list = insertionsByLine.get(line) ?? []
            list.push(p)
            insertionsByLine.set(line, list)
          }
          pending.delete(p)
        }
      }
    }
  }

  // 重建源码（倒序插入防行号位移；同闭合行多条按声明序正序插入）
  const insertions: ScopeDropInsertion[] = []
  const outLines = [...rawLines]
  const closeLines = [...insertionsByLine.keys()].sort((a, b) => b - a)
  for (const closeLine of closeLines) {
    const items = insertionsByLine.get(closeLine)!
    const stmts = items.map((p) => {
      insertions.push({ varName: p.varName, line: closeLine })
      return `${p.indent}  ${p.varName}.drop()`
    })
    outLines.splice(closeLine - 1, 0, ...stmts)
  }
  // insertions 行号：多闭合行倒序插入后，靠前闭合行的插入位置不受影响（其行号 < 后插入区）——但同一行多条共享行号
  return { code: outLines.join('\n'), insertions }
}

// ============================================================
// 管线组合（borrow-checker.md §5.1 transform 插件形态——源码级等价）
// ============================================================

export interface PssPipelineOptions {
  /** 全局缺省模式（文件头 pragma 可覆盖；缺省 off——渐进采用 §7.1 存量默认） */
  mode?: PssMode
  /** strict 自动 drop 插入（缺省 true——「业务不写 drop 也能正确释放」） */
  autoDrop?: boolean
}

export interface PssPipelineResult {
  /** 生效模式（pragma 覆盖后） */
  mode: PssMode
  /** B 规则（B-01~B-08）+ P 限制（P1~P9/CMP071）诊断合集 */
  diagnostics: Array<BorrowDiagnostic | PssDiagnostic>
  /** strict + 有 error → 阻断构建 */
  blocksBuild: boolean
  ownedVars: string[]
  /** autoDrop 后的源码（无插入 = 原样；off 模式 = 原样） */
  code: string
  insertions: ScopeDropInsertion[]
}

/** ★G-43 B5：PSS 管线——B 规则 + P 限制 + 自动 drop 一次跑齐（编译管线在 parse 前调用的独立步骤） */
export function runPss(source: string, opts: PssPipelineOptions = {}): PssPipelineResult {
  const mode = resolvePssMode(source, opts.mode ?? 'off')
  const autoDrop = opts.autoDrop ?? true
  if (mode === 'off') {
    return { mode, diagnostics: [], blocksBuild: false, ownedVars: [], code: source, insertions: [] }
  }

  const borrow = analyzeOwnershipSource(source, { mode })
  const pss = analyzePss(source, { mode, ownedVars: borrow.ownedVars })
  const diagnostics = [...borrow.diagnostics, ...pss.diagnostics]

  let code = source
  let insertions: ScopeDropInsertion[] = []
  if (autoDrop) {
    const r = insertScopeDrops(source)
    code = r.code
    insertions = r.insertions
  }

  const blocksBuild = mode === 'strict' && diagnostics.some((d) => d.severity === 'error')
  return { mode, diagnostics, blocksBuild, ownedVars: borrow.ownedVars, code, insertions }
}
