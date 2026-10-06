// packages/compiler/src/cse/compute.ts
// ★★★G-61 B1：**CSE · 计算值 + 继承 + IR 字段映射**（Profile §4.2 Step 5/6/7）
//
// 【三步本文件全包】
//   Step 5 继承：可继承属性自上而下传播（父已算 ⇒ 子可见；编译器按树序单遍即可）
//   Step 6 计算值：相对单位折叠（em/rem/%(font-size)/线高归一）、CSS 宽关键字（inherit/initial/unset）
//   Step 7 输出：① CSS 长手 computed 值（判据①逐属性比对用）② StyleIR 字段（App/Skyline 消费）
//
// 【两条输出通道（为什么）】
//   ① `computed`（CSS 长手 → 归一值）：判据①（IR ≡ Web getComputedStyle）的比对面——
//      与 Web 探针同口径（颜色 #rrggbb[aa]、长度 px 数）⇒ 可逐属性判等。
//   ② `fields`（StyleIR 字段 → ResolvedLength 等契约形态）：宿主应用器（B3）的输入。
//      ★形态按 B0 冻结的 `packages/contracts/src/style-ir-values.ts`（`{kind:'absolute',dp}` /
//      `{kind:'ratio',ratio,base}` / `{kind:'auto'}`）——**不是**旧折叠通路的裸数字（那是过渡形态）。
//
// 【计算值语义（v1 逐条，均按 CSS 标准）】
//   · px → 绝对（dp）；无单位数（width: 300）→ 按 px（本仓历史约定，登记为 extension）
//   · em（font-size 自身）→ 父 font-size × n；em（其余）→ **自身** font-size × n（CSS 规则）
//   · rem → 根 font-size × n；%（font-size）→ 父 font-size × n（**可绝对化**——父已算）
//   · %（宽度/高度/margin/padding/定位）→ **不可绝对化**（依赖布局）⇒ 保留 ratio + base（判据① C 类）
//   · line-height：无单位数 = 因子（×自身 font-size 得 px，浏览器同为 px）· px → 原值 · normal → 保留关键字
//   · font-weight：normal→400 · bold→700 · 数字原样（bolder/lighter 需父权重 ⇒ 相对父计算）
//   · 颜色：hex/rgb/hsl/命名色/transparent → #rrggbb[aa]（与 Web 探针同口径）；currentColor → 自身 color
//   · margin/padding % 基准 = **父宽**（CSS：内外边距百分比一律按含块行内尺寸）——别按方向分
//   · flex-basis: auto/content → 关键字保留 · width/height: auto → 'auto'
//
// 【继承集（CSS 标准——注意与旧折叠面 APP_INHERITABLE_FIELDS 的差异）】
//   CSS 确实继承：color / font-size / font-weight / font-family / line-height / letter-spacing /
//     text-align / text-overflow / visibility / white-space / cursor(不做) / text-indent(不做)
//   ★`text-decoration` **不继承**（CSS：装饰不继承，靠"传播"画出——子元素 computed 是 none）。
//     旧折叠面把 textDecoration 列进可继承是**偏差**（本轮按 CSS 改正；差异由判据①逐属性锁定）。
//   ★自定义属性（`--x`）继承（CSS 规则）。

import type { CseNode, CseRule, CseStyleSheet, CseTraceStep, CseWinner, CseComputeResult, CseComputedNode } from './types'
import { buildIndex, candidatesFor, chainMatches, contextOf, type MatchContext, type RuleIndex } from './match'
import { cascade, layerContextOf, type CascadeCandidate, type LayerContext } from './cascade'
import { CSS_NAMED_COLORS } from './colors-named'

/* ────────────────────────── 值类型与属性表 ────────────────────────── */

/** 归一 computed 值（与 Web 探针同口径的可比较形态） */
export type CssComputedValue =
  | number // px 长度 / 无单位数（opacity/flex-grow/z-index/line-height 因子）
  | string // 颜色 #rrggbb[aa] / 关键字 / 剩余无法归一的值
  | { ratio: number; base: 'parentWidth' | 'parentHeight' | 'viewportWidth' | 'viewportHeight' | 'fontSize' | 'rootFontSize' }

const COLOR_PROPS = new Set([
  'color', 'background-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
])
const NUMBER_PROPS = new Set(['opacity', 'flex-grow', 'flex-shrink', 'z-index', 'order', 'aspect-ratio'])
const ENUM_PROPS = new Set([
  'display', 'position', 'overflow-x', 'overflow-y', 'visibility', 'text-align', 'text-overflow',
  'white-space', 'text-decoration-line', 'flex-direction', 'flex-wrap', 'justify-content',
  'align-items', 'align-content', 'align-self', 'box-sizing', 'pointer-events',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（关键字枚举，小写归一）
  'justify-self',
  // ★★★grid-auto-flow 项（2026-10-08）：类 grid 容器的自动放置（关键字枚举）
  'grid-auto-flow',
  // ★★★word-break 项（2026-10-06）：行内断词策略（关键字枚举，小写归一）
  'word-break',
  // ★★★背景定位家族（2026-10-07）：size/position/repeat（关键字/长度/百分比——字符串原样透传，仅归一空白）
  'background-size',
  'background-position',
  'background-repeat',
])
/** px-only 长度（CSS 不接受 %：border-width / 字距） */
const PX_LENGTH_PROPS = new Set([
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'letter-spacing',
  // font-size 单独处理（em/%/rem 均可绝对化）
])
/** 可百分比的长度 + 其 % 的基准（不可绝对化 ⇒ ratio；top/left 系列按含块，margin/padding 按父宽） */
const RATIO_BASES: Record<string, 'parentWidth' | 'parentHeight' | 'viewportWidth' | 'viewportHeight'> = {
  width: 'parentWidth', 'min-width': 'parentWidth', 'max-width': 'parentWidth',
  height: 'parentHeight', 'min-height': 'parentHeight', 'max-height': 'parentHeight',
  'margin-top': 'parentWidth', 'margin-right': 'parentWidth', 'margin-bottom': 'parentWidth', 'margin-left': 'parentWidth',
  'padding-top': 'parentWidth', 'padding-right': 'parentWidth', 'padding-bottom': 'parentWidth', 'padding-left': 'parentWidth',
  top: 'parentHeight', bottom: 'parentHeight', left: 'parentWidth', right: 'parentWidth',
  'row-gap': 'parentHeight', 'column-gap': 'parentWidth', gap: 'parentWidth',
  'flex-basis': 'parentWidth',
}
/** 全部长度类属性（含 font-size 特例） */
const LENGTH_PROPS = new Set([
  ...Object.keys(RATIO_BASES), ...PX_LENGTH_PROPS, 'font-size', 'line-height',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
])

