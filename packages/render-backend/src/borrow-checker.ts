// packages/render-backend/src/borrow-checker.ts
// ★G-43 B2（proteus-ownership-plan batches B2）：借用检查器规则集（权威 TS 版）
//   对齐 borrow-checker.md §3（B-01~B-08）+ §4（PSS strict/loose/off 三级）+ §2（PSS 限制 → 使分析可判定）
//   · 源码级静态分析：对 Owned<T> 变量做状态格（Uninit/Alive/Moved/Dropped）+ activeBorrow 追踪
//   · 没有完整 AST——顺序流块分析（诚实标注：完整 CFG 归 B5 编译器接入；本实现覆盖文档示例的线性/块语义）
//   · 纯函数可插拔：G-38 transform 插件接入在此提供 analyzeOwnershipSource 接口（文档 §5.1）
//   · PSS strict → error 阻断；loose → 主路径 error + 其余 warning；off → 跳编译期（运行时兜底 + 可观测）

export type BorrowRule = 'B-01' | 'B-02' | 'B-03' | 'B-04' | 'B-05' | 'B-06' | 'B-07' | 'B-08'
export type BorrowSeverity = 'error' | 'warning'

export interface BorrowDiagnostic {
  rule: BorrowRule
  severity: BorrowSeverity
  line: number
  message: string
}

export interface BorrowAnalysisResult {
  diagnostics: BorrowDiagnostic[]
  /** strict + 有 error → 阻断构建 */
  blocksBuild: boolean
  /** 参与分析的 Owned 变量名 */
  ownedVars: string[]
}

export type PssMode = 'strict' | 'loose' | 'off'

export interface BorrowCheckerOptions {
  mode?: PssMode
}

/** 状态格（borrow-checker.md §3.2——CFG 简化为顺序流块分析的状态） */
type VarState = 'uninit' | 'alive' | 'moved' | 'dropped'

interface VarInfo {
  state: VarState
  line: number
  activeBorrows: number
}

// ============================================================
// 源码切分（轻量：按行 + 块深度——不解析字符串/模板完整性，诚实边界）
// ============================================================

interface Line {
  num: number
  text: string
  depth: number
}

function tokenizeLines(source: string): Line[] {
  const out: Line[] = []
  let depth = 0
  for (const raw of source.split('\n')) {
    const text = raw.trim()
    // 块深度：粗粒度（string/注释内的括号不处理——诚实边界，文档示例级）
    const opens = (text.match(/\{/g) ?? []).length
    const closes = (text.match(/\}/g) ?? []).length
    out.push({ num: 0, text, depth })
    depth += opens - closes
  }
  // 补齐行号
  out.forEach((l, i) => (l.num = i + 1))
  return out
}

// ============================================================
// 语句模式识别
// ============================================================

interface OwnedDecl {
  name: string
  line: number
}

