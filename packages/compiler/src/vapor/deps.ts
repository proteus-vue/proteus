// packages/compiler/src/vapor/deps.ts
// Vapor for Proteus IR · V2 Step 2 —— **模板表达式依赖分析**（方案 §4.3 Step 2）
//
// 【要解决什么】对每个动态绑定，求出它引用了哪些响应式源：
//   `:class="{ active: isActive }"` → 依赖 { isActive }
//   `{{ item.name }}`               → 依赖 { item }（列表内为**相对路径** item.name）
//
// 【为什么用 @vue/compiler-dom 的 AST 而不是正则扫模板】
//   模板表达式里 identifier 的边界极易判错（字符串字面量里的同名文本、属性名、
//   `?.` 可选链、模板字符串插值、解构……）。误判会**多订或漏订**源：
//   漏订 = UI 静默不更新（方案 §5.6 说的最危险失效模式）。
//   ⇒ 用官方 parser 拿到结构化 AST，只在其上判「哪些是表达式 / 哪些是字面量」。
//
// 【列表内的相对路径】`v-for="item in list"` 内的表达式引用 `item.xxx` 时，
//   依赖的是**列表项字段**而非顶层源 ⇒ 归属该列表的 `itemKey` 语义（V1 的 LIST_UPDATE 承接）。
//   本模块把这类依赖单独标注（`listRelative`），供 Step 3 建图时区分。
import { parse as domParse } from '@vue/compiler-dom'
import type { VueCompatDeps } from './sources'
import { parse as babelParse } from '@babel/parser'
import type { ReactiveSource } from './sources'

/** 表达式的依赖分析结果 */
export interface ExprDeps {
  /** 直接引用的顶层源名（与 sources 求交后即为真实依赖） */
  roots: string[]
  /** 引用中未被识别为响应式源的标识符（可能是全局/工具函数——用于 C1 纯函数判定与诊断） */
  unknown: string[]
  /** ★列表内的相对路径依赖（v-for 作用域变量及其属性访问） */
  listRelative: Array<{ scope: string; path: string }>
  /** 表达式里是否出现函数调用（C1 纯函数判定的输入之一） */
  hasCall: boolean
  /** 表达式里出现的调用名（诊断：`fmt(...)` → 需要 @proteus-pure 才可升级） */
  calls: string[]
  /** 解析失败（保守：调用方必须判 L0，不许假设安全） */
  parseFailed: boolean
}

const EMPTY_DEPS: ExprDeps = { roots: [], unknown: [], listRelative: [], hasCall: false, calls: [], parseFailed: false }

/** JS 内置与常见全局（出现即不算「未识别的源」，避免诊断噪音） */
const KNOWN_GLOBALS = new Set([
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'console',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'null', 'true', 'false',
  'Intl', 'RegExp', 'Map', 'Set', 'Promise', 'Symbol', 'BigInt', 'Error',
])

/**
 * 分析单个模板表达式的依赖（V2 Step 2）
 *
 * @param code   表达式源码（如 `isActive ? 'a' : 'b'`）
 * @param scopes v-for / v-slot 引入的**作用域变量**（这些名字不是顶层源）
 */
export function analyzeExprDeps(code: string, scopes: string[] = []): ExprDeps {
  const src = code.trim()
  if (!src) return { ...EMPTY_DEPS }

  let ast: unknown
  try {
    ast = babelParse(`(${src})`, { sourceType: 'module', plugins: ['typescript'] })
  } catch {
    // 也可能是**语句**形态（如事件内联体）——再试一次；仍失败则保守判失败
    try {
      ast = babelParse(src, { sourceType: 'module', plugins: ['typescript'] })
    } catch {
      return { ...EMPTY_DEPS, parseFailed: true }
    }
  }
  return analyzeAstDeps(ast, scopes)
}

