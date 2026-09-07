// src/compiler/validate.ts
// 产物自校验 —— 反编译黑盒的核心机制
// 编译器如果产出坏产物（js 语法错误 / wxml 标签不配对 / 违反目标平台标准），必须当场抛错并指明文件，
// 绝不静默输出不可用的产物（对比 uni-app 编译产物无法定位问题）。
// ★#505 收紧：校验器按目标平台标准（微信 = ES5）而非宿主 Node 标准（new Function 认识 ES2020，
//   ?? / ?. 语法过但微信开发者工具 babel 不解析——#504 用户点名的盲区）。
import type { CompileResult } from './types'

/** 编译产物校验错误（携带源文件名，便于定位） */
export class CompilerError extends Error {
  constructor(
    public filename: string,
    message: string,
  ) {
    super(`[proteus-compiler] ${filename}: ${message}`)
    this.name = 'CompilerError'
  }
}

/** JS 语法校验：new Function 仅解析不执行（产物为 Page()/Component() 调用，无 import/export） */
export function validateJs(js: string): { ok: boolean; error?: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(js)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * ★#505 平台 JS 标准校验：扫描产物残留的微信编译器不解析的 ES2020 语法（?? ?. ??= ||= &&=）。
 * 跳过字符串/模板/注释/正则字面量（产物注释里的 ?? 是文本非代码——#504 dist 实证唯一 ?? 在注释）；
 * 报告首处行号+列号。逻辑从 scripts/check-script-compile.mjs tripwire 内建进产物自校验链，
 * 使 babel 转译失败路径（es5.ts error 返回原样代码）在 compileVueSfc 内兜底报红，而非依赖外部门禁。
 */
export function scanMpUnsafeEs5(js: string): { kind: string; line: number; col: number } | null {
  let i = 0
  let line = 1
  while (i < js.length) {
    const c = js[i]
    const next = js[i + 1]
    if (c === '\n') { line++; i++; continue }
    if (c === '/' && next === '/') { const e = js.indexOf('\n', i); i = e < 0 ? js.length : e; continue }
    if (c === '/' && next === '*') { const e = js.indexOf('*/', i + 2); i = e < 0 ? js.length : e + 2; continue }
    if (c === '\'' || c === '"') { let j = i + 1; while (j < js.length) { if (js[j] === '\\') { j += 2; continue } if (js[j] === c) break; j++ } i = j + 1; continue }
    if (c === '`') {
      let depth = 0
      let j = i + 1
      while (j < js.length) {
        const cc = js[j]
        if (cc === '\\') { j += 2; continue }
        if (depth === 0 && cc === '`') break
        if (cc === '$' && js[j + 1] === '{') depth++
        else if (depth > 0 && cc === '}') depth--
        j++
      }
      i = j + 1
      continue
    }
    if (c === '?' && next === '?' && js[i + 2] === '=') return { kind: '??=', line, col: i }
    if (c === '?' && next === '?') return { kind: '??', line, col: i }
    if (c === '?' && next === '.' && !/[0-9]/.test(js[i + 2] ?? '')) return { kind: '?.', line, col: i }
    if (c === '|' && next === '|' && js[i + 2] === '=') return { kind: '||=', line, col: i }
    if (c === '&' && next === '&' && js[i + 2] === '=') return { kind: '&&=', line, col: i }
    i++
  }
  return null
}

/** ★#505 平台 JS 标准校验入口：残留 ES2020 → 校验失败（微信开发者工具 babel 不解析） */
export function validateMpJsPlatform(js: string): { ok: boolean; error?: string } {
  const hit = scanMpUnsafeEs5(js)
  if (!hit) return { ok: true }
  return { ok: false, error: `平台 JS 标准违规：ES2020 语法「${hit.kind}」残留于第 ${hit.line} 行第 ${hit.col + 1} 列（微信开发者工具 babel 不解析；产物应已由 es5.ts 转译）` }
}

/** WXML 标签配对校验（先剥离注释，避免行号注释中的标签文本干扰） */
export function validateWxml(wxml: string): { ok: boolean; error?: string } {
  const withoutComments = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const tagRe = /<\/?([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*\/?>/g
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(withoutComments))) {
    const full = m[0]
    const name = m[1]
    if (full.startsWith('</')) {
      const top = stack.pop()
      if (top !== name) {
        return { ok: false, error: `</${name}> 与 <${top ?? '(无)'}> 不匹配（位置 ${m.index}）` }
      }
    } else if (!full.endsWith('/>')) {
      stack.push(name)
    }
  }
  if (stack.length) {
    return { ok: false, error: `<${stack[stack.length - 1]}> 未闭合` }
  }
  return { ok: true }
}

/** 校验整包编译结果，失败抛 CompilerError */
export function assertValidResult(result: CompileResult, filename: string): void {
  const jsCheck = validateJs(result.js)
  if (!jsCheck.ok) {
    throw new CompilerError(filename, `js 产物语法错误：${jsCheck.error}`)
  }
  // ★#505 收紧：js 产物按平台标准校验（微信 = ES5，非宿主 Node 标准）——new Function 认识 ES2020
  //   会放过 ?? / ?.，而微信开发者工具 babel 不解析（#504 盲区）；此处兜底 es5.ts 转译失败路径
  const platformCheck = validateMpJsPlatform(result.js)
  if (!platformCheck.ok) {
    throw new CompilerError(filename, platformCheck.error ?? '平台 JS 标准违规')
  }
  const wxmlCheck = validateWxml(result.wxml)
  if (!wxmlCheck.ok) {
    throw new CompilerError(filename, `wxml 产物结构错误：${wxmlCheck.error}`)
  }
  // ★#505 G2：wxml 产物按平台标准校验（蓝本 = glass-easel 官方 parser 错误码）——
  //   wx:key 数据绑定残留 / 重复属性 / 大写标签·属性名，任一命中 = 编译器产物违反平台规范
  const wxmlPlatformCheck = validateWxmlPlatform(result.wxml)
  if (!wxmlPlatformCheck.ok) {
    throw new CompilerError(filename, `wxml 产物平台标准违规：${wxmlPlatformCheck.error}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★#505 G2 wxml 平台标准校验（蓝本：glass-easel parse/tag.rs ParseErrorKind）
// 检查六项（对应官方具名错误码；产物正常形态永不命中——命中即编译器 bug）:
//   1. DataBindingNotAllowed —— wx:key 值含 {{}}（官方：wx:key 禁用数据绑定，直接指定字段名）
//   2. DuplicatedAttribute —— 同一元素重复属性（历史真机坑：重复 class 只保留其一）
//   3. AvoidUppercaseLetters —— 标签名含大写（产物自定义组件标签应为 kebab-case 全小写；
//      属性名大写豁免——camelCase 自定义属性如 modelValue/viewBox 是合法绑定，官方亦为 Note 级）
//   4. UnsupportedSyntax —— 绑定表达式含 ?. 可选链（官方 expr.rs 运算符表无 ?.——模板表达式会经
//      平台表达式解析；Skyline(glass-easel) 无此运算符；官方 UnsupportedSyntax Error 级蓝本）
//   5. InvalidAttribute —— wx:key / wx:for-item / wx:for-index 悬挂（元素无 wx:for 却带这三者；
//      官方 ForList 提取仅 for 存在时消费，否则逐项告警——防 codegen 收敛重构回归）
//   6. InvalidAttribute —— wx:elif / wx:else 悬挂（无前置同层 wx:if/wx:elif 兄弟；官方分支组
//      合并 find_if_element_index 找不到前置 If → 告警 + 语义错位——Vue v-else 语义已保证配对）
//   7. DuplicatedStylePropertyNames —— 纯静态 style 串含重复键（官方 tag.rs 仅对 Value::Static
//      style 拆分查重——含 {{}} 的动态值官方不静态分析（动态 base + style: 前缀 →
//      IncompatibleWithStyleColonAttributes）；用户手写 style="a:1;a:2" 或未来 codegen 拼接回归即命中）
// 诚实边界：完整平台校验（标签/属性白名单、style 串合法性等）需官方 parser 级实现，暂不内置。
// ─────────────────────────────────────────────────────────────────────────────

/** 单条 wxml 平台违规（code = 官方 ParseErrorKind 蓝本） */
export interface WxmlPlatformIssue {
  code: 'DataBindingNotAllowed' | 'DuplicatedAttribute' | 'AvoidUppercaseLetters' | 'UnsupportedSyntax' | 'InvalidAttribute' | 'DuplicatedStylePropertyNames'
  message: string
  /** wxml 字符偏移（定位用） */
  at: number
}

/** 轻量标签扫描：返回每个开标签 { name, attrText, at, selfClosing }（跳过注释与闭标签） */
function scanOpenTags(wxml: string): Array<{ name: string; attrText: string; at: number; selfClosing: boolean }> {
  const out: Array<{ name: string; attrText: string; at: number; selfClosing: boolean }> = []
  // 先剔除注释区（注释内可能含伪标签文本，如行号注释 <!-- <p-xxx> -->），用占位符保位置
  const withoutComments = wxml.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(withoutComments))) {
    const at = m.index
    const name = m[1]
    const body = m[2]
    const closer = m[3]
    out.push({ name, attrText: body, at, selfClosing: closer.startsWith('/') })
  }
  return out
}

/** 属性名列表（跳过引号包裹的值；兼容无值布尔属性如 wx:else/scroll-y） */
function parseAttrNames(attrText: string): string[] {
  const names: string[] = []
  let i = 0
  while (i < attrText.length) {
    const c = attrText[i]
    if (/\s/.test(c)) { i++; continue }
    // 读属性名（至空白 / = / 结束）
    let j = i
    while (j < attrText.length && !/\s|=/.test(attrText[j])) j++
    if (j > i) names.push(attrText.slice(i, j))
    // 跳过值（引号包裹或裸 token）
    i = j
    while (i < attrText.length && /\s/.test(attrText[i])) i++
    if (attrText[i] === '=') {
      i++
      while (i < attrText.length && /\s/.test(attrText[i])) i++
      const q = attrText[i]
      if (q === '"' || q === "'") {
        i++
        while (i < attrText.length && attrText[i] !== q) i++
        i++ // 闭引号
      } else {
        while (i < attrText.length && !/\s/.test(attrText[i])) i++
      }
    }
  }
  return names
}

/** wxml 平台标准扫描（蓝本 glass-easel ParseErrorKind） */
export function scanWxmlPlatformIssues(wxml: string): WxmlPlatformIssue[] {
  const issues: WxmlPlatformIssue[] = []
  const tags = scanOpenTags(wxml)
  for (const tag of tags) {
    // AvoidUppercaseLetters：标签名含大写（产物应 kebab-case 全小写——自定义组件标签漏映射即 bug）
    if (/[A-Z]/.test(tag.name)) {
      issues.push({ code: 'AvoidUppercaseLetters', message: `标签 <${tag.name}> 含大写（产物应 kebab-case 全小写——自定义组件标签漏映射？）`, at: tag.at })
    }
    // 属性解析与检查
    const names = parseAttrNames(tag.attrText)
    // DuplicatedAttribute：同名属性重复（含 wx: 前缀全名）
    const seen = new Set<string>()
    for (const n of names) {
      if (seen.has(n)) {
        issues.push({ code: 'DuplicatedAttribute', message: `<${tag.name}> 属性 ${n} 重复（微信仅保留其一——编译器应合并）`, at: tag.at })
      }
      seen.add(n)
    }
    // DataBindingNotAllowed：wx:key 值含 {{（官方：wx:key 禁用数据绑定，直接指定字段名）
    const keyM = tag.attrText.match(/wx:key\s*=\s*(["'])(.*?)\1/)
    if (keyM && keyM[2].includes('{{')) {
      issues.push({ code: 'DataBindingNotAllowed', message: `<${tag.name}> wx:key="${keyM[2]}" 含数据绑定 {{}}——官方规范：wx:key 禁用数据绑定（直接指定 item 字段名或 *this）`, at: tag.at })
    }
    // InvalidAttribute：wx:key / wx:for-item / wx:for-index 悬挂（无 wx:for——官方 ForList 提取
    //   tag.rs 仅 for 存在时消费这三者，否则逐项 InvalidAttribute 告警；我们产物 wx:key 恒随 v-for
    //   同元素发射，命中即 codegen 重构回归）
    const hasFor = names.includes('wx:for')
    if (!hasFor) {
      const dangling = ['wx:key', 'wx:for-item', 'wx:for-index'].filter((n) => names.includes(n))
      if (dangling.length) {
        issues.push({ code: 'InvalidAttribute', message: `<${tag.name}> ${dangling.join('/')} 无 wx:for 悬挂（官方仅 wx:for 元素消费——列表键/作用域名须随 for）`, at: tag.at })
      }
    }
  }
  // InvalidAttribute：wx:elif / wx:else 悬挂（无前置同层 wx:if/wx:elif 兄弟——官方分支组合并
  //   find_if_element_index 找不到前置 If → InvalidAttribute 告警 + 分支语义错位；Vue v-else 已保证配对，
  //   命中即 codegen 重构回归）——结构性扫描：栈模拟深度 + 每层最近兄弟的 if 态
  const noComments2 = wxml.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const structRe = /<((\/?)([a-zA-Z][\w-]*)((?:[^">']|"[^"]*"|'[^']*')*?)(\/?))>/g
  let sm: RegExpExecArray | null
  const depthIf: string[] = [] // depthIf[d] = 最近一个已完成兄弟的 if 态：'if' | 'elif' | 'else' | 'none'
  let openDepth = 0
  const setIf = (d: number, v: string) => { depthIf[d] = v }
  while ((sm = structRe.exec(noComments2))) {
    const closing = sm[2]
    const name = sm[3]
    const attrText = sm[4] ?? ''
    const selfClose = sm[5] === '/'
    const attrs = parseAttrNames(attrText)
    if (closing) { openDepth = Math.max(0, openDepth - 1); continue }
    const isIf = attrs.includes('wx:if')
    const isElif = attrs.includes('wx:elif')
    const isElse = attrs.includes('wx:else')
    if (isElif || isElse) {
      const prev = depthIf[openDepth] ?? 'none'
      if (prev !== 'if' && prev !== 'elif') {
        issues.push({ code: 'InvalidAttribute', message: `<${name}> ${isElif ? 'wx:elif' : 'wx:else'} 悬挂（前置兄弟无 wx:if/wx:elif——官方分支组要求 elif/else 紧跟 if 链）`, at: sm.index })
      }
    }
    // 记录本元素对同层后续兄弟的 if 态
    const st = isIf ? 'if' : isElif ? 'elif' : isElse ? 'else' : 'none'
    setIf(openDepth, st)
    if (!selfClose) {
      openDepth++
      if (openDepth < depthIf.length) depthIf[openDepth] = 'none' // 进入子层重置
    }
  }
  // UnsupportedSyntax：绑定表达式含 ?. 可选链（官方 expr.rs 运算符表无 ?.——含 ?? 与函数调用但无可选链；
  //   ★2026-09-07 官方仓库深扒取证：define_operator 全表无 '?.'）——模板 {{ a?.b }} 会经平台表达式解析，
  //   Skyline(glass-easel) 视为不支持语法；Vue 源码请改用守卫写法（如 a && a.b 或 a !== undefined ? a.b : undefined）
  const noComments = wxml.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const optM = noComments.match(/\{\{[^{}]*\?\.[^{}]*\}\}/)
  if (optM) {
    issues.push({ code: 'UnsupportedSyntax', message: `绑定表达式 ${optM[0].trim().slice(0, 60)} 含 ?. 可选链——平台表达式解析不支持（官方 UnsupportedSyntax；含 ?? 与函数调用但无可选链）：请改守卫写法`, at: optM.index ?? 0 })
  }
  // DuplicatedStylePropertyNames：纯静态 style 串重复键（官方 tag.rs 仅对 Value::Static style 拆分查重——
  //   含 {{}} 的动态值官方不静态分析；跳过引号内分号防误拆：
  //   ★2026-09-07 三轮取证：产物 49 处 style（静态 5/动态 34/混合 10）静态段重复零——命中 = 用户源码
  //   低质写法（style="a:1;a:2"）或未来 codegen 拼接回归）
  const styleRe = /\bstyle\s*=\s*(["'])([^"']*)\1/g
  let stm: RegExpExecArray | null
  while ((stm = styleRe.exec(noComments))) {
    const styleVal = stm[2]
    if (styleVal.includes('{{')) continue // 动态/混合值：官方语义不静态查重（动态 base → IncompatibleWithStyleColonAttributes 分支）
    const seenKeys = new Set<string>()
    for (const decl of splitStyleDecls(styleVal)) {
      const key = decl.split(':')[0]?.trim()
      if (!key || !/^[a-zA-Z_-][\w-]*$/.test(key)) continue // 空段/非键（值内含分号被跳过引号后仍可能余渣）不参与
      if (seenKeys.has(key)) {
        issues.push({ code: 'DuplicatedStylePropertyNames', message: `style="${styleVal.slice(0, 80)}" 重复属性键 ${key}（官方 DuplicatedStylePropertyNames Error 级——微信仅保留其一/后覆盖前，语义不可预期）`, at: stm.index })
        break
      }
      seenKeys.add(key)
    }
  }
  return issues
}

/** 按分号拆 style 声明（跳过单双引号内的分号——font-family:'A; B' 等值内分号不误拆） */
function splitStyleDecls(styleVal: string): string[] {
  const decls: string[] = []
  let cur = ''
  let i = 0
  while (i < styleVal.length) {
    const c = styleVal[i]
    if (c === "'" || c === '"') {
      const q = c
      cur += c
      i++
      while (i < styleVal.length && styleVal[i] !== q) cur += styleVal[i++]
      if (i < styleVal.length) cur += styleVal[i]
      i++
      continue
    }
    if (c === ';') { decls.push(cur); cur = ''; i++; continue }
    cur += c
    i++
  }
  if (cur.trim()) decls.push(cur)
  return decls
}

/** wxml 平台标准校验入口：任一官方错误码命中 → 校验失败 */
export function validateWxmlPlatform(wxml: string): { ok: boolean; error?: string } {
  const issues = scanWxmlPlatformIssues(wxml)
  if (!issues.length) return { ok: true }
  const first = issues[0]
  return { ok: false, error: `[${first.code}] ${first.message}（位置 ${first.at}）` }
}