/** CSS 可继承属性（标准子集——见头注；text-decoration **不在**此表） */
export const CSE_INHERITED_PROPS = new Set([
  'color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'text-overflow', 'visibility', 'white-space',
  // ★★★word-break 项（2026-10-06）：CSS Text 继承属性（子节点默认继承父的断词策略）
  'word-break',
])

/** 各属性 initial 值（`initial`/`unset` 需要；未列 ⇒ initial 不可用（如实记 diagnostic）） */
const INITIAL_VALUES: Record<string, string> = {
  color: '#000000',
  'font-size': '16px',
  'font-weight': '400',
  'font-family': 'initial',
  'line-height': 'normal',
  'letter-spacing': '0px',
  'text-align': 'start',
  'text-overflow': 'clip',
  visibility: 'visible',
  'white-space': 'normal',
  // ★★★word-break 项（2026-10-06）：CSS initial = normal（继承属性）
  'word-break': 'normal',
  'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
  'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
  opacity: '1',
  'flex-grow': '0',
  'flex-shrink': '1',
  'z-index': 'auto',
  position: 'static',
  display: 'inline', // 注意：由 UA 按元素决定（div→block）；`initial` 显式写才是 inline
  'pointer-events': 'auto',
}

/* ────────────────────────── 颜色归一（与 Web 探针同口径） ────────────────────────── */

const NAMED_COLORS: Record<string, string> = { ...CSS_NAMED_COLORS, transparent: '#00000000' }

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
function hex2(n: number): string {
  return clamp255(n).toString(16).padStart(2, '0')
}

/** CSS 颜色 → '#rrggbb' | '#rrggbbaa'（不认识 ⇒ null，调用方诊断） */
export function computeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const hexm = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hexm) {
    const h = hexm[1]!
    if (h.length === 3) return '#' + h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
    if (h.length === 4) return '#' + h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!
    return '#' + h
  }
  const named = NAMED_COLORS[s]
  if (named) return named
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!m) return null
  const fn = m[1]!
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const chan = (t: string): number => {
    if (t.endsWith('%')) return (Number(t.slice(0, -1)) / 100) * 255
    return Number(t)
  }
  const alpha = (t: string | undefined): number | null => {
    if (t === undefined || t === '') return 1
    if (t.endsWith('%')) return Number(t.slice(0, -1)) / 100
    return Number(t)
  }
  let r: number
  let g: number
  let b: number
  if (fn.startsWith('rgb')) {
    r = chan(parts[0]!)
    g = chan(parts[1]!)
    b = chan(parts[2]!)
  } else {
    const h = Number(parts[0]!.replace(/deg$/, '')) / 30
    const sat = parts[1]!.endsWith('%') ? Number(parts[1]!.slice(0, -1)) / 100 : Number(parts[1]!)
    const li = parts[2]!.endsWith('%') ? Number(parts[2]!.slice(0, -1)) / 100 : Number(parts[2]!)
    const a = sat * Math.min(li, 1 - li)
    const f = (nn: number): number => {
      const k = (nn + h) % 12
      return 255 * (li - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    }
    r = f(0)
    g = f(8)
    b = f(4)
  }
  if (![r, g, b].every(Number.isFinite)) return null
  // alpha：第 4 个数值参数，或 `/ a` 形态（上面 split 已归一为 parts[3]）
  const a = alpha(parts[3])
  if (a === null || !Number.isFinite(a)) return null
  const base = '#' + hex2(r) + hex2(g) + hex2(b)
  return a >= 1 ? base : base + hex2(a * 255)
}

/* ────────────────────────── var() / calc 支持判定 ────────────────────────── */

/** var() 替换（含 fallback `var(--x, fb)`；未定义且无 fallback ⇒ null = 不可用） */
export function substituteVars(value: string, vars: Map<string, string>, depth = 0): string | null {
  if (depth > 16) return null
  if (!value.includes('var(')) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const at = value.indexOf('var(', i)
    if (at < 0) {
      out += value.slice(i)
      break
    }
    out += value.slice(i, at)
    // 括号平衡找 var( ... ) 的闭合（★起点 d=1：开括号 `var(` 已被跳过，从内容起算）
    let d = 1
    let j = at + 4
    let close = -1
    for (; j < value.length; j++) {
      if (value[j] === '(') d++
      else if (value[j] === ')') {
        d--
        if (d === 0) {
          close = j
          break
        }
      }
    }
    if (close < 0) return null
    const inner = value.slice(at + 4, close)
    const comma = (() => {
      let dd = 0
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k]!
        if (ch === '(') dd++
        else if (ch === ')') dd--
        else if (ch === ',' && dd === 0) return k
      }
      return -1
    })()
    const name = (comma >= 0 ? inner.slice(0, comma) : inner).trim()
    if (!name.startsWith('--')) return null
    const found = vars.get(name)
    if (found !== undefined) {
      const sub = substituteVars(found, vars, depth + 1)
      if (sub === null) return null
      out += sub
    } else if (comma >= 0) {
      const fb = inner.slice(comma + 1).trim()
      const sub = substituteVars(fb, vars, depth + 1)
      if (sub === null) return null
      out += sub
    } else {
      return null // 无定义无 fallback ⇒ 该声明无效（CSS：invalid at computed-value time）
    }
    i = close + 1
  }
  return out
}

