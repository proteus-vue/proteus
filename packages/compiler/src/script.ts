// src/compiler/script.ts
// 4-1-b Script → Page/Component 构造器 JS
// 顶层 const（ref/reactive/字面量）→ data；顶层函数 → methods；生命周期映射
import type { ScriptIR, ScriptTransformOptions, ScriptTransformResult, StyleTransformOptions } from './types'
import type { TransformTrace } from './trace'
import { lineAt } from './trace'
import { resolveOverrides } from './overrides'
// ★#497 动作二批 1：结构发现 AST 化（@babel/parser——尾注释/TS 类型/泛型/返回注解天然不污染；解析失败回退旧文本路径，永不比现状差）
import { parse as babelParse } from '@babel/parser'
// ★#504 语言层转译交还 babel（方法论：不自研成熟工具链，只自建语义层）
import { transpileMpSafe } from './es5'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let astCacheSrc = ''
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let astCacheBody: any[] | null = null

/** 解析 script 顶层语句（TS 插件；失败 → null 触发回退） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function topLevelAst(source: string): any[] | null {
  if (astCacheSrc === source) return astCacheBody
  astCacheSrc = source
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    astCacheBody = (babelParse(source, { sourceType: 'module', plugins: ['typescript'] }) as any).program.body as any[]
  } catch {
    astCacheBody = null
  }
  return astCacheBody
}

/** 方法参数 AST → 产物参数文本（类型注解天然剔除；保留 ? 可选 / 默认值 / 展开；解构参数剥类型注解切片） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function astParamText(source: string, p: any): string {
  if (p.type === 'Identifier') return p.name // TS 可选参数 optional=true（? 是类型语法——产物 JS 无可选标记）
  if (p.type === 'AssignmentPattern') return `${astParamText(source, p.left)} = ${source.slice(p.right.start, p.right.end)}`
  if (p.type === 'RestElement') return '...' + astParamText(source, p.argument)
  // Object/Array 解构参数：去 typeAnnotation 后切片（含注解时按注解前区间拼）
  if (p.typeAnnotation) return source.slice(p.start, p.typeAnnotation.start).trimEnd()
  return source.slice(p.start, p.end)
}

/**
 * ★#497 剥行尾注释（双斜杠 与 块注释）：括号/引号感知——深度 0（顶层）才剥，字符串/括号内不误伤。
 * const 初始值提取后调用：ref(0) 后接行尾注释 → ref(0)（静态求值正则需右括号收尾；带注释误判 runtimeInit → 产物裸调 ref）
 */
function stripTrailingComment(code: string): string {
  let depth = 0
  let inS: string | null = null
  for (let i = 0; i < code.length - 1; i++) {
    const ch = code[i]
    if (inS) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === inS) inS = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inS = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    else if (ch === '/' && code[i + 1] === '/' && depth === 0) return code.slice(0, i).trimEnd()
    else if (ch === '/' && code[i + 1] === '*' && depth === 0) {
      const end = code.indexOf('*/', i + 2)
      return code.slice(0, end >= 0 ? end : i).trimEnd()
    }
  }
  return code
}

/** 构建期求值开发者自身源码中的字面量表达式（与 babel 插件同信任域） */
function evalLiteral(expr: string): unknown {
  try {
    return Function(`"use strict"; return (${expr})`)()
  } catch {
    return undefined
  }
}

/**
 * vue-compat-advance Batch 3：提取 provide/inject 调用
 * provide("key", expr) → 页面/组件初始化时注册（getApp().__proteusProvides）
 * const x = inject("key"[, default]) → 初始化时读取 + setData（data.x 初始 undefined）
 * 约束：仅零缩进顶层调用；provide 值支持字面量 / 裸 ref 名 / ref.value；inject 默认值支持字面量
 */
function extractProvideInject(
  source: string,
): {
  provides: Array<{ key: string; expr: string; line: number }>
  injects: Array<{ name: string; key: string; def?: string; line: number }>
} {
  const provides: Array<{ key: string; expr: string; line: number }> = []
  const injects: Array<{ name: string; key: string; def?: string; line: number }> = []
  // ★#497 批 2：AST 顶层（provide(...) 调用 / const x = inject(...)）
  const body = topLevelAst(source)
  if (body) {
    for (const st of body) {
      if (st.type === 'ExpressionStatement' && st.expression?.type === 'CallExpression' && st.expression.callee?.name === 'provide') {
        const args = st.expression.arguments
        const keyNode = args[0]
        const valNode = args[1]
        if (!keyNode || keyNode.type !== 'StringLiteral' || !valNode) continue
        provides.push({ key: keyNode.value, expr: source.slice(valNode.start, valNode.end), line: st.loc.start.line })
        continue
      }
      if (st.type === 'VariableDeclaration' && st.kind === 'const') {
        for (const d of st.declarations) {
          if (!d.id || d.id.type !== 'Identifier' || !d.init || d.init.type !== 'CallExpression' || d.init.callee?.name !== 'inject') continue
          const args = d.init.arguments
          const keyNode = args[0]
          if (!keyNode || keyNode.type !== 'StringLiteral') continue
          const inj: { name: string; key: string; def?: string; line: number } = { name: d.id.name, key: keyNode.value, line: st.loc.start.line }
          if (args[1]) inj.def = source.slice(args[1].start, args[1].end)
          injects.push(inj)
        }
      }
    }
    return { provides, injects }
  }
  // —— 文本回退路径 ——
  // provide("key", expr)（顶层调用，单行）
  const pRe = /^provide\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/gm
  let m: RegExpExecArray | null
  while ((m = pRe.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue // 仅行首顶层调用
    provides.push({ key: m[1], expr: m[2].trim(), line: lineAt(source, m.index) })
  }
  // const x = inject("key"[, default])（顶层 const，单行）
  const iRe = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*inject\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([^)]+))?\)/gm
  while ((m = iRe.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue
    const inj: { name: string; key: string; def?: string; line: number } = { name: m[1], key: m[2], line: lineAt(source, m.index) }
    if (m[3] !== undefined) inj.def = m[3].trim()
    injects.push(inj)
  }
  return { provides, injects }
}

/**
 * 生成 provide/inject 运行时注入块（getApp().__proteusProvides 全局注册表，ES5 安全，无缩进由调用方 indentBody）
 * - page：页面 onLoad 单函数合并块（registry 声明一次 + provide + inject）
 * - provide：组件 created 块（先于子组件 attached 注册）
 * - inject：组件 attached 块（computed/immediate-watch 之后 setData + 订阅）
 * provide 值表达式重写：裸 ref 名 / ref.value → this.data.<name>（ref 编译为 data 字段）
 * ★Batch 4：裸 ref 提供 → provideRefs（ref→key）+ 注册表 __subs 初始化（写入点联动通知）；
 *   inject → 订阅 __subs[key]（值变化 setData 刷新）；.value/字面量保持静态快照（Vue 语义）
 */
function buildProvideInject(
  provides: Array<{ key: string; expr: string }>,
  injects: Array<{ name: string; key: string; def?: string }>,
  data: Record<string, unknown>,
  computeds: Record<string, ComputedInfo>,
): { page: string; provide: string; inject: string; provideRefs: Map<string, string> } {
  // ★Batch 6：页面命名空间打开段（provides = 当前页注册表）
  // 页面 onLoad：__seq 递增生成 pageId（存实例 __proteusPageId）→ 命名空间解析
  const pageOpen = [
    'const __reg = getApp().__proteusProvides || (getApp().__proteusProvides = {})',
    '__reg.__seq = (__reg.__seq || 0) + 1',
    "this.__proteusPageId = 'p' + __reg.__seq",
    'const provides = (__reg[this.__proteusPageId] || (__reg[this.__proteusPageId] = {}))',
  ].join('\n')
  // 组件 created/attached：getCurrentPages 栈顶页面的 __proteusPageId（组件渲染期间栈顶 = 所属页面）→ 同一命名空间；无则 global
  const compOpen = [
    "const __pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : [])",
    "const __pid = __pages.length ? __pages[__pages.length - 1].__proteusPageId : ''",
    "this.__proteusPageId = __pid || 'global'",
    'const __reg = getApp().__proteusProvides || (getApp().__proteusProvides = {})',
    'const provides = (__reg[this.__proteusPageId] || (__reg[this.__proteusPageId] = {}))',
  ].join('\n')
  const provideRefs = new Map<string, string>() // 裸 ref 名 → key（写入点联动通知用）
  const pLines: string[] = []
  for (const p of provides) {
    let expr = p.expr
    // ref.value → this.data.ref（读取重写，与 rewriteRefAccess 读取分支一致）
    const vm = expr.match(/^([A-Za-z_$][\w$]*)\.value$/)
    if (vm && (vm[1] in data || vm[1] in computeds)) expr = `this.data.${vm[1]}`
    else if (expr in data) {
      expr = `this.data.${expr}` // 裸 ref 名 / data 字段
      // ★Batch 4：裸 ref 提供 → 响应式联动（Vue 语义：传 ref 引用联动；.value 是静态快照不联动）
      provideRefs.set(p.expr, p.key)
    }
    pLines.push(`provides[${JSON.stringify(p.key)}] = ${expr}`)
    if (provideRefs.has(p.expr)) {
      // 初始化订阅集合（proteusSyncProvide 通知 / inject 订阅读写此结构）
      pLines.push(`if (!provides.__subs) provides.__subs = {}; if (!provides.__subs[${JSON.stringify(p.key)}]) provides.__subs[${JSON.stringify(p.key)}] = []`)
    }
  }
  const iLines: string[] = []
  for (const inj of injects) {
    const read = `provides[${JSON.stringify(inj.key)}]`
    const value = inj.def === undefined ? read : `(${read} === undefined ? ${inj.def} : ${read})`
    iLines.push(`this.setData({ ${inj.name}: ${value} })`)
  }
  if (injects.length) {
    // ★Batch 4：订阅响应式联动——提供侧 ref 写入（proteusSyncProvide 通知）→ setData 刷新；
    // 仅订阅已初始化 __subs 的 key（静态提供 / 未注册 key 保持快照）；__proteusSubs 供 detached/onUnload 取消
    iLines.push('const __self = this')
    for (const inj of injects) {
      const read = `provides[${JSON.stringify(inj.key)}]`
      iLines.push(`if (provides.__subs && provides.__subs[${JSON.stringify(inj.key)}]) {`)
      iLines.push(`  const __sub = { k: ${JSON.stringify(inj.key)}, fn: function () { __self.setData({ ${inj.name}: ${read} }) } }`)
      iLines.push('  if (!this.__proteusSubs) this.__proteusSubs = []')
      iLines.push('  this.__proteusSubs.push(__sub)')
      iLines.push(`  provides.__subs[${JSON.stringify(inj.key)}].push(__sub)`)
      iLines.push('}')
    }
  }
  return {
    page: pLines.length || iLines.length ? `${pageOpen}\n${[...pLines, ...iLines].join('\n')}` : '',
    provide: pLines.length ? `${compOpen}\n${pLines.join('\n')}` : '',
    inject: iLines.length ? `${compOpen}\n${iLines.join('\n')}` : '',
    provideRefs,
  }
}

/**
 * ★module-plan B0：解析 import 语句结构（default / named / namespace / 副作用 / type）
 * 返回形态供 require 转换（compiler 生成语句；requirePath 由插件预计算传入）
 */
interface ImportSpec {
  /** 源模块路径（源码书写形式，如 ../stores/player） */
  source: string
  kind: 'default' | 'named' | 'namespace' | 'side'
  /** named 导入名 / default 变量名 / namespace 变量名（side 为空） */
  names: string[]
  line: number
  /** 是否为纯类型导入（import type，产物剥离不需 require） */
  typeOnly: boolean
}
function extractImports(source: string): ImportSpec[] {
  // ★#497 批 2：AST 解析 import（跨行 named/type/别名天然正确；side-effect 无 specifier）
  const body = topLevelAst(source)
  if (body) {
    const out: ImportSpec[] = []
    for (const st of body) {
      if (st.type !== 'ImportDeclaration') continue
      const src = st.source.value as string
      const line = st.loc.start.line
      if (st.importKind === 'type') {
        out.push({ source: src, kind: 'named', names: [], line, typeOnly: true })
        continue
      }
      const defaults: string[] = []
      const named: string[] = []
      const ns: string[] = []
      for (const sp of st.specifiers) {
        if (sp.type === 'ImportDefaultSpecifier') defaults.push(sp.local.name)
        else if (sp.type === 'ImportNamespaceSpecifier') ns.push(sp.local.name)
        else named.push(sp.imported?.name ?? sp.imported?.value ?? sp.local.name) // as 别名：现语义用原导入名（剥 as）
      }
      if (ns.length) out.push({ source: src, kind: 'namespace', names: ns, line, typeOnly: false })
      if (defaults.length && named.length) {
        out.push({ source: src, kind: 'default', names: defaults, line, typeOnly: false })
        out.push({ source: src, kind: 'named', names: named, line, typeOnly: false })
      } else if (defaults.length) out.push({ source: src, kind: 'default', names: defaults, line, typeOnly: false })
      else if (named.length) out.push({ source: src, kind: 'named', names: named, line, typeOnly: false })
      else if (ns.length) {
        // default + * as 组合：default 已在 ns 分支外独立 push（上述 ns 先 push）；补 default
        if (defaults.length) out.push({ source: src, kind: 'default', names: defaults, line, typeOnly: false })
      } else if (!st.specifiers.length) out.push({ source: src, kind: 'side', names: [], line, typeOnly: false })
    }
    return out
  }
  // —— 文本回退路径 ——
  const out: ImportSpec[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t.startsWith('import ')) continue
    const lineNo = i + 1
    // 副作用导入：import 'm'
    let m = t.match(/^import\s+['"]([^'"]+)['"];?$/)
    if (m) { out.push({ source: m[1], kind: 'side', names: [], line: lineNo, typeOnly: false }); continue }
    // type 导入：import type { x } from 'm'（纯类型，运行时剥离）
    m = t.match(/^import\s+type\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?$/)
    if (m) { out.push({ source: m[2], kind: 'named', names: [], line: lineNo, typeOnly: true }); continue }
    // import def, { a, b } from 'm'（default + named 组合）
    m = t.match(/^import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\.*\s+from\s+['"]([^'"]+)['"];?$/)
    if (m) {
      const names = m[2].split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+[\w$]+$/, '').trim())
      out.push({ source: m[3], kind: 'default', names: [m[1]], line: lineNo, typeOnly: false })
      if (names.length) out.push({ source: m[3], kind: 'named', names, line: lineNo, typeOnly: false })
      continue
    }
    // import * as ns from 'm'
    m = t.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?$/)
    if (m) { out.push({ source: m[2], kind: 'namespace', names: [m[1]], line: lineNo, typeOnly: false }); continue }
    // import { a, b } from 'm'
    m = t.match(/^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?$/)
    if (m) {
      const names = m[1].split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+[\w$]+$/, '').trim())
      out.push({ source: m[2], kind: 'named', names, line: lineNo, typeOnly: false })
      continue
    }
    // import def from 'm'
    m = t.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?$/)
    if (m) { out.push({ source: m[2], kind: 'default', names: [m[1]], line: lineNo, typeOnly: false }); continue }
  }
  return out
}

/** 从 openBraceIndex 的 { 开始匹配闭合大括号，返回内部内容 */
function extractBracedBody(source: string, openBraceIndex: number): string | null {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(openBraceIndex + 1, i)
    }
  }
  return null
}

/**
 * 从 valueStart 扫描 const 初始值：追踪 ()[]{} 平衡并跳过字符串/注释（字符串里的括号不影响深度），
 * 深度归零后遇 ; 或行尾结束——支持多行数组/对象字面量（如 ref([\n { a: 1 },\n])）
 */
function extractInitializer(source: string, valueStart: number): string {
  let depth = 0
  let quote: string | null = null
  let escaped = false
  let inBlockComment = false
  let i = valueStart
  const len = source.length
  for (; i < len; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === '/' && next === '/') {
      // 行注释：跳过至行尾；深度 0 时注释后无语句内容，行尾即结束
      while (i < len && source[i] !== '\n') i++
      if (depth === 0) break
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue }
    if (depth === 0 && (ch === ';' || ch === '\n')) break
  }
  return source.slice(valueStart, i).trim()
}

/** computed 派生字段信息（v0.3 读路径 + v0.3 尾写路径：编译期把 getter 转 data 派生） */
interface ComputedInfo {
  name: string
  /** getter 表达式中依赖的 ref 名（x.value → x） */
  deps: string[]
  /** 转写后表达式（x.value → this.data.x），供 setData 合并重算 */
  expr: string
  /** 显式 setter（对象形式 computed({ get, set }) → proteusSetX 方法；无 = 只读） */
  setter?: { param: string; body: string }
  /** ★#499 块体 computed：整段求值方法体（proteusCalcX()——内部语句任意，末语句 return expr）；expr = this.proteusCalcX() */
  blockBody?: string
}

