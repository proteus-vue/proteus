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

/** computed 派生字段信息（v0.3 读路径：编译期把 getter 转 data 派生） */
interface ComputedInfo {
  name: string
  /** getter 表达式中依赖的 ref 名（x.value → x） */
  deps: string[]
  /** 转写后表达式（x.value → this.data.x），供 setData 合并重算 */
  expr: string
}

/** watch 信息（v0.3：依赖 ref 写入后自动调用回调，模拟 Vue watch） */
interface WatchInfo {
  /** 依赖的 ref 名 */
  dep: string
  /** 回调参数（[newVal, oldVal]） */
  params: string[]
  /** 回调体（ref 访问已重写为 this.data 形式） */
  body: string
  /** immediate: true → onLoad 初始化时调用一次 */
  immediate: boolean
}

/**
 * 提取顶层 watch 调用：watch(refName, (newVal, oldVal) => { ... }[, { immediate: true }])
 * MVP：仅单 ref 直接引用 + 箭头函数回调；数组源 / 函数源 / function 回调警告不支持
 */
function extractWatch(
  source: string,
  data: Record<string, unknown>,
  warnings: string[],
  trace?: TransformTrace,
): Record<string, WatchInfo> {
  const out: Record<string, WatchInfo> = {}
  const re = /^watch\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\)\s*)\s*\{/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (source.slice(lineStart, m.index) !== '') continue
    const dep = m[1]
    const params = (m[2] ?? m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!(dep in data)) {
      warnings.push(`watch 依赖 ${dep} 未在顶层 data 中定义（watch 的源必须是本文件顶层 ref/reactive）`)
      continue
    }
    const braceIdx = m.index + m[0].length - 1
    const body = extractBracedBody(source, braceIdx)
    if (body === null) {
      warnings.push(`watch ${dep} 回调体解析失败，已跳过`)
      continue
    }
    const after = source.slice(braceIdx + body.length + 1, braceIdx + body.length + 120)
    const immediate = /immediate\s*:\s*true/.test(after)
    if (out[dep]) {
      warnings.push(`watch ${dep} 存在多个（MVP 仅支持一个），后者覆盖前者`)
    }
    trace?.add('script/watch-to-methods', {
      line: lineAt(source, m.index),
      before: `watch(${dep}, (${params.join(', ')}) => ...)`,
      after: `proteusWatch${capitalize(dep)}（${dep} 写入 setData 后自动调用${immediate ? '，immediate 初始化一次' : ''}）`,
    })
    out[dep] = { dep, params, body, immediate }
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
  // 仅支持 computed(() => 表达式) 箭头简写 + 表达式体（块体/function 形式警告不支持）
  const m = init.match(/^computed\s*\(\s*\(\)\s*=>\s*([\s\S]*?)\s*\)\s*;?$/)
  if (!m) return null
  const rawExpr = m[1]
  // 块体（() => { return ... }）不是表达式体：{ 开头需拦截（否则生成 { return ... } 坏表达式）
  if (rawExpr.trim().startsWith('{')) return null
  const deps = [...new Set(Array.from(rawExpr.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g), (mm) => mm[1]))]
  const missing = deps.filter((d) => !(d in data))
  if (missing.length) {
    warnings.push(
      `computed ${name} 依赖 ${missing.join('/')} 未在顶层 data 中定义（${name} 的依赖必须是本文件顶层 ref/reactive）`,
    )
  }
  // 转写：x.value → this.data.x（与 ref 读取重写一致）
  const expr = rawExpr.replace(/\b([A-Za-z_$][\w$]*)\.value\b/g, 'this.data.$1')
  return { name, deps, expr }
}

