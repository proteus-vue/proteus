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

/** 抽取表达式里的标识符 token（判"是否引用运行时源"用——粗粒度：属性名也算，宁可多保留不可错折） */
function identTokens(expr: string): string[] {
  const out: string[] = []
  for (const m of expr.matchAll(/[A-Za-z_$][\w$]*/g)) out.push(m[0])
  return out
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

function transformChildren(children: AstNode[], scope: Scope, diags: string[], rt: ReadonlySet<string> | undefined): AstNode[] {
  const out: AstNode[] = []
  for (const child of children) for (const n of transformNode(child, scope, diags, rt)) out.push(n)
  return out
}

/**
 * ★★★决策 #899：把**可静态求值的标量绑定**折成静态属性——`:preset="p"`（`p` 由 v-for 作用域/常量给定）
 *   ⇒ `preset="card"`。**为什么必须**：静态 v-for 展开后，循环体仍是"绑定表达式"（`:preset="p"`），
 *   而下游**静态消费方**（如玻璃 `glassResolver` 的 `strProp`、图标解析器）**只认字面量** ⇒ 读不到值、
 *   回落默认（真机实测：`<pg-glass v-for="p in presets" :preset="p">` 两节点都渲染成 custom 默认，非 card/modal）。
 *   ⇒ 这是 `:class` 折入（既有）的**同族泛化**：`:class` 只是"绑定 prop"里的一种，其余标量绑定同理可折。
 *   仅折 **primitive**（string/number/boolean）；object/array 保持绑定（转静态串会丢失类型，交既有路径）。
 */
function foldScalarBinds(node: AstNode, scope: Scope): AstNode {
  const props = (node.props as AstNode[] | undefined) ?? []
  let changed = false
  const next = props.map((p) => {
    if (p.type !== 7 || p.name !== 'bind') return p
    const arg = (p.arg as { content?: string } | undefined)?.content
    if (!arg || arg === 'class' || arg === 'style') return p   // class 归 foldClass；style 太复杂（对象/数组）
    const code = (p.exp as { content?: string } | undefined)?.content ?? ''
    const e = evalStatic(code, scope)
    if (!e.ok) return p
    const v = e.value
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      changed = true
      return { type: 6 as const, name: arg, value: { content: String(v) }, loc: p.loc } as AstNode
    }
    return p
  })
  return changed ? { ...node, props: next } : node
}

function transformNode(node: AstNode, scope: Scope, diags: string[], rt: ReadonlySet<string> | undefined): AstNode[] {
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
      // ★★★运行时列表（2026-10-13）：源为响应式源 => 不静态展开，保留 v-for 交运行期列表路径
      //   （子树整块不动——行内插值/动态 class/v-if/handler 全由订阅表+运行期驱动；台账 A1/B1/B2 同源墙）。
      if (rt && rt.has(parsed.src.split('.')[0]!.trim())) return [node]
      const e = evalStatic(parsed.src, scope)
      if (e.ok && Array.isArray(e.value)) {
        const base = stripped(node, 'for', 'key') // 静态展开后 :key 无意义
        const expanded: AstNode[] = []
        ;(e.value as unknown[]).forEach((item, i) => {
          const inner: Scope = { ...scope, [parsed.alias]: item }
          if (parsed.index) inner[parsed.index] = i
          for (const n of transformNode(base, inner, diags, rt)) expanded.push(n)
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
    // ★★★运行时条件（2026-10-13）：条件式引用响应式源 => 保留节点（运行期 visibility 槽位切换可见性），
    //   不静态折死（折死 => 运行期翻不回来，正是"编译折叠 vs 运行时"的墙）。
    if (rt && identTokens(code).some((t) => rt.has(t))) {
      const sIf = stripped(node, 'if')
      return [{ ...foldScalarBinds(foldClass(sIf, scope), scope), children: transformChildren((sIf.children as AstNode[]) ?? [], scope, diags, rt) }]
    }
    const e = evalStatic(code, scope)
    if (e.ok) {
      if (!e.value) return []
      const s = stripped(node, 'if')
      return [{ ...foldScalarBinds(foldClass(s, scope), scope), children: transformChildren((s.children as AstNode[]) ?? [], scope, diags, rt) }]
    }
    diags.push(`v-if="${code}" 不可构建期静态求值 ⇒ 已丢弃该分支（App 壳需可求值的条件；业务函数请预置到构建期状态）`)
    return []
  }

  // ③ 普通元素：折 :class + 折标量绑定 + 递归子节点
  const folded = foldScalarBinds(foldClass(node, scope), scope)
  return [{ ...folded, children: transformChildren((folded.children as AstNode[]) ?? [], scope, diags, rt) }]
}

/**
 * 对模板 AST 做构建期静态实例化。
 * @param ast vue compiler-dom 的 RootNode
 * @param statics 已知初值（应用构建期状态；名称 → 值，可含函数）。未提供的名称 ⇒ 不可求值。
 */
export function staticInstantiate(
  ast: AstNode,
  statics: Scope,
  opts?: { runtimeSources?: ReadonlySet<string> },
): StaticInstantiateResult {
  const diagnostics: string[] = []
  const rt = opts?.runtimeSources
  const children = transformChildren((ast.children as AstNode[]) ?? [], statics, diagnostics, rt)
  return { ast: { ...ast, children }, diagnostics }
}
