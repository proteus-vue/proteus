// packages/tokens/src/audit.ts —— token 色彩审计（WCAG 对比度）——门禁 `check:tokens` 的判据核心。
//   【为什么进宪法】"AA 达标"此前是**文档里的声称**（global.css 注释），不是机器判据 ⇒ 改值即可能
//   静默跌出 AA。把对比度审计做进宪法包 ⇒ 改 token 值当场可判（双侧浅/深都审）。
import { SA_TOKENS } from './tokens'

/** 解析颜色为 `[r,g,b,a]`（0-255, 0-1）；支持 `#rgb`/`#rrggbb`/`rgba(r,g,b,a)`/`rgb(...)`；`var(...)` 经 `resolve` 一层。 */
export function parseColor(input: string, resolve: (name: string) => string | undefined): [number, number, number, number] | null {
  let s = input.trim()
  // var(--x) → 实际值（一层；缺省回落 0 不匹配）
  const vm = s.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (vm) {
    const v = resolve(vm[1]!)
    if (v === undefined) return null
    s = v.trim()
  }
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6) return null
    const n = parseInt(h, 16)
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 1]
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
  return null
}

/** 把带 alpha 的前景**合成**到不透明背景上（WCAG 对比度要求不透明色）。 */
function flatten(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  const a = fg[3]
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ]
}

function relLum([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度（1–21）。前景带 alpha 时合成到背景上。 */
export function wcagRatio(fg: [number, number, number, number], bg: [number, number, number, number]): number {
  const bgOpaque: [number, number, number] = [bg[0], bg[1], bg[2]]
  const f = flatten(fg, bgOpaque)
  const l1 = relLum(f)
  const l2 = relLum(bgOpaque)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** 关键对比对（前景 token, 背景 token, 最小比值, 说明）。AA：正文 4.5、大字/图形 3.0。 */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; min: number; note: string }> = [
  { fg: '--sa-text', bg: '--sa-bg', min: 4.5, note: '正文 / 页面底' },
  { fg: '--sa-text', bg: '--sa-surface', min: 4.5, note: '正文 / 卡片' },
  { fg: '--sa-text-2', bg: '--sa-bg', min: 4.5, note: '次级文本 / 页面底' },
  { fg: '--sa-text-3', bg: '--sa-bg', min: 4.5, note: '辅助文本 / 页面底（曾 2.66:1 不达标）' },
  { fg: '--sa-text-3', bg: '--sa-surface', min: 4.5, note: '辅助文本 / 卡片' },
]

/**
 * 审计 token 对比度（浅色 + 深色两套）。返回违规列表（空 = 全绿）。
 * @param tokens 默认宪法全表；测试可注入。
 */
export function auditTokenContrast(
  tokens: Record<string, { value: string; dark?: string }> = SA_TOKENS,
): Array<{ mode: 'light' | 'dark'; pair: string; ratio: number; min: number; note: string }> {
  const violations: Array<{ mode: 'light' | 'dark'; pair: string; ratio: number; min: number; note: string }> = []
  const resolveOf = (mode: 'light' | 'dark') => (name: string): string | undefined => {
    const t = tokens[name]
    if (!t) return undefined
    return mode === 'dark' && t.dark !== undefined ? t.dark : t.value
  }
  for (const mode of ['light', 'dark'] as const) {
    const resolve = resolveOf(mode)
    for (const p of CONTRAST_PAIRS) {
      const fg = parseColor(`var(${p.fg})`, resolve)
      const bg = parseColor(`var(${p.bg})`, resolve)
      if (!fg || !bg) continue
      const ratio = wcagRatio(fg, bg)
      if (ratio < p.min) violations.push({ mode, pair: `${p.fg} on ${p.bg}`, ratio: Math.round(ratio * 100) / 100, min: p.min, note: p.note })
    }
  }
  return violations
}