/** 顶层 const（ref/reactive/字面量）→ data 初始值 + computed 派生信息 */
function extractData(
  source: string,
  warnings: string[],
  trace?: TransformTrace,
): { data: Record<string, unknown>; computed: Record<string, ComputedInfo> } {
  const data: Record<string, unknown> = {}
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
    if (value === undefined && raw !== 'undefined') {
      warnings.push(
        `const ${name} 的初始值 "${raw.slice(0, 40)}" 无法静态求值，data.${name} 将设为 undefined（MVP 限制：仅支持字面量）`,
      )
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
  return { data, computed }
}

/** 顶层函数（function 声明 / const 箭头）→ methods 源码 */
function extractMethods(source: string, warnings: string[], trace?: TransformTrace, disabled?: Set<string>): Record<string, string> {
  const methods: Record<string, string> = {}
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  let m: RegExpExecArray | null
  if (!disabled?.has('script/function-to-methods')) {
    while ((m = fnRe.exec(source))) {
      const name = m[1]
      const params = m[2]
      const body = extractBracedBody(source, m.index + m[0].length - 1)
      trace?.add('script/function-to-methods', { line: lineAt(source, m.index), before: `function ${name}(${params})`, after: `${name}(${params})` })
      // 对象字面量方法简写：handleTap() {...}（不能输出裸 function 声明）
      if (body !== null) methods[name] = `${name}(${params}) {\n${body}\n}`
      else warnings.push(`函数 ${name} 体解析失败，已跳过`)
    }
  }
  const arrowRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g
  if (!disabled?.has('script/arrow-to-methods')) {
    while ((m = arrowRe.exec(source))) {
      const name = m[1]
      const params = m[2]
      const braceIdx = source.indexOf('{', m.index + m[0].length - 1)
      const body = extractBracedBody(source, braceIdx)
      trace?.add('script/arrow-to-methods', { line: lineAt(source, m.index), before: `const ${name} = (...) =>`, after: `${name}(...)` })
      if (body !== null) methods[name] = `${name}(${params}) {\n${body}\n}`
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

/** immediate watch 初始化行：onLoad 时调用一次（newVal = 当前值，oldVal = undefined） */
function immediateWatchLine(watches: Record<string, WatchInfo>): string {
  const lines = Object.entries(watches)
    .filter(([, w]) => w.immediate)
    .map(([dep]) => `this.proteusWatch${capitalize(dep)}(this.data.${dep}, undefined)`)
  return lines.join('\n')
}

/**
 * setData 写入模板：有派生补丁 / watch 联动 / 前置写时先更新 this.data.name 再 setData——
 * 保证同一 setData 对象里的派生表达式读到该 ref 的**新值**（setData 异步批量，对象内求值用当前 this.data）
 */
function writeSetData(name: string, valueExpr: string, patch: string, watchName?: string, forceWrite = false): string {
  const needWrite = forceWrite || Boolean(patch) || Boolean(watchName)
  if (!needWrite) return `this.setData({ ${name}: ${valueExpr} })`
  return `this.data.${name} = ${valueExpr}; this.setData({ ${name}: this.data.${name}${patch} })`
}

/** watch 联动调用：setData 后追加分号 + proteusWatchX(newVal, oldVal)（旧值由调用方在写入前保存） */
function watchTail(name: string, watchName?: string): string {
  if (!watchName) return ''
  return `; this.proteusWatch${capitalize(name)}(this.data.${name}, old${capitalize(name)})`
}

function rewriteRefAccess(
  body: string,
  refNames: Set<string>,
  trace?: TransformTrace,
  disabled?: Set<string>,
  computeds: Record<string, ComputedInfo> = {},
  watches: Record<string, WatchInfo> = {},
): string {
  const skip = (id: string) => disabled?.has(id)
  let out = body
  for (const name of refNames) {
    const prop = `this.data.${name}`
    const line = lineAt(body, Math.max(0, body.indexOf(name)))
    const patch = computedPatch(name, computeds)
    const watchName = name in watches && !skip('script/watch-to-methods') ? name : undefined
    const oldSave = watchName ? `const old${capitalize(name)} = this.data.${name}; ` : ''
    // 自增/自减（含前置 ++name.value / --name.value：前置需先写 this.data，表达式值 = 新值）
    if (!skip('script/ref-incdec')) {
      if (new RegExp(`(\\+\\+|--)\\s*${name}\\.value`).test(body) || new RegExp(`\\b${name}\\.value\\s*(\\+\\+|--)`).test(body)) {
        trace?.add('script/ref-incdec', { line, before: `${name}.value++/--`, after: `this.setData({ ${name}: ...${patch || watchName ? ' + 派生/联动' : ''} })` })
      }
      out = out.replace(new RegExp(`\\+\\+\\s*${name}\\.value`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} + 1`, patch, watchName, true)}${watchTail(name, watchName)}`)
      out = out.replace(new RegExp(`--\\s*${name}\\.value`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} - 1`, patch, watchName, true)}${watchTail(name, watchName)}`)
      out = out.replace(new RegExp(`\\b${name}\\.value\\s*\\+\\+`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} + 1`, patch, watchName)}${watchTail(name, watchName)}`)
      out = out.replace(new RegExp(`\\b${name}\\.value\\s*--`, 'g'), `${oldSave}${writeSetData(name, `${numOrZero(prop)} - 1`, patch, watchName)}${watchTail(name, watchName)}`)
    }
    // 赋值：name.value = expr（排除 == / === / 复合赋值）
    if (!skip('script/ref-write')) {
      if (new RegExp(`\\b${name}\\.value\\s*=\\s*(?!=)`).test(out)) {
        trace?.add('script/ref-write', { line, before: `${name}.value = expr`, after: `this.setData({ ${name}: expr${patch || watchName ? ' + 派生/联动' : ''} })` })
      }
      out = out.replace(
        new RegExp(`\\b${name}\\.value\\s*=\\s*(?!=)([^;\\n]+)`),
        (_m, expr) => `${oldSave}${writeSetData(name, expr.trim(), patch, watchName)}${watchTail(name, watchName)}`,
      )
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
function extractLifecycles(source: string, trace?: TransformTrace, disabled?: Set<string>): { onReady?: string; onUnload?: string; onLoad?: string } {
  const out: { onReady?: string; onUnload?: string; onLoad?: string } = {}
  if (disabled?.has('script/lifecycle-map')) return out
  const hooks = [
    { re: /onMounted\s*\(/g, key: 'onReady' as const },
    { re: /onUnmounted\s*\(/g, key: 'onUnload' as const },
    { re: /onLoad\s*\(/g, key: 'onLoad' as const },
  ]
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

/** script 源码 → Page/Component 构造器 JS（纯函数，独立可测） */
export function transformScriptToPage(
  source: string,
  _opts: StyleTransformOptions = { px2rpx: true, rpxRatio: 2 },
  extra: ScriptTransformOptions = {},
): ScriptTransformResult {
  const warnings: string[] = []
  const trace = extra.trace
  // ★底线循环 ①③：禁用集（config rules.disabled 即时生效）
  const disabled = resolveOverrides(extra.rules).disabled
  const { data, computed } = disabled.has('script/const-to-data') ? { data: {}, computed: {} } : extractData(source, warnings, trace)
  // computed 读路径（v0.3）：规则禁用时退化为不编译（computed 字段不进 data）
  const computeds = disabled.has('script/computed-to-data') ? {} : computed
  // watch（v0.3）：依赖 ref 写入 setData 后自动调用回调
  const watches = disabled.has('script/watch-to-methods') ? {} : extractWatch(source, data, warnings, trace)
  const methods = extractMethods(source, warnings, trace, disabled)
  const lifecycles = extractLifecycles(source, trace, disabled)
  const vModelBindings = extra.vModelBindings ?? []
  const refNames = new Set(Object.keys(data))

  const lines: string[] = []
  if (extra.file) lines.push(`// ${extra.file}（Proteus mp-transform 编译产物）`)
  lines.push('// AUTO-GENERATED by vite-plugin-mp-transform.ts. DO NOT EDIT.', '')
  lines.push(extra.isComponent ? 'Component({' : 'Page({')

  const dataEntries = Object.entries(data)
  if (dataEntries.length) {
    lines.push('  data: {')
    for (const [k, v] of dataEntries) lines.push(`    ${k}: ${JSON.stringify(v)},`)
    lines.push('  },')
  }

  // v-model 自动 handler：proteusOnXxxInput(e) { this.setData({ xxx: e.detail.value }) }
  const vmodelDisabled = disabled.has('script/vmodel-handler')
  for (const name of vModelBindings) {
    if (!vmodelDisabled) lines.push(`  proteusOn${capitalize(name)}Input(e) { this.setData({ ${name}: e.detail.value }) },`)
  }
  if (vModelBindings.length && !vmodelDisabled) {
    trace?.add('script/vmodel-handler', {
      before: `v-model="${vModelBindings.join('", "')}"`,
      after: `proteusOn${vModelBindings.map(capitalize).join(' / proteusOn')}Input（setData 回写）`,
    })
  }

  // 导航链接自动 handler（模板出现 <a href> / <router-link> 时注入，仅 MP 产物存在）
  // 方法名避免 __ 前缀（微信保留前缀）；当前为临时调试版：无条件输出日志（验证通过后回收门控）
  if (extra.usesNavigate && !disabled.has('script/nav-handler')) {
    trace?.add('script/nav-handler', { before: '<a href> / <router-link>', after: 'proteusNavigateTo(e)（data-url → wx.navigateTo）' })
    // 注意：生成代码避免数组解构/对象展开（微信 ES5 转译依赖 babel helper 模块）
    // 调试日志统一 [proteus][环节] 格式，仅 debug 构建注入
    lines.push(
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
    lines.push(`  onReady() {\n${indentBody(rewriteRefAccess(lifecycles.onReady, refNames, trace, disabled, computeds, watches))}\n  },`)
  } else if (extra.debug) {
    // 调试：注入页面就绪日志（无显式 onReady 时）
    lines.push(`  onReady() {\n    console.log('[proteus][page] onReady ${extra.file ?? ''}', Date.now())\n  },`)
  }
  if (lifecycles.onUnload) lines.push(`  onUnload() {\n${indentBody(rewriteRefAccess(lifecycles.onUnload, refNames, trace, disabled, computeds, watches))}\n  },`)
  if (lifecycles.onLoad) {
    // 显式 onLoad：computed 初始化 + immediate watch 注入在方法体前
    const initLines = [computedInitLine(computeds), immediateWatchLine(watches)].filter(Boolean)
    const body = rewriteRefAccess(lifecycles.onLoad, refNames, trace, disabled, computeds, watches)
    lines.push(`  onLoad(options) {\n${indentBody(initLines.length ? `${initLines.join('\n')}\n${body}` : body)}\n  },`)
  } else {
    // 默认 onLoad：路由参数自动 decode 并注入 data（P5 契约，与 runtime/pageLifecycle 的 createPage 行为一致）
    // 注意：不用数组解构/对象展开（微信 ES5 转译需要 babel helper 模块，真机报 arrayWithHoles 未定义）
    if (!disabled.has('script/onload-params')) {
      trace?.add('script/onload-params', { before: '（无显式 onLoad）', after: 'onLoad(options) → decodeURIComponent + JSON.parse + setData' })
      const initLines = [computedInitLine(computeds), immediateWatchLine(watches)].filter(Boolean)
      lines.push(
        [
          '  onLoad(options) {',
          ...(extra.debug ? [`    console.log('[proteus][page] onLoad ${extra.file ?? ''}', JSON.stringify(options), Date.now())`] : []),
          ...initLines.map((l) => `    ${l}`),
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
    }
  }

  for (const src of Object.values(methods)) lines.push(`  ${rewriteRefAccess(src, refNames, trace, disabled, computeds, watches)},`)
  // watch 回调方法：proteusWatchX(newVal, oldVal)（方法名避开 __ 前缀，微信保留前缀决策 #29）
  for (const w of Object.values(watches)) {
    lines.push(
      `  proteusWatch${capitalize(w.dep)}(${w.params.join(', ')}) {\n${indentBody(rewriteRefAccess(w.body, refNames, trace, disabled, computeds, watches))}\n  },`,
    )
  }
  lines.push('})')

  // 产物级约束（es5-safe 贯穿全部生成代码；component-mode 决定构造器）
  trace?.add('script/component-mode', {
    before: 'SFC',
    after: extra.isComponent ? 'Component({ ... })' : 'Page({ ... })',
  })
  trace?.add('script/es5-safe', { before: '?? / ?. / 解构 / 展开', after: '显式 null 三元 / 索引循环 / 直接赋值' })

  for (const w of warnings) console.warn(`[mp-transform] ${w}`)
  return { js: lines.join('\n') + '\n', warnings }
}
