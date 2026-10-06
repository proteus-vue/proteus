// packages/compiler/src/cse/parse.ts
// ★★★G-61 B1：**CSE · 样式表解析**（收集 → 长手展开 → 层/特异性/源序索引）
//
// 【产出】CseStyleSheet：规则表（长手声明 + layer/layerIndex/specificity/order/source）+ layerOrder + skipped
//
// 【支持面（v1，见 types.ts 头注；不支持的**计数不静默**）】
//   · 选择器：类/元素/id/通配 + 后代/子组合 + 结构伪类 + `:not(简单)` + `:deep()` 展开 + 分组 `a, b`
//   · at-rule：@layer 块与语句 ✅；@keyframes 跳过（动画另有通道）；其余（@media/@supports/@import/
//     @font-face/@property…）**整块跳过 + 计数**（v1 不假装支持响应式）
//   · 简写展开：margin/padding/inset/gap/overflow/flex/border/border-top…/border-radius/border-width/
//     border-color（含 1–4 值；`border-radius: a / b` 椭圆形式 → 记 skipped）
//   · 声明级 `!important` 逐条保留（层叠按**长手**竞争——本模块的核心设计，见 types.ts）
//
// 【与 template.ts（旧折叠通路）的关系】过渡期并行；本模块**不改旧件**（B3 切换后旧件下线）。

import type { CseDeclaration, CseRule, CseSegment, CseSelectorChain, CseStyleSheet } from './types'
import { expandShorthandDecl, UNSUPPORTED_SHORTHANDS } from './shorthand'

/** 剥 CSS 块注释（**保留换行**——行号不漂移） */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 剥 scoped 后缀（`.foo-data-v-xxx` → `foo`）——与旧通路 `stripScopeSuffix` 同语义 */
export function stripScopeSuffix(cls: string): string {
  return cls.replace(/-data-v-[0-9a-f]+$/i, '')
}

/** 顶层扫描：分出 at-rule 与普通规则（括号/引号感知；返回 [{head, block, line}]） */
interface RawBlock {
  /** `{` 前的头（选择器或 at-rule 前导） */
  head: string
  /** 块体（不含大括号；at-rule 语句为 null） */
  body: string | null
  /** 结束位置（供语句型 at-rule 推进游标） */
  end: number
  line: number
}

function scanTopLevel(css: string): RawBlock[] {
  const out: RawBlock[] = []
  let i = 0
  const n = css.length
  let line = 1
  const lineAt = (pos: number): number => css.slice(0, pos).split('\n').length
  void line
  while (i < n) {
    // 跳过空白/分号
    while (i < n && /[\s;]/.test(css[i]!)) i++
    if (i >= n) break
    // 找 head 结束（`{` 或 `;`；引号与括号感知）
    let j = i
    let depth = 0
    let quote: string | null = null
    let headEnd = -1
    let terminator: '{' | ';' = '{'
    while (j < n) {
      const ch = css[j]!
      if (quote) {
        if (ch === '\\') j++
        else if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '(') depth++
      else if (ch === ')') depth = Math.max(0, depth - 1)
      else if (depth === 0 && ch === '{') { headEnd = j; terminator = '{'; break }
      else if (depth === 0 && ch === ';') { headEnd = j; terminator = ';'; break }
      j++
    }
    if (headEnd < 0) {
      // 末尾残留（无 `{`/`;`）：整段按语句处理
      out.push({ head: css.slice(i).trim(), body: null, end: n, line: lineAt(i) })
      break
    }
    const head = css.slice(i, headEnd).trim()
    if (terminator === ';') {
      out.push({ head, body: null, end: j + 1, line: lineAt(i) })
      i = j + 1
      continue
    }
    // 找配对 `}`（引号感知）
    let k = j + 1
    let d = 1
    quote = null
    while (k < n && d > 0) {
      const ch = css[k]!
      if (quote) {
        if (ch === '\\') k++
        else if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '{') d++
      else if (ch === '}') d--
      k++
    }
    out.push({ head, body: css.slice(j + 1, k - 1), end: k, line: lineAt(i) })
    i = k
  }
  return out
}

/* ────────────────────────── 选择器解析 ────────────────────────── */