/** calc() 单层常量化：`calc(N op M)`（数或 px 参与；含 var 已前置替换）。不支持 ⇒ null（v1 诚实） */
export function foldCalc(value: string): string | null {
  const m = /^calc\((.+)\)$/i.exec(value.trim())
  if (!m) return value.includes('calc(') ? null : value
  const expr = m[1]!.trim()
  // 只支持 "长度 op 长度" 的 + - （乘除含单位语义复杂，v1 不做）
  const mm = /^(-?[\d.]+)(px)?\s*([+-])\s*(-?[\d.]+)(px)?$/.exec(expr)
  if (!mm) return null
  const a = Number(mm[1]!)
  const b = Number(mm[4]!)
  const unitA = mm[2] ?? ''
  const unitB = mm[5] ?? ''
  if (unitA !== unitB) return null
  const v = mm[3] === '+' ? a + b : a - b
  return `${v}px`
}

/* ────────────────────────── 长度求解 ────────────────────────── */

export interface LengthResolveCtx {
  /** 自身 font-size（px；step 已先算） */
  fontSize: number
  /** 父 font-size（px；em in font-size） */
  parentFontSize: number
  /** 根 font-size（px） */
  rootFontSize: number
  /** 视口（px；vw/vh 求值——B-a 的视口由调用方给，编译期未知时用默认 390×844） */
  viewport: { width: number; height: number }
}

/** 长度求解结果：绝对 px / 比例+基准（不可绝对化）/ 关键字 */
export type LengthResult =
  | { px: number }
  | { ratio: number; base: 'parentWidth' | 'parentHeight' | 'viewportWidth' | 'viewportHeight' | 'fontSize' | 'rootFontSize' }
  | { keyword: string }

/** 长度 token → 绝对 px（可绝对化时）或 ratio（不可绝对化时）或关键字；不认识 ⇒ null */
export function computeLength(prop: string, raw: string, ctx: LengthResolveCtx): LengthResult | null {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (v === 'auto') return { keyword: 'auto' }
  if (v === 'content') return { keyword: 'content' }
  if (['none', 'normal', 'max-content', 'min-content', 'fit-content', 'stretch'].includes(v)) return { keyword: v }
  const m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(v)
  if (!m) return null
  const n = Number(m[1]!)
  if (!Number.isFinite(n)) return null
  const unit = m[2]!
  switch (unit) {
    case '':
    case 'px':
      return { px: n }
    case 'pt':
      // CSS: 1pt = 4/3 px。**v1 已知偏差**：旧通路按 1:1（本表按 CSS 标准 4/3——更正确；
      // 与旧通路的 1:1 差异由判据①锁定，切换期登记）
      return { px: (n * 4) / 3 }
    case 'em':
      // CSS：font-size 自身的 em 按**父**字号；其余按自身
      return { px: n * (prop === 'font-size' ? ctx.parentFontSize : ctx.fontSize) }
    case 'rem':
      return { px: n * ctx.rootFontSize }
    case '%': {
      // font-size 的 %：父字号（可绝对化）
      if (prop === 'font-size') return { px: (n / 100) * ctx.parentFontSize }
      // line-height 的 %：自身字号（可绝对化）
      if (prop === 'line-height') return { px: (n / 100) * ctx.fontSize }
      // 其余：依赖布局 ⇒ ratio + base（判据① C 类）
      const base = RATIO_BASES[prop] ?? 'parentWidth'
      return { ratio: n / 100, base }
    }
    case 'vw':
      return { px: (n / 100) * ctx.viewport.width }
    case 'vh':
      return { px: (n / 100) * ctx.viewport.height }
    case 'rpx':
      // 750rpx = 视口宽（小程序语义；App 同口径）——编译期按视口宽求值（与 Web 基准同视口时等价）
      return { px: (n / 750) * ctx.viewport.width }
    default:
      return null
  }
}

/* ────────────────────────── 主计算（逐节点） ────────────────────────── */

export interface ComputeTreeOptions {
  /** 视口（vw/vh/rpx 求值；判据①用与 Web 采集相同的 390×844） */
  viewport?: { width: number; height: number }
  /** 根 font-size（rem 基准；默认 16） */
  rootFontSize?: number
  /** inline style（节点 key → 长手声明原文；**最高优先级**——CSS：style 属性胜过一切 author 规则，
   *  除非其他声明 `!important`。v1 按 CSS：inline 普通 < 任意 important） */
  inlineStyles?: Record<string, Array<{ prop: string; value: string }>>
}

interface ParentCarry {
  /** 继承而来的长手 computed（prop → 值） */
  inherited: Map<string, CssComputedValue>
  /** 继承的自定义属性 */
  vars: Map<string, string>
  fontSize: number
  fontWeight: number
  /**
   * ★line-height 的**继承语义**（CSS 经典坑）：无单位数是**因子**（继承后在每个后代按自身 font-size 重算）；
   *   em/%/px 是**绝对长度**（继承的是算好的长度）。⇒ 必须把因子与长度分开带。
   */
  lineHeight?: { kind: 'factor'; n: number } | { kind: 'px'; n: number } | { kind: 'normal' }
}