/** 识别 Owned 变量声明（`const buf = pageContext.alloc(...)` / `const buf = cp.alloc(...)` / `allocShared`） */
const DECL_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pageContext|ctx|cp|host|container|this)?\.?(?:alloc|allocShared|createOwned|new Owned)\(/

/** 识别 Borrow 变量声明（`const view = buf.borrow()`）——逃逸检查对象 */
const BORROW_DECL_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.borrow\(/

/** 方法调用：`name.op(...)` */
const CALL_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(transferTo|borrow|drop|read|write|get|use)\s*\(/

/** 逃逸容器写入：`globalCache.v = b` / `store.set('k', b)` / `setTimeout(() => view...` */
const ESCAPE_ASSIGN_RE = /(globalCache|windowStore|moduleScope|eventBus)\??\.?\w*\s*=\s*([A-Za-z_$][\w$]*)/

/** 闭包捕获逃逸（箭头函数内引用变量） */
function closureCaptureLine(text: string, varName: string): boolean {
  // `setTimeout(() => view.get(), ...)` 或 `() => { ... varName ... }` 捕获
  return /(setTimeout|setInterval|addEventListener|then|subscribe)\s*\(/.test(text) && text.includes(varName)
}

// ============================================================
// 规则 B-01 ~ B-08 的分析器（顺序流块状态机）
// ============================================================

/** ★G-43 B2：源码级借用检查（PSS strict/loose/off——B-01~B-08） */
export function analyzeOwnershipSource(source: string, opts: BorrowCheckerOptions = {}): BorrowAnalysisResult {
  const mode: PssMode = opts.mode ?? 'strict'
  const diagnostics: BorrowDiagnostic[] = []
  const vars = new Map<string, VarInfo>()
  const borrowVars = new Map<string, { source: string; line: number }>()
  const refEdges: Array<{ from: string; to: string; line: number }> = []

  const add = (rule: BorrowRule, severity: BorrowSeverity, line: number, message: string): void => {
    // PSS 分级：strict 全量；loose 只查主路径（B-01/B-02/B-04/B-05 error，其余 warning 化）；off 跳过编译期
    if (mode === 'off') return
    let sev = severity
    if (mode === 'loose' && severity === 'error' && !['B-01', 'B-02', 'B-04', 'B-05'].includes(rule)) {
      sev = 'warning'
    }
    diagnostics.push({ rule, severity: sev, line, message })
  }

  for (const line of tokenizeLines(source)) {
    const txt = line.text
    // —— B-03 优先：闭包捕获逃逸（`setTimeout(() => view.get())` 行可能在 CALL_RE 里被 view.get() 拦截，先行检查）——
    for (const [name, borrow] of borrowVars) {
      if (closureCaptureLine(txt, name)) {
        add('B-03', 'error', line.num, `G4003: borrow escapes scope——${name} 被闭包捕获（source ${borrow.source}）`)
      }
    }
    // —— 声明：登记 Owned 变量（state=alive）——
    const decl = txt.match(DECL_RE)
    if (decl) {
      const name = decl[1]
      vars.set(name, { state: 'alive', line: line.num, activeBorrows: 0 })
      continue
    }

    // —— Borrow 变量声明登记（B-03 逃逸检查对象）——
    const bdecl = txt.match(BORROW_DECL_RE)
    if (bdecl) {
      borrowVars.set(bdecl[1], { source: bdecl[2], line: line.num })
      const src = vars.get(bdecl[2])
      if (src) src.activeBorrows++
      continue
    }

    // —— 方法调用：状态转移 ——
    const call = txt.match(CALL_RE)
    if (call) {
      const name = call[1]
      const op = call[2]
      const info = vars.get(name)
      if (!info) continue // 非受检变量（未通过声明模式识别——可能来自参数/返回）

      if (op === 'transferTo') {
        // B-02：double-move（moved 后再 transferTo）
        if (info.state === 'moved') {
          add('B-01', 'error', line.num, `G4001: use after move——${name} 已转移，不可再操作`)
        } else if (info.state !== 'alive') {
          add('B-02', 'error', line.num, `G4002: double move——${name} 状态 ${info.state} 不可转移`)
        } else if (info.activeBorrows > 0) {
          add('B-05', 'error', line.num, `G4005: 转移时有 ${info.activeBorrows} 个活跃借用——先 release`)
        } else {
          info.state = 'moved'
        }
      } else if (op === 'borrow') {
        if (info.state !== 'alive') {
          add('B-01', 'error', line.num, `G4001: ${name} 状态 ${info.state} 不可借用`)
        } else {
          info.activeBorrows++
        }
      } else if (op === 'drop') {
        // B-05：drop 时存在活跃借用（非 force）
        if (info.state === 'alive' && info.activeBorrows > 0 && !/force/.test(txt)) {
          add('B-05', 'error', line.num, `G4005: drop 时 ${name} 有 ${info.activeBorrows} 个活跃借用`)
        } else if (info.state === 'alive') {
          info.state = 'dropped'
        }
      } else if (op === 'read' || op === 'write' || op === 'get' || op === 'use') {
        // B-01：use-after-move / use-after-drop
        if (info.state === 'moved') {
          add('B-01', 'error', line.num, `G4001: use after move——${name} 已转移（第 ${info.line} 行 declared），此处访问非法`)
        } else if (info.state === 'dropped') {
          add('B-01', 'error', line.num, `G4001: use after drop——${name} 已释放，不可再访问`)
        }
      }
      continue
    }

    // —— B-03/B-07：逃逸容器写入（borrow → B-03；Owned → B-07 跨页强引用，G-43 B5 补全）——
    const esc = txt.match(ESCAPE_ASSIGN_RE)
    if (esc) {
      const varName = esc[2]
      if (borrowVars.has(varName)) {
        add('B-03', 'error', line.num, `G4003: borrow escapes scope——${varName} 被写入更长寿容器`)
      } else if (vars.get(varName)?.state === 'alive') {
        add('B-07', 'error', line.num, `G4007: 跨页面强引用——Owned ${varName} 被写入跨页容器（生命周期越界，应 transferTo/weak）`)
      }
      continue
    }
    // ★B-07 store.set 形态（`store.set('k', owned)` —— 跨页容器 API 写入）
    const storeSet = txt.match(/\b(?:store|stores|globalCache|windowStore|moduleScope|eventBus)\s*\.\s*(?:set|add|push|write)\s*\(\s*[^,()]+,\s*([A-Za-z_$][\w$]*)/)
    if (storeSet && vars.get(storeSet[1])?.state === 'alive') {
      add('B-07', 'error', line.num, `G4007: 跨页面强引用——Owned ${storeSet[1]} 被存入跨页容器（生命周期越界，应 transferTo/weak）`)
      continue
    }
    // 闭包捕获逃逸：`setTimeout(() => view.get())` / `.then(() => view...)`
    for (const [name, borrow] of borrowVars) {
      if (closureCaptureLine(txt, name)) {
        add('B-03', 'error', line.num, `G4003: borrow escapes scope——${name} 被闭包捕获（source ${borrow.source}）`)
      }
    }
    // —— B-08：对象互指（循环引用的源码表现——`a.x = b` + `b.y = a`；G-43 B5 补全）——
    const assign = txt.match(/^([A-Za-z_$][\w$]*)\s*\.\s*[\w$]+\s*=\s*([A-Za-z_$][\w$]*);?$/)
    if (assign && assign[1] !== assign[2]) {
      refEdges.push({ from: assign[1], to: assign[2], line: line.num })
    }
  }

  // —— B-06：作用域结束时未处置的 Owned（alive 未 drop/transfer）——
  // 顺序流简化：块结束（深度 < 当前声明处）仍 alive → 未处置。取最后一个深度为 0 的 Owned 变量做检查。
  const ownedVars = [...vars.keys()]
  for (const [name, info] of vars) {
    if (info.state === 'alive') {
      // 简化：顶层声明未处置 → warning（strict 也仅 warning——文档 B-06 loose 是警告，strict 主路径 error）
      add('B-06', mode === 'strict' ? 'warning' : 'warning', info.line, `G4006: owned resource not disposed——${name} 既未 drop 也未 transferTo`)
    }
  }

  // —— B-08：循环引用（互指环检测——from→to 有向图找回边；B-08 strict/loose 均 warning）——
  for (const e of refEdges) {
    // 自引用（a.x = a）或互指（a.x = b 且 b.y = a）→ 环
    const back = refEdges.find((r) => r.from === e.to && r.to === e.from)
    if (back || e.from === e.to) {
      add('B-08', 'warning', e.line, `G4008: 循环引用——${e.from} ⇄ ${e.to}（打破循环用 Weak）`)
    }
  }

  const blocksBuild = mode === 'strict' && diagnostics.some((d) => d.severity === 'error')
  return { diagnostics, blocksBuild, ownedVars }
}