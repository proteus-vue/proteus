// packages/compiler/src/vapor/static-instantiate.ts —— ★★★构建期静态实例化（批次 45 · App 壳落地）
//
// 【为什么需要（App 端无 Vue 运行时）】App 路径产物是**静态**节点树（内核建树、宿主自绘）——
//   模板里的 `v-if` / `v-for` / 插值 / `:class` 必须**构建期**求值，否则：
//   · `v-if` 分支**全部建盒**（实测：编译器不丢任何 v-if 分支）⇒ 默认隐藏的 chrome
//     （网络条/音乐条）会**错误显示**；
//   · 静态 `v-for`（如底部 Tab 栏 `v-for="t in tabRoutes"`）**不展开** ⇒ 只剩一个空项；
//   · 插值/`:class` 原样保留 ⇒ 文本空占位、条件类失效。
//   App 壳（App.vue 的 global/overlay 层）就是这么写的 ⇒ 单源落地 App 壳必须先有本能力。
//
// 【实现（构建期一次性求值，复用已知状态）】前置 **AST 变换**：用**已知初值**（`statics`）在
//   构建期求值表达式——折叠 `v-if`（真→保留、假→丢弃）、展开 `v-for`（数组 ⇒ 逐项克隆 + 作用域代入）、
//   折折可求值插值为静态文本、把 `:class`（对象/字符串）折进 `class`。变换后交给既有 `walk`。
//
// 【求值口径】刻意**不走**运行时表达式子集（`compileExpr` 只认白名单内建，业务函数如 `tabLabel(x)` 会被拒）——
//   构建期是在 Node 里跑**项目自己的模板表达式**（可信、且**只算一次**产出静态快照），故用
//   `new Function('$s','with($s){return (expr)}')` 直接按 JS 语义求值（覆盖业务函数/三元/对象等）。
//   任一名字未提供 ⇒ 求值抛 ReferenceError ⇒ 视为「不可静态求值」（不静默算错）。
//
// 【诚实边界（不静默半支持）】只折叠**可静态求值**的表达式：
//   · `v-if` 表达式不可求值 ⇒ **丢弃该分支 + 精确诊断**（不静默留半成品）；
//   · `v-for` 源不可静态求值 ⇒ **保留**既有运行时列表路径（不动）；
//   · 插值/`:class` 不可求值 ⇒ 保留（交既有运行时/内核路径）。
type Scope = Record<string, unknown>

interface AstNode {
  type: number
  [k: string]: unknown
}

export interface StaticInstantiateResult {
  ast: AstNode
  diagnostics: string[]
}

/** 表达式求值缓存（同一表达式字符串只编译一次 Function） */
const fnCache = new Map<string, ((s: unknown) => unknown) | null>()

/**
 * 构建期求值：`with(statics) { return (expr) }`。
 * 未提供名字 ⇒ ReferenceError ⇒ `ok:false`（不可静态求值，不静默算错）。
 */
function evalStatic(code: string, scope: Scope): { ok: boolean; value: unknown } {
  const src = code.trim()
  if (!src) return { ok: false, value: undefined }
  let fn = fnCache.get(src)
  if (fn === undefined) {
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('$s', `with($s){ return (${src}); }`) as (s: unknown) => unknown
    } catch {
      fn = null
    }
    fnCache.set(src, fn)
  }
  if (!fn) return { ok: false, value: undefined }
  try {
    return { ok: true, value: fn(scope) }
  } catch {
    return { ok: false, value: undefined }
  }
}

function dirOf(node: AstNode, name: string): { exp?: { content?: string } } | undefined {
  const props = (node.props as AstNode[] | undefined) ?? []
  return props.find((p) => p.type === 7 && p.name === name) as { exp?: { content?: string } } | undefined
}

/** 克隆元素并**去掉**某指令（+ 可选去掉某 `:bind` 参数） */
function stripped(node: AstNode, dropDir?: string, dropBindArg?: string): AstNode {
  const props = ((node.props as AstNode[] | undefined) ?? []).filter((p) => {
    if (dropDir && p.type === 7 && p.name === dropDir) return false
    if (dropBindArg && p.type === 7 && p.name === 'bind' && (p.arg as { content?: string })?.content === dropBindArg) return false
    return true
  })
  return { ...node, props }
}

/** 解析 `x in src` / `(x, i) in src` / `x of src` */
function parseFor(exp: string): { alias: string; index?: string; src: string } | null {
  const m = /^\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)?\s+(?:in|of)\s+([\s\S]+)$/.exec(exp.trim())
  if (!m) return null
  return { alias: m[1], index: m[2], src: m[3].trim() }
}