/** 单棵树 → 逐节点 computed + fields */
export function computeTree(roots: CseNode[], sheet: CseStyleSheet, opts: ComputeTreeOptions = {}): CseComputeResult {
  const index: RuleIndex = buildIndex(sheet.rules)
  const layerCtx: LayerContext = layerContextOf(sheet.layerOrder)
  const viewport = opts.viewport ?? { width: 390, height: 844 }
  const rootFontSize = opts.rootFontSize ?? 16

  const nodes: CseComputedNode[] = []
  const diagnostics: CseComputeResult['diagnostics'] = []

  const walk = (node: CseNode, ancestors: MatchContext[], chainRules: AncestorChainRules, parent: ParentCarry | null, isRoot: boolean): void => {
    const ctx = contextOf(node, node.index, node.count, isRoot)
    // ① 候选 + 匹配
    const matched: CseRule[] = []
    for (const r of candidatesFor(index, ctx)) {
      if (chainMatches(r, ancestors, ctx)) matched.push(r)
    }
    // ② 层叠（含 inline style —— 伪规则形式参与：inline 无选择器/无层、特异性按 CSS 视作最高普通级）
    const candidates: CascadeCandidate[] = []
    for (const r of matched) {
      for (let i = 0; i < r.decls.length; i++) {
        const d = r.decls[i]!
        candidates.push({ rule: r, decl: d, declIdx: i })
      }
    }
    const inline = opts.inlineStyles?.[node.key]
    if (inline) {
      // inline 规则：`isInline` 标记（比较期恒胜普通选择器声明——见 cascade.beats ①.5）
      const inlineRule: CseRule = {
        chain: { segments: [], combinators: [], raw: '/* inline */' },
        layer: null,
        layerIndex: 0,
        specificity: [0, 0, 0],
        order: Number.MAX_SAFE_INTEGER,
        decls: [],
        isInline: true,
        source: { sheet: -1, line: 0 },
      }
      for (let i = 0; i < inline.length; i++) {
        const d = inline[i]!
        candidates.push({ rule: inlineRule, decl: { prop: d.prop, value: d.value, important: false }, declIdx: i })
      }
    }
    const winners = cascade(candidates, layerCtx)
    void chainRules

    // ③ 自定义属性（自身 + 继承）：供 var() 替换
    const vars = new Map<string, string>(parent?.vars ?? [])
    for (const [prop, w] of Object.entries(winners)) {
      if (prop.startsWith('--')) {
        const sub = substituteVars(w.value, vars)
        if (sub !== null) vars.set(prop, sub)
      }
    }

    // ④ 逐长手 → computed（先 font-size/color/font-weight，供 em/currentColor/相对权重）
    const computed: Record<string, CssComputedValue> = {}
    const trace: Record<string, CseTraceStep> = {}
    const parentFontSize = parent?.fontSize ?? rootFontSize
    const lctx: LengthResolveCtx = { fontSize: parentFontSize, parentFontSize, rootFontSize, viewport }
    const winnersByProp = new Map(Object.entries(winners))

    /** 解析一条胜出声明 → computed 值（含 var/calc/关键字） */
    const resolveWinner = (prop: string, w: CseWinner): CssComputedValue | 'UNSUPPORTED' | 'INVALID' | null => {
      let raw = substituteVars(w.value, vars)
      if (raw === null) return 'INVALID'
      const calc = foldCalc(raw)
      if (calc === null) return 'UNSUPPORTED'
      raw = calc
      const low = raw.trim().toLowerCase()
      // CSS 宽关键字
      if (low === 'inherit') {
        const p = parent?.inherited.get(prop)
        return p === undefined ? null : p
      }
      if (low === 'initial') {
        const iv = INITIAL_VALUES[prop]
        if (iv === undefined) return 'UNSUPPORTED'
        raw = iv
      } else if (low === 'unset') {
        if (CSE_INHERITED_PROPS.has(prop)) {
          const p = parent?.inherited.get(prop)
          return p === undefined ? null : p
        }
        const iv = INITIAL_VALUES[prop]
        if (iv === undefined) return 'UNSUPPORTED'
        raw = iv
      } else if (low === 'revert') {
        return 'UNSUPPORTED' // v1：revert 需要 UA 层信息 ⇒ 不猜
      }
      // 颜色
      if (COLOR_PROPS.has(prop)) {
        if (raw.trim().toLowerCase() === 'currentcolor') return raw.trim().toLowerCase() as never // 后置处理
        const c = computeColor(raw)
        return c ?? 'INVALID'
      }
      // 长度
      if (LENGTH_PROPS.has(prop)) {
        if (prop === 'line-height') {
          // line-height 在专用块处理（因无单位因子需按自身 fs 求值）——此处只兜底非 factor 形态
          const r = computeLength(prop, raw, lctx)
          if (!r) return 'INVALID'
          if ('px' in r) return r.px
          if ('keyword' in r) return r.keyword
          return r
        }
        const r = computeLength(prop, raw, lctx)
        if (!r) return 'INVALID'
        if ('px' in r) return r.px
        if ('keyword' in r) return r.keyword
        return r
      }
      // 数值
      if (NUMBER_PROPS.has(prop)) {
        const nv = Number(raw)
        if (Number.isFinite(nv)) return prop === 'z-index' ? Math.round(nv) : nv
        if (raw.trim().toLowerCase() === 'auto') return 'auto'
        return 'INVALID'
      }
      if (prop === 'font-weight') {
        const fw = raw.trim().toLowerCase()
        if (fw === 'normal') return 400
        if (fw === 'bold') return 700
        if (/^\d+$/.test(fw)) return Number(fw)
        if (fw === 'bolder' || fw === 'lighter') {
          const pf = parent?.fontWeight ?? 400
          const delta = fw === 'bolder' ? 300 : -300
          return Math.max(100, Math.min(900, pf + delta))
        }
        return 'INVALID'
      }
      // 枚举
      if (ENUM_PROPS.has(prop)) return raw.trim().toLowerCase()
      // 其余（transform / box-shadow / font-family / background-image…）：v1 原样字符串（不参与判据①）
      return raw
    }

    // 先算 font-size（em 的基准）
    {
      const w = winnersByProp.get('font-size')
      if (w) {
        const val = resolveWinner('font-size', w)
        if (typeof val === 'number' && Number.isFinite(val)) {
          computed['font-size'] = val
          trace['font-size'] = stepOf(val, 'cascade', w, vars)
        } else if (val !== null && val !== 'UNSUPPORTED' && val !== 'INVALID') {
          computed['font-size'] = val as CssComputedValue
          trace['font-size'] = stepOf(val as CssComputedValue, 'cascade', w, vars)
        } else if (val !== null) {
          diagnostics.push({ level: 'warn', code: 'CSE_FONT_SIZE_UNSUPPORTED', message: `${node.key}: font-size: ${w.value}（v1 不支持）` })
        }
      } else if (parent?.inherited.get('font-size') !== undefined) {
        computed['font-size'] = parent.inherited.get('font-size')!
        trace['font-size'] = { value: computed['font-size'], from: null, via: 'inherited' }
      } else {
        computed['font-size'] = rootFontSize
        trace['font-size'] = { value: rootFontSize, from: null, via: 'default' }
      }
      const fs = computed['font-size']
      lctx.fontSize = typeof fs === 'number' ? fs : parentFontSize
    }

    // line-height 专用块（★CSS 经典坑：无单位因子按每个后代的**自身** font-size 重算；
    //   em/%/px 则算成绝对长度继承）——computed 值统一为 **px**（与浏览器更接近；`normal` 保留关键字）
    let lineHeightCarry: ParentCarry['lineHeight']
    {
      const w = winnersByProp.get('line-height')
      if (w) {
        const substituted = substituteVars(w.value, vars)
        const calc = substituted === null ? null : foldCalc(substituted)
        if (substituted !== null && calc === null) {
          diagnostics.push({ level: 'warn', code: 'CSE_VALUE_UNSUPPORTED', message: `${node.key}: line-height: ${w.value}` })
        } else if (calc !== null) {
          const raw: string = calc
          const lv = raw.trim().toLowerCase()
          if (lv === 'normal') {
            computed['line-height'] = 'normal'
            trace['line-height'] = stepOf('normal', 'cascade', w, vars)
            lineHeightCarry = { kind: 'normal' }
          } else if (/^-?\d*\.?\d+$/.test(lv)) {
            const factor = Number(lv)
            computed['line-height'] = factor * lctx.fontSize
            trace['line-height'] = stepOf(computed['line-height'], 'cascade', w, vars)
            lineHeightCarry = { kind: 'factor', n: factor }
          } else {
            const r = computeLength('line-height', raw, lctx)
            if (r && 'px' in r) {
              computed['line-height'] = r.px
              trace['line-height'] = stepOf(r.px, 'cascade', w, vars)
              lineHeightCarry = { kind: 'px', n: r.px }
            } else if (r && 'keyword' in r) {
              computed['line-height'] = r.keyword
              trace['line-height'] = stepOf(r.keyword, 'cascade', w, vars)
            }
          }
        }
      } else if (parent?.lineHeight !== undefined) {
        const pl = parent.lineHeight
        if (pl.kind === 'factor') {
          computed['line-height'] = pl.n * lctx.fontSize
          trace['line-height'] = { value: computed['line-height'], from: null, via: 'inherited' }
          lineHeightCarry = pl // 因子继续往下带（CSS：因子继承）
        } else if (pl.kind === 'px') {
          computed['line-height'] = pl.n
          trace['line-height'] = { value: pl.n, from: null, via: 'inherited' }
          lineHeightCarry = pl
        } else {
          computed['line-height'] = 'normal'
          trace['line-height'] = { value: 'normal', from: null, via: 'inherited' }
          lineHeightCarry = pl
        }
      }
    }

    // 其余长手
    for (const [prop, w] of Object.entries(winners)) {
      if (prop === 'font-size' || prop === 'line-height' || prop.startsWith('--')) continue
      let val: CssComputedValue | 'UNSUPPORTED' | 'INVALID' | null
      try {
        val = resolveWinner(prop, w)
      } catch {
        val = 'INVALID'
      }
      if (val === null) continue // 关键字的空（继承链无值）⇒ 视作未设置
      if (val === 'UNSUPPORTED' || val === 'INVALID') {
        diagnostics.push({
          level: 'warn',
          code: val === 'UNSUPPORTED' ? 'CSE_VALUE_UNSUPPORTED' : 'CSE_VALUE_INVALID',
          message: `${node.key}: ${prop}: ${w.value}${w.fromShorthand ? `（来自 ${w.fromShorthand}）` : ''}`,
        })
        continue
      }
      computed[prop] = val
      trace[prop] = stepOf(val, 'cascade', w, vars)
    }

    // currentColor 后置（需要自身 color）
    for (const prop of COLOR_PROPS) {
      if (computed[prop] === 'currentcolor') {
        const own = computed['color'] ?? parent?.inherited.get('color') ?? '#000000'
        computed[prop] = own
        const t = trace[prop]
        if (t) t.varSubstituted = 'currentColor → 自身 color'
      }
    }

    // ⑤ 继承传播（未显式设置的可继承属性）
    const inheritedNext = new Map<string, CssComputedValue>(parent?.inherited ?? [])
    for (const prop of CSE_INHERITED_PROPS) {
      if (computed[prop] !== undefined) inheritedNext.set(prop, computed[prop])
      else if (parent?.inherited.get(prop) !== undefined) {
        computed[prop] = parent.inherited.get(prop)!
        trace[prop] = { value: computed[prop], from: null, via: 'inherited' }
      }
    }
    // ★visibility 虽是继承属性但可被显式覆盖——已在上面统一处理

    // ⑥ StyleIR 字段映射
    const fields: Record<string, unknown> = {}
    const unmapped: Array<{ prop: string; value: string }> = []
    // ★★★overflow-x 项（2026-10-06 · css:next P0·10×）：**逐轴字段 + Web 归一回放**（CSS Overflow 3）。
    //   · 归一（真 Chromium getComputedStyle 实测）：一侧 visible、另一侧非 visible 且非 clip ⇒ visible→auto；
    //   · 逐轴恒发 overflowX/overflowY（IR 保真）；x==y 时**附发** overflow（兼容既有引擎面语义）；
    //   · 值集 = 内核封闭集（visible/hidden/scroll/auto）——`clip` 无内核对应 ⇒ 如实记 unmapped。
    const ovf = resolveOverflowFields(computed)
    if (ovf !== null) {
      fields['overflowX'] = ovf.x
      fields['overflowY'] = ovf.y
      if (ovf.x === ovf.y) fields['overflow'] = ovf.x
      const tx = trace['overflow-x']
      const ty = trace['overflow-y']
      if (tx) trace['overflowX'] = tx
      if (ty) trace['overflowY'] = ty
      if (ovf.x === ovf.y && (tx ?? ty)) trace['overflow'] = (tx ?? ty)!
    } else {
      for (const p of ['overflow-x', 'overflow-y'] as const) {
        const w = winnersByProp.get(p)
        if (w) unmapped.push({ prop: p, value: w.value })
      }
    }
    // ★border-radius 逐角合并（引擎形态：统一半径 + 逐角掩码；合并失败 ⇒ 记 unmapped）
    const radius = resolveBorderRadiusFields(computed)
    if (radius) {
      for (const [k, v] of Object.entries(radius)) fields[k] = v
    } else {
      for (const p of ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const) {
        const w = winnersByProp.get(p)
        if (w) unmapped.push({ prop: p, value: w.value })
      }
    }

    for (const [prop, val] of Object.entries(computed)) {
      if (prop === 'overflow-x' || prop === 'overflow-y') continue // 已合并处理
      if (/^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.test(prop)) continue // 已合并处理
      const ir = mapToIrField(prop, val)
      if (ir === null) {
        const w = winnersByProp.get(prop)
        if (w) unmapped.push({ prop, value: w.value })
        continue
      }
      fields[ir.field] = ir.value
      // trace 同步到字段名（explain 按字段查）
      const t = trace[prop]
      if (t) trace[ir.field] = t
    }

    const nodeResult: CseComputedNode = { key: node.key, fields, trace, unmapped }
    nodes.push(nodeResult)

    // ⑦ 子节点（祖先链 + 父 carry；兄弟序重算）
    const childAncestors = [...ancestors, ctx]
    const carry: ParentCarry = {
      inherited: inheritedNext,
      vars,
      fontSize: lctx.fontSize,
      fontWeight: typeof computed['font-weight'] === 'number' ? computed['font-weight'] : parent?.fontWeight ?? 400,
    }
    if (lineHeightCarry !== undefined) carry.lineHeight = lineHeightCarry
    const kids = node.children
    for (let i = 0; i < kids.length; i++) {
      kids[i]!.index = i
      kids[i]!.count = kids.length
      walk(kids[i]!, childAncestors, chainRules, carry, false)
    }
  }

  const emptyRules: AncestorChainRules = {}
  for (const r of roots) {
    r.index = r.index ?? 0
    r.count = r.count ?? 1
    walk(r, [], emptyRules, null, true)
  }

  const byKey: Record<string, CseComputedNode> = {}
  for (const n of nodes) byKey[n.key] = n
  return { nodes, byKey, diagnostics }
}