/** watch 信息（v0.3 起：单 ref / 数组源 / 函数源，依赖写入后自动调用回调；★B3 起：props 源 → observers） */
interface WatchInfo {
  /** 方法名后缀（deps 组合：count → Count、[a,b] → AAndB；props 源 → PropX） */
  id: string
  /** 依赖的 ref 名列表 */
  deps: string[]
  /** 回调参数（[newVal, oldVal]） */
  params: string[]
  /** 回调体（ref 访问已重写为 this.data 形式） */
  body: string
  /** immediate: true → onLoad 初始化时调用一次 */
  immediate: boolean
  /** 源码起始行（sourcemap / 行号注释） */
  line: number
  /** 函数源 getter（转写后 this.data 形式；undefined = ref 直接源） */
  expr?: string
  /** ★props 源：监听自身属性名（→ WeChat observers；Web 端标准 Vue watch） */
  propField?: string
}

/** 组件 prop 信息（v0.3 组件系统：defineProps → Component properties） */
interface PropInfo {
  /** 微信 properties 类型 */
  type: string
  /** 默认值（微信 value） */
  value?: unknown
}

/** TS 类型 → 微信 properties type + 默认值（泛型形式 defineProps<{...}>） */
function mapTsType(t: string, warnings: string[], name: string): { type: string; value?: unknown } {
  const s = t.trim()
  if (s === 'string') return { type: 'String', value: '' }
  if (s === 'number') return { type: 'Number', value: 0 }
  if (s === 'boolean') return { type: 'Boolean', value: false }
  if (s === 'object') return { type: 'Object' }
  if (s.endsWith('[]') || s === 'Array') return { type: 'Array' }
  if (s.includes('|') || s.startsWith("'")) return { type: 'String', value: '' } // 联合字面量 / 字面量类型
  warnings.push(`prop ${name} 的类型 ${s} 无法映射（泛型形式支持 string/number/boolean/object/Array/联合），已按 String 处理`)
  return { type: 'String', value: '' }
}

/** 剥 TS as 断言 / 非空断言 / 括号（defineProps 对象形式常见 `Array as any` / `(String as any)`） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tsUnwrap(n: any): any {
  if (!n) return n
  if (
    n.type === 'TSAsExpression' ||
    n.type === 'TSTypeAssertion' ||
    n.type === 'TSNonNullExpression' ||
    n.type === 'ParenthesizedExpression'
  ) {
    return tsUnwrap(n.expression)
  }
  return n
}

/** defineProps 对象形式 → Component properties 字段（仅组件模式；含 v0.3 尾 TS 泛型形式）
 *  ★#497 批 2b：AST 发现 + 属性级解析（注释/跨行/含逗号默认值/嵌套 default 天然正确）；解析失败回退旧文本路径 */
