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
// 检查三项（对应官方具名错误码；产物正常形态永不命中——命中即编译器 bug）:
//   1. DataBindingNotAllowed —— wx:key 值含 {{}}（官方：wx:key 禁用数据绑定，直接指定字段名）
//   2. DuplicatedAttribute —— 同一元素重复属性（历史真机坑：重复 class 只保留其一）
//   3. AvoidUppercaseLetters —— 标签名含大写（产物自定义组件标签应为 kebab-case 全小写；
//      属性名大写豁免——camelCase 自定义属性如 modelValue/viewBox 是合法绑定，官方亦为 Note 级）
// 诚实边界：完整平台校验（标签/属性白名单、style 串合法性等）需官方 parser 级实现，暂不内置。
// ─────────────────────────────────────────────────────────────────────────────

/** 单条 wxml 平台违规（code = 官方 ParseErrorKind 蓝本） */
export interface WxmlPlatformIssue {
  code: 'DataBindingNotAllowed' | 'DuplicatedAttribute' | 'AvoidUppercaseLetters'
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
  }
  return issues
}

/** wxml 平台标准校验入口：任一官方错误码命中 → 校验失败 */
export function validateWxmlPlatform(wxml: string): { ok: boolean; error?: string } {
  const issues = scanWxmlPlatformIssues(wxml)
  if (!issues.length) return { ok: true }
  const first = issues[0]
  return { ok: false, error: `[${first.code}] ${first.message}（位置 ${first.at}）` }
}
