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
export function collectTemplateBindings(source: string, filename = 'anonymous.vue'): TemplateBindingRef[] {
  let tpl = ''
  try {
    const d = sfcParse(source, { filename }).descriptor
    tpl = d.template?.content ?? ''
  } catch {
    return []
  }
  if (!tpl.trim()) return []

  const out: TemplateBindingRef[] = []
  let ast
  try {
    ast = domParse(tpl, { comments: false })
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
        for (const p of n.props ?? []) {
          if (p.name === 'bind' && p.arg?.content === 'key' && p.exp?.content) {
            keyFieldOfElement = p.exp.content.trim()
          }
        }
        for (const p of n.props ?? []) {
          const EXPR = 7 /* DIRECTIVE */
          const name = p.name
          const expCode = p.exp?.content
          if (!expCode) continue
          const expLine = line ?? p.exp?.loc?.start?.line
          // v-for：作用域引入别名（`item in list` / `(item, idx) in list`）
          if (name === 'for') {
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
              keyField: keyFieldOfElement,
              vforElementIndex: myElementIndex,
              isKeyBinding: false,
            }
            // ★同一元素内**其余绑定**（:key / :class / 其它 prop）也属于该行 ⇒ 立即置为当前上下文
            //   （v-for 在 props 里可能排在 :key 之后，故不能只靠循环开头的初值）
            activeListCtx = nextListCtx
            // ★别名 → 列表源根名（`item in list` ⇒ item → list）
            const listRoot = srcExpr.trim().split('.')[0]?.replace(/[^\w$]/g, '') ?? ''
            if (listRoot) {
              nextScopeSources = { ...scopeSources }
              for (const nm of names) nextScopeSources[nm] = listRoot
            }
            continue
          }
          // v-if / v-else-if：条件本身是依赖；★其**内部**属「运行时分支」（C5）
          if (name === 'if' || name === 'else-if') {
            out.push(binding(String(expCode), `v-${name}`, 'visible', tag, expLine, scopes, inBranch, scopeSources, myElementIndex, activeListCtx ?? undefined))
            nextBranch = true
            continue
          }
          // v-show 与 v-if 不同：节点**始终在树内**，只是可见性切换 ⇒ 不算运行时分支
          if (name === 'show') {
            out.push(binding(String(expCode), 'v-show', 'visible', tag, expLine, scopes, inBranch, scopeSources, myElementIndex, activeListCtx ?? undefined))
            continue
          }
          // 动态绑定（:x / v-bind:x / v-model）——★属性名在 arg 里
          if (name === 'bind' || name === 'model') {
            const arg = name === 'model' ? (p.arg?.content ?? 'modelValue') : (p.arg?.content ?? '')
            // 无 arg 的 v-bind="obj"（展开对象）：无法静态定位属性 ⇒ 记为 attrs（C2 交由解析结果判）
            const propKey = arg ? normalizePropKey(arg) : 'attr.spread'
            const isKey = arg === 'key'
            out.push(
              binding(
                String(expCode),
                arg ? `:${arg}` : 'v-bind',
                propKey,
                tag,
                expLine,
                scopes,
                inBranch,
                scopeSources,
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