/** 从已解析的 AST 提取依赖（★同一个 AST 可复用——步骤间不重复解析） */
export function analyzeAstDeps(ast: unknown, scopes: string[] = []): ExprDeps {
  const roots = new Set<string>()
  const unknown = new Set<string>()
  const listRelative: Array<{ scope: string; path: string }> = []
  const calls = new Set<string>()
  const scopeSet = new Set(scopes)
  // 收集过程中记录「每个标识符的父节点」以便判断是否属性键 / 是否调用
  const declared = new Set<string>() // 局部声明（回调参数等）——不算源
  let sawDecl = false

  interface Node {
    type: string
    [k: string]: unknown
  }

  /** 是否为属性访问的**非计算**键（`a.b` 里的 b 不是独立标识符） */
  const isPropKey = (parent: Node | undefined, child: Node): boolean => {
    if (!parent) return false
    if (parent.type === 'MemberExpression' && parent.property === child && !parent.computed) return true
    if (parent.type === 'ObjectProperty' && parent.key === child && !parent.computed) return true
    return false
  }

  /**
   * 记录局部声明（函数参数、解构、变量声明）——这些名字在表达式内部是**局部**的，
   * 不能算作响应式源。（漏掉会让 `arr.map(item => item.x)` 把 item 误认成源）
   */
  const collectPattern = (pat: Node | null | undefined): void => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier':
        declared.add(pat.name as string)
        sawDecl = true
        break
      case 'ObjectPattern':
        for (const p of (pat.properties as Node[]) ?? []) collectPattern((p.value ?? p.argument) as Node)
        break
      case 'ArrayPattern':
        for (const el of (pat.elements as Node[]) ?? []) collectPattern(el)
        break
      case 'AssignmentPattern':
        collectPattern(pat.left as Node)
        break
      case 'RestElement':
        collectPattern(pat.argument as Node)
        break
      default:
        break
    }
  }

  const walk = (node: unknown, parent?: Node): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) walk(n, parent)
      return
    }
    const n = node as Node
    if (typeof n.type !== 'string') return

    switch (n.type) {
      case 'Identifier': {
        if (isPropKey(parent, n)) return
        const name = n.name as string
        // 调用名：父是 CallExpression 的 callee ⇒ 计入 calls（C1 判定用）
        if (parent?.type === 'CallExpression' && parent.callee === n) calls.add(name)
        if (declared.has(name) || scopeSet.has(name)) return
        if (KNOWN_GLOBALS.has(name)) return
        // 顶层/成员表达式的**根部**才计入 roots；属性键已在上面排除
        if (parent?.type === 'MemberExpression' && parent.object !== n && !parent.computed) return
        roots.add(name)
        return
      }
      case 'MemberExpression': {
        // ★完整路径（供列表内相对路径诊断）：取非计算链
        const path = memberPath(n)
        if (path) {
          const [head, ...rest] = path.split('.')
          if (scopeSet.has(head) && rest.length > 0) listRelative.push({ scope: head, path })
        }
        walk(n.object as Node, n)
        if (n.computed) walk(n.property as Node, n)
        // 非计算属性键**不遍历**（它不是独立标识符）
        return
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        for (const p of (n.params as Node[]) ?? []) collectPattern(p)
        // 函数体在**新作用域**里遍历（declared 已含参数）
        walk(n.body as Node, n)
        return
      }
      case 'VariableDeclarator':
        walk(n.init as Node, n)
        collectPattern(n.id as Node)
        return
      case 'CallExpression': {
        walk(n.callee as Node, n)
        for (const a of (n.arguments as Node[]) ?? []) walk(a, n)
        return
      }
      case 'TemplateLiteral': {
        for (const e of (n.expressions as Node[]) ?? []) walk(e, n)
        return
      }
      default: {
        for (const k of Object.keys(n)) {
          if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
          const v = n[k]
          if (v && typeof v === 'object') walk(v, n)
        }
        return
      }
    }
  }

  walk(ast)
  void sawDecl

  // 「未识别的标识符」：既不是源、又不是已知全局、又不是局部/作用域变量的名字——
  // 由调用方与 sources 求交后再定；这里先给 roots 全集（调用方拿 byName 过滤）
  return {
    roots: [...roots],
    unknown: [...unknown],
    listRelative,
    hasCall: calls.size > 0,
    calls: [...calls],
    parseFailed: false,
  }
}

/** 取成员链路径（`a.b.c` → 'a.b.c'；含计算属性返回 null——路径不静态） */
function memberPath(node: { type: string; object?: unknown; property?: unknown; computed?: boolean }): string | null {
  if (node.type !== 'MemberExpression') {
    if (node.type === 'Identifier') return (node as unknown as { name: string }).name
    return null
  }
  const objPath = memberPath(node.object as never)
  if (objPath === null) return null
  if (node.computed) return null
  const prop = node.property as { type: string; name?: string } | undefined
  if (!prop || prop.type !== 'Identifier' || !prop.name) return null
  return `${objPath}.${prop.name}`
}

/* ────────────────────────── 模板遍历：收集全部动态表达式 ────────────────────────── */

