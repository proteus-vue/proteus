// packages/compiler/src/cse/shorthand.ts
// ★★★G-61 B1：**CSS 简写 → 长手展开**（唯一实现——规则表与 inline style 共用一条通道）
//
// 【为什么必须独立成模块（关键正确性）】CSS 层叠逐**长手**判定：`margin: 0` 与 `margin-top: 5px`
//   竞争同一属性。若两条通道（`<style>` 规则、`style="..."` 属性）各自展开简写，展开语义就会漂移。
//   ⇒ 本模块是唯一展开实现；parse.ts（样式表）与 extract.ts（inline）都走它。
//
// 【支持面（v1）】margin/padding/inset（1–4 值）· border-width/color/style（1–4）· border-radius（1–4，
//   `/` 椭圆形式不支持）· border / border-<side>（width style color 任意序）· gap（1–2）·
//   overflow（1–2）· flex（`none`/`auto`/`<grow> <shrink>? <basis>?`）· text-decoration（取 line 维度）·
//   background（只取颜色 token）。其余（font/transition/animation…）⇒ null（调用方计数，不静默）。

import type { CseDeclaration } from './types'

/** 顶层空格切分（括号/引号感知——`rgb(0, 0, 0)` 内空格不切） */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (const ch of value) {
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
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

/** 四值简写展开 → [top,right,bottom,left] */
function fourSides(v: string): [string, string, string, string] | null {
  const p = splitTopLevel(v)
  if (p.length === 1) return [p[0]!, p[0]!, p[0]!, p[0]!]
  if (p.length === 2) return [p[0]!, p[1]!, p[0]!, p[1]!]
  if (p.length === 3) return [p[0]!, p[1]!, p[2]!, p[1]!]
  if (p.length === 4) return [p[0]!, p[1]!, p[2]!, p[3]!]
  return null
}

const EDGE_SUFFIX: Array<'top' | 'right' | 'bottom' | 'left'> = ['top', 'right', 'bottom', 'left']
/** border-radius 四角顺序（CSS：左上 → 右上 → 右下 → 左下） */
const CORNER_SUFFIX: Array<'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'> = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** 已知不支持简写（调用方据此记 skipped/诊断——列在这里防"悄悄当长手收下"） */
export const UNSUPPORTED_SHORTHANDS = new Set([
  'font', 'transition', 'animation', 'border-image', 'background-image', 'list-style', 'outline',
  'box-shadow', 'filter', 'backdrop-filter',
])

/**
 * 简写展开为长手（列表序保留；`fromShorthand` 记来源）。
 * 返回 null ⇒ 该简写不支持（调用方记 skipped——不静默）。
 */
export function expandShorthandDecl(prop: string, value: string, important: boolean): CseDeclaration[] | null {
  const decl = (p: string, v: string): CseDeclaration => ({ prop: p, value: v, important, fromShorthand: prop })
  // margin / padding / inset：1–4 值
  const m = /^(margin|padding|inset)$/.exec(prop)
  if (m) {
    const sides = fourSides(value)
    if (!sides) return null
    const names = m[1] === 'inset' ? ['top', 'right', 'bottom', 'left'] : [`${m[1]}-top`, `${m[1]}-right`, `${m[1]}-bottom`, `${m[1]}-left`]
    return sides.map((v, i) => decl(names[i]!, v))
  }
  // border-width / border-color / border-style：1–4 值
  const bw = /^border-(width|color|style)$/.exec(prop)
  if (bw) {
    const sides = fourSides(value)
    if (!sides) return null
    return sides.map((v, i) => decl(`border-${EDGE_SUFFIX[i]!}-${bw[1]!}`, v))
  }
  // border-radius：1–4 值（`/` 椭圆形式 ⇒ 不支持）
  if (prop === 'border-radius') {
    if (value.includes('/')) return null
    const sides = fourSides(value)
    if (!sides) return null
    return sides.map((v, i) => decl(`border-${CORNER_SUFFIX[i]!}-radius`, v))
  }
  // border：<width> <style> <color>（任意顺序；未识别 token ⇒ 忽略）
  if (prop === 'border' || /^border-(top|right|bottom|left)$/.test(prop)) {
    const side = prop === 'border' ? '' : `-${prop.slice('border-'.length)}`
    const toks = splitTopLevel(value)
    let width: string | undefined
    let style: string | undefined
    let color: string | undefined
    const STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'hidden', 'groove', 'ridge', 'inset', 'outset'])
    for (const t of toks) {
      const low = t.toLowerCase()
      if (STYLES.has(low)) {
        style = low
        continue
      }
      // ★E 组（设备标量 · 决策 #598）：宽度 token 亦可是内置 env 引用（var(--pf-hairline) / env(...) / calc(...)）
      if (/^\d*\.?\d+(px|em|rem|%|vw|vh)?$/.test(low) || ['thin', 'medium', 'thick'].includes(low)
          || /^var\(\s*--pf-|^env\(|^calc\(/.test(low)) {
        width = t
        continue
      }
      if (!color) color = t
    }
    const out: CseDeclaration[] = []
    const sides = side ? [side.slice(1)] : EDGE_SUFFIX
    for (const s of sides) {
      if (width) out.push(decl(`border-${s}-width`, width))
      if (color) out.push(decl(`border-${s}-color`, color))
      if (style) out.push(decl(`border-${s}-style`, style))
    }
    return out.length ? out : null
  }
  // gap：1–2 值
  if (prop === 'gap') {
    const p = splitTopLevel(value)
    if (p.length === 1) return [decl('row-gap', p[0]!), decl('column-gap', p[0]!)]
    if (p.length === 2) return [decl('row-gap', p[0]!), decl('column-gap', p[1]!)]
    return null
  }
  // overflow：1–2 值
  if (prop === 'overflow') {
    const p = splitTopLevel(value)
    if (p.length === 1) return [decl('overflow-x', p[0]!), decl('overflow-y', p[0]!)]
    if (p.length === 2) return [decl('overflow-x', p[0]!), decl('overflow-y', p[1]!)]
    return null
  }
  // flex：<grow> <shrink>? <basis>?
  if (prop === 'flex') {
    const p = splitTopLevel(value)
    const defs: CseDeclaration[] = []
    if (p[0] === 'none') return [decl('flex-grow', '0'), decl('flex-shrink', '0'), decl('flex-basis', 'auto')]
    if (p[0] === 'auto') return [decl('flex-grow', '1'), decl('flex-shrink', '1'), decl('flex-basis', 'auto')]
    defs.push(decl('flex-grow', p[0]!))
    if (p[1] !== undefined) defs.push(decl('flex-shrink', p[1]!))
    else defs.push(decl('flex-shrink', '1'))
    if (p[2] !== undefined) defs.push(decl('flex-basis', p[2]!))
    else if (p[0] === '1' && p[1] === undefined) defs.push(decl('flex-basis', '0%'))
    return defs
  }
  // text-decoration：简写 ⇒ 取 line 维度（`underline dotted red` → line=underline；v1 只表达 line）
  if (prop === 'text-decoration') {
    const first = splitTopLevel(value).find((t) => /^(none|underline|overline|line-through|blink)$/i.test(t))
    if (!first) return null
    return [decl('text-decoration-line', first.toLowerCase())]
  }
  // background：只提取颜色 token（图/位置等 v1 不支持）；纯色简写常见形态
  if (prop === 'background') {
    const toks = splitTopLevel(value)
    const maybe = toks.find((t) => t.startsWith('#') || /^(rgb|hsl)a?\(/i.test(t) || /^[a-z]+$/i.test(t))
    if (maybe && !/^(url|linear-gradient|radial-gradient|conic-gradient|none|repeat|no-repeat|center|left|right|top|bottom|cover|contain|fixed|scroll)/i.test(maybe)) {
      return [decl('background-color', maybe)]
    }
    return null
  }
  return null // 其余简写（font/transition/animation…）⇒ 不支持
}