/** 把 `:class`（对象 `{on:cond}` / 数组 / 字符串 / 表达式）折进静态 `class` attribute；不可求值 ⇒ 原样保留 */
function foldClass(node: AstNode, scope: Scope): AstNode {
  const props = (node.props as AstNode[] | undefined) ?? []
  const dynIdx = props.findIndex(
    (p) => p.type === 7 && p.name === 'bind' && (p.arg as { content?: string })?.content === 'class',
  )
  if (dynIdx < 0) return node
  const e = evalStatic((props[dynIdx].exp as { content?: string })?.content ?? '', scope)
  if (!e.ok) return node
  const v = e.value
  const add: string[] = []
  if (typeof v === 'string') {
    if (v.trim()) add.push(v.trim())
  } else if (Array.isArray(v)) {
    for (const x of v) if (typeof x === 'string' && x.trim()) add.push(x.trim())
  } else if (v && typeof v === 'object') {
    for (const [k, on] of Object.entries(v as Record<string, unknown>)) if (on) add.push(k)
  }
  // 合并进既有静态 class
  const staticIdx = props.findIndex((p) => p.type === 6 && p.name === 'class')
  const staticCls = staticIdx >= 0 ? String((props[staticIdx].value as { content?: string })?.content ?? '') : ''
  const merged = [staticCls, ...add].map((s) => s.trim()).filter(Boolean).join(' ')
  const next = props.filter((_, i) => i !== dynIdx)
  const at = staticIdx >= 0 ? staticIdx : next.length
  if (merged) {
    // 覆盖/新增静态 class（注意 staticIdx 在过滤后可能位移：dynIdx < staticIdx 时前移一位）
    const si = staticIdx >= 0 ? (dynIdx < staticIdx ? staticIdx - 1 : staticIdx) : -1
    if (si >= 0) next[si] = { type: 6, name: 'class', value: { content: merged }, loc: props[0]?.loc }
    else next.splice(at, 0, { type: 6, name: 'class', value: { content: merged }, loc: props[0]?.loc })
  }
  return { ...node, props: next }
}

function transformChildren(children: AstNode[], scope: Scope, diags: string[]): AstNode[] {
  const out: AstNode[] = []
  for (const child of children) for (const n of transformNode(child, scope, diags)) out.push(n)
  return out
}

function transformNode(node: AstNode, scope: Scope, diags: string[]): AstNode[] {
  // 插值：可求值（原始值）⇒ 折成静态文本
  if (node.type === 5 /* INTERPOLATION */) {
    const code = (((node.content as { content?: string })?.content) ?? '').trim()
    if (!code) return []
    const e = evalStatic(code, scope)
    if (e.ok && (e.value == null || typeof e.value !== 'object')) {
      const text = e.value == null ? '' : String(e.value)
      return text ? [{ type: 2 /* TEXT */, content: text }] : []
    }
    return [node]
  }
  if (node.type !== 1 /* ELEMENT */) return [node]

  // ① v-for：源可静态求值（数组）⇒ 逐项克隆 + 作用域代入
  const forDir = dirOf(node, 'for')
  if (forDir?.exp?.content) {
    const parsed = parseFor(forDir.exp.content)
    if (parsed) {
      const e = evalStatic(parsed.src, scope)
      if (e.ok && Array.isArray(e.value)) {
        const base = stripped(node, 'for', 'key') // 静态展开后 :key 无意义
        const expanded: AstNode[] = []
        ;(e.value as unknown[]).forEach((item, i) => {
          const inner: Scope = { ...scope, [parsed.alias]: item }
          if (parsed.index) inner[parsed.index] = i
          for (const n of transformNode(base, inner, diags)) expanded.push(n)
        })
        return expanded
      }
      // src 不可求值 ⇒ 落到下面（保留既有运行时列表路径）
    }
  }

  // ② v-if：真 ⇒ 保留并剥离；假 ⇒ 丢弃；不可求值 ⇒ 丢弃 + 诊断
  const ifDir = dirOf(node, 'if')
  if (ifDir?.exp?.content) {
    const code = ifDir.exp.content.trim()
    const e = evalStatic(code, scope)
    if (e.ok) {
      if (!e.value) return []
      const s = stripped(node, 'if')
      return [{ ...foldClass(s, scope), children: transformChildren((s.children as AstNode[]) ?? [], scope, diags) }]
    }
    diags.push(`v-if="${code}" 不可构建期静态求值 ⇒ 已丢弃该分支（App 壳需可求值的条件；业务函数请预置到构建期状态）`)
    return []
  }

  // ③ 普通元素：折 :class + 递归子节点
  const folded = foldClass(node, scope)
  return [{ ...folded, children: transformChildren((folded.children as AstNode[]) ?? [], scope, diags) }]
}

/**
 * 对模板 AST 做构建期静态实例化。
 * @param ast vue compiler-dom 的 RootNode
 * @param statics 已知初值（应用构建期状态；名称 → 值，可含函数）。未提供的名称 ⇒ 不可求值。
 */
export function staticInstantiate(ast: AstNode, statics: Scope): StaticInstantiateResult {
  const diagnostics: string[] = []
  const children = transformChildren((ast.children as AstNode[]) ?? [], statics, diagnostics)
  return { ast: { ...ast, children }, diagnostics }
}