/** 模板里的一处动态绑定 */
export interface TemplateBindingRef {
  /** 表达式源码 */
  code: string
  /** 来源描述（诊断：`<p-view :style>` / 插值 / `v-if` …） */
  where: string
  /** 目标 propKey 的归一化名（与 component-ir 的 propKey 对齐；插值为 text.content） */
  propKey: string
  /** 该表达式所处的 v-for 作用域变量栈（自外向内） */
  scopes: string[]
  /**
   * ★v-for 上下文（该绑定位于某个 v-for 行模板内时才有）
   *
   * 【为什么必须有（本仓实测的功能缺口）】v-for 内的绑定（如 `{{ item.title }}`）
   *   若按普通槽位产出，它的 `nodeId` 是**模板级**的——而 v-for 的行会实例化 N 次，
   *   根本没有单一固定 nodeId ⇒ 指令会写到"模板那个节点"上（错）。
   *   ⇒ 这类绑定必须产出 `list-item` 槽位：由运行时按 (listId, itemKey, itemSlotId)
   *     **解析出具体行的节点**（`ListRegistry` 的职责）。
   */
  listContext?: {
    /** 该 v-for 的稳定 id（按出现顺序分配 ⇒ 产物可复现） */
    listId: number
    /** v-for 别名（`item in list` 的 `item`） */
    scope: string
    /**
     * ★列表源表达式的**原始文本**（如 `groups` / `group.items`）
     *
     * 【为什么需要（本仓实测的嵌套缺口）】外层是 `group.items` 时，它的根 `group`
     *   是**外层的行作用域变量**，不是顶层源 ⇒ 只记根名会把内层挂到外层列表上（错）。
     *   运行时按本字段逐级求值（外层行 → 该行的 items），才能定位真正的行数据。
     */
    sourceExpr: string
    /** ★外层列表的 listId（嵌套时才有；用于运行时按"外层行 → 内层数组"求值） */
    parentListId?: number
    /** `:key` 的表达式（如 `item.id`）——运行时的**行标识字段**；无 `:key` 时为 undefined */
    keyField?: string
    /** 该 v-for 元素在模板序中的元素序号（供运行时算行内相对偏移） */
    vforElementIndex: number
    /** 是否就是 `:key` 绑定自身（它不是可更新的渲染属性，建槽位时跳过） */
    isKeyBinding: boolean
  }

  /**
   * ★作用域别名 → 其**所属列表的源表达式根名**（`item` → `list`）
   *
   * 【为什么必须有（本仓实测：首版漏了它）】`{{ item.title }}` 的依赖是"列表某项的字段"，
   *   要登记到**列表源**（`list`）而不是一个叫 `item` 的源——否则依赖图里这条绑定**凭空消失**
   *   （现象：slot_8 标了 L1，但依赖图里找不到它，运行时那个源变化不会写这个槽位）。
   *   ⇒ 建图时用它把 item 级槽位挂回列表源。
   */
  scopeSources: Record<string, string>
  /** 元素 tag（诊断） */
  tag: string
  /**
   * ★该元素在**模板序 DFS** 中的序号（= IR builder 分配的 nodeId）
   *
   * 【为什么必须有（本仓实测的真缺陷）】首版用「绑定序号」当 nodeId ⇒
   *   `<p-view><p-view :width="w"/></p-view>` 里那个绑定拿到 nodeId=0（根），
   *   而它在树里其实是第 2 个节点 ⇒ **指令写到错误的节点上**（且不报错，几何静默不对）。
   *   ⇒ 正解：nodeId 必须与 IR builder 同源——两者都是「模板序 DFS 给**每个元素**编号」。
   */
  elementIndex: number
  /** 源码行（1-based，诊断定位） */
  line?: number
  /** 是否在运行时才可判定的 v-if 分支内（C5 判定输入） */
  inRuntimeBranch: boolean
}

/**
 * 收集模板中全部动态绑定表达式（V2 Step 2 的入口）
 *
 * ★与既有 `transformTemplateToWxml` 的关系：那条管线是**小程序产物**（wxml）的生成路径，
 *   本函数只做**依赖分析**、不改任何产物——两者共享同一份官方 AST，互不干扰。
 */