/** 祖先链规则缓存位（预留：Bloom 过滤优化用；v1 不启用） */
type AncestorChainRules = Record<string, never>

function stepOf(value: unknown, via: CseTraceStep['via'], w: CseWinner, vars: Map<string, string>): CseTraceStep {
  const step: CseTraceStep = {
    value,
    from: {
      selector: w.selector,
      layer: w.layer,
      specificity: w.specificity,
      order: w.order,
      important: w.important,
    },
    via,
  }
  if (w.fromShorthand !== undefined) step.from!.fromShorthand = w.fromShorthand
  if (w.value.includes('var(')) {
    const sub = substituteVars(w.value, vars)
    if (sub !== null && sub !== w.value) step.varSubstituted = sub
  }
  return step
}

/* ────────────────────────── CSS 长手 → StyleIR 字段 ────────────────────────── */

/** ResolvedLength（契约形态） */
type RL = { kind: 'absolute'; dp: number } | { kind: 'ratio'; ratio: number; base: string } | { kind: 'auto' } | null
const absolute = (dp: number): RL => ({ kind: 'absolute', dp })

/** 单个长手 → IR 字段（null = 无对应字段（记 unmapped）） */
function mapToIrField(prop: string, val: CssComputedValue): { field: string; value: unknown } | null {
  // 直通同名（camelCase 化由字段名手写保证与注册表一致）
  const NUMERIC_IR: Record<string, string> = {
    opacity: 'opacity',
    'flex-grow': 'flexGrow',
    'flex-shrink': 'flexShrink',
    'z-index': 'zIndex', // registry: forbidden（semantic-only 域）——v1 直通（App 层消费与否由 applier 决定）
    'letter-spacing': 'letterSpacing',
  }
  const ENUM_IR: Record<string, string> = {
    display: 'display',
    position: 'position',
    visibility: 'visibility',
    'text-align': 'textAlign',
    'text-overflow': 'textOverflow',
    'text-decoration-line': 'textDecoration',
    'flex-direction': 'flexDirection',
    'flex-wrap': 'flexWrap',
    'justify-content': 'justifyContent',
    'align-items': 'alignItems',
    'align-content': 'alignContent',
    'align-self': 'alignSelf',
    // ★★★justify-self 项（2026-10-06 · css:next P0·9×）：网格项行内轴自对齐（CSE 直通同名 IR 字段）
    'justify-self': 'justifySelf',
    // ★★★grid-auto-flow 项（2026-10-08）：CSE 直通同名 IR 字段
    'grid-auto-flow': 'gridAutoFlow',
    // ★★★word-break 项（2026-10-06 · css:next P0·7× · CSS Text）：行内断词策略（继承属性；CSE 直通同名 IR 字段）
    'word-break': 'wordBreak',
    // ★★★背景定位家族（2026-10-07）：CSE 直通同名 IR 字段（字符串）
    'background-size': 'backgroundSize',
    'background-position': 'backgroundPosition',
    'background-repeat': 'backgroundRepeat',
    'box-sizing': 'boxSizing',
    'pointer-events': 'pointerEvents',
    // ★white-space：App 端由引擎消费（`nowrap` 是常见排版约束——批次 29 已加 no-op 支持）；
    //   与 APP_ENUM_VALUES 的封闭集扩展保持一致（App 引擎侧未列值时由 applier 决定，不静默丢）
    'white-space': 'whiteSpace',
  }
  const LENGTH_IR: Record<string, string> = {
    width: 'width', height: 'height',
    'min-width': 'minWidth', 'max-width': 'maxWidth',
    'min-height': 'minHeight', 'max-height': 'maxHeight',
    'margin-top': 'marginTop', 'margin-right': 'marginRight', 'margin-bottom': 'marginBottom', 'margin-left': 'marginLeft',
    'padding-top': 'paddingTop', 'padding-right': 'paddingRight', 'padding-bottom': 'paddingBottom', 'padding-left': 'paddingLeft',
    top: 'top', right: 'right', bottom: 'bottom', left: 'left',
    'row-gap': 'rowGap', 'column-gap': 'columnGap',
  }
  const COLOR_IR: Record<string, string> = {
    color: 'color',
    'background-color': 'backgroundColor',
    'border-top-color': 'borderTopColor', 'border-right-color': 'borderRightColor',
    'border-bottom-color': 'borderBottomColor', 'border-left-color': 'borderLeftColor',
  }
  if (prop in NUMERIC_IR) return { field: NUMERIC_IR[prop]!, value: val }
  if (prop in ENUM_IR) return { field: ENUM_IR[prop]!, value: val }
  if (prop in COLOR_IR) return { field: COLOR_IR[prop]!, value: val }
  // 长度类（含 ratio / auto / 关键字）
  if (prop in LENGTH_IR) {
    const field = LENGTH_IR[prop]!
    if (typeof val === 'number') return { field, value: absolute(val) }
    if (typeof val === 'string') {
      if (val === 'auto') return { field, value: { kind: 'auto' } satisfies RL }
      if (val === 'none' || val === 'normal' || val.endsWith('content')) return null // 不可表达 ⇒ unmapped
      return null
    }
    if (typeof val === 'object' && 'ratio' in val) return { field, value: { kind: 'ratio', ratio: val.ratio, base: val.base } satisfies RL }
    return null
  }
  if (prop === 'font-size') {
    return { field: 'fontSize', value: typeof val === 'number' ? val : null }
  }
  if (prop === 'font-weight') {
    return { field: 'fontWeight', value: typeof val === 'number' ? val : null }
  }
  if (prop === 'line-height') {
    // 契约：lineHeight 为 engine-field（旧通路存 '1.4' | '22px'）；CSE v1 直通（number=px；因子也 number）
    return { field: 'lineHeight', value: typeof val === 'number' ? val : (val as string) }
  }
  if (prop === 'font-family') return { field: 'fontFamily', value: val }
  if (prop === 'flex-basis') {
    if (typeof val === 'number') return { field: 'flexBasis', value: absolute(val) }
    if (typeof val === 'string') {
      if (val === 'auto') return { field: 'flexBasis', value: { kind: 'auto' } satisfies RL }
      return { field: 'flexBasis', value: val } // content 等关键字：直通（Applier 决定）
    }
    if (typeof val === 'object' && 'ratio' in val) return { field: 'flexBasis', value: { kind: 'ratio', ratio: val.ratio, base: val.base } satisfies RL }
    return null
  }
  if (/^border-(top|right|bottom|left)-width$/.test(prop)) {
    const side = prop.split('-')[1]!
    return { field: `border${side[0]!.toUpperCase()}${side.slice(1)}Width`, value: typeof val === 'number' ? val : null }
  }
  // ★★★边框族收口批（2026-10-05）：`border-<side>-style` → `border<Side>Style`（宿主按线型绘制：solid/dashed/dotted）。
  //   `none` 由调用方转换为该边宽度 0（见上方 width 映射的完成阶段）；此处只透传线型字符串。
  if (/^border-(top|right|bottom|left)-style$/.test(prop)) {
    const side = prop.split('-')[1]!
    return { field: `border${side[0]!.toUpperCase()}${side.slice(1)}Style`, value: typeof val === 'string' ? val : null }
  }
  // 逐角 radius：由 resolveBorderRadiusFields 统一合并（此处不单独映射）
  if (prop === 'border-top-left-radius' || prop === 'border-top-right-radius' || prop === 'border-bottom-right-radius' || prop === 'border-bottom-left-radius') return null
  if (prop === 'overflow-x' || prop === 'overflow-y') {
    // 契约只有一个 overflow 字段：两侧相同时写它；不同 ⇒ v1 记 unmapped（不静默取一边）
    return null // 由调用方在完成后处理（见下 resolveOverflow）
  }
  if (prop === 'aspect-ratio') return { field: 'aspectRatio', value: typeof val === 'number' ? val : null }
  // ★★★B3 补齐（2026-10-05——conformance 抓出 B1 遗漏）：grid 族与 z-index 此前**完全未映射**
  //   （探针实测：`grid-template-columns` 等算出来了却没进 IR ⇒ App/Skyline 静默丢 Grid）。
  if (prop === 'grid-template-columns') return { field: 'gridTemplateColumns', value: typeof val === 'string' ? normalizeGridTrack(val) : null }
  if (prop === 'grid-template-rows') return { field: 'gridTemplateRows', value: typeof val === 'string' ? normalizeGridTrack(val) : null }
  if (prop === 'grid-column') return { field: 'gridColumn', value: val }
  if (prop === 'grid-row') return { field: 'gridRow', value: val }
  if (prop === 'z-index') return { field: 'zIndex', value: typeof val === 'number' ? val : null }
  return null
}