function extractProps(source: string, warnings: string[], trace?: TransformTrace): Record<string, PropInfo> {
  const out: Record<string, PropInfo> = {}
  const add = (name: string, info: PropInfo, before: string): void => {
    out[name] = info
    trace?.add('script/define-props', { before, after: `properties.${name}（type: ${info.type}）` })
  }
  /** 对象形式 prop 归一（AST 与文本回退共用语义）：类型白名单校验 + 函数 default 丢弃 + 无 default 按类型兜底 */
  const normalize = (name: string, typeIn: string, valueIn: unknown, fnDefault: boolean): void => {
    let type = typeIn
    let value = valueIn
    if (!['String', 'Number', 'Boolean', 'Object', 'Array', 'Function'].includes(type)) {
      warnings.push(`prop ${name} 的类型 ${type} 无法映射到微信 properties（MVP 支持 String/Number/Boolean/Object/Array），已按 String 处理`)
      type = 'String'
    }
    // 无 default 时按类型给默认值（微信 properties.value）；函数默认值（如 () => []）不适用，跳过
    if (fnDefault || typeof value === 'function') {
      warnings.push(`prop ${name} 的 default 是函数（微信 properties.value 仅支持字面量），已忽略默认值`)
      value = undefined
    }
    if (value === undefined) {
      if (type === 'String') value = ''
      else if (type === 'Number') value = 0
      else if (type === 'Boolean') value = false
    }
    out[name] = { type, value }
  }
  const body = topLevelAst(source)
  if (body) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isFnDefault = (n: any): boolean => {
      const u = tsUnwrap(n)
      return u.type === 'ArrowFunctionExpression' || u.type === 'FunctionExpression'
    }
    /** 对象配置对象 { type, default } 中取指定键值（default 是任意表达式 → AST 区间切片喂 evalLiteral——逗号/嵌套天然正确） */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const objValueOf = (obj: any, key: string): any | undefined => {
      for (const p of obj.properties ?? []) {
        if (p.type !== 'ObjectProperty' || p.computed) continue
        const k = p.key
        if (k && ((k.type === 'Identifier' && k.name === key) || (k.type === 'StringLiteral' && k.value === key))) return p.value
      }
      return undefined
    }
    /** 单条 runtime 形式 prop（简写构造器 label: String / 配置对象 { type, default }）→ 归一入册 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleRuntimeEntry = (name: string, valueNode: any): void => {
      const u = tsUnwrap(valueNode)
      let type = 'String'
      let value: unknown
      let fnDefault = false
      if (u.type === 'ObjectExpression') {
        const tv = objValueOf(u, 'type')
        if (tv) {
          const tu = tsUnwrap(tv)
          if (tu.type === 'Identifier') type = tu.name
          else if (tu.type === 'ArrayExpression' && tu.elements[0]) {
            // 多构造器 type: [String, Number] → 首构造器（旧文本语义取 type: 后首标识符）
            const e0 = tsUnwrap(tu.elements[0])
            if (e0 && e0.type === 'Identifier') type = e0.name
          }
        }
        const dv = objValueOf(u, 'default')
        if (dv) {
          fnDefault = isFnDefault(dv)
          if (!fnDefault) value = evalLiteral(source.slice(dv.start, dv.end).trim())
        }
      } else if (u.type === 'Identifier') {
        type = u.name // 简写构造器（label: String）；自定义类型走白名单警告
      } else {
        return // 其他形态（如 'String' 字面量）：维持旧行为静默忽略
      }
      normalize(name, type, value, fnDefault)
      add(name, out[name], `defineProps({ ${name}: ... })`)
    }
    // 全树扫描 defineProps 调用（宏可能位于 const 初始化 / withDefaults 参数 / 表达式语句）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (n: any): void => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier' && n.callee.name === 'defineProps') calls.push(n)
      for (const k of Object.keys(n)) {
        const v = n[k]
        if (Array.isArray(v)) for (const c of v) walk(c)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    for (const st of body) walk(st)
    for (const call of calls) {
      // 对象形式优先（旧文本顺序语义）；无对象参数再看 TS 泛型形式
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objArg = (call.arguments ?? []).find((a: any) => a && a.type === 'ObjectExpression')
      if (objArg) {
        for (const p of objArg.properties ?? []) {
          if (p.type !== 'ObjectProperty' || p.computed) continue
          const k = p.key
          if (!k || (k.type !== 'Identifier' && k.type !== 'StringLiteral')) continue
          const name = k.type === 'Identifier' ? k.name : k.value
          if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
          handleRuntimeEntry(name, p.value)
        }
        continue
      }
      // TS 泛型形式（v0.3 尾）：defineProps<{ label: string; count?: number }>()——typeParameters（@babel/parser TS 插件）；成员含注释/跨行天然正确
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typeLit = ((call as any).typeParameters?.params ?? []).find((p: any) => p && p.type === 'TSTypeLiteral')
      if (!typeLit) continue
      for (const mm of typeLit.members) {
        if (!mm || mm.type !== 'TSPropertySignature') continue
        const k = mm.key
        if (!k || (k.type !== 'Identifier' && k.type !== 'StringLiteral')) continue
        const name = k.type === 'Identifier' ? k.name : k.value
        if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
        const tn = mm.typeAnnotation?.typeAnnotation
        if (!tn) continue
        const t = source.slice(tn.start, tn.end).trim()
        const info = mapTsType(t, warnings, name)
        add(name, info, `defineProps<{ ${name}${mm.optional ? '?' : ''}: ${t} }>()`)
      }
    }
    return out
  }
  // —— 文本回退路径 ——
  const m = source.match(/\bdefineProps\s*\(\s*\{/)
  if (m) {
    const fbBody = extractBracedBody(source, (m.index ?? 0) + m[0].length - 1)
    if (fbBody === null) {
      warnings.push('defineProps 解析失败（MVP 仅支持对象形式 defineProps({...})），已忽略')
      return out
    }
    const re = /(['"]?)([A-Za-z_$][\w$]*)\1\s*:\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)/g
    let pm: RegExpExecArray | null
    while ((pm = re.exec(fbBody))) {
      const name = pm[2]
      const spec = pm[3].trim()
      let type = 'String'
      let value: unknown
      if (spec.startsWith('{')) {
        const typeM = spec.match(/type\s*:\s*([A-Za-z_$][\w$]*)/)
        if (typeM) type = typeM[1]
        const defM = spec.match(/default\s*:\s*([^,}]+)/)
        if (defM) value = evalLiteral(defM[1].trim())
      } else {
        type = spec
      }
      if (!['String', 'Number', 'Boolean', 'Object', 'Array', 'Function'].includes(type)) {
        warnings.push(`prop ${name} 的类型 ${type} 无法映射到微信 properties（MVP 支持 String/Number/Boolean/Object/Array），已按 String 处理`)
        type = 'String'
      }
      if (typeof value === 'function') {
        warnings.push(`prop ${name} 的 default 是函数（微信 properties.value 仅支持字面量），已忽略默认值`)
        value = undefined
      }
      if (value === undefined) {
        if (type === 'String') value = ''
        else if (type === 'Number') value = 0
        else if (type === 'Boolean') value = false
      }
      add(name, { type, value }, `defineProps({ ${name}: ... })`)
    }
    return out
  }
  // TS 泛型形式（v0.3 尾）：defineProps<{ label: string; count?: number }>()
  const tsM = source.match(/\bdefineProps\s*<\{([\s\S]*?)\}\s*>/)
  if (!tsM) return out
  const re2 = /([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([^;]+)/g
  let pm2: RegExpExecArray | null
  while ((pm2 = re2.exec(tsM[1]))) {
    const name = pm2[1]
    const info = mapTsType(pm2[3], warnings, name)
    add(name, info, `defineProps<{ ${name}${pm2[2] ?? ''}: ${pm2[3].trim()} }>()`)
  }
  return out
}

/** ★#497 批 2b watch 辅助：props 成员源（props.x → 字段名；非 props 对象 / 计算属性返回 undefined） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propsMemberField(n: any): string | undefined {
  if (!n || n.type !== 'MemberExpression' || n.computed) return undefined
  if (!n.object || n.object.type !== 'Identifier' || n.object.name !== 'props') return undefined
  if (!n.property || n.property.type !== 'Identifier') return undefined
  return n.property.name
}

/** ★#497 批 2b watch 辅助：getter 箭头的返回表达式——表达式体直接返回；块体仅支持单 return（多语句 getter 无法编译期内联 → null） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arrowGetterExpr(node: any): any | null {
  if (!node || node.type !== 'ArrowFunctionExpression') return null
  if (node.body.type !== 'BlockStatement') return node.body
  const sts = (node.body.body ?? []).filter((s: any) => s.type !== 'EmptyStatement')
  if (sts.length === 1 && sts[0].type === 'ReturnStatement' && sts[0].argument) return sts[0].argument
  return null
}

/** ★#497 批 2b watch 辅助：options 参数 immediate: true 定位（AST——旧文本 120 字符尾扫在大尾注释时会漏） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function watchOptionsImmediate(args: any[]): boolean {
  for (const a of args) {
    if (!a || a.type !== 'ObjectExpression') continue
    for (const p of a.properties ?? []) {
      if (p.type === 'ObjectProperty' && !p.computed && p.key && p.key.type === 'Identifier' && p.key.name === 'immediate') {
        if (p.value && p.value.type === 'BooleanLiteral' && p.value.value === true) return true
      }
    }
  }
  return false
}

/**
 * 提取顶层 watch 调用：watch(源, (newVal, oldVal) => { ... }[, { immediate: true }])
 * 源：单 ref（count）| 数组（[a, b]）| 函数（() => expr，依赖从 expr 的 x.value 提取）| ★props 源（props.x / () => props.x → WeChat observers）
 * ★#497 批 2b：AST 顶层发现——回调参数 TS 类型/解构天然剥除（astParamText）、options AST 定位、
 *   单参简写 (v => {}) 与 getter 块体（单 return）补支持；解析失败回退旧文本路径（永不比现状差）
 */
function extractWatch(
  source: string,
  data: Record<string, unknown>,
  warnings: string[],
  trace?: TransformTrace,
  allowPropWatch = true,
): Record<string, WatchInfo> {
  const out: Record<string, WatchInfo> = {}
  const body = topLevelAst(source)
  if (body) {
    for (const st of body) {
      if (st.type !== 'ExpressionStatement') continue
      const call = st.expression
      if (!call || call.type !== 'CallExpression') continue
      if (!call.callee || call.callee.type !== 'Identifier' || call.callee.name !== 'watch') continue
      const args = call.arguments ?? []
      const srcNode = args[0]
      const cbNode = args[1]
      if (!srcNode || !cbNode) continue
      if (cbNode.type !== 'ArrowFunctionExpression' && cbNode.type !== 'FunctionExpression') continue
      // MVP 仅块体回调（表达式体 watch 维持既有契约静默跳过）；async 回调旧文本不识别——同样跳过
      if (!cbNode.body || cbNode.body.type !== 'BlockStatement' || cbNode.async) continue
      const params = cbNode.params.map((p: any) => astParamText(source, p))
      const rawSrc = source.slice(srcNode.start, srcNode.end).trim()
      const line = st.loc.start.line
      const cbBody = extractBracedBody(source, cbNode.body.start)
      if (cbBody === null) {
        warnings.push(`watch ${rawSrc} 回调体解析失败，已跳过`)
        continue
      }
      const immediate = watchOptionsImmediate(args)
      // ★props 源（组件监听自身属性变化）：watch(props.x, cb) / watch(() => props.x, cb)
      //   Web 端即标准 Vue watch（全响应式）；MP 端编译为 Component observers（属性变化触发回调）
      let propField: string | undefined
      if (allowPropWatch) {
        propField = propsMemberField(srcNode)
        if (!propField && srcNode.type === 'ArrowFunctionExpression') {
          const g = arrowGetterExpr(srcNode)
          if (g) propField = propsMemberField(g)
        }
      }
      if (propField) {
        const id = `Prop${capitalize(propField)}`
        if (out[id]) {
          warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
        }
        trace?.add('script/watch-props', {
          line,
          before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
          after: `observers: { ${propField}(n, o) { ... }${immediate ? ' + proteusWatchPropX 方法（onReady 初始化调用一次——父传属性 attached 后才到位，#499）' : ''} }`,
        })
        out[id] = { id, deps: [], params, body: cbBody, immediate, line, propField }
        continue
      }
      // 解析源 → deps + 函数源 getter
      let deps: string[] = []
      let expr: string | undefined
      if (srcNode.type === 'Identifier') {
        // 单 ref
        deps = [srcNode.name]
      } else if (srcNode.type === 'ArrayExpression') {
        // 数组源 [a, b]（元素为顶层 ref 标识符；其他元素形态不参与依赖）
        deps = srcNode.elements.filter((el: any) => el && el.type === 'Identifier').map((el: any) => el.name)
      } else if (srcNode.type === 'ArrowFunctionExpression') {
        // 函数源 () => expr：依赖从 expr 的 x.value 提取；getter 转写为 this.data 形式
        const g = arrowGetterExpr(srcNode)
        if (!g) {
          warnings.push(`watch 源无法解析依赖（${rawSrc.slice(0, 40)}），已跳过`)
          continue
        }
        const getter = source.slice(g.start, g.end).trim()
        deps = [...new Set(Array.from(getter.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
        // ★#503 es5-safe：getter 表达式内 ?? / ?. → 显式 null 检查（进产物 watchTail/immediate）
        expr = getter.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
      } else {
        // 其余形态（props.x 成员在 script/watch-props 禁用时 / 方法调用源等）：按文本源名走缺失校验（旧文本单 ref 语义）
        deps = [rawSrc]
      }
      const missing = deps.filter((d) => !(d in data))
      if (missing.length) {
        warnings.push(`watch 依赖 ${missing.join('/')} 未在顶层 data 中定义（watch 的源必须是本文件顶层 ref/reactive）`)
        continue
      }
      if (!deps.length) {
        warnings.push(`watch 源无法解析依赖（${rawSrc.slice(0, 40)}），已跳过`)
        continue
      }
      const id = deps.map((d) => capitalize(d)).join('And')
      if (out[id]) {
        warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
      }
      trace?.add('script/watch-to-methods', {
        line,
        before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
        after: `proteusWatch${id}（${deps.join('/')} 写入 setData 后自动调用${immediate ? '，immediate 初始化一次' : ''}）`,
      })
      out[id] = { id, deps, params, body: cbBody, immediate, line, expr }
    }
    return out
  }
  // —— 文本回退路径 ——
  const re = /^watch\s*\(\s*([\s\S]*?)\s*,\s*(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\)\s*)\s*\{/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue
    const rawSrc = m[1].trim()
    const params = (m[2] ?? m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    let propField: string | undefined
    if (allowPropWatch && rawSrc.startsWith('props.')) {
      propField = rawSrc.slice('props.'.length).trim().replace(/\.value$/, '')
    } else if (allowPropWatch && rawSrc.startsWith('()')) {
      const getter = rawSrc.replace(/^\(\)\s*=>\s*/, '').trim()
      const pm = getter.match(/^props\.([A-Za-z_$][\w$]*)$/)
      if (pm) propField = pm[1]
    }
    if (propField) {
      const braceIdx = m.index + m[0].length - 1
      const fbBody = extractBracedBody(source, braceIdx)
      if (fbBody === null) {
        warnings.push(`watch ${rawSrc} 回调体解析失败，已跳过`)
        continue
      }
      const after = source.slice(braceIdx + fbBody.length + 1, braceIdx + fbBody.length + 120)
      const immediate = /immediate\s*:\s*true/.test(after)
      const id = `Prop${capitalize(propField)}`
      if (out[id]) {
        warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
      }
      trace?.add('script/watch-props', {
        line: lineAt(source, m.index),
        before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
        after: `observers: { ${propField}(n, o) { ... }${immediate ? ' + proteusWatchPropX 方法（onReady 初始化调用一次——父传属性 attached 后才到位，#499）' : ''} }`,
      })
      out[id] = { id, deps: [], params, body: fbBody, immediate, line: lineAt(source, m.index), propField }
      continue
    }
    let deps: string[] = []
    let expr: string | undefined
    if (rawSrc.startsWith('[')) {
      deps = Array.from(rawSrc.matchAll(/\b([A-Za-z_$][\w$]*)\b/g), (mm) => mm[1])
    } else if (rawSrc.startsWith('()')) {
      const getter = rawSrc.replace(/^\(\)\s*=>\s*/, '')
      deps = [...new Set(Array.from(getter.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
      expr = getter.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
    } else {
      deps = [rawSrc]
    }
    const missing = deps.filter((d) => !(d in data))
    if (missing.length) {
      warnings.push(`watch 依赖 ${missing.join('/')} 未在顶层 data 中定义（watch 的源必须是本文件顶层 ref/reactive）`)
      continue
    }
    if (!deps.length) {
      warnings.push(`watch 源无法解析依赖（${rawSrc.slice(0, 40)}），已跳过`)
      continue
    }
    const id = deps.map((d) => capitalize(d)).join('And')
    const braceIdx = m.index + m[0].length - 1
    const fbBody = extractBracedBody(source, braceIdx)
    if (fbBody === null) {
      warnings.push(`watch ${rawSrc} 回调体解析失败，已跳过`)
      continue
    }
    const after = source.slice(braceIdx + fbBody.length + 1, braceIdx + fbBody.length + 120)
    const immediate = /immediate\s*:\s*true/.test(after)
    if (out[id]) {
      warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
    }
    trace?.add('script/watch-to-methods', {
      line: lineAt(source, m.index),
      before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
      after: `proteusWatch${id}（${deps.join('/')} 写入 setData 后自动调用${immediate ? '，immediate 初始化一次' : ''}）`,
    })
    out[id] = { id, deps, params, body: fbBody, immediate, line: lineAt(source, m.index), expr }
  }
  return out
}

/** 提取顶层 const 中的 computed（箭头简写 + 表达式体），返回派生信息 */
function extractComputedFromInit(
  name: string,
  init: string,
  data: Record<string, unknown>,
  warnings: string[],
  computedNames?: Set<string>,
): ComputedInfo | null {
  // 箭头简写：computed(() => 表达式)（表达式体；块体 → 整段求值方法）
  const arrow = init.match(/^computed(?:<[^>]*>)?\s*\(\s*\(\)\s*=>\s*([\s\S]*?)\s*\)\s*;?$/)
  // 对象形式（v0.3 尾写路径）：computed({ get: () => expr[, set: (v) => { body }] })
  let rawExpr: string | undefined
  let setter: { param: string; body: string } | undefined
  if (arrow) {
    rawExpr = arrow[1]
    if (rawExpr.trim().startsWith('{')) {
      // ★#499 块体 computed 支持：整段求值编译为 proteusCalcX() 方法（内部语句任意：局部变量/分支/模块函数），
      //   依赖=全文 x.value 读取（与 Vue 响应依赖语义对齐）；末语句须为 return 表达式（否则无派生值 → 旧警告路径）
      const blockBody = extractBracedBody(init, init.indexOf('{', init.indexOf('=>')))
      if (blockBody === null || !/\breturn\s+[\s\S]*$/.test(blockBody)) return null
      const depsB = [...new Set(Array.from(blockBody.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
      const missingB = depsB.filter((d) => !(d in data) && !(computedNames?.has(d)))
      if (missingB.length) {
        warnings.push(
          `computed ${name} 依赖 ${missingB.join('/')} 未在顶层 data 中定义（${name} 的依赖必须是本文件顶层 ref/reactive）`,
        )
      }
      return { name, deps: depsB, expr: `this.proteusCalc${capitalize(name)}()`, blockBody }
    }
  } else {
    const objM = init.match(/^computed(?:<[^>]*>)?\s*\(\s*\{/)
    if (!objM) return null
    const body = extractBracedBody(init, (objM.index ?? 0) + objM[0].length - 1)
    if (body === null) return null
    const getM = body.match(/\bget\s*:\s*\(\)\s*=>\s*([\s\S]*?)(?=,\s*\bset\s*:|$)/)
    rawExpr = getM?.[1]?.trim()
    if (!rawExpr || rawExpr.startsWith('{')) return null
    const setM = body.match(/\bset\s*:\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\}/)
    if (setM) setter = { param: setM[1].trim(), body: setM[2] }
  }
  const deps = [...new Set(Array.from(rawExpr.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
  const missing = deps.filter((d) => !(d in data) && !(computedNames?.has(d)))
  if (missing.length) {
    warnings.push(
      `computed ${name} 依赖 ${missing.join('/')} 未在顶层 data 中定义（${name} 的依赖必须是本文件顶层 ref/reactive）`,
    )
  }
  // 转写：x.value → this.data.x（与 ref 读取重写一致）；★#503 es5-safe（?? / ?. → 显式 null 检查）
  const expr = rawExpr.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
  return { name, deps, expr, setter }
}

/** 顶层 const（ref/reactive/字面量）→ data 初始值 + computed 派生信息 + ★B0 运行时初始化（函数调用） */
/** ★#497 动作二批 1：单条顶层 const 分类（AST 与文本回退共用）——宏跳过/函数跳过/computed 收集/ref·字面量→data/调用→runtimeInit */
function handleConstToData(
  name: string,
  init: string,
  line: number,
  out: { data: Record<string, unknown>; runtimeInits: Array<{ name: string; call: string }>; rawComputed: Array<{ name: string; init: string; line: number }> },
  warnings: string[],
  trace?: TransformTrace,
): void {
  // 组件宏（defineProps/defineEmits/defineExpose）：编译期指令，不提取 data（defineProps< 泛型形式兼容）
  if (/^(?:defineProps\s*[<(]|defineEmits\s*\(|defineExpose\s*\()/.test(init)) return
  // 跳过函数/箭头函数（属于 methods）
  if (/^(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(init)) return
  // computed 读路径（v0.3）：收集后统一处理（依赖可能定义在其后）
  if (/^computed(?:<[^>]*>)?\s*\(/.test(init)) {
    out.rawComputed.push({ name, init, line })
    return
  }
  trace?.add('script/const-to-data', {
    line,
    before: `const ${name} = ${init.slice(0, 40)}${init.length > 40 ? '…' : ''}`,
    after: `data.${name}`,
  })
  const inner = init.match(/^(?:ref|reactive|shallowRef|readonly)\s*\(\s*([\s\S]*?)\s*\);?\s*$/)
  const raw = inner ? inner[1] : init
  const value = evalLiteral(raw)
  const isCall = /^[\w$.]+\(/.test(raw.trim())
  if (isCall && value === undefined && !/^inject\s*\(/.test(raw.trim())) {
    // ★module-plan B0：函数调用且静态求值失败 → 运行时初始化（实例属性 this.<name>，onLoad/attached 注入）——不再丢调用
    // inject 是 Vue 内置注入（Batch 3）不走此路径（data 初始 undefined + 运行时 setData 填充）
    // ★#503 es5-safe：运行时初始化调用串内 ?? / ?. → 显式 null 检查（原样进产物 onLoad/attached）
    out.runtimeInits.push({ name, call: raw.trim() })
    trace?.add('script/runtime-init', {
      line,
      before: `const ${name} = ${raw.slice(0, 40)}`,
      after: `this.${name} = ${raw.trim()}（onLoad/attached 运行时初始化，实例属性；模板绑定不支持）`,
    })
    warnings.push(
      `const ${name} 的初始值 "${raw.slice(0, 40)}" 是函数调用——已编译为运行时初始化 this.${name}（onLoad/attached 执行，实例属性：模板绑定不支持，逻辑层可用；共享逻辑请用模块 import，见 docs/proteus-module-plan/）`,
    )
    return // 不进 data（运行时实例属性）
  }
  if (value === undefined && raw !== 'undefined' && !/^inject\s*\(/.test(raw.trim())) {
    warnings.push(`const ${name} 的初始值 "${raw.slice(0, 40)}" 无法静态求值，data.${name} 将设为 undefined（MVP 限制：仅支持字面量）`)
  }
  // ★#502 反黑盒：非有限数（Infinity/NaN）进 data → 微信 setData 序列化约束整次放弃/静默变 null（p-modal variants 真机根因）——编译期显式警告
  const hasNonFinite = (o: unknown): boolean => {
    if (typeof o === 'number') return !Number.isFinite(o)
    if (Array.isArray(o)) return o.some(hasNonFinite)
    if (o && typeof o === 'object') return Object.values(o).some(hasNonFinite)
    return false
  }
  if (hasNonFinite(value)) {
    warnings.push(`const ${name} 含非有限数（Infinity/NaN）——小程序 setData 数据须可 JSON 序列化，整次 setData 会被放弃/字段静默变 null：请改用 Number.MAX_SAFE_INTEGER 表达无上界`)
  }
  out.data[name] = value
}

/** 顶层 const（ref/reactive/字面量）→ data 初始值 + computed 派生信息 + ★B0 运行时初始化（函数调用）
 *  ★#499 另收顶层 let（null 初始化句柄 aware/query/env）→ letHandles（实例属性通道——裸引用/赋值由 rewriteBareMethodCalls 改 this.x；
 *  此前 let 整个丢失 → 方法体裸引用 ReferenceError：p-modal aware 真机崩） */
function extractData(
  source: string,
  warnings: string[],
  trace?: TransformTrace,
): {
  data: Record<string, unknown>
  computed: Record<string, ComputedInfo>
  runtimeInits: Array<{ name: string; call: string }>
  letHandles: string[]
} {
  const data: Record<string, unknown> = {}
  const runtimeInits: Array<{ name: string; call: string }> = []
  const letHandles: string[] = []
  const rawComputed: Array<{ name: string; init: string; line: number }> = []
  const out = { data, runtimeInits, rawComputed }
  /** let 句柄判定：顶层 null/undefined 初始化（声明后方法体内赋值使用）——其它形态维持旧行为 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addLetHandle = (name: string, init: string | null, line: number): void => {
    if (!name || letHandles.includes(name)) return
    if (init !== null && init !== 'null' && init !== 'undefined') return
    letHandles.push(name)
    trace?.add('script/const-to-data', {
      line,
      before: `let ${name} = ${init ?? 'null'}`,
      after: `实例属性句柄（方法体裸引用/赋值改 this.${name}；不进 data）`,
    })
  }
  // ★#497 动作二：AST 发现（顶层 const，天然剥注释/类型/泛型）；失败回退文本正则（永不比现状差）
  const body = topLevelAst(source)
  if (body) {
    for (const st of body) {
      if (st.type !== 'VariableDeclaration') continue
      for (const d of st.declarations) {
        if (!d.id || d.id.type !== 'Identifier') continue
        if (st.kind === 'const' && d.init) {
          // AST 区间切片——行尾注释不在 init 范围（#497 根因）、TS 类型在类型节点不在文本
          const init = source.slice(d.init.start, d.init.end)
          handleConstToData(d.id.name, init, st.loc.start.line, out, warnings, trace)
        } else if (st.kind === 'let') {
          addLetHandle(d.id.name, d.init ? source.slice(d.init.start, d.init.end) : null, st.loc.start.line)
        }
      }
    }
  } else {
    // 只提取行首（缩进 0）的顶层 const：函数体/生命周期体/块内的局部 const 天然跳过（文本回退路径）
    const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      const lineStart = source.lastIndexOf('\n', m.index) + 1
      if (source.slice(lineStart, m.index) !== '') continue
      const name = m[1]
      const initRaw = extractInitializer(source, m.index + m[0].length)
      if (!initRaw) continue
      const init = stripTrailingComment(initRaw)
      handleConstToData(name, init, lineAt(source, m.index), out, warnings, trace)
    }
    // 顶层 let 句柄（文本回退）
    const letRe = /let\s+([A-Za-z_$][\w$]*)\s*=\s*(null|undefined)\s*;?/gm
    let lm: RegExpExecArray | null
    while ((lm = letRe.exec(source))) {
      const lineStart = source.lastIndexOf('\n', lm.index) + 1
      if (source.slice(lineStart, lm.index) !== '') continue
      addLetHandle(lm[1], lm[2], lineAt(source, lm.index))
    }
  }
  // 二次处理 computed（此时 data 已完整，可校验依赖）
  const computed: Record<string, ComputedInfo> = {}
  // ★#499 computed 链（visibleItems 依赖 visibleCount）：缺依赖校验须容忍另一 computed——链 dep 不再误报
  const computedNames = new Set(rawComputed.map((c) => c.name))
  for (const c of rawComputed) {
    const info = extractComputedFromInit(c.name, c.init, data, warnings, computedNames)
    if (info) {
      computed[c.name] = info
      trace?.add('script/computed-to-data', {
        line: c.line,
        before: `const ${c.name} = computed(() => ...)`,
        after: `派生字段（依赖 ${info.deps.join('/') || '无'}，写入时合并重算）`,
      })
    } else {
      warnings.push(`computed ${c.name} 仅支持箭头简写表达式体（computed(() => expr)）或块体（末语句 return 表达式），已忽略`)
    }
  }
  return { data, computed, runtimeInits, letHandles }
}

/** 顶层方法（源码 + 起始行号，供 sourcemap / 行号注释） */
interface MethodInfo {
  /** 方法体源码（含参数，产物方法简写） */
  src: string
  /** 源码起始行（1-based） */
  line: number
}

/** 剥离方法参数 TS 类型标注（产物是 JS；e: { detail?: number } → e）
 *  ★#494 兼容泛型参数（Record<string, unknown>）：深度计数扫描——旧实现 [^,)]+ 被逗号截断，
 *  泛型含逗号时残留碎片混进参数名（devtools-open-api-demo 语法错误）。尾部逗号由后续 trim 收口 */
function stripParamTypes(params: string): string {
  let depth = 0
  let out = ''
  let i = 0
  while (i < params.length) {
    const ch = params[i]
    if (ch === '<' || ch === '[' || ch === '(') depth++
    else if (ch === '>' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ':' && depth === 0) {
      i++
      while (i < params.length) {
        const c2 = params[i]
        if (c2 === '<' || c2 === '[' || c2 === '(') depth++
        else if (c2 === '>' || c2 === ']' || c2 === ')') depth = Math.max(0, depth - 1)
        else if (c2 === ',' && depth === 0) break
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
    .split(',')
    .map((p) => p.trim().replace(/\?$/, '')) // ★#494 剥参数可选标记 ?（JS 无此语法——TS 可选参数）
    .filter(Boolean)
    .join(', ')
    .replace(/,\s*,/g, ',')
    .trim()
}

/**
 * defineExpose 校验（v0.3 尾）：小程序组件 methods 天然可被 selectComponent 访问 → 编译期 no-op；
 * 校验声明成员：方法 ✓；ref 值（data 字段）暴露无对等机制 → 警告（请用方法包装）
 */
function checkDefineExpose(
  source: string,
  data: Record<string, unknown>,
  warnings: string[],
  trace?: TransformTrace,
): void {
  const m = source.match(/\bdefineExpose\s*\(\s*\{([\s\S]*?)\}\s*\)/)
  if (!m) return
  const names = Array.from(m[1].matchAll(/([A-Za-z_$][\w$]*)/g), (mm) => mm[1])
  trace?.add('script/define-expose', {
    before: `defineExpose({ ${names.join(', ')} })`,
    after: 'no-op（组件 methods 天然可被 selectComponent 访问）',
  })
  for (const n of names) {
    if (n in data) {
      warnings.push(`defineExpose 暴露的 ${n} 是 ref 值（小程序无对等机制，外部仅可访问 methods），已忽略——请用方法包装`)
    }
  }
}

/** 顶层函数（function 声明 / const 箭头）→ methods 源码 */
function extractMethods(source: string, warnings: string[], trace?: TransformTrace, disabled?: Set<string>): Record<string, MethodInfo> {
  const methods: Record<string, MethodInfo> = {}
  // ★#497 动作二批 1：共享方法入册（AST 与文本回退共用）
  const addMethod = (kind: 'fn' | 'arrow', name: string, paramsText: string, isAsync: boolean, line: number, body: string | null): void => {
    if (body === null) {
      if (kind === 'fn') warnings.push(`函数 ${name} 体解析失败，已跳过`)
      return
    }
    trace?.add(kind === 'fn' ? 'script/function-to-methods' : 'script/arrow-to-methods', {
      line,
      before: kind === 'fn' ? `function ${name}(...)` : `const ${name} = (...) =>`,
      after: `${name}(${paramsText})`,
    })
    // 对象字面量方法简写：handleTap() {...}（不能输出裸 function 声明；async 保留——方法体 await 合法）
    methods[name] = { src: `${isAsync ? 'async ' : ''}${name}(${paramsText}) {\n${body}\n}`, line }
  }
  const fnEnabled = !disabled?.has('script/function-to-methods')
  const arrowEnabled = !disabled?.has('script/arrow-to-methods')
  const body = topLevelAst(source)
  if (body) {
    for (const st of body) {
      if (st.type === 'FunctionDeclaration' && fnEnabled && st.id) {
        const params = st.params.map((p: any) => astParamText(source, p)).join(', ')
        addMethod('fn', st.id.name, params, Boolean(st.async), st.loc.start.line, extractBracedBody(source, st.body.start))
        continue
      }
      if (st.type === 'VariableDeclaration' && arrowEnabled && st.kind === 'const') {
        for (const d of st.declarations) {
          if (!d.id || d.id.type !== 'Identifier' || !d.init) continue
          const init = d.init
          if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') continue
          const fnLike = init
          const params = fnLike.params.map((p: any) => astParamText(source, p)).join(', ')
          if (fnLike.body.type === 'BlockStatement') {
            addMethod('arrow', d.id.name, params, Boolean(fnLike.async), st.loc.start.line, extractBracedBody(source, fnLike.body.start))
          }
        }
      }
    }
  } else {
    // 文本回退路径
    if (fnEnabled) {
      const fnRe = /(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[A-Za-z_$][\w$.<>\[\]]*)?\s*\{/g
      let m: RegExpExecArray | null
      while ((m = fnRe.exec(source))) {
        const params = stripParamTypes(m[3])
        addMethod('fn', m[2], params, Boolean(m[1]), lineAt(source, m.index), extractBracedBody(source, m.index + m[0].length - 1))
      }
    }
    if (arrowEnabled) {
      const arrowRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\(([^)]*)\)\s*=>\s*\{/g
      let m: RegExpExecArray | null
      while ((m = arrowRe.exec(source))) {
        const params = stripParamTypes(m[3])
        const braceIdx = source.indexOf('{', m.index + m[0].length - 1)
        addMethod('arrow', m[1], params, Boolean(m[2]), lineAt(source, m.index), extractBracedBody(source, braceIdx))
      }
    }
  }
  return methods
}

/**
 * 方法/生命周期体中的 setup ref 访问重写（MVP 能力）
 * - name.value = expr    → this.setData({ name: expr })
 * - name.value++ / --    → this.setData({ name: (null 检查 ? 0 : this.data.name) + 1 })（含前置 ++ 形式）
 * - name.value（读取）    → this.data.name
 * 未覆盖：复合赋值（+= 等）降级为 this.data.name 读写（不触发 setData）
 * 注意：不能用 `??`（真机预览报 SyntaxError: Unexpected token ?），统一显式 null 检查
 */
function numOrZero(expr: string): string {
  return `(${expr} === undefined || ${expr} === null ? 0 : ${expr})`
}

/** ★#499 派生/联动表达式 propsVar 归一：props.x → this.data.x（computedPatch/watchTail/immediate 共用；computedInitLine 已自带该改写） */
function rewritePropsInExpr(expr: string, propsVar?: string): string {
  if (!propsVar) return expr
  return expr.replace(new RegExp(`\\b${propsVar}\\.([A-Za-z_$][\\w$]*)`, 'g'), 'this.data.$1')
}

/** ★#499 observers 回调参数归一：开发者回调参数 (w) → (n, o)（微信 observers 形参固定 n/o 语义——旧产物签名 (n,o) 但回调体仍引用 w → ReferenceError：p-modal width 真机崩） */
function renameWatchParamsToNo(body: string, params: string[]): string {
  const names = ['n', 'o']
  let out = body
  for (let i = 0; i < params.length && i < names.length; i++) {
    const p = params[i].trim()
    if (!p || p === names[i] || !/^[A-Za-z_$][\w$]*$/.test(p)) continue
    out = out.replace(new RegExp(`\\b${p}\\b`, 'g'), names[i])
  }
  return out
}

/** ★#500 computed 派生补丁条目：BFS 闭包（依赖链：写 c.value 的 computed 也随依赖 ref 写入重算——p-sidebar toggle 后 rootClass/layoutStyle 链式刷新）；expr 已做 propsVar 归一；chained = 存在补丁项依赖另一补丁项 */
function computedPatchEntries(
  writtenRef: string,
  computeds: Record<string, ComputedInfo>,
  propsVar?: string,
): { entries: Array<{ n: string; expr: string }>; chained: boolean } {
  const names: string[] = []
  let level = [writtenRef]
  const seen = new Set([writtenRef])
  while (level.length) {
    const next: string[] = []
    for (const [n, c] of Object.entries(computeds)) {
      if (seen.has(n)) continue
      if (c.deps.some((d) => level.includes(d))) {
        next.push(n)
        seen.add(n)
      }
    }
    for (const n of next) names.push(n)
    level = next
  }
  const entries = names.map((n) => ({ n, expr: rewritePropsInExpr(computeds[n].expr, propsVar) }))
  const entryNames = new Set(names)
  const chained = entries.some((e) => computeds[e.n].deps.some((d) => d !== writtenRef && entryNames.has(d)))
  return { entries, chained }
}

/** onLoad 初始化行：一次性计算全部 computed 派生字段（首次渲染前 data 就绪） */
function computedInitLine(computeds: Record<string, ComputedInfo>, runtimeInitNames?: Set<string>, propsVar?: string): string {
  const entries = Object.entries(computeds)
  if (!entries.length) return ''
  // ★#495c computed 表达式内 runtimeInit 裸名 → this.x（gridClass 依赖 gridOk=detectFluidCapabilities() runtimeInit——
  //  裸名词法查找 ReferenceError：p-grid attached 崩）；props.gap → this.data.gap（与方法体 propsVar 重写一致）
  const rewrite = (expr: string): string => {
    let out = expr
    if (propsVar) out = out.replace(new RegExp(`\\b${propsVar}\\.([A-Za-z_$][\\w$]*)`, 'g'), 'this.data.$1')
    if (runtimeInitNames) {
      for (const name of runtimeInitNames) {
        out = out.replace(new RegExp(`(?<!\\.)\\b${name}\\b`, 'g'), `this.${name}`)
      }
    }
    return out
  }
  const rewritten = entries.map(([n, c]) => [n, rewrite(c.expr)] as const)
  // ★#499 computed 链（visibleItems 依赖 visibleCount）：单对象 setData 内求值读不到前驱新值（setData 未应用）——
  //   链存在时先顺序写入 this.data 再统一 setData（源码声明序即依赖序：JS TDZ 保证被引用 computed 在前）
  const hasChain = entries.some(([, c]) => c.deps.some((d) => d in computeds))
  if (hasChain) {
    const assigns = rewritten.map(([n, expr]) => `this.data.${n} = ${expr}`)
    return `${assigns.join('\n')}\nthis.setData({ ${rewritten.map(([n]) => `${n}: this.data.${n}`).join(', ')} })`
  }
  return `this.setData({ ${rewritten.map(([n, expr]) => `${n}: ${expr}`).join(', ')} })`
}

/** ★module-plan B0：函数调用初始化运行时注入（实例属性 this.<name> = <call>，onLoad/attached 执行）
 *  ★#494 call 为本页方法名（methodNames 命中）→ this.<method>() 裸调用改写——
 *  微信 Page 顶层方法必须 this 调用（词法查找必 ReferenceError：config-demo 的 makeGuardStyle 白屏根因之一）
 *  ★2026-09-07 同族坑②：call 表达式内其它 runtimeInit 实例裸引用 → this.<name>（dev-host `const metrics =
 *  host.getMetrics()` → this.metrics = host.getMetrics() 中 host 未 this 化 → onLoad ReferenceError） */
function runtimeInitLine(inits: Array<{ name: string; call: string }>, methodNames?: Set<string>, runtimeInitNames?: Set<string>): string {
  return inits
    .map((i) => {
      let call = i.call
      if (methodNames) {
        const m = call.match(/^([A-Za-z_$][\w$]*)\s*\(/)
        if (m && methodNames.has(m[1])) call = `this.${call}`
      }
      if (runtimeInitNames) {
        // call 内其它 runtimeInit 实例裸名 → this.<name>（链式 base / 参数引用；与 computedInitLine rewrite 同规则；
        //   声明顺序 = 源码序（inits 数组），前序实例已 this 赋值，后续引用安全）
        for (const n of runtimeInitNames) {
          if (n === i.name) continue // 自引用（递归 const 非法，保守跳过）
          call = call.replace(new RegExp(`(?<!\\.)\\b${n}\\b`, 'g'), `this.${n}`)
        }
      }
      return `this.${i.name} = ${call}`
    })
    .join('\n')
}

/**
 * ★#494 app-config 绑定桥（Pinia store 桥的对位物）：
 * - useAppConfig() → getConfig()（命令式读取，无 Vue 实例要求——MP 页面 setup 体在 onLoad 执行，getCurrentInstance() 恒 null）
 * - useFeatureFlag(k) → getFeatureFlag(getConfig(), k)（纯函数）
 * - 生成快照 setData + onAppConfigChange 订阅刷新（模板 {{ appConf.x }} 直接读 data.appConf.x）
 */
function isAppConfigCall(call: string): boolean {
  return /^useAppConfig\s*\(\s*\)$/.test(call) || /^useFeatureFlag\s*\(/.test(call)
}

/** runtimeInit 调用改写：useAppConfig/useFeatureFlag → 命令式等价（原调用在 onLoad 无 Vue 实例必炸） */
function rewriteAppConfigCall(call: string): string {
  const flag = call.match(/^useFeatureFlag\s*\((.*)\)\s*$/)
  if (flag) return `getFeatureFlag(getConfig(), ${flag[1].trim()})`
  return 'getConfig()'
}

/** app-config 绑定初始化行：快照 setData + 订阅刷新 + onUnload 退订句柄 */
function appConfigBindingLine(bindings: Array<{ name: string; expr: string }>): string {
  const map = bindings.map((b) => `${b.name}: ${b.expr}`).join(', ')
  return [
    'const __self = this',
    `this.setData({ ${map} })`,
    `this.__appConfigUnsub = onAppConfigChange(function () { __self.setData({ ${map} }) })`,
  ].join('\n')
}

/**
 * ★#494 顶层副作用语句提取：零缩进单行表达式语句（如 initAppConfig(x) / registerCapability(x)）→
 * 依序注入 onLoad 最前（先于 runtimeInits——初始化必须先于读取）。此前这类语句被静默丢弃（反黑盒缺口）。
 * 仅保留「调用形态」语句；赋值/其他形态不识别（保守面，误抓面最小）。
 */
function extractTopLevelCalls(source: string, warnings: string[], trace?: TransformTrace): string[] {
  const out: string[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || line[0] === ' ' || line[0] === '\t' || line.startsWith('//')) continue
    // 形态：fn(...) 或 await fn(...)（单行闭合）；排除已被专门通道识别的形态
    const m = t.match(/^(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\((.*)\)\s*;?$/)
    if (!m) continue
    const fn = m[1]
    // ★2026-09-07 同族坑①：语句关键字开头被误当函数调用（`if (typeof window !== 'undefined')
    //   window.addEventListener('resize', onResize)` → fn='if' 整行注入 onLoad——onResize 方法裸引用在
    //   resize 触发时 ReferenceError + if 语义错乱）——排除语句关键字（首个标识符）
    if (/^(if|for|while|switch|do|return|throw|try|catch|else|new|delete|typeof|void|in|instanceof|case|default|break|continue)\b/.test(t)) continue
    // 专门通道已有归属的形态跳过（provide/inject/watch/computed/生命周期宏）
    if (/^(provide|inject|watch|computed|onLoad|onShow|onHide|onReady|onUnload|defineProps|defineEmits|defineExpose|defineAppConfig)\b/.test(fn)) continue
    // 字符串内不含换行即视为单行闭合（保守：多行调用不抓，避免误截）
    if ((m[2].match(/['"`]/g) ?? []).length % 2 !== 0) continue
    out.push(t.replace(/;$/, ''))
    trace?.add('script/top-level-calls', {
      line: i + 1,
      before: t.slice(0, 60),
      after: `onLoad 前置执行（顶层副作用语句保留——此前被静默丢弃）`,
    })
  }
  if (out.length) {
    warnings.push(
      `顶层副作用调用 ${out.length} 条（${out[0].slice(0, 40)}${out.length > 1 ? ` 等 ${out.length} 条` : ''}）已注入 onLoad 初始化序（外部 init 前置/实例方法调用后置 this 化）——MP 页面无模块级作用域，初始化类调用请确保幂等`,
    )
  }
  return out
}

/**
 * ★pinia-plan 12 P1：模板 store 绑定注入——useXxxStore() 实例属性 + Pinia $subscribe → setData 同步
 * 字段映射：<field>: store.<field>（Pinia getter 访问；setData 后模板 {{ field }} 生效）
 */
function storeBindingLine(fields: string[], storeVar: string): string {
  const map = fields.map((f) => `${f}: __self.${storeVar}.${f}`).join(', ')
  return [
    'const __self = this',
    `this.setData({ ${map} })`,
    `if (this.${storeVar} && this.${storeVar}.$subscribe) {`,
    `  this.${storeVar}.$subscribe(function () { __self.setData({ ${map} }) })`,
    `}`,
  ].join('\n')
}

/** immediate watch 初始化行：onLoad/就绪时调用一次（单源标量 / 多源数组，oldVal = undefined；函数源 expr 含 props 时归一） */
function immediateWatchLine(watches: Record<string, WatchInfo>, propsVar?: string): string {
  const lines = Object.entries(watches)
    .filter(([, w]) => w.immediate)
    .map(([, w]) => {
      const single = w.deps.length === 1
      const getter = w.expr ? rewritePropsInExpr(w.expr, propsVar) : undefined
      const newVals = w.propField
        ? `this.data.${w.propField}`
        : single
          ? (getter ?? `this.data.${w.deps[0]}`)
          : `[${(getter ?? w.deps.map((d) => `this.data.${d}`).join(', '))}]`
      const oldVals = w.propField ? 'undefined' : single ? 'undefined' : `[${w.deps.map(() => 'undefined').join(', ')}]`
      return `this.proteusWatch${w.id}(${newVals}, ${oldVals})`
    })
  return lines.join('\n')
}

/**
 * setData 写入模板：有派生补丁 / watch 联动 / 前置写时先更新 this.data.name 再 setData——
 * 保证同一 setData 对象里的派生表达式读到该 ref 的**新值**（setData 异步批量，对象内求值用当前 this.data）
 * ★#500 computed 链（补丁项依赖另一补丁项）：单对象内求值读不到前驱新值 → 先顺序赋值 this.data 再统一 setData（无链保持既有产物形态）
 */
function writeSetData(
  name: string,
  valueExpr: string,
  patch: { entries: Array<{ n: string; expr: string }>; chained: boolean },
  hasWatch = false,
  forceWrite = false,
): string {
  const needWrite = forceWrite || patch.entries.length > 0 || hasWatch
  if (!needWrite) return `this.setData({ ${name}: ${valueExpr} })`
  if (!patch.chained) {
    const map = patch.entries.map((e) => `${e.n}: ${e.expr}`).join(', ')
    return `this.data.${name} = ${valueExpr}; this.setData({ ${name}: this.data.${name}${map ? `, ${map}` : ''} })`
  }
  const assigns = [`this.data.${name} = ${valueExpr}`, ...patch.entries.map((e) => `this.data.${e.n} = ${e.expr}`)]
  const map = [name, ...patch.entries.map((e) => e.n)].map((n) => `${n}: this.data.${n}`).join(', ')
  return `${assigns.join('; ')}; this.setData({ ${map} })`
}

/** watch 联动调用：setData 后追加分号 + proteusWatch<id>（单源回调标量 / 多源回调数组，旧值由调用方在写入前保存） */
function watchTail(w: WatchInfo | undefined, propsVar?: string): string {
  if (!w) return ''
  const single = w.deps.length === 1
  const getter = w.expr ? rewritePropsInExpr(w.expr, propsVar) : undefined
  const newVals = single ? (getter ?? `this.data.${w.deps[0]}`) : `[${(getter ?? w.deps.map((d) => `this.data.${d}`).join(', '))}]`
  const oldVals = single ? `old${capitalize(w.deps[0])}` : `[${w.deps.map((d) => `old${capitalize(d)}`).join(', ')}]`
  return `; this.proteusWatch${w.id}(${newVals}, ${oldVals})`
}

/**
 * ★#496c 柔性语义编译：p-grid 档位求解段——onLoad 屏幕宽近似（px，首帧即近似不错闪）
 */
function semanticGridInitCode(grids: Array<{ minColWidth: number; gap: number; index: number }>): string {
  if (!grids.length) return ''
  const perGrid = grids
    .map((g) => {
      const cols = `Math.max(1, Math.floor((__pw + ${g.gap}) / (${g.minColWidth} + ${g.gap})))`
      return `__sb[${JSON.stringify(`pgridStyle${g.index}`)}] = 'flex-grow:0; flex-shrink:0; flex-basis:' + Math.floor((__pw - (${cols} - 1) * ${g.gap}) / ${cols}) + 'px'`
    })
    .join('\n')
  return [
    "const __pw = (typeof wx !== 'undefined' && wx.getWindowInfo) ? wx.getWindowInfo().screenWidth : 375",
    'const __sb = {}',
    perGrid,
    'this.setData(__sb)',
  ].join('\n')
}

/**
 * ★#496d 柔性语义编译：p-grid 档位函数 + resize 重算（onReady 注入）——
 * ①SelectorQuery 实测容器宽（页面 padding 下屏宽近似会溢出，#496b）②wx.onWindowResize 重算：
 * 模拟器拖动宽度/真机旋转后 onLoad/onReady 不重跑，旧 px 档会让大容器一列且不满（复测根因）
 * ③onUnload 注销 resize（this.__pgOff）。回调 ES5 风格。
 */
function semanticGridReadyCode(grids: Array<{ minColWidth: number; gap: number; index: number }>): string {
  if (!grids.length) return ''
  const refreshBody = grids
    .map((g) => {
      const MC = g.minColWidth
      const GP = g.gap
      return [
        "var __q = wx.createSelectorQuery()",
        `__q.select('#pgrid${g.index}').boundingClientRect(function (rect) {`,
        '  if (rect && rect.width > 0) {',
        '    var w = rect.width',
        `    var cols = Math.max(1, Math.floor((w + ${GP}) / (${MC} + ${GP})))`,
        // ★#496f 整 px 向下取整（小数 basis 总和=容器宽在 Skyline 取整方向不确定 → 溢出 wrap 单列不满）
        `    var basis = Math.floor((w - (cols - 1) * ${GP}) / cols)`,
        `    console.log('[proteus][pgrid${g.index}] w=' + w + ' cols=' + cols + ' basis=' + basis + 'px')`,
        `    __self.setData({ ${JSON.stringify(`pgridStyle${g.index}`)}: 'flex-grow:0; flex-shrink:0; flex-basis:' + basis + 'px' })`,
        '  }',
        '}).exec()',
      ].join('\n')
    })
    .join('\n')
  return [
    'var __self = this',
    '__self.__pgRefresh = function () {',
    refreshBody,
    '}',
    '__self.__pgRefresh()',
    // ★#496e Skyline onReady 首帧布局未稳时 rect 偏小——延时二次重测兜底
    'setTimeout(function () { __self.__pgRefresh() }, 150)',
    "if (typeof wx !== 'undefined' && wx.onWindowResize) {",
    '  __self.__pgOnResize = function () { __self.__pgRefresh() }',
    '  wx.onWindowResize(__self.__pgOnResize)',
    '}',
  ].join('\n')
}

/** onUnload 注销 resize 监听（页面卸载防泄漏） */
function semanticGridOffLine(): string {
  return "if (this.__pgOnResize && typeof wx !== 'undefined' && wx.offWindowResize) { wx.offWindowResize(this.__pgOnResize); this.__pgOnResize = null }"
}

/**
 * ★#494 方法体 TS 类型语法统一剥除器（打法收敛：不再按形态追加 as/注解/泛型正则——
 * 断言/注解可任意嵌套（函数类型/泛型/对象字面量/索引访问/数组后缀），正则组合追不完）：
 *  ① as 断言（深度平衡单遍剥离）② 泛型调用注入 fn<Type>(x) ③ const/let 类型注解 ④ 块内箭头参数/返回注解
 * 产物是 JS——类型语法必须全剥，否则语法错误（页面真实编译后暴露的存量缺口：
 * 此前带类型注解的顶层函数被 fnRe 漏掉整段静默丢弃，fnRe 修复后积压形态集中暴露）。
 */
function stripTypeSyntax(body: string): string {
  let out = body
  // ① as 断言：单遍扫描，类型表达式按括号/尖括号/花括号/方括号深度平衡消费；字符串字面量整段跳过；
  //   零深度遇语句边界（; , 换行）或外层闭合（) } ]）即停——数组后缀 [] 在深度内一并剥除
  let res = ''
  let i = 0
  while (i < out.length) {
    const hit = out.indexOf(' as ', i)
    if (hit < 0) {
      res += out.slice(i)
      break
    }
    res += out.slice(i, hit)
    i = hit + 4
    let depth = 0
    let prev = ''
    let stopped = false
    while (i < out.length && !stopped) {
      const ch = out[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        const q = ch
        i++
        while (i < out.length && out[i] !== q) {
          if (out[i] === '\\') i++
          i++
        }
        i++
        prev = q
        continue
      }
      // 箭头函数 '=>' 的 > 不是类型闭合（Record<..., (v: unknown) => string | null> 内嵌箭头类型）
      if (ch === '>' && prev === '=') {
        prev = ch
        i++
        continue
      }
      if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') {
        if (depth === 0) {
          stopped = true
          continue
        }
        depth--
      } else if (depth === 0) {
        // 类型词法集合：标识符/./|/&/空格；换行与其余字符（; , + - * / = ?）视为语句边界
        // ★换行必须停止：类型后的 \n 被吞会与下一行粘行（方法闭 } 粘进 RHS 扫描 → ref 写入双 } 嵌套错误）
        if (ch === '\n' || ch === '\r' || ch === '\t' || !/[A-Za-z0-9_$.|& ]/.test(ch)) {
          stopped = true
          continue
        }
      }
      prev = ch
      i++
    }
  }
  out = res
  // ② 泛型调用注入剥离：fn<{ ... }>(args) / fn<Type>(args) → fn(args)
  out = out.replace(/([A-Za-z_$][\w$]*)<\{[^\n]*?\}\s*>\s*\(/g, '$1(')
  out = out.replace(/([A-Za-z_$][\w$]*)<[A-Za-z_$][\w$]*>\s*\(/g, '$1(')
  // ③ 块内 const/let 类型注解剥离：const f: Record<string, number> = {...} → const f = {...}
  out = out.replace(/\b(const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=\n]+=/g, (m, kw, name) => `${kw} ${name} =`)
  // ④ 块内箭头函数参数/返回类型注解剥离：(n: IRNode): void => → (n) =>
  out = out.replace(/\(([^(){}]*)\)\s*:\s*[A-Za-z_$][\w$.<>\[\]|\s]*\s*=>/g, (_m, params) => `(${stripParamTypes(params)}) =>`)
  return out
}

/**
 * 方法体裸调用改写：已知组件方法名 → this.name(（真机修复：微信组件方法必须在 methods 且须 this 调用，
 * 裸标识符调用是词法查找 → 顶层/全局找不到 → ReferenceError / 事件报 does not have a method）
 * methodNames 白名单精确区分：组件方法（改写）vs 模块函数/内置（setTimeout/eventValue 等 → 保持裸调用）
 * ★#494 runtimeInitNames：runtimeInit 变量的裸标识符引用 → this.<name>（toggleGlass 内的 appConf.features
 *   原样词法查找必 ReferenceError——变量是实例属性 this.appConf）
 */
function rewriteBareMethodCalls(body: string, methodNames: Set<string>, runtimeInitNames?: Set<string>): string {
  let out = body
  for (const name of methodNames) {
    out = out.replace(new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g'), `this.${name}(`)
  }
  if (runtimeInitNames) {
    for (const name of runtimeInitNames) {
      // 裸标识符 → this.<name>；三例外：属性访问（.name）、声明处（const/let/var name）、保持原样
      out = out.replace(
        new RegExp(`(?<!\\.)\\b(const\\s+|let\\s+|var\\s+)?${name}\\b`, 'g'),
        (m, decl) => (decl ? m : `this.${name}`),
      )
    }
  }
  return out
}

function rewriteRefAccess(
  body: string,
  refNames: Set<string>,
  trace?: TransformTrace,
  disabled?: Set<string>,
  computeds: Record<string, ComputedInfo> = {},
  watches: Record<string, WatchInfo> = {},
  emitEnabled = false,
  propsVar?: string,
  providedRefs?: Map<string, string>,
  transitionToggle?: Map<string, string>,
): string {
  const skip = (id: string) => disabled?.has(id)
  let out = body
  // TS 类型语法剥离（产物是 JS）：统一由确定性扫描器处理——断言/注解/泛型
  // ★#494 打法收敛：此前按形态逐个打正则补丁（as 标识符/对象/字符串/数组/嵌套函数类型…追不完）——
  //  替换为括号/尖括号深度平衡的剥除器（stripTypeSyntax），任意嵌套一次覆盖；不再新增形态正则
  out = stripTypeSyntax(out)
  // 组件事件（v0.3）：emit('xxx', payload) → this.triggerEvent('xxx', payload)（微信组件方法）
  if (emitEnabled) {
    out = out.replace(/\bemit\s*\(/g, 'this.triggerEvent(')
    // ★G12 候选 B（2026-09-07 Skyline 真机实证）：v-model 契约事件名单段化——triggerEvent 首参字符串字面量
    //   'update:xxx' → 'update-xxx'（与父侧 bind:update-xxx 同口径；双冒号事件名在 Skyline/glass-easel 编译链
    //   不匹配；非 update: 前缀事件名（formChange/openshare…）不动；动态/变量事件名不动——产物保持原样）
    out = out.replace(/this\.triggerEvent\(\s*(['"])(update:)([^'"]*)\1/g, 'this.triggerEvent($1update-$3$1')
  }
  // 组件 props（v0.3）：props.xxx → this.data.xxx（微信 properties 在 this.data 可访问）
  if (propsVar) out = out.replace(new RegExp(`\\b${propsVar}\\.([A-Za-z_$][\\w$]*)`, 'g'), 'this.data.$1')
  // computed 写路径（v0.3 尾）：x.value = v → setter 方法调用；只读（无 setter）→ 注释忽略
  for (const [cname, c] of Object.entries(computeds)) {
    if (!new RegExp(`\\b${cname}\\.value\\s*=`).test(out)) continue
    if (c.setter) {
      out = out.replace(
        new RegExp(`\\b${cname}\\.value\\s*=\\s*(?!=)([^;\\n]+)`),
        (_m, expr) => `this.proteusSet${capitalize(cname)}(${expr.trim()})`,
      )
    } else {
      out = out.replace(
        new RegExp(`\\b${cname}\\.value\\s*=\\s*(?!=)([^;\\n]+)`),
        () => `/* computed ${cname} 只读（无 setter），赋值已忽略 */`,
      )
    }
  }
  for (const name of refNames) {
    const prop = `this.data.${name}`
    const line = lineAt(body, Math.max(0, body.indexOf(name)))
    const patch = computedPatchEntries(name, computeds, propsVar)
    // 命中依赖此 ref 的 watch（多源/函数源 deps 匹配；MVP 每 ref 至多一个 watch）
    const w = Object.values(watches).find((ww) => ww.deps.includes(name) && !skip('script/watch-to-methods'))
    const oldSave = w
      ? `const ${w.deps.map((d) => `old${capitalize(d)} = this.data.${d}`).join(', ')}; `
      : ''
    const tail = watchTail(w, propsVar)
    // ★Batch 4：裸 ref 被 provide → 写入后同步注册表值 + 通知订阅者（proteusSyncProvide 由 transformScriptToPage 生成）
    const sync = providedRefs && providedRefs.get(name)
      ? `; this.proteusSyncProvide(${JSON.stringify(providedRefs.get(name))}, ${JSON.stringify(name)})`
      : ''
    // ★Batch 5：v-if ref 被 transition 引用 → 写入后驱动离开动画状态机（延迟移除）
    const tToggle = transitionToggle && transitionToggle.get(name) ? `; this.${transitionToggle.get(name)}()` : ''
    // 自增/自减（含前置 ++name.value / --name.value：前置需先写 this.data，表达式值 = 新值）
    if (!skip('script/ref-incdec')) {
      if (new RegExp(`(\\+\\+|--)\\s*${name}\\.value`).test(body) || new RegExp(`\\b${name}\\.value\\s*(\\+\\+|--)`).test(body)) {
        trace?.add('script/ref-incdec', { line, before: `${name}.value++/--`, after: `this.setData({ ${name}: ...${patch.entries.length || w ? ' + 派生/联动' : ''} })` })
      }
      out = out.replace(new RegExp(`\\+\\+\\s*${name}\\.value`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} + 1`, patch, Boolean(w), true)}${tail}${sync}${tToggle}`)
      out = out.replace(new RegExp(`--\\s*${name}\\.value`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} - 1`, patch, Boolean(w), true)}${tail}${sync}${tToggle}`)
      out = out.replace(new RegExp(`\\b${name}\\.value\\s*\\+\\+`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} + 1`, patch, Boolean(w))}${tail}${sync}${tToggle}`)
      out = out.replace(new RegExp(`\\b${name}\\.value\\s*--`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} - 1`, patch, Boolean(w))}${tail}${sync}${tToggle}`)
    }
    // 赋值：name.value = expr（排除 == / === / 复合赋值）
    // ★B5 修复：RHS 支持多行表达式（箭头函数体/对象字面量含换行）——旧捕获 [^;\n]+ 遇多行箭头只截到首行
    if (!skip('script/ref-write')) {
      if (new RegExp(`\\b${name}\\.value\\s*=\\s*(?!=)`).test(out)) {
        trace?.add('script/ref-write', { line, before: `${name}.value = expr`, after: `this.setData({ ${name}: expr${patch.entries.length || w ? ' + 派生/联动' : ''} })` })
      }
      // 平衡扫描 RHS：花括号/括号/方括号配对 + 字符串跳过，深度 0 遇 ; 或行尾结束
      const assignRe = new RegExp(`\\b${name}\\.value\\s*=\\s*(?!=)`)
      const chunks: string[] = []
      let rest = out
      while (true) {
        const am = assignRe.exec(rest)
        if (!am) {
          chunks.push(rest)
          break
        }
        chunks.push(rest.slice(0, am.index))
        let i = am.index + am[0].length
        let depth = 0
        let inStr: string | null = null
        while (i < rest.length) {
          const ch = rest[i]
          if (inStr) {
            if (ch === '\\') {
              i += 2
              continue
            }
            if (ch === inStr) inStr = null
          } else if (ch === '"' || ch === "'") {
            inStr = ch
          } else if (ch === '{' || ch === '(' || ch === '[') {
            depth++
          } else if (ch === '}' || ch === ')' || ch === ']') {
            depth--
          } else if (depth === 0 && (ch === ';' || ch === '\n')) {
            break
          }
          i++
        }
        const expr = rest.slice(am.index + am[0].length, i).trim()
        chunks.push(`${oldSave}${writeSetData(name, expr, patch, Boolean(w))}${tail}${sync}${tToggle}`)
        rest = rest.slice(i)
      }
      out = chunks.join('')
    }
    // 读取：name.value → this.data.name
    if (!skip('script/ref-read')) {
      if (new RegExp(`\\b${name}\\.value\\b`).test(out)) {
        trace?.add('script/ref-read', { line, before: `${name}.value`, after: `this.data.${name}` })
      }
      out = out.replace(new RegExp(`\\b${name}\\.value\\b`, 'g'), prop)
    }
  }
  return out
}
/** 生命周期映射：onMounted→onReady / onUnmounted→onUnload / onLoad→onLoad */
function extractLifecycles(source: string, trace?: TransformTrace, disabled?: Set<string>, warnings: string[] = []): { onReady?: string; onUnload?: string; onLoad?: string } {
  const out: { onReady?: string; onUnload?: string; onLoad?: string } = {}
  if (disabled?.has('script/lifecycle-map')) return out
  // ★#497 批 2：AST 顶层回调发现（onMounted→onReady / onUnmounted→onUnload / onLoad→onLoad）+ 未映射 onXxx 警告（全树扫描）
  const body = topLevelAst(source)
  if (body) {
    const hooks = [
      { name: 'onMounted', key: 'onReady' as const },
      { name: 'onUnmounted', key: 'onUnload' as const },
      { name: 'onLoad', key: 'onLoad' as const },
    ]
    const mapped = new Set(['onMounted', 'onUnmounted', 'onLoad'])
    // 递归全树：未映射 onXxx（回调形态）警告 + 顶层回调体提取
    const seen = new Map<string, { args: unknown[]; line: number }[]>()
    const walk = (node: { type: string; callee?: { name?: string }; arguments?: unknown[]; body?: unknown[]; expression?: unknown }): void => {
      if (!node || typeof node.type !== 'string') return
      if (node.type === 'CallExpression') {
        const name = node.callee && 'name' in node.callee ? node.callee.name : ''
        if (typeof name === 'string' && /^on[A-Z]/.test(name)) {
          const args = (node.arguments ?? []) as Array<{ type?: string }>
          const cb = args[0]
          if (cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')) {
            const arr = seen.get(name) ?? []
            arr.push({ args, line: (node as { loc?: { start?: { line?: number } } }).loc?.start?.line ?? 0 })
            seen.set(name, arr)
          }
        }
      }
      for (const k of Object.keys(node)) {
        const v = (node as Record<string, unknown>)[k]
        if (Array.isArray(v)) for (const c of v) walk(c as never)
        else if (v && typeof v === 'object') walk(v as never)
      }
    }
    for (const st of body) walk(st)
    for (const name of seen.keys()) {
      if (!mapped.has(name)) {
        warnings.push(`未映射的生命周期钩子 ${name}() 已剥离（小程序无对等钩子；Web 端保留原生语义）——如组件内需要降级说明请注释标注`)
      }
    }
    for (const h of hooks) {
      const hits = seen.get(h.name)
      if (!hits?.length) continue
      const first = hits[0]
      const cb = (first.args[0] as { body?: { start?: number } }).body
      if (!cb || typeof cb.start !== 'number') continue
      const inner = extractBracedBody(source, cb.start)
      if (inner !== null) {
        out[h.key] = inner
        trace?.add('script/lifecycle-map', { line: first.line, before: `${h.name}()`, after: h.key })
      }
    }
    return out
  }
  // —— 文本回退路径 ——
  const hooks = [
    { re: /onMounted\s*\(/g, key: 'onReady' as const },
    { re: /onUnmounted\s*\(/g, key: 'onUnload' as const },
    { re: /onLoad\s*\(/g, key: 'onLoad' as const },
  ]
  // ★B6 反黑盒：未映射的 onXxx 钩子显式警告（不再静默剥离）——如 onErrorCaptured（Web 能力，MP 无 Vue 运行时）
  // 仅匹配「回调形态」调用 onXxx(() => / onXxx(function，排除方法定义（function onXxx(...)）与普通调用
  const mapped = new Set(['onMounted', 'onUnmounted', 'onLoad'])
  for (const hm of source.matchAll(/\bon([A-Z][A-Za-z0-9_]*)\s*\(\s*(?:(?:\([^)]*\)\s*=>)|function)/g)) {
    const full = `on${hm[1]}`
    if (!mapped.has(full)) {
      warnings.push(`未映射的生命周期钩子 ${full}() 已剥离（小程序无对等钩子；Web 端保留原生语义）——如组件内需要降级说明请注释标注`)
    }
  }
  for (const h of hooks) {
    h.re.lastIndex = 0
    const m = h.re.exec(source)
    if (!m) continue
    const braceIdx = source.indexOf('{', m.index)
    const body = extractBracedBody(source, braceIdx)
    trace?.add('script/lifecycle-map', { line: lineAt(source, m.index), before: m[0].replace(/\s*\(/, '()'), after: h.key })
    if (body !== null) out[h.key] = body
  }
  return out
}

function indentBody(body: string): string {
  return body.split('\n').map((l) => `  ${l}`).join('\n')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ============ sourcemap v3（v0.3：方法级 JS 源码映射，接入微信开发者工具调试） ============
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** base64 VLQ 编码（sourcemap mappings 字段） */
export function vlqEncode(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = vlq & 0x1f
    vlq >>>= 5
    if (vlq > 0) digit |= 0x20
    out += B64[digit]
  } while (vlq > 0)
  return out
}

/** base64 VLQ 解码（测试验证用） */
export function vlqDecode(str: string): number[] {
  const out: number[] = []
  let shift = 0
  let value = 0
  for (const ch of str) {
    const digit = B64.indexOf(ch)
    value |= (digit & 0x1f) << shift
    if (digit & 0x20) {
      shift += 5
    } else {
      const negate = value & 1
      const decoded = value >>> 1
      out.push(negate ? -decoded : decoded)
      shift = 0
      value = 0
    }
  }
  return out
}

/**
 * 生成 sourcemap v3 JSON：产物每行 → 源码行（lineMappings: 产物 0-based 行 → 源码 1-based 行）
 * segment = [genCol=0, srcIdx=0, srcLine(delta), srcCol=0]；无映射行 → 空 segment
 */
export function buildSourceMap(
  js: string,
  file: string | undefined,
  source: string,
  lineMappings: Array<{ out: number; src: number }>,
): string {
  const byOut = new Map(lineMappings.map((m) => [m.out, m.src]))
  const lineCount = js.split('\n').length
  let prevSrc = 0
  const segs: string[] = []
  for (let i = 0; i < lineCount; i++) {
    const srcLine = byOut.get(i)
    if (srcLine == null) {
      segs.push('')
      continue
    }
    const src0 = srcLine - 1
    segs.push(`AA${vlqEncode(src0 - prevSrc)}A`)
    prevSrc = src0
  }
  return JSON.stringify({
    version: 3,
    file: file ? `${file}.js` : 'page.js',
    sources: [file ?? 'anonymous.vue'],
    sourcesContent: [source],
    names: [],
    mappings: segs.join(';'),
  })
}

/** script 源码 → Page/Component 构造器 JS（纯函数，独立可测） */
export function transformScriptToPage(
  source: string,
  _opts: StyleTransformOptions = { px2rpx: true, rpxRatio: 2 },
  extra: ScriptTransformOptions = {},
): ScriptTransformResult {
  const warnings: string[] = []
  const trace = extra.trace
  // ★module-plan B0：import → require（跨模块引用）——moduleImports 由插件预计算（源码路径 → 产物相对 require 路径）
  const moduleImports = new Map<string, string>()
  for (const mi of extra.moduleImports ?? []) moduleImports.set(mi.source, mi.requirePath)
  // 解析 import 结构（named/default/namespace/side/type）→ 生成 require 语句（产物顶部）
  const requireLines: string[] = []
  const importWarnings: string[] = []
  for (const imp of extractImports(source)) {
    if (imp.source === 'vue') continue // Vue API 导入：编译器静态识别，正常用法
    if (imp.typeOnly) continue // import type：纯类型，运行时剥离
    if (imp.source.endsWith('.vue')) continue // 组件导入：MP 端走 usingComponents（编译器忽略）
    const reqPath = moduleImports.get(imp.source)
    if (reqPath) {
      // ★B0：可解析的跨模块引用 → require 转换（共享模块由插件编译为独立 js 产物）
      if (imp.kind === 'named') {
        requireLines.push(`const { ${imp.names.join(', ')} } = require('${reqPath}')`)
      } else if (imp.kind === 'namespace') {
        requireLines.push(`const ${imp.names[0]} = require('${reqPath}')`)
      } else if (imp.kind === 'default') {
        requireLines.push(`const ${imp.names[0]} = require('${reqPath}').default !== undefined ? require('${reqPath}').default : require('${reqPath}')`)
      } else {
        requireLines.push(`require('${reqPath}')`)
      }
      trace?.add('script/module-import', {
        line: imp.line,
        before: `import { ${imp.names.join(', ')} } from '${imp.source}'`,
        after: `const { ${imp.names.join(', ')} } = require('${reqPath}')（跨模块引用，共享模块独立产物）`,
      })
    } else if (!extra.isComponent) {
      // 不可解析的跨模块 import（npm 包 / 未收录路径）：剥离 + 警告（反黑盒，vue-compat Batch A）
      importWarnings.push(imp.source)
      trace?.add('script/module-import', {
        line: imp.line,
        before: `import ... from '${imp.source}'`,
        after: '（剥离：无法解析的跨模块引用，符号将 undefined）',
      })
    }
  }
  if (importWarnings.length) {
    warnings.push(
      `检测到 ${importWarnings.length} 条无法解析的 import（${importWarnings.slice(0, 3).join(', ')}${importWarnings.length > 3 ? '…' : ''}）——小程序产物无模块系统，跨模块引用将 undefined：请改用本地模块路径（module-plan B0：相对路径共享模块自动编译 + require）或框架 store 桥`,
    )
  }
  // ★底线循环 ①③：禁用集（config rules.disabled 即时生效）
  const disabled = resolveOverrides(extra.rules).disabled
  const { data, computed, runtimeInits, letHandles } = disabled.has('script/const-to-data')
    ? { data: {}, computed: {}, runtimeInits: [] as Array<{ name: string; call: string }>, letHandles: [] as string[] }
    : extractData(source, warnings, trace)
  // computed 读路径（v0.3）：规则禁用时退化为不编译（computed 字段不进 data）
  const computeds = disabled.has('script/computed-to-data') ? {} : computed
  // ★#500 :style 绑定的 computed 派生对象自动序列化（MP 双渲染器 style 属性仅收字符串——对象绑定静默失效，WebView 亦然）
  const styleBindingNames = new Set(extra.styleBindings ?? [])
  let needsStyleStringHelper = false
  for (const sn of styleBindingNames) {
    const c = computeds[sn]
    if (!c) continue
    c.expr = `__proteusStyleString(${c.expr})`
    needsStyleStringHelper = true
  }
  // watch（v0.3）：依赖 ref 写入 setData 后自动调用回调
  const watches = disabled.has('script/watch-to-methods') ? {} : extractWatch(source, data, warnings, trace, !disabled.has('script/watch-props'))
  // 组件系统（v0.3）：defineProps → properties、emit → triggerEvent、props 访问重写
  const props = extra.isComponent && !disabled.has('script/define-props') ? extractProps(source, warnings, trace) : {}
  const propsVar = source.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*defineProps\s*[<(]/)?.[1]
  const emitEnabled = extra.isComponent && /defineEmits\s*\(/.test(source) && !disabled.has('script/define-emits')
  const methods = extractMethods(source, warnings, trace, disabled)
  // defineExpose（v0.3 尾）：no-op 校验（组件模式）
  if (extra.isComponent) checkDefineExpose(source, data, warnings, trace)
  const lifecycles = extractLifecycles(source, trace, disabled, warnings)
  const vModelBindings = extra.vModelBindings ?? []
  // ★#499：改写集合含 computeds——派生字段 ready/onLoad 已进 data，方法体读取 x.value → this.data.x（p-modal
  //   observers/onReady 内 variants.value 此前裸引用 ReferenceError；表达式体 computed 写入路径由 setter 循环先行接管）
  const refNames = new Set([...Object.keys(data), ...Object.keys(computed)])

  // ★vue-compat-advance Batch 3：provide/inject 提取 + 注入块构建（禁用规则时整体跳过）
  // ★Batch 4：裸 ref 提供 → provideRefs（ref→key），ref 写入点同步注册表 + 通知订阅者；inject 侧订阅 __subs
  const piEnabled = !disabled.has('script/provide-inject')
  const { provides, injects } = piEnabled ? extractProvideInject(source) : { provides: [], injects: [] }
  const piBlocks = buildProvideInject(provides, injects, data, computeds)
  if (piEnabled && (provides.length || injects.length)) {
    trace?.add('script/provide-inject', {
      before: `${provides.map((p) => `provide(${JSON.stringify(p.key)}, …)`).join('、')}${provides.length && injects.length ? '；' : ''}${injects.map((i) => `const ${i.name} = inject(${JSON.stringify(i.key)})`).join('、')}`,
      after: '页面 onLoad / 组件 created+attached 注入 getApp().__proteusProvides 全局注册表读写（MVP 值快照，非响应式）',
    })
  }
  // ★Batch 4：提供侧联动（proteusSyncProvide 生成 + ref 写入点注入）与 inject 侧取消订阅（proteusUnsubscribeProvide）
  const providedRefs = piEnabled ? piBlocks.provideRefs : new Map<string, string>()
  const hasInjects = piEnabled && injects.length > 0

  // ★vue-compat-advance Batch 5：离开动画状态机——data 注入 __tv/__tl + toggle 方法 + ref 写入点注入
  const transitions = extra.transitions ?? []
  const transitionToggle = new Map<string, string>() // ref → toggle 方法名（ref 写入点联动）
  for (const t of transitions) transitionToggle.set(t.ref, `proteusTransitionToggle${t.index}`)
  const dataExtra: Record<string, unknown> = {}
  for (const t of transitions) {
    dataExtra[`__tv${t.index}`] = data[t.ref]
    dataExtra[`__tl${t.index}`] = false
  }

  // ★pinia-plan 12 P1：模板 store 绑定——store 变量（useXxxStore() runtimeInit）存在且模板引用了 store.<field>
  const storeBindings = extra.storeBindings ?? []
  const storeVar = runtimeInits.find((i) => i.name === 'store' && /^use\w*Store\(/.test(i.call))?.name
  const storeBindingInit = storeVar && storeBindings.length ? storeBindingLine(storeBindings, storeVar) : ''
  if (storeBindingInit) {
    trace?.add('script/store-binding', {
      before: `模板 {{ store.${storeBindings.join(' }} / {{ store.')} }}`,
      after: `onLoad：this.setData(映射) + store.$subscribe → setData（Pinia MP 绑定，pinia-plan 12 P1）`,
    })
  }

  // ★#494 app-config 绑定桥：useAppConfig()/useFeatureFlag() → 命令式 API + 快照 setData + onAppConfigChange 订阅
  //   （原样发射会在 onLoad 撞 useAppConfig 的 getCurrentInstance() 守卫 → 页面白屏；且实例属性进不了 data，模板 {{ appConf.x }} 落空）
  const appConfigBindings = runtimeInits
    .filter((i) => isAppConfigCall(i.call))
    .map((i) => ({ name: i.name, expr: rewriteAppConfigCall(i.call) }))
  if (appConfigBindings.length) {
    for (const i of runtimeInits) if (isAppConfigCall(i.call)) i.call = rewriteAppConfigCall(i.call)
    trace?.add('script/app-config-binding', {
      before: `const ${appConfigBindings.map((b) => b.name).join(' / ')} = useAppConfig()/useFeatureFlag(…)`,
      after: 'onLoad：setData(快照) + onAppConfigChange 订阅刷新（MP 绑定桥，#494）',
    })
  }
  const appConfigBindingInit = appConfigBindings.length ? appConfigBindingLine(appConfigBindings) : ''

  // ★#494 app-config require 行补 named imports（改写后的 getConfig/getFeatureFlag/onAppConfigChange 引用需要）
  if (appConfigBindings.length) {
    for (let i = 0; i < requireLines.length; i++) {
      const m = requireLines[i].match(/^const \{ ([^}]+) \} = require\('([^']*app-config[^']*)'\)$/)
      if (m) {
        const names = m[1].split(', ').map((s) => s.trim())
        const merged = [...names]
        for (const extra2 of ['getConfig', 'getFeatureFlag', 'onAppConfigChange']) if (!merged.includes(extra2)) merged.push(extra2)
        requireLines[i] = `const { ${merged.join(', ')} } = require('${m[2]}')`
      }
    }
  }

  // ★#494 顶层副作用语句保留：initAppConfig(x) / registerCapability(x) 等零缩进调用 → onLoad 最前
  //   （此前被静默丢弃——initAppConfig 不执行则 configRef 恒 null，后续 getConfig 必炸）
  const topLevelCalls = disabled.has('script/top-level-calls') ? [] : extractTopLevelCalls(source, warnings, trace)

  const lines: string[] = []
  if (extra.file) lines.push(`// ${extra.file}（Proteus mp-transform 编译产物）`)
  lines.push('// AUTO-GENERATED by vite-plugin-mp-transform.ts. DO NOT EDIT.', '')
  // ★module-plan B0：跨模块引用 require 语句（共享模块产物，页面/组件顶部声明）
  if (requireLines.length) lines.push(...requireLines, '')
  // ★#500 编译期注入：style 属性仅收字符串（MP 双渲染器对象绑定静默失效）——派生对象自动序列化
  if (needsStyleStringHelper) {
    lines.push(
      '// ★#500 编译期注入：style 属性仅收字符串（MP 双渲染器对象绑定静默失效）——派生对象自动序列化',
      'function __proteusStyleString(o) {',
      '  if (typeof o === "string") return o',
      '  const parts = []',
      '  const keys = o ? Object.keys(o) : []',
      '  for (let i = 0; i < keys.length; i++) {',
      '    const k = keys[i]',
      '    const v = o[k]',
      '    if (v === undefined || v === null || v === "") continue',
      "    parts.push(k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase() }) + ': ' + v)",
      '  }',
      "  return parts.join('; ')",
      '}',
      '',
    )
  }
  lines.push(extra.isComponent ? 'Component({' : 'Page({')
  if (extra.isComponent) {
    // ★#500 微信自定义组件默认单插槽——具名插槽（<slot name>）需显式开启 multipleSlots，否则按名路由失效（glass-easel 组件框架层，双渲染器一致）
    lines.push('  options: { multipleSlots: true },')
    trace?.add('component/multi-slot', { before: 'Component({ ... })（默认单插槽）', after: 'options.multipleSlots = true（具名插槽按名路由）' })
  }

  // ★真机修复：方法类行收集到 methodLines——组件模式包进 methods: {}（微信组件方法必须在此，顶层不识别）；
  //   页面模式方法保留顶层（Page 支持）；sourcemap 映射独立维护，最后合并（methods 块插入后重定位）
  const methodLines: string[] = []
  const methodMappings: Array<{ out: number; src: number }> = []
  const pushMethod = (line: string, srcLine?: number): void => {
    const start = methodLines.length
    methodLines.push(line)
    if (srcLine !== undefined) {
      const sub = line.split('\n')
      for (let i = 0; i < sub.length; i++) methodMappings.push({ out: start + i, src: srcLine + i })
    }
  }
  // ★方法名白名单：方法体裸调用改写 this.x()（模块函数/内置不在白名单 → 保持裸调用）
  const methodNames = new Set<string>(Object.keys(methods))
  // ★#494 runtimeInit 变量名（方法体/生命周期体内裸标识符引用 → this.<name>——实例属性不在词法作用域）
  // ★#499 let 句柄同通道（顶层 let aware/query = null → 方法体裸引用/赋值改 this.<name>）
  const runtimeInitNames = new Set<string>([...runtimeInits.map((i) => i.name), ...letHandles])

  // ★15-page-scroll-container 批次2/3：页面滚动 API 桥接（15-page-scroll-container）——Skyline 页面本身不滚动，
  //   页面级钩子（onPageScroll/onReachBottom/onPullDownRefresh/wx.pageScrollTo）靠自动包装 scroll-view 事件触发（template 侧绑定）
  //   载荷归一：scroll-view e.detail.scrollTop → 页面 onPageScroll { scrollTop }（对齐页面生命周期载荷）；
  //   ★须在 dataEntries 组装前赋值 dataExtra（__proteusRefreshing/__proteusPageScrollTop 进初始 data）
  const bridgeHooks = {
    hasOnPageScroll: /onPageScroll\s*\(/.test(source),
    hasOnReachBottom: /onReachBottom\s*\(/.test(source),
    hasOnPullDownRefresh: /onPullDownRefresh\s*\(/.test(source),
    hasPageScrollTo: /wx\.pageScrollTo\s*\(/.test(source),
  }
  if (!extra.isComponent && !disabled.has('page/scroll-bridge')) {
    if (bridgeHooks.hasOnPullDownRefresh) dataExtra.__proteusRefreshing = false
    if (bridgeHooks.hasPageScrollTo) dataExtra.__proteusPageScrollTop = 0
  }

  const semanticGrids = extra.semanticGrids ?? []
  const semanticGridInit = semanticGridInitCode(semanticGrids) // ★#496 档位求解段（init 最前）
  // ★#496b p-grid 默认 style（首帧/无 wx 时设计稿档——calc 百分比串）
  if (!disabled.has('fluid/semantic-grid') && semanticGrids.length) {
    for (const g of semanticGrids) dataExtra[`pgridStyle${g.index}`] = g.defaultStyle
  }

  const dataEntries = [...Object.entries(data), ...Object.entries(dataExtra)]
  if (dataEntries.length) {
    lines.push('  data: {')
    for (const [k, v] of dataEntries) lines.push(`    ${k}: ${JSON.stringify(v)},`)
    lines.push('  },')
  }

  // 组件 properties（v0.3）：defineProps 对象形式 → 微信 properties（type + value 默认值）
  // ★2026-08 真机修复：始终注入 rootClass（组件标签 class 透传——页面 wxss 无法可靠作用于 host 节点，
  //   class 经 root-class 属性 → rootClass property → 组件根节点 {{rootClass}}，Vue class 继承语义等价）
  const propEntries = Object.entries(props)
  if (extra.isComponent) {
    const allProps = { ...props }
    if (!disabled.has('component/root-class')) {
      allProps.rootClass = { type: 'String', value: '' }
    }
    const entries = Object.entries(allProps)
    if (entries.length) {
      lines.push('  properties: {')
      for (const [k, p] of entries) {
        lines.push(`    ${k}: { type: ${p.type}${p.value !== undefined ? `, value: ${JSON.stringify(p.value)}` : ''} },`)
      }
      lines.push('  },')
    }
  } else if (propEntries.length) {
    lines.push('  properties: {')
    for (const [k, p] of propEntries) {
      lines.push(`    ${k}: { type: ${p.type}${p.value !== undefined ? `, value: ${JSON.stringify(p.value)}` : ''} },`)
    }
    lines.push('  },')
  }

  // v-model 自动 handler：proteusOnXxxInput(e) { this.setData({ xxx: e.detail.value }) }
  const vmodelDisabled = disabled.has('script/vmodel-handler')
  for (const name of vModelBindings) {
    if (!vmodelDisabled) {
      methodNames.add(`proteusOn${capitalize(name)}Input`)
      pushMethod(`  proteusOn${capitalize(name)}Input(e) { this.setData({ ${name}: e.detail.value }) },`)
    }
  }
  // ★#500 自定义组件 v-model[:arg] 回写 handler：proteusUpdate<Arg>Model(e) { this.setData({ model: e.detail }) }
  //   （组件 triggerEvent('update:xxx', 值) → e.detail 直接为新值；非 input 形态不走 e.detail.value）
  for (const h of extra.vModelComponentHandlers ?? []) {
    if (!vmodelDisabled) {
      methodNames.add(h.name)
      pushMethod(`  ${h.name}(e) { this.setData({ ${h.model}: e.detail }) },`)
    }
  }
  if (vModelBindings.length && !vmodelDisabled) {
    trace?.add('script/vmodel-handler', {
      before: `v-model="${vModelBindings.join('", "')}"`,
      after: `proteusOn${vModelBindings.map(capitalize).join(' / proteusOn')}Input（setData 回写）`,
    })
  }

  // ★props 源 watch → WeChat observers（组件监听自身属性变化；Web 端即标准 Vue watch）
  const propWatches = Object.values(watches).filter((w) => w.propField)
  if (extra.isComponent && propWatches.length) {
    lines.push('  observers: {')
    for (const w of propWatches) {
      // ★#499：回调参数先归一为 n/o（微信 observers 实参固定 — 回调体引用开发者参数名如 w 必须同步改名）
      const observerBody = rewriteBareMethodCalls(rewriteRefAccess(renameWatchParamsToNo(w.body, w.params), refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames)
      const bodyLines = observerBody.split('\n')
      lines.push(`    ${w.propField}(n, o) {`)
      for (const bl of bodyLines) lines.push(`      ${bl}`)
      lines.push('    },')
    }
    lines.push('  },')
  }

  // 导航链接自动 handler（模板出现 <a href> / <router-link> 时注入，仅 MP 产物存在）
  // 方法名避免 __ 前缀（微信保留前缀）；当前为临时调试版：无条件输出日志（验证通过后回收门控）
  if (extra.usesNavigate && !disabled.has('script/nav-handler')) {
    trace?.add('script/nav-handler', { before: '<a href> / <router-link>', after: 'proteusNavigateTo(e)（data-url → wx.navigateTo）' })
    // 注意：生成代码避免数组解构/对象展开（微信 ES5 转译依赖 babel helper 模块）
    // 调试日志统一 [proteus][环节] 格式，仅 debug 构建注入
    methodNames.add('proteusNavigateTo')
    methodLines.push(
      '  proteusNavigateTo(e) {',
      '    const ds = e.currentTarget.dataset',
      '    const url = String(ds.url || "")',
      ...(extra.debug ? [`    console.log('[proteus][nav] tap', JSON.stringify(ds), Date.now())`] : []),
      '    if (!url) return',
      ...(extra.debug ? [`    console.log('[proteus][nav] navigateTo', url, Date.now())`] : []),
      '    const nav = {',
      '      url: url,',
      ...(extra.debug ? [`      success: function () { console.log('[proteus][nav] navigateTo success', url, Date.now()) },`] : []),
      '      fail: function (err) {',
      ...(extra.debug ? [`        console.warn('[proteus][nav] navigateTo fail', JSON.stringify(err), Date.now())`] : []),
      '        if (ds.routeType) wx.navigateTo({ url: url })',
      '      }',
      '    }',
      '    if (ds.routeType) nav.routeType = ds.routeType',
      '    wx.navigateTo(nav)',
      '  },',
    )
  }

  // ★#499 props 组件派生/immediate 初始化放 onReady（微信父传属性 attached 后才到位——attached 读 this.data.items 为 undefined，p-toolbar 真机崩）；
  //   无 props 组件保持 attached（既有验证时序不变）；运行时初始化/注入仍留 attached（先于 ready 执行）
  const compDerivedReady =
    extra.isComponent && propEntries.length > 0
      ? [computedInitLine(computeds, runtimeInitNames, propsVar), immediateWatchLine(watches, propsVar)].filter(Boolean).join('\n')
      : ''
  // ★#496c onReady 精修段（页面 p-grid 档位——SelectorQuery 实测容器宽）
  const semanticGridReady = !extra.isComponent ? semanticGridReadyCode(semanticGrids) : ''
  if (lifecycles.onReady) {
    const readyBody = semanticGridReady
      ? `${semanticGridReady}\n${compDerivedReady ? `${compDerivedReady}\n` : ''}${lifecycles.onReady}`
      : compDerivedReady
        ? `${compDerivedReady}\n${lifecycles.onReady}`
        : lifecycles.onReady
    lines.push(`  onReady() {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(readyBody, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames))}\n  },`)
  } else if (semanticGridReady || compDerivedReady) {
    lines.push(`  onReady() {\n${indentBody(semanticGridReady ? `${semanticGridReady}${compDerivedReady ? `\n${compDerivedReady}` : ''}` : compDerivedReady)}\n  },`)
  } else if (extra.debug) {
    // 调试：注入页面就绪日志（无显式 onReady 时）
    lines.push(`  onReady() {\n    console.log('[proteus][page] onReady ${extra.file ?? ''}', Date.now())\n  },`)
  }
  // ★Batch 6：页面级清理（provide 或 inject 时）——onUnload 删除当前页命名空间（防泄漏）
  // ★lifecycle B6：页面级 store $dispose（useXxxStore 实例属性 → onUnload 自动清理，防内存泄漏）
  const storeDisposeLine =
    storeVar && !extra.isComponent
      ? `if (this.${storeVar} && this.${storeVar}.$dispose) { this.${storeVar}.$dispose(); this.${storeVar} = null }`
      : ''
  // ★#494 app-config 订阅退订：onUnload 显式存在时注入 unsubscribe；无 onUnload 时 needsPageCleanup 承载生成
  const appConfigUnsubLine = appConfigBindings.length ? 'if (this.__appConfigUnsub) { this.__appConfigUnsub(); this.__appConfigUnsub = null }' : ''
  // ★#496d 页面 p-grid resize 监听注销（拖宽/旋转重算档位）
  const semGridOffLine = !extra.isComponent && semanticGrids.length ? semanticGridOffLine() : ''
  const needsPageCleanup = hasInjects || providedRefs.size > 0 || Boolean(storeDisposeLine) || Boolean(appConfigUnsubLine) || Boolean(semGridOffLine)
  const pageCleanupLine = 'const __reg = getApp().__proteusProvides; if (__reg && this.__proteusPageId) delete __reg[this.__proteusPageId]'
  const unsubLine = hasInjects ? 'this.proteusUnsubscribeProvide()' : ''
  if (lifecycles.onUnload) {
    // ★Batch 4/6：页面级 inject 订阅取消 + 命名空间清理 + store dispose（前置；onUnload 显式存在时注入）
    // ★B7：组件模式 onUnmounted → detached（微信组件无 onUnload；MP 组件销毁钩子为 detached）
    const unloadBody = rewriteBareMethodCalls(rewriteRefAccess(lifecycles.onUnload, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames)
    const isComp = extra.isComponent
    const pre = isComp ? [unsubLine].filter(Boolean).join('\n') : [unsubLine, appConfigUnsubLine, semGridOffLine, storeDisposeLine, pageCleanupLine].filter(Boolean).join('\n')
    const hook = isComp ? 'detached' : 'onUnload'
    lines.push(`  ${hook}() {
${indentBody(pre ? `${pre}
${unloadBody}` : unloadBody)}
  },`)
  } else if (needsPageCleanup && !extra.isComponent) {
    // 页面级 provide/inject/store/app-config/p-grid 但无显式 onUnload：生成承载清理的 onUnload（组件模式用 detached，见组件分支）
    lines.push(`  onUnload() {
${indentBody([unsubLine, appConfigUnsubLine, semGridOffLine, storeDisposeLine, pageCleanupLine].filter(Boolean).join('\n'))}
  },`)
  }
  // ★#494 onLoad 初始化序：顶层副作用调用（initAppConfig 等）→ computed → runtimeInits（已含方法调用 this 改写 + 命令式改写）→ store 桥 → app-config 桥 → 模板引用快照 → immediate watch → provide/inject
  // 模板引用的 runtimeInit 变量 → 快照进 data（实例属性模板读不到；app-config 桥已自带快照的不重复）
  const templateRefNames = new Set(extra.templateRefs ?? [])
  const runtimeInitSnapshots = runtimeInits
    .filter((i) => templateRefNames.has(i.name) && !appConfigBindings.some((b) => b.name === i.name))
    .map((i) => i.name)
  const runtimeInitSnapshotLine = runtimeInitSnapshots.length
    ? `this.setData({ ${runtimeInitSnapshots.map((n) => `${n}: ${styleBindingNames.has(n) ? `__proteusStyleString(this.${n})` : `this.${n}`}`).join(', ')} })`
    : ''
  if (runtimeInitSnapshots.length) {
    trace?.add('script/runtime-init-snapshot', {
      before: `模板引用 runtimeInit 变量：${runtimeInitSnapshots.join(' / ')}`,
      after: 'onLoad：setData(快照) 进 data（实例属性模板读不到，#494）',
    })
  }
  // ★#495c 初始化序：顶层副作用 → runtimeInits（先于 computed——computed 可依赖 runtimeInit 值如 gridClass→gridOk）→ computed（含 runtimeInit 裸名/props 改写）→ store/app-config 桥 → 快照 → immediate watch → provide/inject
  // ★2026-09-07 G12 复测真机 bug：注入段裸方法调用漏 this 化（semantic-primitives-demo refreshSplit 顶层调用
  //   → onLoad ReferenceError）——注入段与显式 onLoad body 同规则过 rewriteBareMethodCalls。
  //   同时修顺序：顶层调用分两段——pre（外部/import 初始化如 initAppConfig，须先于 runtimeInit——#494 原语义）
  //   置最前；post（callee 依赖实例：方法名册成员 this.x() / runtimeInit 链式 this.host.y()）置于 runtimeInit 之后
  //   （源码序 const host 先定义再 host.registerFallback——此前单段置顶会让 this.host 先行 undefined）。
  const dependsOnInstance = (c: string): boolean => {
    const m = c.match(/^(?:await\s+)?([A-Za-z_$][\w$]*)/)
    if (!m) return false
    const base = m[1].split('.')[0]
    return Boolean(base && (methodNames.has(base) || runtimeInitNames.has(base)))
  }
  const preCallsLine = topLevelCalls.filter((c) => !dependsOnInstance(c)).join('\n')
  const postCallsLine = topLevelCalls.filter((c) => dependsOnInstance(c)).join('\n')
  const initLineSeq = (): string[] =>
    [semanticGridInit, preCallsLine ? rewriteBareMethodCalls(preCallsLine, methodNames, runtimeInitNames) : '', runtimeInitLine(runtimeInits, methodNames, runtimeInitNames), postCallsLine ? rewriteBareMethodCalls(postCallsLine, methodNames, runtimeInitNames) : '', computedInitLine(computeds, runtimeInitNames, propsVar), storeBindingInit, appConfigBindingInit, runtimeInitSnapshotLine, immediateWatchLine(watches, propsVar), piBlocks.page].filter(Boolean)

  // 组件模式：无 onLoad（微信组件生命周期无 onLoad）；computed 初始化 + immediate watch 放 attached()
  // ★vue-compat-advance Batch 3：provide 注册放 created（先于子组件 attached 注入），inject 读取放 attached
  if (extra.isComponent) {
    if (piBlocks.provide) {
      lines.push(`  created() {\n${indentBody(piBlocks.provide)}\n  },`)
    }
    // ★#495c 组件 attached：runtimeInit 先于 computed（顺序同页面 initLineSeq）
    // ★2026-09-07 同族坑③：组件模式顶层副作用此前完全未注入（topLevelCalls 仅页面 initLineSeq 使用 → 组件 setup
    //   顶层调用静默丢）——attached 补 pre/post 段（与页面同构：外部 init 最前；实例依赖调用 this 化后置 runtimeInit 后）
    const initLines = [
      semanticGridInit,
      preCallsLine ? rewriteBareMethodCalls(preCallsLine, methodNames, runtimeInitNames) : '',
      runtimeInitLine(runtimeInits, methodNames, runtimeInitNames),
      postCallsLine ? rewriteBareMethodCalls(postCallsLine, methodNames, runtimeInitNames) : '',
      compDerivedReady ? '' : computedInitLine(computeds, runtimeInitNames, propsVar),
      storeBindingInit,
      compDerivedReady ? '' : immediateWatchLine(watches, propsVar),
      piBlocks.inject,
    ].filter(Boolean)
    if (initLines.length) {
      lines.push(`  attached() {\n${indentBody(initLines.join('\n'))}\n  },`)
    }
    // ★Batch 4：组件级 inject 订阅取消（attached 订阅 → detached 移除，防全局注册表回调泄漏）
    // ★B7：onUnmounted 已映射 detached 时不再重复生成（避免 Component 重复键覆盖）
    if (hasInjects && !lifecycles.onUnload) {
      lines.push(`  detached() {\n    this.proteusUnsubscribeProvide()\n  },`)
    }
  } else if (lifecycles.onLoad) {
    // 显式 onLoad（页面）：顶层副作用调用 + computed 初始化 + immediate watch + provide/inject 注入在方法体前（★#494 initLineSeq）
    const initLines = initLineSeq()
    const body = rewriteBareMethodCalls(rewriteRefAccess(lifecycles.onLoad, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames)
    lines.push(`  onLoad(options) {\n${indentBody(initLines.length ? `${initLines.join('\n')}\n${body}` : body)}\n  },`)
  } else {
    // 默认 onLoad：路由参数自动 decode 并注入 data（P5 契约，与 runtime/pageLifecycle 的 createPage 行为一致）
    // 注意：不用数组解构/对象展开（微信 ES5 转译需要 babel helper 模块，真机报 arrayWithHoles 未定义）
    if (!disabled.has('script/onload-params')) {
      trace?.add('script/onload-params', { before: '（无显式 onLoad）', after: 'onLoad(options) → decodeURIComponent + JSON.parse + setData' })
      const initLines = initLineSeq()
      lines.push(
        [
          '  onLoad(options) {',
          ...(extra.debug ? [`    console.log('[proteus][page] onLoad ${extra.file ?? ''}', JSON.stringify(options), Date.now())`] : []),
          ...initLines.map((l) => l.split('\n').map((sl) => `    ${sl}`).join('\n')),
          '    const params = {}',
          '    const keys = Object.keys(options || {})',
          '    for (let i = 0; i < keys.length; i++) {',
          '      const k = keys[i]',
          '      const v = options[k]',
          '      const s = decodeURIComponent(v)',
          '      try { params[k] = (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : s } catch { params[k] = s }',
          '    }',
          '    this.setData(params)',
          '  },',
        ].join('\n'),
      )
    } else if (piBlocks.page) {
      // script/onload-params 禁用但存在 provide/inject：仍注入承载 onLoad（provide 注册 + inject setData）
      lines.push(`  onLoad(options) {\n${indentBody(piBlocks.page)}\n  },`)
    }
  }

  // ★sourcemap（v0.3）：产物行 → 源码行映射（方法体 / watch 回调体；生成代码无映射）
  const lineMappings: Array<{ out: number; src: number }> = []
  const pushMapped = (line: string, srcLine: number) => {
    const start = lines.length
    lines.push(line)
    const sub = line.split('\n')
    for (let i = 0; i < sub.length; i++) lineMappings.push({ out: start + i, src: srcLine + i })
  }

  for (const [name, m] of Object.entries(methods)) {
    if (extra.debug) methodLines.push(`  // @${m.line} ${name}()`)
    // ★签名行不参与改写（方法名定义处不能变 this.x）；仅函数体做 ref 重写 + 裸调用改写
    const braceIdx = m.src.indexOf('{')
    const sig = m.src.slice(0, braceIdx + 1)
    const body = m.src.slice(braceIdx + 1)
    pushMethod(`  ${sig + rewriteBareMethodCalls(rewriteRefAccess(body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames)},`, m.line)
  }
  // ★15-page-scroll-container 批次2/3：桥接方法生成（dataExtra 已在 dataEntries 前赋值）
  if (!extra.isComponent && !disabled.has('page/scroll-bridge')) {
    if (bridgeHooks.hasOnPageScroll) {
      methodNames.add('proteusPageScroll')
      methodLines.push('  proteusPageScroll(e) { if (typeof this.onPageScroll === "function") this.onPageScroll({ scrollTop: e.detail.scrollTop, scrollLeft: e.detail.scrollLeft }) },')
    }
    if (bridgeHooks.hasOnReachBottom) {
      methodNames.add('proteusReachBottom')
      methodLines.push('  proteusReachBottom() { if (typeof this.onReachBottom === "function") this.onReachBottom() },')
    }
    if (bridgeHooks.hasOnPullDownRefresh) {
      // ★批次3：refresher 受控结束（refresher-triggered 绑定 __proteusRefreshing，触发后置 false 收回刷新态）
      methodNames.add('proteusPullDownRefresh')
      methodLines.push(
        '  proteusPullDownRefresh() { const __r = typeof this.onPullDownRefresh === "function" ? this.onPullDownRefresh() : undefined; this.setData({ __proteusRefreshing: false }); return __r },'
      )
    }
    if (bridgeHooks.hasPageScrollTo) {
      // ★批次3：wx.pageScrollTo → 页面方法（自动包装 scroll-view scroll-top 绑定，运行时桥接）
      methodNames.add('proteusPageScrollTo')
      methodLines.push('  proteusPageScrollTo(opts) { this.setData({ __proteusPageScrollTop: opts.scrollTop }) },')
    }
  }
  // watch 回调方法：proteusWatch<id>(newVal, oldVal)（方法名避开 __ 前缀，微信保留前缀决策 #29）
  // ★props 源非 immediate watch 只走 observers，不生成方法（避免无用产物）；immediate 需要方法（onReady 初始化调用，#499）
  for (const w of Object.values(watches)) {
    if (w.propField && !w.immediate) continue
    methodNames.add(`proteusWatch${w.id}`)
    const src = `proteusWatch${w.id}(${w.params.join(', ')}) {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(w.body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames))}\n  },`
    pushMethod(`  ${src}`, w.line)
  }
  // ★#499 块体 computed 整段求值方法：proteusCalcX()（内部语句任意，末语句 return 表达式；派生 expr = this.proteusCalcX()——
  //   p-modal variants 等块体 computed 此前被忽略 → 依赖方引用悬空 ReferenceError）
  for (const [cname, c] of Object.entries(computeds)) {
    if (!c.blockBody) continue
    const mcalc = `proteusCalc${capitalize(cname)}`
    methodNames.add(mcalc)
    const bsrc = `${mcalc}() {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(c.blockBody, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames))}\n  },`
    pushMethod(`  ${bsrc}`, 1)
  }
  // computed 写路径（v0.3 尾）：显式 setter → proteusSetX(v) 方法（setter 体内 ref 读写照常重写）
  for (const [cname, c] of Object.entries(computeds)) {
    if (!c.setter) continue
    methodNames.add(`proteusSet${capitalize(cname)}`)
    const src = `proteusSet${capitalize(cname)}(${c.setter.param}) {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(c.setter.body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames, runtimeInitNames))}\n  },`
    pushMethod(`  ${src}`, 1)
  }
  // 事件修饰符包装（v0.3 尾）：.self → 仅 e.target === e.currentTarget 触发；.once → data 标记首次后不再触发
  for (const h of extra.selfHandlers ?? []) {
    methodNames.add(`proteusSelf${capitalize(h)}`)
    methodLines.push(`  proteusSelf${capitalize(h)}(e) {`)
    methodLines.push(`    if (e.target === e.currentTarget) {`)
    methodLines.push(`      this.${h}(e)`)
    methodLines.push(`    }`)
    methodLines.push(`  },`)
  }
  for (const h of extra.onceHandlers ?? []) {
    methodNames.add(`proteusOnce${capitalize(h)}`)
    methodLines.push(`  proteusOnce${capitalize(h)}(e) {`)
    methodLines.push(`    if (!this.data.__once${capitalize(h)}) {`)
    methodLines.push(`      this.data.__once${capitalize(h)} = true`)
    methodLines.push(`      this.${h}(e)`)
    methodLines.push(`    }`)
    methodLines.push(`  },`)
  }
  // vue-compat Batch B：内联事件表达式包装方法（@click="count++" → proteusInlineIncCount 等）
  for (const ih of extra.inlineHandlers ?? []) {
    if (disabled.has('event/inline-expression')) continue
    methodNames.add(ih.name)
    pushMethod(`  ${ih.name}(e) {`, 1)
    pushMethod(`    ${ih.code}`, 1)
    pushMethod(`  },`, 1)
  }
  // ★vue-compat-advance Batch 4：provide/inject 响应式联动辅助方法
  if (providedRefs.size > 0) {
    // 提供侧：ref 写入点（rewriteRefAccess 注入）调用——同步当前页命名空间值 + 通知订阅者（inject 侧 setData 刷新）
    methodNames.add('proteusSyncProvide')
    methodLines.push(
      '  proteusSyncProvide(key, ref) {',
      '    const reg = getApp().__proteusProvides',
      '    const p = reg && this.__proteusPageId ? reg[this.__proteusPageId] : (reg || {})',
      '    if (!p) return',
      '    p[key] = this.data[ref]',
      '    const subs = p.__subs && p.__subs[key]',
      '    if (!subs) return',
      '    for (let i = 0; i < subs.length; i++) subs[i]()',
      '  },',
    )
  }
  if (hasInjects) {
    // inject 侧：取消订阅（组件 detached / 页面 onUnload 调用；按引用索引移除防泄漏）
    methodNames.add('proteusUnsubscribeProvide')
    methodLines.push(
      '  proteusUnsubscribeProvide() {',
      '    const reg = getApp().__proteusProvides',
      '    const p = reg && this.__proteusPageId ? reg[this.__proteusPageId] : (reg || {})',
      '    if (!p || !p.__subs || !this.__proteusSubs) return',
      '    for (let i = 0; i < this.__proteusSubs.length; i++) {',
      '      const s = this.__proteusSubs[i]',
      '      const list = p.__subs[s.k]',
      '      if (list) {',
      '        const idx = list.indexOf(s.fn)',
      '        if (idx >= 0) list.splice(idx, 1)',
      '      }',
      '    }',
      '    this.__proteusSubs = null',
      '  },',
    )
  }
  // ★vue-compat-advance Batch 5：离开动画状态机 toggle 方法（ref 写入点注入驱动）
  // 动画时长对齐 style.ts keyframes（fade 250 / slide-up 320 / scale 400）；定时器 id 存实例属性防重/可取消
  for (const t of transitions) {
    const dur = { fade: 250, 'slide-up': 320, scale: 400 }[t.tName] ?? 250
    methodNames.add(`proteusTransitionToggle${t.index}`)
    methodLines.push(
      `  proteusTransitionToggle${t.index}() {`,
      `    if (this.data.${t.ref}) {`,
      `      clearTimeout(this.__tlTimer${t.index})`,
      `      this.__tlTimer${t.index} = null`,
      `      this.setData({ __tv${t.index}: true, __tl${t.index}: false })`,
      `      return`,
      `    }`,
      `    if (this.__tlTimer${t.index}) return`,
      `    this.setData({ __tl${t.index}: true })`,
      `    this.__tlTimer${t.index} = setTimeout(() => {`,
      `      this.__tlTimer${t.index} = null`,
      `      this.setData({ __tv${t.index}: false })`,
      `    }, ${dur})`,
      `  },`,
    )
  }
  // ★真机修复：微信组件方法必须定义在 methods: {}（顶层方法不识别 → 事件绑定报 does not have a method）；
  //   页面模式方法保留顶层（Page 支持）；methods 块插入后合并 sourcemap 映射（out 相对插入点）
  if (extra.isComponent) {
    lines.push('  methods: {')
    for (const ml of methodLines) {
      for (const sl of ml.split('\n')) lines.push(`  ${sl}`)
    }
    lines.push('  },')
  } else {
    lines.push(...methodLines)
  }
  const methodsBase = lines.length
  for (const mm of methodMappings) lineMappings.push({ out: methodsBase + mm.out, src: mm.src })
  lines.push('})')

  // 产物级约束（es5-safe 贯穿全部生成代码；component-mode 决定构造器）
  trace?.add('script/component-mode', {
    before: 'SFC',
    after: extra.isComponent ? 'Component({ ... })' : 'Page({ ... })',
  })
  trace?.add('script/es5-safe', { before: '?? / ?. / 解构 / 展开', after: '显式 null 三元 / 索引循环 / 直接赋值' })

  for (const w of warnings) console.warn(`[mp-transform] ${w}`)
  const js = lines.join('\n') + '\n'
  // ★15-page-scroll-container 批次3：wx.pageScrollTo → this.proteusPageScrollTo（页面上下文桥接，自动包装 scroll-view scroll-top）
  const jsFinal = js.replace(/\bwx\.pageScrollTo\s*\(/g, 'this.proteusPageScrollTo(')
  // sourcemap v3（VLQ）：产物每行 → 源码行（无映射行为空 segment）
  const sourcemap = buildSourceMap(jsFinal, extra.file, source, lineMappings)
  // ★#504 语言层转译交还 babel：?? / ?. / ??= ||= &&= / 对象展开 → ES5 安全产物（微信编译器不解析 ES2020，
  //   预览上传期 SyntaxError——devtools-open-api-demo 真机实证）；inputSourceMap 组合保 sourcemap 指向 Vue 源
  const es5 = transpileMpSafe(jsFinal, sourcemap)
  if (es5.error) warnings.push(`es5-safe 转译失败（产物保留原样，预览可能报语法错误）：${es5.error}`)
  if (es5.changed) trace?.add('script/es5-safe', { before: '?? / ?. / ??= / ||= / &&= / 对象展开残留', after: 'babel 表达式级转译（ES2020→ES5 安全产物，方法论：不自研成熟工具链）' })
  // ★#505 M4 ScriptIR 首条：script 语义结构化投影（data/computeds/runtimeInits/lifecycles——
  //   规则禁用态如实反映：const-to-data/computed-to-data 禁用 → 对应声明空（产物同样退化为无该语义）
  const scriptIR: ScriptIR = {
    data: Object.keys(data).map((name) => ({ name })),
    computeds: Object.entries(computeds).map(([name, c]) => ({
      name,
      deps: (c.deps ?? []).slice(),
      kind: c.blockBody ? ('block' as const) : c.setter ? ('writable' as const) : ('expression' as const),
    })),
    runtimeInits: [...runtimeInitNames].map((name) => ({ name })),
    lifecycles: (['onLoad', 'onReady', 'onUnload'] as const).filter((k) => lifecycles[k]),
    // watch 声明（props 源 → observers；getter 源带 expr；数组源 deps>1；单 ref 源 deps=1）——规则禁用态如实
    watchers: Object.values(watches).map((w) => ({
      deps: (w.deps ?? []).slice(),
      kind: w.propField ? ('props' as const) : w.expr !== undefined ? ('getter' as const) : (w.deps?.length ?? 0) > 1 ? ('array' as const) : ('ref' as const),
      immediate: w.immediate ?? false,
      observers: w.propField !== undefined,
      params: (w.params ?? []).slice(),
      ...(w.propField ? { propField: w.propField } : {}),
    })),
    // props 声明（defineProps → properties：name + 微信类型——组件模式且 script/define-props 未禁用时提取）
    props: Object.entries(props).map(([name, p]) => ({ name, type: p.type })),
    // provide/inject 键表（★Batch 4：裸 ref 提供 → reactive 联动；inject 订阅取消）——规则禁用态如实
    provides: piEnabled ? provides.map((p) => ({ key: p.key, reactive: [...providedRefs.values()].includes(p.key) })) : [],
    injects: piEnabled ? injects.map((i) => ({ key: i.key, name: i.name })) : [],
    // methods 名册（顶层函数/箭头 —— 产物方法；模板 @handler 回显关联面）
    methods: Object.keys(methods).map((name) => ({ name })),
  }
  return { js: es5.code, warnings, sourcemap: es5.sourcemap ?? sourcemap, ir: scriptIR }
}
