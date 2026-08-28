// src/compiler/script.ts
// 4-1-b Script → Page/Component 构造器 JS
// 顶层 const（ref/reactive/字面量）→ data；顶层函数 → methods；生命周期映射
import type { ScriptTransformOptions, ScriptTransformResult, StyleTransformOptions } from './types'

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

/** 顶层 const（ref/reactive/字面量）→ data 初始值 */
function extractData(source: string, warnings: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
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
    // 跳过函数/箭头函数（属于 methods）
    if (/^(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(init)) continue
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
  return data
}

/** 顶层函数（function 声明 / const 箭头）→ methods 源码 */
function extractMethods(source: string, warnings: string[]): Record<string, string> {
  const methods: Record<string, string> = {}
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(source))) {
    const name = m[1]
    const params = m[2]
    const body = extractBracedBody(source, m.index + m[0].length - 1)
    // 对象字面量方法简写：handleTap() {...}（不能输出裸 function 声明）
    if (body !== null) methods[name] = `${name}(${params}) {\n${body}\n}`
    else warnings.push(`函数 ${name} 体解析失败，已跳过`)
  }
  const arrowRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g
  while ((m = arrowRe.exec(source))) {
    const name = m[1]
    const params = m[2]
    const braceIdx = source.indexOf('{', m.index + m[0].length - 1)
    const body = extractBracedBody(source, braceIdx)
    if (body !== null) methods[name] = `${name}(${params}) {\n${body}\n}`
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

function rewriteRefAccess(body: string, refNames: Set<string>): string {
  let out = body
  for (const name of refNames) {
    const prop = `this.data.${name}`
    // 自增/自减（含前置 ++name.value / --name.value）
    out = out.replace(new RegExp(`\\+\\+\\s*${name}\\.value`, 'g'), `${prop} = ${numOrZero(prop)} + 1; this.setData({ ${name}: ${prop} })`)
    out = out.replace(new RegExp(`--\\s*${name}\\.value`, 'g'), `${prop} = ${numOrZero(prop)} - 1; this.setData({ ${name}: ${prop} })`)
    out = out.replace(new RegExp(`\\b${name}\\.value\\s*\\+\\+`, 'g'), `this.setData({ ${name}: ${numOrZero(prop)} + 1 })`)
    out = out.replace(new RegExp(`\\b${name}\\.value\\s*--`, 'g'), `this.setData({ ${name}: ${numOrZero(prop)} - 1 })`)
    // 赋值：name.value = expr（排除 == / === / 复合赋值）
    out = out.replace(
      new RegExp(`\\b${name}\\.value\\s*=\\s*(?!=)([^;\\n]+)`),
      (_m, expr) => `this.setData({ ${name}: ${expr.trim()} })`,
    )
    // 读取：name.value → this.data.name
    out = out.replace(new RegExp(`\\b${name}\\.value\\b`, 'g'), prop)
  }
  return out
}
/** 生命周期映射：onMounted→onReady / onUnmounted→onUnload / onLoad→onLoad */
function extractLifecycles(source: string): { onReady?: string; onUnload?: string; onLoad?: string } {
  const out: { onReady?: string; onUnload?: string; onLoad?: string } = {}
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
  const data = extractData(source, warnings)
  const methods = extractMethods(source, warnings)
  const lifecycles = extractLifecycles(source)
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
  for (const name of vModelBindings) {
    lines.push(`  proteusOn${capitalize(name)}Input(e) { this.setData({ ${name}: e.detail.value }) },`)
  }

  // 导航链接自动 handler（模板出现 <a href> / <router-link> 时注入，仅 MP 产物存在）
  // 方法名避免 __ 前缀（微信保留前缀）；当前为临时调试版：无条件输出日志（验证通过后回收门控）
  if (extra.usesNavigate) {
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
    lines.push(`  onReady() {\n${indentBody(rewriteRefAccess(lifecycles.onReady, refNames))}\n  },`)
  } else if (extra.debug) {
    // 调试：注入页面就绪日志（无显式 onReady 时）
    lines.push(`  onReady() {\n    console.log('[proteus][page] onReady ${extra.file ?? ''}', Date.now())\n  },`)
  }
  if (lifecycles.onUnload) lines.push(`  onUnload() {\n${indentBody(rewriteRefAccess(lifecycles.onUnload, refNames))}\n  },`)
  if (lifecycles.onLoad) {
    lines.push(`  onLoad(options) {\n${indentBody(rewriteRefAccess(lifecycles.onLoad, refNames))}\n  },`)
  } else {
    // 默认 onLoad：路由参数自动 decode 并注入 data（P5 契约，与 runtime/pageLifecycle 的 createPage 行为一致）
    // 注意：不用数组解构/对象展开（微信 ES5 转译需要 babel helper 模块，真机报 arrayWithHoles 未定义）
    lines.push(
      [
        '  onLoad(options) {',
        ...(extra.debug ? [`    console.log('[proteus][page] onLoad ${extra.file ?? ''}', JSON.stringify(options), Date.now())`] : []),
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

  for (const src of Object.values(methods)) lines.push(`  ${rewriteRefAccess(src, refNames)},`)
  lines.push('})')

  for (const w of warnings) console.warn(`[mp-transform] ${w}`)
  return { js: lines.join('\n') + '\n', warnings }
}