/** `:nth-child(...)` 参数 → {a,b}（An+B / odd / even / 整数） */
function parseNth(arg: string): { a: number; b: number } | null {
  const s = arg.trim().toLowerCase()
  if (!s) return null
  if (s === 'odd') return { a: 2, b: 1 }
  if (s === 'even') return { a: 2, b: 0 }
  if (/^[+-]?\d+$/.test(s)) return { a: 0, b: Number(s) }
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s)
  if (!m) return null
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1])
  return { a, b: m[2] ? Number(m[2]) : 0 }
}

/** 展开 `:deep(<inner>)` / `::v-deep(<inner>)`（括号平衡；不平衡 ⇒ null） */
function unwrapDeep(sel: string): string | null {
  const re = /:{1,2}(?:deep|v-deep)\s*\(/i
  let out = sel
  for (let guard = 0; guard < 16; guard++) {
    const m = re.exec(out)
    if (!m) return out
    const open = out.indexOf('(', m.index)
    let depth = 0
    let close = -1
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++
      else if (out[i] === ')') { depth--; if (depth === 0) { close = i; break } }
    }
    if (close < 0) return null
    const inner = out.slice(open + 1, close).trim()
    out = out.slice(0, m.index) + ' ' + inner + ' ' + out.slice(close + 1)
  }
  return null
}

/** 解析单段（可选 id + 类 + 元素 + 通配 + 结构伪类 + `:not(简单)`）；不支持 ⇒ null */
export function parseSegment(part: string): CseSegment | null {
  let rest = part
  const pseudos: Array<{ name: string; arg?: string }> = []
  rest = rest.replace(/:([a-z-]+)(?:\(([^()]*)\))?/gi, (_m, name: string, arg: string | undefined) => {
    pseudos.push({ name: String(name).toLowerCase(), arg: arg === undefined ? undefined : String(arg) })
    return ''
  })
  if (rest.includes(':')) return null // 残留（伪元素等）
  let universal = false
  let pseudo: CseSegment['pseudo']
  let not: CseSegment | undefined
  /** ★`:root`（文档根；编译器语境 = 根节点——`config` 命名空间令牌常见写法） */
  let root = false
  for (const p of pseudos) {
    if (p.name === 'root') {
      root = true
      continue
    }
    if (p.name === 'first-child') {
      if (pseudo) return null
      pseudo = { kind: 'first-child', a: 0, b: 1 }
      continue
    }
    if (p.name === 'last-child') {
      if (pseudo) return null
      pseudo = { kind: 'last-child', a: 0, b: 1 }
      continue
    }
    if (p.name === 'nth-child') {
      if (pseudo) return null
      const nn = parseNth(p.arg ?? '')
      if (!nn) return null
      pseudo = { kind: 'nth-child', a: nn.a, b: nn.b }
      continue
    }
    if (p.name === 'not') {
      if (not) return null
      const inner = parseSegment((p.arg ?? '').trim())
      if (!inner || inner.not) return null
      not = inner
      continue
    }
    return null // 状态伪类/其余 ⇒ 不支持（规则整条跳过 + 计数）
  }
  // id（`#main`；特异性 a 分量）
  const idMatch = /#([A-Za-z_][\w-]*)/.exec(rest)
  const id = idMatch ? idMatch[1]! : undefined
  if (id) rest = rest.replace(/#[A-Za-z_][\w-]*/g, '')
  if (/#/.test(rest)) return null // `#` 后非法字符
  const classes = [...rest.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => stripScopeSuffix(x[1]!))
  rest = rest.replace(/\.[A-Za-z_][\w-]*/g, '')
  if (rest === '*') {
    universal = true
    rest = ''
  }
  let tag: string | undefined
  if (rest) {
    if (!/^[A-Za-z][\w-]*$/.test(rest)) return null
    tag = rest
  }
  if (!universal && !tag && classes.length === 0 && !id && !pseudo && !not && !root) return null
  const seg: CseSegment = { classes }
  if (id) seg.id = id
  if (tag) seg.tag = tag
  if (universal) seg.universal = true
  if (root) seg.root = true
  if (pseudo) seg.pseudo = pseudo
  if (not) seg.not = not
  return seg
}

/** 解析一条选择器为链；不支持 ⇒ null */
export function parseChain(sel: string): CseSelectorChain | null {
  const raw = sel
  if (!sel) return null
  let work: string | null = sel.replace(/\s*>>>\s*/g, ' ')
  work = unwrapDeep(work)
  if (work === null) return null
  if (/[\[\]{}]|\+~|[$@]/.test(work)) return null // 属性/兄弟/插值：v1 不支持
  const normalized = work.replace(/\s*>\s*/g, ' > ')
  const parts = normalized.split(/\s+/).filter(Boolean)
  const segments: CseSegment[] = []
  const combinators: Array<' ' | '>'> = []
  for (const part of parts) {
    if (part === '>') {
      if (segments.length === 0) return null
      combinators[segments.length - 1] = '>'
      continue
    }
    const seg = parseSegment(part)
    if (!seg) return null
    if (segments.length > 0 && combinators[segments.length - 1] === undefined) combinators[segments.length - 1] = ' '
    segments.push(seg)
  }
  if (segments.length === 0) return null
  return { segments, combinators, raw }
}

/** 特异性 (a=id, b=类+伪类+not内计数, c=元素) */
export function specificityOf(segments: CseSegment[]): [number, number, number] {
  let a = 0
  let b = 0
  let c = 0
  for (const seg of segments) {
    if (seg.id) a += 1
    b += seg.classes.length
    if (seg.pseudo) b += 1
    if (seg.not) {
      const s = specificityOf([seg.not])
      a += s[0]
      b += s[1]
      c += s[2]
    }
    if (seg.tag) c += 1
  }
  return [a, b, c]
}

/* ────────────────────────── 声明解析 + 简写展开 ────────────────────────── */

/** 切 `prop: value` 声明的分号（括号/引号感知） */
function splitDeclarations(body: string): Array<{ prop: string; value: string; important: boolean }> {
  const out: Array<{ prop: string; value: string; important: boolean }> = []
  let cur = ''
  let depth = 0
  let quote: string | null = null
  const push = (): void => {
    const t = cur.trim()
    cur = ''
    if (!t) return
    const i = t.indexOf(':')
    if (i <= 0) return
    const prop = t.slice(0, i).trim().toLowerCase()
    let value = t.slice(i + 1).trim()
    if (!prop || !value) return
    let important = false
    const im = /^(.*?)\s*!important\s*$/i.exec(value)
    if (im) {
      value = im[1]!.trim()
      important = true
    }
    out.push({ prop, value, important })
  }
  for (const ch of body) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) {
      push()
      continue
    }
    cur += ch
  }
  push()
  return out
}