/** grid 轨迹串归一（空格/斜杠规范化——浏览器 computed 会把 `1fr 1fr` 原样返回，但多余空白要归一） */
function normalizeGridTrack(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

export { resolveOverflowFields, resolveBorderRadiusFields }

/**
 * overflow-x/y → **归一后的逐轴值**（Web 真值，CSS Overflow 3）。
 *   · 两侧均未声明 ⇒ null（不发字段——零 churn）；
 *   · 值集 = 内核封闭集（visible/hidden/scroll/auto）：命中 `clip`/未知值 ⇒ null（调用方记 unmapped）；
 *   · **归一**（真 Chromium getComputedStyle 实测）：一侧 visible、另一侧非 visible 且非 clip ⇒ visible→auto
 *     （`overflow-x: hidden` ⇒ x=hidden · y=auto；`overflow-x: auto` ⇒ x=auto · y=auto）。
 */
function resolveOverflowFields(computed: Record<string, CssComputedValue>): { x: string; y: string } | null {
  const rawX = computed['overflow-x']
  const rawY = computed['overflow-y']
  if (typeof rawX !== 'string' && typeof rawY !== 'string') return null
  let x = typeof rawX === 'string' ? rawX : 'visible'
  let y = typeof rawY === 'string' ? rawY : 'visible'
  const supported = (v: string): boolean => v === 'visible' || v === 'hidden' || v === 'scroll' || v === 'auto'
  if (!supported(x) || !supported(y)) return null
  if (x === 'visible' && y !== 'visible') x = 'auto'
  if (y === 'visible' && x !== 'visible') y = 'auto'
  return { x, y }
}

/**
 * border-radius 逐角合并 → 引擎字段形态（**对齐 App 引擎既有能力**，见 vapor/template.ts:904 同款）：
 *   · 四角等值（数值）⇒ 只写 `borderRadius`（统一半径）
 *   · 四角有 0/非 0 模式且非零值一致 ⇒ `borderRadius` = 非零值 + `borderRadiusCorners` = 逐角布尔掩码
 *   · 四角百分比且等值 ⇒ `borderRadiusPct` = 比例
 *   · 其余（逐角不同半径 / 混合单位）⇒ null（调用方记 unmapped——v1 不静默取近似）
 */
function resolveBorderRadiusFields(computed: Record<string, CssComputedValue>): Record<string, unknown> | null {
  const corners = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const
  const vals = corners.map((c) => computed[c])
  if (vals.every((v) => v === undefined)) return null
  // ★★★边框族收口批（2026-10-05）：**缺省角视为 0**（CSS：只写某角 = 其余角 0）——
  //   此前 `undefined` 会走成 null ⇒ 单角写法（`border-top-left-radius: 8px`）**静默丢**。
  const nums = vals.map((v) => (v === undefined ? 0 : typeof v === 'number' ? v : null))
  if (nums.every((v) => v !== null)) {
    const [tl, tr, br, bl] = nums as number[]
    const all = new Set(nums as number[])
    if (all.size === 1) return { borderRadius: tl }
    const nonzero = (nums as number[]).filter((v) => v !== 0)
    const nz = new Set(nonzero)
    if (nz.size === 1) {
      return {
        borderRadius: nonzero[0]!,
        borderRadiusCorners: { topLeft: tl! > 0, topRight: tr! > 0, bottomRight: br! > 0, bottomLeft: bl! > 0 },
      }
    }
    return null
  }
  const ratios = vals.map((v) => (v !== undefined && typeof v === 'object' && 'ratio' in v ? v.ratio : null))
  if (ratios.every((v) => v !== null)) {
    const rset = new Set(ratios as number[])
    if (rset.size === 1) return { borderRadiusPct: (ratios as number[])[0]! }
  }
  return null
}