export function collectTemplateBindings(
  source: string,
  filename = 'anonymous.vue',
  /** ★可注入（缺省用本仓锁定的 Vue 版本）；兼容性测试传 3.4 / 3.6 的解析器 */
  compat?: Pick<VueCompatDeps, 'sfcParse' | 'domParse'>,
): TemplateBindingRef[] {
  const vueParse = compat?.sfcParse ?? sfcParse
  const dom = compat?.domParse ?? domParse
  let tpl = ''
  try {
    const d = vueParse(source, { filename }).descriptor
    tpl = d.template?.content ?? ''
  } catch {
    return []
  }
  if (!tpl.trim()) return []

  const out: TemplateBindingRef[] = []
  let ast
  try {
    ast = dom(tpl, { comments: false })
  } catch {
    return out
  }

  let nextElementIndex = 0
  let nextListId = 0 // ★v-for 的稳定 id（按出现顺序 ⇒ 产物可复现）
  type ListCtx = NonNullable<TemplateBindingRef['listContext']> | null
  const walk = (
    nodes: unknown[],
    scopes: string[],
    inBranch: boolean,
    scopeSources: Record<string, string> = {},
    /** ★当前所在元素（插值不是元素，它归属父元素） */
    parentElementIndex = 0,
    /** ★当前所处的 v-for 上下文（外层为 null） */
    listCtx: ListCtx = null,
  ): void => {
    for (const raw of nodes) {
      const n = raw as {
        type: number
        tag?: string
        /**
         * ★指令节点的形状（本仓实测确认）：
         *   · `exp.content`（NodeTypes.SIMPLE_EXPRESSION = 4）= **表达式源码**
         *     ——首版误读 `value.content`（DOM 侧只有 `exp`，没有 `value`）⇒ **全部指令绑定漏采**，
         *       现象是"只收集到插值、:class/:style/v-for 全丢"，且测试只报"依赖图里没有 a"。
         *   · `arg.content` = 绑定的属性名（`:class` → 'class'；`v-for` 无 arg）
         */
        props?: Array<{
          type: number
          name: string
          arg?: { content?: string }
          exp?: { content?: string; loc?: { start?: { line?: number } } }
        }>
        children?: unknown[]
        loc?: { start?: { line?: number } }
        content?: { content?: string } | string
      }
      const tag = n.tag ?? ''
      // ★★组件标签（P1 组件系统第一批）：PascalCase = 组件（与 Vue 官方约定同）——
      //   组件上的 props 走 `component.<name>` 前缀 ⇒ slotKindOf 归到 `component-prop`
      //   ⇒ 运行时发 CALL_COMPONENT_UPDATE（方案 §7.3："组件边界强制 L0"）。
      //   ★与 template.ts 的 `isComponentTag` 判据**同源**（同一份约定，两处判据一致）。
      const isComponentTag = /^[A-Z]/.test(tag)
      const line = n.loc?.start?.line
      let nextScopes = scopes
      let nextBranch = inBranch
      let nextScopeSources = scopeSources
      // ★该元素内所有绑定的 v-for 上下文：v-for 自身的**其它**绑定（:key/:class…）也属于该行
      //   ⇒ 从 nextListCtx 的初值（外层上下文）与 v-for 分支新设的上下文合并取"最深"
      let nextListCtx: ListCtx = listCtx
      let activeListCtx: ListCtx = listCtx

      if (n.type === 1 /* ELEMENT */) {
        // ★每个元素（无论是否含绑定）都占一个序号——与 IR builder 的 DFS 编号一致
        const myElementIndex = nextElementIndex++
        // ★先扫一遍该元素的 `:key`（v-for 的行标识字段）——必须在处理其它绑定**之前**拿到，
        //   否则「:key 写在插值之后」的模板会让前面的绑定拿不到 keyField。
        let keyFieldOfElement: string | undefined
        let forCodeOfElement: string | undefined
        for (const p of n.props ?? []) {
          if (p.name === 'bind' && p.arg?.content === 'key' && p.exp?.content) {
            keyFieldOfElement = p.exp.content.trim()
          }
          if (p.name === 'for' && p.exp?.content) {
            forCodeOfElement = p.exp.content.trim()
          }
        }

        // ★★先建立**行上下文**，再处理该元素的其余绑定（本仓实测的正确性修复）
        //
        // 【为什么（实测的静默 bug）】Vue 语义：元素上有 `v-for` ⇒ **它的所有绑定都属于该行**
        //   （与属性书写顺序无关）。而首版是「按属性顺序处理」：v-for 分支只更新
        //   `nextScopeSources`，同一元素上**写在 v-for 之前的绑定**（如
        //   `<p-view v-for=… :key=… :width="item.w">` 里的 `:width` 也走旧值）拿到的仍是
        //   **外层**的 `scopeSources` ⇒ `item` 未映射 ⇒ 该槽位挂不到任何源 ⇒
        //   **被静默丢出依赖图**（实测：decisions 显示 slot_2 为 L1、stats.l1 计入它，
        //    但 `table.sources` 里没有它 ⇒ 运行时永不写 ⇒ 静默不更新）。
        //   ⇒ 正解：**先扫 v-for 建上下文**（与 `:key` 同一手法），再处理其余绑定。
        let rowCtxOfElement: ListCtx = listCtx
        let rowScopeSources: Record<string, string> = scopeSources
        let rowScopes: string[] = scopes
        if (forCodeOfElement) {
          const parts = forCodeOfElement.split(/\s+(?:in|of)\s+/)
          const alias = parts[0]?.trim() ?? ''
          const names = alias.replace(/[()]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
          const exprText = (parts.slice(1).join(' ') ?? '').trim()
          rowScopes = [...scopes, ...names]
          rowScopeSources = { ...scopeSources }
          const listRoot = exprText.split('.')[0]?.replace(/[^\w$]/g, '') ?? ''
          const topRoot = scopeSources[listRoot] ?? listRoot
          for (const nm of names) rowScopeSources[nm] = topRoot
          const rawExprOrField = exprText.split('.').filter(Boolean).pop() ?? exprText
          for (const nm of names) rowScopeSources[`__field__${nm}`] = rawExprOrField
          const isTopLevel = exprText.split('.').filter(Boolean).length === 1
          for (const nm of names) rowScopeSources[`__kind__${nm}`] = isTopLevel ? 'top' : 'nested'
          // ★★sourceExpr 必须在**污染前**计算（本仓实测的遮蔽陷阱）
          //
          // 【为什么】`aliasToFieldPath` 需要靠 `__field__<别名>` 把别名翻成字段名。
          //   但遮蔽时（内外层同名 `item`）本行的 `__field__item` 会**覆盖**外层的，
          //   而且是**先写映射、后算路径**——于是内层 `item.items` 的别名 `item`
          //   被翻成**外层**的字段名 `items` ⇒ 路径变成 `items.items`（多一段）。
          //   ⇒ 正解：**用翻译前的映射算路径**，再写本行的映射。
          const srcPathBeforeShadow = aliasToFieldPath(exprText, scopeSources)
          rowCtxOfElement = {
            listId: nextListId++,
            scope: names[0] ?? '',
            sourceExpr: srcPathBeforeShadow,
            parentListId: listCtx?.listId,
            keyField: keyFieldOfElement,
            vforElementIndex: myElementIndex,
            isKeyBinding: false,
          }
          // v-for 的**源表达式**绑定（`list.items`）用**外层** scopeSources（它不属行内）
          if (exprText) {
            out.push(
              binding(exprText, 'v-for', 'list.items', tag, line, scopes, inBranch, scopeSources, myElementIndex),
            )
          }
        }

        for (const p of n.props ?? []) {
          const EXPR = 7 /* DIRECTIVE */
          const name = p.name
          const expCode = p.exp?.content
          if (!expCode) continue
          const expLine = line ?? p.exp?.loc?.start?.line
          // v-for：已在上方**预扫描**中处理（建上下文 + 推源绑定）——此处跳过
          if (name === 'for') {
            nextScopes = rowScopes
            nextScopeSources = rowScopeSources
            nextListCtx = rowCtxOfElement
            activeListCtx = rowCtxOfElement
            continue
          }
          if (false as boolean) {
            const parts = String(expCode).split(/\s+(?:in|of)\s+/)
            const alias = parts[0]?.trim() ?? ''
            const names = alias.replace(/[()]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
            nextScopes = [...scopes, ...names]
            // v-for 的**源表达式**（`in` 之后那半）也是依赖（用**外层**作用域解析）
            const srcExpr = parts.slice(1).join(' ')
            if (srcExpr) {
              out.push({
                ...binding(srcExpr, 'v-for', 'list.items', tag, expLine, scopes, inBranch, scopeSources, myElementIndex),
                // v-for 自身的**源绑定**是「整体换数据源」（list-data），不带 listContext
              })
            }
            // ★建立行的 v-for 上下文：后续该元素（含自身其它绑定）与其子树内的绑定都带上它
            nextListCtx = {
              listId: nextListId++,
              scope: names[0] ?? '',
              // ★保留完整源表达式（嵌套时 `group.items` 不能只留根名）
              // ★★纯字段路径（别名已翻译为字段名）——本仓实测的关键纠正：
              //   `v-for="b in a.l2"` 的表达式含**别名** `a`，而运行时要在
              //   「顶层行 → 字段 → 字段」上逐级下钻 ⇒ 需要**字段名**（`l2`）而非别名。
              //   首版存含别名表达式 ⇒ 运行时在顶层行找字段 `b` ⇒ 找不到 ⇒ 行集空 ⇒
              //   **静默不发指令**（实测三层嵌套 0 条指令）。
              sourceExpr: aliasToFieldPath((expCode.trim().split(/\s+(?:in|of)\s+/)[1] ?? "").trim(), scopeSources),
              // ★若外层已有 v-for 上下文 ⇒ 记录父列表 id（运行时按外层行求值内层数组）
              parentListId: listCtx?.listId,
              keyField: keyFieldOfElement,
              vforElementIndex: myElementIndex,
              isKeyBinding: false,
            }
            // ★同一元素内**其余绑定**（:key / :class / 其它 prop）也属于该行 ⇒ 立即置为当前上下文
            //   （v-for 在 props 里可能排在 :key 之后，故不能只靠循环开头的初值）
            activeListCtx = nextListCtx
            // ★别名 → 列表源根名（`item in list` ⇒ item → list）
            // ★列表源的**根名**：若根名是**外层 v-for 的行别名**，则它指向的是
            //   「外层行的某个字段」而不是顶层源 ⇒ 记录**完整表达式** `sourceExpr`，
            //   并把顶层源解析为「外层列表所属的顶层源」（供依赖图挂接）。
            const exprText = srcExpr.trim()
            const listRoot = exprText.split('.')[0]?.replace(/[^\w$]/g, '') ?? ''
            if (listRoot) {
              nextScopeSources = { ...scopeSources }
              // 外层别名 → 顶层源（`group` → `groups`）；非别名时就是它自己
              const topRoot = scopeSources[listRoot] ?? listRoot
              for (const nm of names) nextScopeSources[nm] = topRoot
              // ★记「别名 → 该别名所在行的字段名」（供下一层 v-for 翻译 sourceExpr）：
              //   `b in a.l2` ⇒ b 行是 `a` 行的 `l2` 字段 ⇒ __field__b = 'l2'
              //   顶层（`a in groups`）⇒ 别名对应顶层源名本身 ⇒ __field__a = 'groups'
              for (const nm of names) nextScopeSources[`__field__${nm}`] = exprText.split('.').filter(Boolean).pop() ?? topRoot
              // ★记该别名是否**直接来自顶层源**（`a in l1` ⇒ top；`b in a.l2` ⇒ nested）
              //   供 aliasToFieldPath 决定是否剥首段（本仓实测：用"是否映射到顶层源"判会误剥）
              const isTopLevel = exprText.split('.').filter(Boolean).length === 1
              for (const nm of names) nextScopeSources[`__kind__${nm}`] = isTopLevel ? 'top' : 'nested'
              // ★把内层列表源也映射到顶层源（`group.items` 的根 `group` → `groups`）
              nextScopeSources[exprText.split('.')[0]] = topRoot
            }
            continue
          }
          // v-if / v-else-if：条件本身是依赖；★其**内部**属「运行时分支」（C5）
          if (name === 'if' || name === 'else-if') {
            out.push(binding(String(expCode), `v-${name}`, 'visible', tag, expLine, nextScopes, inBranch, nextScopeSources, myElementIndex, activeListCtx ?? undefined))
            nextBranch = true
            continue
          }
          // v-show 与 v-if 不同：节点**始终在树内**，只是可见性切换 ⇒ 不算运行时分支
          if (name === 'show') {
            out.push(binding(String(expCode), 'v-show', 'visible', tag, expLine, nextScopes, inBranch, nextScopeSources, myElementIndex, activeListCtx ?? undefined))
            continue
          }
          // 动态绑定（:x / v-bind:x / v-model）——★属性名在 arg 里
          if (name === 'bind' || name === 'model') {
            const arg = name === 'model' ? (p.arg?.content ?? 'modelValue') : (p.arg?.content ?? '')
            // 无 arg 的 v-bind="obj"（展开对象）：无法静态定位属性 ⇒ 记为 attrs（C2 交由解析结果判）
            // ★★`:style` 单属性降级（2026-10-02）：能静态判定字段名时编成**字段级键**
            //   （layout.width 等）——否则运行时拿到的是整串 CSS 文本，与 SET_STYLE 的
            //   `(key_id, f32)` 契约不匹配（实测 Vapor 端该节点宽度从未生效）。见 stylePropKeyFromExpr。
            let propKey = arg ? normalizePropKey(arg) : 'attr.spread'
            // ★组件 props：`component.<name>`（→ slotKindOf 归 component-prop → CALL_COMPONENT_UPDATE）
            if (isComponentTag && arg && !propKey.startsWith('layout.') && !propKey.startsWith('text.')) {
              propKey = `component.${arg.replace(/["']/g, '')}`
            }
            // ★★`:style` 单属性降级（2026-10-02）：**键与值一起降级**——
            //   ① 键：`paint.style` → `layout.width`（宿主认的字段名）；
            //   ② 值：求值表达式从整串拼接（`'width:'+item.w+'px'`，结果是字符串）
            //      改成**只算值那一段**（`item.w` → 40，f32 契约）。
            //   只做能静态判定的一条（见 stylePropKeyFromExpr / styleValueExprFromExpr），
            //   其余形态保持原样（不假装支持）。
            let exprForBinding = String(expCode)
            if (arg === 'style') {
              const fieldKey = stylePropKeyFromExpr(exprForBinding)
              const valueExpr = styleValueExprFromExpr(exprForBinding)
              if (fieldKey && valueExpr) {
                propKey = fieldKey
                exprForBinding = valueExpr
              }
            }
            const isKey = arg === 'key'
            out.push(
              binding(
                exprForBinding,
                arg ? `:${arg}` : 'v-bind',
                propKey,
                tag,
                expLine,
                nextScopes,
                inBranch,
                nextScopeSources,
                myElementIndex,
                (activeListCtx ?? undefined),
                // ★`:key` 自身标记（它不是可更新渲染属性 ⇒ 建槽位时跳过；但它的表达式是**行标识字段**）
                isKey,
              ),
            )
          }
        }
        walk((n.children ?? []) as unknown[], nextScopes, nextBranch, nextScopeSources, myElementIndex, nextListCtx ?? listCtx)
        continue
      }
      // ★插值（type 5）本身不是元素：它归属**最近遍历到的元素**（INTERPOLATION 只出现在元素子节点里）
      if (n.type === 5 /* INTERPOLATION */) {
        // ★插值的 content 是**对象** `{ content: '表达式', loc }`（与指令的 exp 不同层）
        const c = n.content as { content?: string; loc?: { start?: { line?: number } } } | undefined
        const code = typeof c === 'object' ? c.content : (c as unknown as string)
        if (code) {
          out.push(
            binding(String(code), '{{ }}', 'text.content', tag, c?.loc?.start?.line ?? line, scopes, inBranch, scopeSources, parentElementIndex, activeListCtx ?? undefined),
          )
        }
        continue
      }
      if (Array.isArray(n.children)) walk(n.children, nextScopes, nextBranch, nextScopeSources, parentElementIndex)
    }
  }

  walk((ast as unknown as { children: unknown[] }).children ?? [], [], false)
  return out
}

/**
 * ★★别名 → 字段名的路径翻译（本仓实测的关键纠正）
 *
 * 【为什么需要】`v-for="b in a.l2"` 的源表达式含**别名** `a`（外层行），
 *   而运行时要沿「顶层行 → 字段 → 字段」逐级下钻 ⇒ 需要的是**字段名路径**。
 *   映射关系在编译期已知：别名 `a` 对应的行是其父的哪个字段（`a in groups` ⇒ 顶层源名；
 *   `b in a.l2` ⇒ 字段 `l2`）。
 *
 * 【本仓实测的后果】首版存含别名的表达式（`b.l3`）⇒ 运行时在顶层行上找字段 `b`
 *   ⇒ 找不到 ⇒ 行集为空 ⇒ **静默不发指令**（三层嵌套实测 0 条）。
 */
function aliasToFieldPath(expr: string, scopeSources: Record<string, string>): string {
  const segs = expr
    .split('.')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => scopeSources[`__field__${seg}`] ?? seg)
  // ★★首段若是**顶层源名** ⇒ 去掉（本仓实测修正）
  //
  // 【为什么】运行时的行集起点就是「顶层源的行集」（`ctx.read(src.sourceName)`），
  //   故路径只需「从一行如何下钻到下一层」的字段序列。
  //   首版把顶层源名留在路径里（`groups.items`）⇒ 运行时在顶层行上找字段 `groups`
  //   ⇒ 找不到 ⇒ 行集空 ⇒ **静默不发指令**。
  //   （最外层 v-for 的路径会因此变成空串——那是正确的：它的行集就是顶层源本身。）
  // ★判据必须是「**首段是顶层源名**」——而不是"映射到了某个顶层源"（本仓实测：
  //   首版用 `Object.values(scopeSources)` 判 ⇒ 所有别名都映射到同一顶层源 ⇒
  //   **中间段也被剥掉**（`l2.l3` → `l3`）⇒ 路径错误）。
  //   正解：`__field__` 映射的**值等于顶层源名**才说明该别名直接来自顶层源。
  if (segs.length > 1 && scopeSources[`__kind__${expr.split('.')[0]?.trim()}`] === 'top') {
    return segs.slice(1).join('.')
  }
  return segs.join('.')
}

/** v-for 上下文的「非 null」形态（供 binding() 的参数类型用） */
type ListCtxArg = NonNullable<TemplateBindingRef['listContext']> | undefined

function binding(
  code: string,
  where: string,
  propKey: string,
  tag: string,
  line: number | undefined,
  scopes: string[],
  inRuntimeBranch: boolean,
  scopeSources: Record<string, string> = {},
  elementIndex = 0,
  listContext: ListCtxArg = undefined,
  isKeyBinding = false,
): TemplateBindingRef {
  return {
    code: code.trim(),
    where,
    propKey,
    tag,
    line,
    scopes: [...scopes],
    inRuntimeBranch,
    scopeSources: { ...scopeSources },
    elementIndex,
    // ★`isKeyBinding` 只在该绑定自身是 `:key` 时为真（其余继承上下文）
    listContext: listContext ? { ...listContext, isKeyBinding } : undefined,
  }
}

/**
 * ★★**单属性 `:style` 的字段级降级**（2026-10-02 六端 SFC 压力测试抓出的契约缺口）。
 *
 * 【缺陷（实测）】`:style="'width:' + item.w + 'px'"` 此前编成 `paint.style`（**整串键**），
 *   而运行时的契约是**结构化字段 + 数值**（`SET_STYLE(node_id, key_id, value: f32)`，
 *   见 layout-core-rust/src/ops.rs；宿主只认 `width`/`height`/`backgroundColor` 等字段名）。
 *   ⇒ Vapor 端（iOS/Android）该节点宽度从未生效（实测：chip 宽度 0、整块不可见），
 *   而 Web 端走 Vue 官方运行时直接吃 style 串 ⇒ **跨端不一致**（压力测试的产出之一）。
 *
 * 【降级规则（保守：只做能静态判定的一条）】表达式是**字符串字面量里含 `字段名:`** 的形态
 *   （`'width:' + …` / `'width: …'` / `\`width: …\``）⇒ 取该字段名映射到 `layout.*`/`paint.*`。
 *   其余形态（多属性串、`:style` 对象、动态属性名）**保持 `paint.style`**——那些需要运行时
 *   解析 CSS 文本（本版不做；如实保留原键，不假装支持）。
 */
export function stylePropKeyFromExpr(exprCode: string): string | null {
  // 取表达式里**第一个** CSS 属性名（字符串字面量开头的 `xxx:`）
  const m = exprCode.match(/['"`]\s*([a-zA-Z-]+)\s*:/)
  if (!m) return null
  const cssProp = m[1]!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  // 复用同一套字段前缀规则（layout.* / paint.*）——**一处实现**，避免两处规则漂移
  return normalizePropKey(cssProp)
}

/**
 * ★★从 `'field: ' + EXPR + 'unit'` 形态里**抽出值表达式**（2026-10-02 同批修复的第二半）。
 *
 * 【为什么必须同时做（实测）】只把 propKey 改成 `layout.width` 还不够——**求值器算的仍是整个
 *   拼接表达式**（结果是字符串 `"width:40px"`），而 `SET_STYLE` 的契约是 `value: f32`。
 *   ⇒ 必须让求值器只算值那一段（`item.w` → `40`）。
 *
 * 【支持形态（保守）】字符串字面量 + 拼接 + 可选单位后缀：
 *   `'width:' + item.w + 'px'` · `"height:" + h` · `` `width: ${w}px` ``（模板串同义）
 * 【不支持（保持原行为，不假装支持）】多属性串（`'width:…;height:…'`）、三元/条件拼接、
 *   动态属性名——这些需要运行时 CSS 解析，本版不做。
 *
 * @returns 值表达式源码（如 `item.w`），或 null（形态不支持 ⇒ 调用方保持原键与整串求值）
 */
export function styleValueExprFromExpr(exprCode: string): string | null {
  const t = exprCode.trim()
  // 形态①：'field:' + EXPR [+ 'unit']
  const concat = t.match(/^['"`][^'"`]*[a-zA-Z-]+\s*:\s*['"`]\s*\+\s*([\s\S]+?)(?:\s*\+\s*['"`][^'"`]*['"`])?$/)
  if (concat) return concat[1]!.trim()
  // 形态②：模板串 `field: ${EXPR}unit`
  const tmpl = t.match(/^`[^`]*[a-zA-Z-]+\s*:\s*\$\{([\s\S]+?)\}[^`]*`$/)
  if (tmpl) return tmpl[1]!.trim()
  return null
}

/** 属性名 → IR 归一化 propKey（与 component-ir 约定对齐；未知前缀归 attr） */
export function normalizePropKey(arg: string): string {
  if (!arg) return 'attr'
  const a = arg.replace(/["']/g, '')
  if (a === 'style') return 'paint.style'
  if (a === 'class') return 'paint.class'
  if (a === 'value' || a === 'modelValue') return 'text.content'
  if (/^(width|height|margin|padding|flex|gap|top|left|right|bottom|min|max|position|display|overflow)/i.test(a)) {
    return `layout.${a}`
  }
  return `attr.${a}`
}

/** SFC 解析入口（复用既有依赖，不新增） */
import { parse as sfcParse } from '@vue/compiler-sfc'
