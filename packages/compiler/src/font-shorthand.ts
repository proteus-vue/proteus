// packages/compiler/src/font-shorthand.ts
// ★★★font 简写（2026-10-18 · 批 B F3）——**词法解析的唯一实现**。
//
// 【为什么单独成模块】`font` 有两条消费通路：App 折叠面（vapor/template.ts，值需归一为
//   数值/角色）与 CSE（cse/shorthand.ts，需展开为长手交给层叠/计算）。两边各写一份语法解析
//   必然漂移（本仓 margin/border 简写已踩过同类分叉）⇒ 语法只在这里解一次，两边只做**值归一**。
//
// 【语法子集】`[style || variant || weight || stretch]? size[/line-height]? family`
//   · 支持：style（normal/italic/oblique）· weight（normal/bold/100–900）· size · line-height · family
//   · **不支持 ⇒ 返回 null**（调用方诊断/计 skipped，不静默近似）：
//     `small-caps`（variant）· stretch 关键字 · 系统字体关键字（caption/icon/menu/message-box/...）
//
// 【Web 真值（真 Chromium 实测，2026-10-18）】`font` 是**重置型简写**：
//   · `font: italic bold 20px/1.5 "Helvetica", sans-serif` ⇒ style=italic weight=700 size=20px lh=30px
//   · `font: normal normal 700 14px serif` ⇒ weight=700 size=14px（**多个 normal 不吞掉字重**）
//   · 未指定的 style/weight/**line-height** 全部重置为 initial（normal/400/normal）——
//     父 `line-height:3` + 子 `font:14px serif` ⇒ 子 computed line-height = normal（实测）。

/** 系统字体关键字：整条即是（无 size/family）——无宿主通道 */
const SYS_FONT = /^(caption|icon|menu|message-box|small-caption|status-bar)$/i
/** stretch 关键字（`condensed` 等）——无宿主通道 */
const STRETCH = /^(ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded)$/
/** 带单位的字号 token（可带 `/line-height`） */
const SIZE_UNIT = /^-?\d*\.?\d+(px|%|rpx|em|rem|vw|vh|pt|pc|in|cm|mm|ex|ch)(\/.*)?$/i
/** 裸数字（本仓 `font-size: 16` 同口径 = px；也用于区分字重 700 与字号） */
const SIZE_BARE = /^-?\d*\.?\d+$/
const WEIGHT_KW = /^(bold|bolder|lighter|[1-9]00)$/

/** 顶层空格切分（引号/括号感知——`rgb()` 内的空格不切，`"Helvetica Neue"` 保持整体） */
export function splitFontTokens(s: string): string[] {
  const out: string[] = []
  let d = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '(') d++
    else if (ch === ')') d = Math.max(0, d - 1)
    if (/\s/.test(ch) && d === 0) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** 简写的**原始分量**（未归一；缺省 = undefined ⇒ 语义为 initial，由调用方补齐） */
export interface FontShorthandParts {
  /** style 关键字（`normal` 不返回——缺省即 normal） */
  style?: 'italic' | 'oblique'
  /** weight 原 token（`bold`/`bolder`/`lighter`/`700`…；`normal` 不返回） */
  weight?: string
  /** 字号原 token（`16px`/`1.2rem`/`16`…） */
  size: string
  /** 行高原 token（不含 `/`；`normal` 原样） */
  lineHeight?: string
  /** 字体族候选串（原样，含逗号/引号） */
  family: string
}

/**
 * 解析 `font` 简写 → 原始分量；不支持/不可解析 ⇒ null（调用方诊断，不静默近似）。
 * ★不做任何值归一（px 折算、字重数值化、字体角色）——那是各消费通路自己的事。
 */
export function splitFontShorthand(raw: string): FontShorthandParts | null {
  const v = raw.trim()
  if (!v || SYS_FONT.test(v)) return null
  const toks = splitFontTokens(v)
  if (toks.length < 2) return null // 至少 size + family
  // ① 定位 size 起点：**先找带单位的**（否则 `700 14px` 会把字重当字号），再回落裸数字
  const isSizeTok = (t: string): boolean => SIZE_UNIT.test(t) || (t.includes('/') && SIZE_BARE.test(t.split('/')[0] ?? ''))
  let si = -1
  for (let j = 0; j < toks.length; j++) if (isSizeTok(toks[j]!)) { si = j; break }
  if (si < 0) for (let j = 0; j < toks.length; j++) if (SIZE_BARE.test(toks[j]!)) { si = j; break }
  if (si < 0) return null
  // ② 前置修饰词：先分类、再定缺省（`normal` 只是"某个槽位的 normal"，不能边扫边占槽）
  const parts: FontShorthandParts = { size: '', family: '' }
  const seen = new Set<'style' | 'weight'>()
  for (let j = 0; j < si; j++) {
    const t = toks[j]!.toLowerCase()
    if (t === 'italic' || t === 'oblique') {
      if (seen.has('style')) return null
      seen.add('style'); parts.style = t; continue
    }
    if (WEIGHT_KW.test(t)) {
      if (seen.has('weight')) return null
      seen.add('weight'); parts.weight = t; continue
    }
    if (t === 'normal') continue
    // variant / stretch / 其它未知 token ⇒ 无宿主通道（不静默近似）
    if (t === 'small-caps' || STRETCH.test(t)) return null
    return null
  }
  // ③ size[/line-height]（斜杠两侧允许空白：`18px/24px` · `18px / 24px` · `18px/ 24px`）
  const szTok = toks[si]!
  const slash = szTok.indexOf('/')
  parts.size = slash >= 0 ? szTok.slice(0, slash) : szTok
  if (!parts.size) return null
  let consumed = 1
  if (slash >= 0) {
    const tail = szTok.slice(slash + 1)
    if (tail) parts.lineHeight = tail
    else { if (si + 1 >= toks.length) return null; parts.lineHeight = toks[si + 1]!; consumed = 2 }
  } else if (toks[si + 1] === '/') {
    if (si + 2 >= toks.length) return null
    parts.lineHeight = toks[si + 2]!; consumed = 3
  } else if (toks[si + 1]?.startsWith('/')) {
    const tail = toks[si + 1]!.slice(1)
    consumed = 2
    if (tail) parts.lineHeight = tail
    else { if (si + 2 >= toks.length) return null; parts.lineHeight = toks[si + 2]!; consumed = 3 }
  }
  // ④ family：剩余全部（引号内空格在切分时已成独立 token，这里拼回）
  const famStart = si + consumed
  if (famStart >= toks.length) return null
  const fam = toks.slice(famStart).join(' ').trim()
  if (!fam) return null
  parts.family = fam
  return parts
}