/* ────────────────────────── 样式表解析主函数 ────────────────────────── */

export interface ParseSheetOptions {
  /** 样式表索引（source.sheet；多 sheet 时调用方递增） */
  sheet?: number
  /** 起始源序（多 sheet 拼接时调用方传入，保证 order 全局递增） */
  orderBase?: number
}

/** 解析一份样式表 → 规则表（长手），含 @layer 收集 */
export function parseStyleSheet(css: string, opts: ParseSheetOptions = {}): CseStyleSheet & { nextOrder: number } {
  const sheet = opts.sheet ?? 0
  let order = opts.orderBase ?? 0
  const rules: CseRule[] = []
  const layerOrder: string[] = []
  const skipped: CseStyleSheet['skipped'] = []
  const layerIndex = (name: string): number => {
    const i = layerOrder.indexOf(name)
    if (i >= 0) return i
    layerOrder.push(name)
    return layerOrder.length - 1
  }

  const emitRules = (body: string, layer: string | null, baseLine: number): void => {
    const li = layer === null ? -1 : layerIndex(layer)
    for (const blk of scanTopLevel(body)) {
      const line = baseLine + blk.line - 1
      if (blk.head.startsWith('@')) {
        const at = blk.head.split(/\s+/)[0]!.toLowerCase()
        if (at === '@media' || at === '@supports' || at === '@container' || at === '@import' || at === '@font-face' || at === '@property') {
          skipped.push({ kind: 'at-rule', detail: blk.head.slice(0, 80), source: { sheet, line } })
        } else {
          skipped.push({ kind: 'at-rule', detail: blk.head.slice(0, 80), source: { sheet, line } })
        }
        continue
      }
      if (blk.body === null) {
        skipped.push({ kind: 'selector', detail: blk.head.slice(0, 80), source: { sheet, line } }) // 裸文本（不该出现）
        continue
      }
      for (const one of blk.head.split(',')) {
        const chain = parseChain(one.trim())
        if (!chain) {
          skipped.push({ kind: 'selector', detail: one.trim().slice(0, 80), source: { sheet, line } })
          continue
        }
        const decls: CseDeclaration[] = []
        for (const d of splitDeclarations(blk.body)) {
          // CSS 自定义属性（--x）：按原样收集（继承与 var() 替换在 compute 期）
          if (d.prop.startsWith('--')) {
            decls.push({ prop: d.prop, value: d.value, important: d.important })
            continue
          }
          // ★★★var() 简写（2026-10-08 · css:next）：值含 var( 的简写**不在 parse 期展开**（值未知；
          //   单 token 会被误当单值展开 ⇒ 多值令牌替换后对单边非法）。留给 compute 期 vars 已知后展开。
          const expanded = d.value.includes('var(') ? null : expandShorthandDecl(d.prop, d.value, d.important)
          if (expanded) {
            decls.push(...expanded)
            continue
          }
          // 已知不支持简写（font/transition/animation/…）⇒ 计数；其余按长手直接收
          if (UNSUPPORTED_SHORTHANDS.has(d.prop)) {
            skipped.push({ kind: 'declaration', detail: `${d.prop}: ${d.value}`.slice(0, 80), source: { sheet, line } })
            continue
          }
          decls.push({ prop: d.prop, value: d.value, important: d.important })
        }
        if (decls.length === 0) continue
        rules.push({
          chain,
          layer,
          layerIndex: li < 0 ? 0 : li,
          specificity: specificityOf(chain.segments),
          order: order++,
          decls,
          source: { sheet, line },
        })
      }
    }
  }

  // ── 顶层扫描：@layer 块 / @layer 语句 / @keyframes 跳过 / 其余 at-rule 跳过 ──
  for (const blk of scanTopLevel(stripComments(css))) {
    const line = blk.line
    if (blk.head.startsWith('@')) {
      const m = /^@layer\s+([\w.,\s-]+)$/i.exec(blk.head.trim())
      if (m && blk.body === null) {
        // `@layer a, b;`——只声明顺序
        for (const name of m[1]!.split(',').map((s) => s.trim()).filter(Boolean)) layerIndex(name)
        continue
      }
      const mb = /^@layer\s+([\w-]+)$/i.exec(blk.head.trim())
      if (mb && blk.body !== null) {
        emitRules(blk.body, mb[1]!, line + 1)
        continue
      }
      const at = blk.head.split(/\s+/)[0]!.toLowerCase()
      if (at === '@keyframes') continue // 动画另有通道：不算样式规则、也不计 skipped（正常存在）
      skipped.push({ kind: 'at-rule', detail: blk.head.slice(0, 80), source: { sheet, line } })
      continue
    }
    if (blk.body === null) {
      skipped.push({ kind: 'selector', detail: blk.head.slice(0, 80), source: { sheet, line } })
      continue
    }
    // 顶层普通规则（无层）
    for (const one of blk.head.split(',')) {
      const chain = parseChain(one.trim())
      if (!chain) {
        skipped.push({ kind: 'selector', detail: one.trim().slice(0, 80), source: { sheet, line } })
        continue
      }
      const decls: CseDeclaration[] = []
      for (const d of splitDeclarations(blk.body!)) {
        if (d.prop.startsWith('--')) {
          decls.push({ prop: d.prop, value: d.value, important: d.important })
          continue
        }
        // ★★★var() 简写（同上）：值含 var( 的简写不在 parse 期展开（留给 compute 期替换后展开）。
        const expanded = d.value.includes('var(') ? null : expandShorthandDecl(d.prop, d.value, d.important)
        if (expanded) {
          decls.push(...expanded)
          continue
        }
        if (UNSUPPORTED_SHORTHANDS.has(d.prop)) {
          skipped.push({ kind: 'declaration', detail: `${d.prop}: ${d.value}`.slice(0, 80), source: { sheet, line } })
          continue
        }
        decls.push({ prop: d.prop, value: d.value, important: d.important })
      }
      if (decls.length === 0) continue
      rules.push({
        chain,
        layer: null,
        layerIndex: 0,
        specificity: specificityOf(chain.segments),
        order: order++,
        decls,
        source: { sheet, line },
      })
    }
  }

  return { rules, layerOrder, skipped, nextOrder: order }
}
