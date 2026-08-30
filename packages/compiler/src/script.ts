// src/compiler/script.ts
// 4-1-b Script → Page/Component 构造器 JS
// 顶层 const（ref/reactive/字面量）→ data；顶层函数 → methods；生命周期映射
import type { ScriptTransformOptions, ScriptTransformResult, StyleTransformOptions } from './types'
import type { TransformTrace } from './trace'
import { lineAt } from './trace'
import { resolveOverrides } from './overrides'

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

/** defineProps 对象形式 → Component properties 字段（仅组件模式；含 v0.3 尾 TS 泛型形式） */
function extractProps(source: string, warnings: string[], trace?: TransformTrace): Record<string, PropInfo> {
  const out: Record<string, PropInfo> = {}
  const add = (name: string, info: PropInfo, before: string): void => {
    out[name] = info
    trace?.add('script/define-props', { before, after: `properties.${name}（type: ${info.type}）` })
  }
  const m = source.match(/\bdefineProps\s*\(\s*\{/)
  if (m) {
    const body = extractBracedBody(source, (m.index ?? 0) + m[0].length - 1)
    if (body === null) {
      warnings.push('defineProps 解析失败（MVP 仅支持对象形式 defineProps({...})），已忽略')
      return out
    }
    const re = /(['"]?)([A-Za-z_$][\w$]*)\1\s*:\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)/g
    let pm: RegExpExecArray | null
    while ((pm = re.exec(body))) {
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
      // 无 default 时按类型给默认值（微信 properties.value）；函数默认值（如 () => []）不适用，跳过
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
  const re = /([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([^;]+)/g
  let pm: RegExpExecArray | null
  while ((pm = re.exec(tsM[1]))) {
    const name = pm[1]
    const info = mapTsType(pm[3], warnings, name)
    add(name, info, `defineProps<{ ${name}${pm[2] ?? ''}: ${pm[3].trim()} }>()`)
  }
  return out
}

/**
 * 提取顶层 watch 调用：watch(源, (newVal, oldVal) => { ... }[, { immediate: true }])
 * 源：单 ref（count）| 数组（[a, b]）| 函数（() => expr，依赖从 expr 的 x.value 提取）| ★props 源（props.x / () => props.x → WeChat observers）
 * MVP：箭头函数回调；function 回调警告
 */
function extractWatch(
  source: string,
  data: Record<string, unknown>,
  warnings: string[],
  trace?: TransformTrace,
  allowPropWatch = true,
): Record<string, WatchInfo> {
  const out: Record<string, WatchInfo> = {}
  const re = /^watch\s*\(\s*([\s\S]*?)\s*,\s*(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\)\s*)\s*\{/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue
    const rawSrc = m[1].trim()
    const params = (m[2] ?? m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    // ★props 源（组件监听自身属性变化）：watch(props.x, cb) / watch(() => props.x, cb)
    //   Web 端即标准 Vue watch（全响应式）；MP 端编译为 Component observers（属性变化触发回调）
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
      const body = extractBracedBody(source, braceIdx)
      if (body === null) {
        warnings.push(`watch ${rawSrc} 回调体解析失败，已跳过`)
        continue
      }
      const after = source.slice(braceIdx + body.length + 1, braceIdx + body.length + 120)
      const immediate = /immediate\s*:\s*true/.test(after)
      const id = `Prop${capitalize(propField)}`
      if (out[id]) {
        warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
      }
      trace?.add('script/watch-props', {
        line: lineAt(source, m.index),
        before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
        after: `observers: { ${propField}(n, o) { ... }${immediate ? ' + proteusWatchPropX 方法（attached 初始化调用一次）' : ''} }`,
      })
      out[id] = { id, deps: [], params, body, immediate, line: lineAt(source, m.index), propField }
      continue
    }
    // 解析源 → deps + 函数源 getter
    let deps: string[] = []
    let expr: string | undefined
    if (rawSrc.startsWith('[')) {
      // 数组源 [a, b]
      deps = Array.from(rawSrc.matchAll(/\b([A-Za-z_$][\w$]*)\b/g), (mm) => mm[1])
    } else if (rawSrc.startsWith('()')) {
      // 函数源 () => expr：依赖从 expr 的 x.value 提取，getter 转写为 this.data 形式
      const getter = rawSrc.replace(/^\(\)\s*=>\s*/, '')
      deps = [...new Set(Array.from(getter.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
      expr = getter.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
    } else {
      // 单 ref
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
    const body = extractBracedBody(source, braceIdx)
    if (body === null) {
      warnings.push(`watch ${rawSrc} 回调体解析失败，已跳过`)
      continue
    }
    const after = source.slice(braceIdx + body.length + 1, braceIdx + body.length + 120)
    const immediate = /immediate\s*:\s*true/.test(after)
    if (out[id]) {
      warnings.push(`watch ${rawSrc} 与已有 watch 重名（${id}），后者覆盖前者`)
    }
    trace?.add('script/watch-to-methods', {
      line: lineAt(source, m.index),
      before: `watch(${rawSrc}, (${params.join(', ')}) => ...)`,
      after: `proteusWatch${id}（${deps.join('/')} 写入 setData 后自动调用${immediate ? '，immediate 初始化一次' : ''}）`,
    })
    out[id] = { id, deps, params, body, immediate, line: lineAt(source, m.index), expr }
  }
  return out
}

/** 提取顶层 const 中的 computed（箭头简写 + 表达式体），返回派生信息 */
function extractComputedFromInit(
  name: string,
  init: string,
  data: Record<string, unknown>,
  warnings: string[],
): ComputedInfo | null {
  // 箭头简写：computed(() => 表达式)（表达式体；块体拦截）
  const arrow = init.match(/^computed\s*\(\s*\(\)\s*=>\s*([\s\S]*?)\s*\)\s*;?$/)
  // 对象形式（v0.3 尾写路径）：computed({ get: () => expr[, set: (v) => { body }] })
  let rawExpr: string | undefined
  let setter: { param: string; body: string } | undefined
  if (arrow) {
    rawExpr = arrow[1]
    if (rawExpr.trim().startsWith('{')) return null // 块体拦截
  } else {
    const objM = init.match(/^computed\s*\(\s*\{/)
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
  const missing = deps.filter((d) => !(d in data))
  if (missing.length) {
    warnings.push(
      `computed ${name} 依赖 ${missing.join('/')} 未在顶层 data 中定义（${name} 的依赖必须是本文件顶层 ref/reactive）`,
    )
  }
  // 转写：x.value → this.data.x（与 ref 读取重写一致）
  const expr = rawExpr.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
  return { name, deps, expr, setter }
}

/** 顶层 const（ref/reactive/字面量）→ data 初始值 + computed 派生信息 + ★B0 运行时初始化（函数调用） */
function extractData(
  source: string,
  warnings: string[],
  trace?: TransformTrace,
): { data: Record<string, unknown>; computed: Record<string, ComputedInfo>; runtimeInits: Array<{ name: string; call: string }> } {
  const data: Record<string, unknown> = {}
  const runtimeInits: Array<{ name: string; call: string }> = []
  const rawComputed: Array<{ name: string; init: string; line: number }> = []
  // 只提取行首（缩进 0）的顶层 const：函数体/生命周期体/块内的局部 const 天然跳过
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    // 只提取行首（零缩进）的顶层 const：函数体/生命周期体/块内的局部 const 天然跳过
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue
    const name = m[1]
    const init = extractInitializer(source, m.index + m[0].length)
    if (!init) continue
    const line = lineAt(source, m.index)
    // 组件宏（defineProps/defineEmits/defineExpose）：编译期指令，不提取 data（defineProps< 泛型形式兼容）
    if (/^(?:defineProps\s*[<(]|defineEmits\s*\(|defineExpose\s*\()/.test(init)) continue
    // 跳过函数/箭头函数（属于 methods）
    if (/^(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(init)) continue
    // computed 读路径（v0.3）：收集后统一处理（依赖可能定义在其后）
    if (init.startsWith('computed(')) {
      rawComputed.push({ name, init, line })
      continue
    }
    trace?.add('script/const-to-data', {
      line,
      before: `const ${name} = ${init.slice(0, 40)}${init.length > 40 ? '…' : ''}`,
      after: `data.${name}`,
    })
    // 解构/嵌套 const（如 const { a } = ...）在 regex 上已天然跳过
    const inner = init.match(/^(?:ref|reactive|shallowRef|readonly)\s*\(\s*([\s\S]*?)\s*\);?\s*$/)
    const raw = inner ? inner[1] : init
    const value = evalLiteral(raw)
    const isCall = /^[\w$.]+\(/.test(raw.trim())
    if (isCall && value === undefined && !/^inject\s*\(/.test(raw.trim())) {
      // ★module-plan B0：函数调用且静态求值失败 → 运行时初始化（实例属性 this.<name>，onLoad/attached 注入）——不再丢调用
      // inject 是 Vue 内置注入（Batch 3）不走此路径（data 初始 undefined + 运行时 setData 填充）
      runtimeInits.push({ name, call: raw.trim() })
      trace?.add('script/runtime-init', {
        line,
        before: `const ${name} = ${raw.slice(0, 40)}`,
        after: `this.${name} = ${raw.trim()}（onLoad/attached 运行时初始化，实例属性；模板绑定不支持）`,
      })
      warnings.push(
        `const ${name} 的初始值 "${raw.slice(0, 40)}" 是函数调用——已编译为运行时初始化 this.${name}（onLoad/attached 执行，实例属性：模板绑定不支持，逻辑层可用；共享逻辑请用模块 import，见 docs/proteus-module-plan/）`,
      )
      continue // 不进 data（运行时实例属性）
    }
    if (value === undefined && raw !== 'undefined' && !/^inject\s*\(/.test(raw.trim())) {
      warnings.push(`const ${name} 的初始值 "${raw.slice(0, 40)}" 无法静态求值，data.${name} 将设为 undefined（MVP 限制：仅支持字面量）`)
    }
    data[name] = value
  }
  // 二次处理 computed（此时 data 已完整，可校验依赖）
  const computed: Record<string, ComputedInfo> = {}
  for (const c of rawComputed) {
    const info = extractComputedFromInit(c.name, c.init, data, warnings)
    if (info) {
      computed[c.name] = info
      trace?.add('script/computed-to-data', {
        line: c.line,
        before: `const ${c.name} = computed(() => ...)`,
        after: `派生字段（依赖 ${info.deps.join('/') || '无'}，写入时合并重算）`,
      })
    } else {
      warnings.push(`computed ${c.name} 仅支持箭头简写 + 表达式体（computed(() => expr)），已忽略`)
    }
  }
  return { data, computed, runtimeInits }
}

/** 顶层方法（源码 + 起始行号，供 sourcemap / 行号注释） */
interface MethodInfo {
  /** 方法体源码（含参数，产物方法简写） */
  src: string
  /** 源码起始行（1-based） */
  line: number
}

/** 剥离方法参数 TS 类型标注（产物是 JS；e: { detail?: number } → e） */
function stripParamTypes(params: string): string {
  return params.replace(/:\s*[^,)]+/g, '').trim()
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
  const fnRe = /(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  let m: RegExpExecArray | null
  if (!disabled?.has('script/function-to-methods')) {
    while ((m = fnRe.exec(source))) {
      const name = m[2]
      const isAsync = Boolean(m[1])
      const params = stripParamTypes(m[3])
      const body = extractBracedBody(source, m.index + m[0].length - 1)
      const line = lineAt(source, m.index)
      trace?.add('script/function-to-methods', { line, before: `function ${name}(${m[3]})`, after: `${name}(${params})` })
      // 对象字面量方法简写：handleTap() {...}（不能输出裸 function 声明；async 保留——方法体 await 合法）
      if (body !== null) methods[name] = { src: `${isAsync ? 'async ' : ''}${name}(${params}) {\n${body}\n}`, line }
      else warnings.push(`函数 ${name} 体解析失败，已跳过`)
    }
  }
  const arrowRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\(([^)]*)\)\s*=>\s*\{/g
  if (!disabled?.has('script/arrow-to-methods')) {
    while ((m = arrowRe.exec(source))) {
      const name = m[1]
      const isAsync = Boolean(m[2])
      const params = stripParamTypes(m[3])
      const braceIdx = source.indexOf('{', m.index + m[0].length - 1)
      const body = extractBracedBody(source, braceIdx)
      const line = lineAt(source, m.index)
      trace?.add('script/arrow-to-methods', { line, before: `const ${name} = (...) =>`, after: `${name}(...)` })
      if (body !== null) methods[name] = { src: `${isAsync ? 'async ' : ''}${name}(${params}) {\n${body}\n}`, line }
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

/** computed 派生补丁：写入 ref 时把依赖它的 computed 重算表达式合并进同一 setData（v0.3 读路径） */
function computedPatch(writtenRef: string, computeds: Record<string, ComputedInfo>): string {
  const patches = Object.entries(computeds)
    .filter(([, c]) => c.deps.includes(writtenRef))
    .map(([n, c]) => `${n}: ${c.expr}`)
  return patches.length ? `, ${patches.join(', ')}` : ''
}

/** onLoad 初始化行：一次性计算全部 computed 派生字段（首次渲染前 data 就绪） */
function computedInitLine(computeds: Record<string, ComputedInfo>): string {
  const entries = Object.entries(computeds)
  if (!entries.length) return ''
  return `this.setData({ ${entries.map(([n, c]) => `${n}: ${c.expr}`).join(', ')} })`
}

/** ★module-plan B0：函数调用初始化运行时注入（实例属性 this.<name> = <call>，onLoad/attached 执行） */
function runtimeInitLine(inits: Array<{ name: string; call: string }>): string {
  return inits.map((i) => `this.${i.name} = ${i.call}`).join('\n')
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

/** immediate watch 初始化行：onLoad 时调用一次（单源标量 / 多源数组，oldVal = undefined） */
function immediateWatchLine(watches: Record<string, WatchInfo>): string {
  const lines = Object.entries(watches)
    .filter(([, w]) => w.immediate)
    .map(([, w]) => {
      const single = w.deps.length === 1
      const newVals = w.propField
        ? `this.data.${w.propField}`
        : single
          ? (w.expr ?? `this.data.${w.deps[0]}`)
          : `[${(w.expr ?? w.deps.map((d) => `this.data.${d}`).join(', '))}]`
      const oldVals = w.propField ? 'undefined' : single ? 'undefined' : `[${w.deps.map(() => 'undefined').join(', ')}]`
      return `this.proteusWatch${w.id}(${newVals}, ${oldVals})`
    })
  return lines.join('\n')
}

/**
 * setData 写入模板：有派生补丁 / watch 联动 / 前置写时先更新 this.data.name 再 setData——
 * 保证同一 setData 对象里的派生表达式读到该 ref 的**新值**（setData 异步批量，对象内求值用当前 this.data）
 */
function writeSetData(name: string, valueExpr: string, patch: string, hasWatch = false, forceWrite = false): string {
  const needWrite = forceWrite || Boolean(patch) || hasWatch
  if (!needWrite) return `this.setData({ ${name}: ${valueExpr} })`
  return `this.data.${name} = ${valueExpr}; this.setData({ ${name}: this.data.${name}${patch} })`
}

/** watch 联动调用：setData 后追加分号 + proteusWatch<id>（单源回调标量 / 多源回调数组，旧值由调用方在写入前保存） */
function watchTail(w: WatchInfo | undefined): string {
  if (!w) return ''
  const single = w.deps.length === 1
  const newVals = single ? (w.expr ?? `this.data.${w.deps[0]}`) : `[${(w.expr ?? w.deps.map((d) => `this.data.${d}`).join(', '))}]`
  const oldVals = single ? `old${capitalize(w.deps[0])}` : `[${w.deps.map((d) => `old${capitalize(d)}`).join(', ')}]`
  return `; this.proteusWatch${w.id}(${newVals}, ${oldVals})`
}

/**
 * 方法体裸调用改写：已知组件方法名 → this.name(（真机修复：微信组件方法必须在 methods 且须 this 调用，
 * 裸标识符调用是词法查找 → 顶层/全局找不到 → ReferenceError / 事件报 does not have a method）
 * methodNames 白名单精确区分：组件方法（改写）vs 模块函数/内置（setTimeout/eventValue 等 → 保持裸调用）
 */
function rewriteBareMethodCalls(body: string, methodNames: Set<string>): string {
  let out = body
  for (const name of methodNames) {
    out = out.replace(new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g'), `this.${name}(`)
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
  // ★platform-plan B1：方法体内 TS 类型断言剥离（as unknown/any/never/标识符/单层泛型——产物是 JS；复杂嵌套断言仍 MVP 限制）
  out = out.replace(/\s+as\s+(?:unknown|any|never)\b/g, '')
  out = out.replace(/\s+as\s+[A-Za-z_$][\w$]*(?:<[^;\n]*?>)?/g, '')
  // 组件事件（v0.3）：emit('xxx', payload) → this.triggerEvent('xxx', payload)（微信组件方法）
  if (emitEnabled) out = out.replace(/\bemit\s*\(/g, 'this.triggerEvent(')
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
    const patch = computedPatch(name, computeds)
    // 命中依赖此 ref 的 watch（多源/函数源 deps 匹配；MVP 每 ref 至多一个 watch）
    const w = Object.values(watches).find((ww) => ww.deps.includes(name) && !skip('script/watch-to-methods'))
    const oldSave = w
      ? `const ${w.deps.map((d) => `old${capitalize(d)} = this.data.${d}`).join(', ')}; `
      : ''
    const tail = watchTail(w)
    // ★Batch 4：裸 ref 被 provide → 写入后同步注册表值 + 通知订阅者（proteusSyncProvide 由 transformScriptToPage 生成）
    const sync = providedRefs && providedRefs.get(name)
      ? `; this.proteusSyncProvide(${JSON.stringify(providedRefs.get(name))}, ${JSON.stringify(name)})`
      : ''
    // ★Batch 5：v-if ref 被 transition 引用 → 写入后驱动离开动画状态机（延迟移除）
    const tToggle = transitionToggle && transitionToggle.get(name) ? `; this.${transitionToggle.get(name)}()` : ''
    // 自增/自减（含前置 ++name.value / --name.value：前置需先写 this.data，表达式值 = 新值）
    if (!skip('script/ref-incdec')) {
      if (new RegExp(`(\\+\\+|--)\\s*${name}\\.value`).test(body) || new RegExp(`\\b${name}\\.value\\s*(\\+\\+|--)`).test(body)) {
        trace?.add('script/ref-incdec', { line, before: `${name}.value++/--`, after: `this.setData({ ${name}: ...${patch || w ? ' + 派生/联动' : ''} })` })
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
        trace?.add('script/ref-write', { line, before: `${name}.value = expr`, after: `this.setData({ ${name}: expr${patch || w ? ' + 派生/联动' : ''} })` })
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
  const { data, computed, runtimeInits } = disabled.has('script/const-to-data') ? { data: {}, computed: {}, runtimeInits: [] as Array<{ name: string; call: string }> } : extractData(source, warnings, trace)
  // computed 读路径（v0.3）：规则禁用时退化为不编译（computed 字段不进 data）
  const computeds = disabled.has('script/computed-to-data') ? {} : computed
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
  const refNames = new Set(Object.keys(data))

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

  const lines: string[] = []
  if (extra.file) lines.push(`// ${extra.file}（Proteus mp-transform 编译产物）`)
  lines.push('// AUTO-GENERATED by vite-plugin-mp-transform.ts. DO NOT EDIT.', '')
  // ★module-plan B0：跨模块引用 require 语句（共享模块产物，页面/组件顶部声明）
  if (requireLines.length) lines.push(...requireLines, '')
  lines.push(extra.isComponent ? 'Component({' : 'Page({')

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
      const observerBody = rewriteBareMethodCalls(rewriteRefAccess(w.body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames)
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

  if (lifecycles.onReady) {
    lines.push(`  onReady() {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(lifecycles.onReady, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames))}\n  },`)
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
  const needsPageCleanup = hasInjects || providedRefs.size > 0 || Boolean(storeDisposeLine)
  const pageCleanupLine = 'const __reg = getApp().__proteusProvides; if (__reg && this.__proteusPageId) delete __reg[this.__proteusPageId]'
  const unsubLine = hasInjects ? 'this.proteusUnsubscribeProvide()' : ''
  if (lifecycles.onUnload) {
    // ★Batch 4/6：页面级 inject 订阅取消 + 命名空间清理 + store dispose（前置；onUnload 显式存在时注入）
    // ★B7：组件模式 onUnmounted → detached（微信组件无 onUnload；MP 组件销毁钩子为 detached）
    const unloadBody = rewriteBareMethodCalls(rewriteRefAccess(lifecycles.onUnload, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames)
    const isComp = extra.isComponent
    const pre = isComp ? [unsubLine].filter(Boolean).join('\n') : [unsubLine, storeDisposeLine, pageCleanupLine].filter(Boolean).join('\n')
    const hook = isComp ? 'detached' : 'onUnload'
    lines.push(`  ${hook}() {
${indentBody(pre ? `${pre}\n${unloadBody}` : unloadBody)}
  },`)
  } else if (needsPageCleanup && !extra.isComponent) {
    // 页面级 provide/inject/store 但无显式 onUnload：生成承载清理的 onUnload（组件模式用 detached，见组件分支）
    lines.push(`  onUnload() {
${indentBody([unsubLine, storeDisposeLine, pageCleanupLine].filter(Boolean).join('\n'))}
  },`)
  }
  // 组件模式：无 onLoad（微信组件生命周期无 onLoad）；computed 初始化 + immediate watch 放 attached()
  // ★vue-compat-advance Batch 3：provide 注册放 created（先于子组件 attached 注入），inject 读取放 attached
  if (extra.isComponent) {
    if (piBlocks.provide) {
      lines.push(`  created() {\n${indentBody(piBlocks.provide)}\n  },`)
    }
    const initLines = [computedInitLine(computeds), runtimeInitLine(runtimeInits), storeBindingInit, immediateWatchLine(watches), piBlocks.inject].filter(Boolean)
    if (initLines.length) {
      lines.push(`  attached() {\n${indentBody(initLines.join('\n'))}\n  },`)
    }
    // ★Batch 4：组件级 inject 订阅取消（attached 订阅 → detached 移除，防全局注册表回调泄漏）
    // ★B7：onUnmounted 已映射 detached 时不再重复生成（避免 Component 重复键覆盖）
    if (hasInjects && !lifecycles.onUnload) {
      lines.push(`  detached() {\n    this.proteusUnsubscribeProvide()\n  },`)
    }
  } else if (lifecycles.onLoad) {
    // 显式 onLoad（页面）：computed 初始化 + immediate watch + provide/inject 注入在方法体前
    const initLines = [computedInitLine(computeds), runtimeInitLine(runtimeInits), storeBindingInit, immediateWatchLine(watches), piBlocks.page].filter(Boolean)
    const body = rewriteBareMethodCalls(rewriteRefAccess(lifecycles.onLoad, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames)
    lines.push(`  onLoad(options) {\n${indentBody(initLines.length ? `${initLines.join('\n')}\n${body}` : body)}\n  },`)
  } else {
    // 默认 onLoad：路由参数自动 decode 并注入 data（P5 契约，与 runtime/pageLifecycle 的 createPage 行为一致）
    // 注意：不用数组解构/对象展开（微信 ES5 转译需要 babel helper 模块，真机报 arrayWithHoles 未定义）
    if (!disabled.has('script/onload-params')) {
      trace?.add('script/onload-params', { before: '（无显式 onLoad）', after: 'onLoad(options) → decodeURIComponent + JSON.parse + setData' })
      const initLines = [computedInitLine(computeds), runtimeInitLine(runtimeInits), storeBindingInit, immediateWatchLine(watches), piBlocks.page].filter(Boolean)
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
    pushMethod(`  ${sig + rewriteBareMethodCalls(rewriteRefAccess(body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames)},`, m.line)
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
  // ★props 源非 immediate watch 只走 observers，不生成方法（避免无用产物）；immediate 需要方法（attached 初始化调用）
  for (const w of Object.values(watches)) {
    if (w.propField && !w.immediate) continue
    methodNames.add(`proteusWatch${w.id}`)
    const src = `proteusWatch${w.id}(${w.params.join(', ')}) {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(w.body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames))}\n  },`
    pushMethod(`  ${src}`, w.line)
  }
  // computed 写路径（v0.3 尾）：显式 setter → proteusSetX(v) 方法（setter 体内 ref 读写照常重写）
  for (const [cname, c] of Object.entries(computeds)) {
    if (!c.setter) continue
    methodNames.add(`proteusSet${capitalize(cname)}`)
    const src = `proteusSet${capitalize(cname)}(${c.setter.param}) {\n${indentBody(rewriteBareMethodCalls(rewriteRefAccess(c.setter.body, refNames, trace, disabled, computeds, watches, emitEnabled, propsVar, providedRefs, transitionToggle), methodNames))}\n  },`
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
  return { js: jsFinal, warnings, sourcemap }
}
