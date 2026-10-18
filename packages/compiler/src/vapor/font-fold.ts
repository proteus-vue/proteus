// packages/compiler/src/vapor/font-fold.ts
// ★★★font 简写 → App 折叠面五字段（2026-10-18 · 批 B F3）。
//
// 【为什么单独成文件】`font` 展开在 `template.ts` 的解析循环里只是一段分派；值归一
//   （字重→数值 / 字号→长度 token / 行高→行高 token / 族→角色）依赖折叠面的私有归一器，
//   把这段留在 4600 行的 template.ts 里既难读也顶穿 file-size 棘轮 ⇒ 抽成独立模块。
//   **语法**解析仍复用 `../font-shorthand.ts`（与 CSE 共用唯一实现，防两份漂移）。
//
// 【Web 真值（真 Chromium 实测，2026-10-18）】`font` 是**重置型简写**：未给的 style/weight/
//   line-height 全部重置为 initial（normal/400/normal）。显式 normal **必须发射**——跳过就等于
//   inherit（italic 父 + `font: 14px serif` 子会被错误继承为斜体、父的 3 倍行高会漏进来）。
//
// 【CSS-wide 关键字】`inherit` / `unset`（可继承属性 ⇒ 同义）⇒ 五字段都记 sentinel `'inherit'`，
//   由 template.ts 的继承 walk 解析为父值；`initial` 不近似（简写的 initial 含 UA 默认字体/字号，
//   跨端不可知）⇒ 返回 error 由调用方诊断。

import { splitFontShorthand } from '../font-shorthand'

/** 简写展开出的五个 App 字段（顺序即发射/诊断顺序） */
export const FONT_FIELDS = ['fontStyle', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily'] as const

export type FontField = (typeof FONT_FIELDS)[number]

/** 折叠面提供的值归一器（与长手 `font-weight`/`font-size`/`line-height`/`font-family` 同源） */
export interface FontFoldDeps {
  weight: (v: string) => number | undefined
  len: (v: string) => number | string | undefined
  lineHeight: (v: string) => string | null
  family: (v: string) => string | undefined
}

/** 展开结果：五字段记录（值类型随字段而异）或基础关键字错误 */
export type FontFoldResult =
  | { ok: true; fields: Partial<Record<FontField, number | string>> }
  | { ok: false; reason: 'initial' | 'unparsable' }

/** `font` → 五字段（含重置出的 normal/400/normal）；不支持 ⇒ `ok:false` 供调用方诊断。 */
export function foldFont(rawVal: string, deps: FontFoldDeps): FontFoldResult {
  const kw = rawVal.trim().toLowerCase()
  if (kw === 'inherit' || kw === 'unset') {
    const fields: Partial<Record<FontField, number | string>> = {}
    for (const f of FONT_FIELDS) fields[f] = 'inherit'
    return { ok: true, fields }
  }
  if (kw === 'initial') return { ok: false, reason: 'initial' }
  const p = splitFontShorthand(rawVal)
  if (p === null) return { ok: false, reason: 'unparsable' }
  // ★bolder/lighter 依赖父级权重 ⇒ 不猜（归一器返回 undefined ⇒ 视为不可解析）
  const weight = p.weight === undefined ? 400 : deps.weight(p.weight)
  if (weight === undefined) return { ok: false, reason: 'unparsable' }
  const fontSize = deps.len(p.size)
  if (fontSize === undefined) return { ok: false, reason: 'unparsable' }
  const lineHeight = p.lineHeight === undefined ? 'normal' : deps.lineHeight(p.lineHeight)
  if (lineHeight === null) return { ok: false, reason: 'unparsable' }
  const fontFamily = deps.family(p.family)
  if (fontFamily === undefined) return { ok: false, reason: 'unparsable' }
  return {
    ok: true,
    fields: { fontStyle: p.style ?? 'normal', fontWeight: weight, fontSize, lineHeight, fontFamily },
  }
}

/* ────────────────────────── 长手（font-* / line-height） ────────────────────────── */

/** 长手折叠结果：字段值 / 诊断理由 / `null` = 不是本模块管的键 */
export type FontLonghandResult =
  | { kind: 'value'; field: FontField; value: number | string }
  | { kind: 'diag'; message: string }
  | null

/** 斜体封闭集（`oblique <angle>` 三端字体引擎均无角度语义 ⇒ 诊断） */
export const FONT_STYLE_VALUES = ['normal', 'italic', 'oblique'] as const

/**
 * 折叠字体长手（`font-weight` / `font-style` / `font-family` / `line-height`）。
 *   ★与简写共用同一批归一器（`deps`），保证「简写展开」与「长手直写」产出**同一形态**。
 *   ★`font-style: normal` **必须发射**（CSS 里它压掉父级继承的 italic，跳过就等于 inherit）。
 */
export function foldFontLonghand(key: string, rawVal: string, deps: FontFoldDeps, rawKey: string): FontLonghandResult {
  if (key === 'fontWeight') {
    const w = deps.weight(rawVal)
    if (w === undefined) return { kind: 'diag', message: `style 里 \`${rawKey}: ${rawVal}\` 不是合法字重（normal/bold/100–900）` }
    return { kind: 'value', field: 'fontWeight', value: w }
  }
  if (key === 'fontStyle') {
    const v = rawVal.trim().toLowerCase()
    if (!(FONT_STYLE_VALUES as readonly string[]).includes(v)) {
      return { kind: 'diag', message: `\`${rawKey}: ${rawVal}\` 不是 App 支持的值（仅 ${FONT_STYLE_VALUES.join(' / ')}；带角度的 oblique 暂不支持）——已跳过` }
    }
    // ★显式 normal **必须发射**：CSS 里它压掉父级继承的 italic（跳过 = inherit，实测会被错误继承）
    return { kind: 'value', field: 'fontStyle', value: v }
  }
  if (key === 'fontFamily') {
    const role = deps.family(rawVal)
    if (role === undefined) {
      return { kind: 'diag', message: `style 里 \`${rawKey}: ${rawVal}\` 无法归一为字体角色（system/serif/monospace/rounded/condensed）——已跳过` }
    }
    return { kind: 'value', field: 'fontFamily', value: role }
  }
  if (key === 'lineHeight') {
    const lh = deps.lineHeight(rawVal)
    if (lh === null) {
      return { kind: 'diag', message: `\`${rawKey}: ${rawVal}\` 未解析（支持无单位倍数 \`1.6\` / \`160%\` / \`24px\` / \`normal\`）——已跳过` }
    }
    return { kind: 'value', field: 'lineHeight', value: lh }
  }
  return null
}
