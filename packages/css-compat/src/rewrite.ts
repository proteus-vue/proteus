// packages/css-compat/src/rewrite.ts
// G-21 css-compat B1：编译期重写（03-compile-time-rewrite.md）
// ① calc 数值折叠（同单位二元运算；含百分比/混合单位不重写 → 引导 p-* 语义组件）
// ② vh/vw → %（Web 语义近似；Skyline 端 p-h-safe 映射在 IR 层 B2）
// ③ rgba(r,g,b,a) → #RRGGBBAA（03 §一.3 内部表示，鸿蒙 toARGB 转换 B2）
import type { RewriteCounts } from './types'

const CALC_BINARY_RE = /calc\(\s*(-?\d+(?:\.\d+)?)(px|rpx|rem)?\s*([+-])\s*(-?\d+(?:\.\d+)?)(px|rpx|rem)?\s*\)/gi
const VH_RE = /(\d+(?:\.\d+)?)(vh|vw)\b/gi
const RGBA_RE = /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+%?)\s*\)/gi

function toHexByte(n: number): string {
  return n.toString(16).padStart(2, '0')
}

/** 解析 alpha（0-1 浮点或百分比）→ 0-255 字节 */
function alphaToByte(alpha: string): string {
  const v = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha)
  const clamped = Math.min(1, Math.max(0, v))
  return toHexByte(Math.round(clamped * 255))
}

/** 折叠 calc(a+b)/calc(a-b)（同单位）→ 字符串；不可折叠返回 null */
function foldCalcExpr(expr: string): string | null {
  const m = /^calc\(\s*(-?\d+(?:\.\d+)?)(px|rpx|rem)?\s*([+-])\s*(-?\d+(?:\.\d+)?)(px|rpx|rem)?\s*\)$/i.exec(expr)
  if (!m) return null
  const aUnit = (m[2] || '').toLowerCase()
  const bUnit = (m[5] || '').toLowerCase()
  if (aUnit !== bUnit) return null // 混合单位（%+px）不折叠
  const a = parseFloat(m[1])
  const b = parseFloat(m[4])
  const folded = m[3] === '+' ? a + b : a - b
  if (!Number.isFinite(folded)) return null
  return `${folded}${aUnit}`
}

/** 编译期重写：返回重写后的 css + 各项重写计数（03 §三 rewritten） */
export function rewriteStyleCss(css: string): { css: string; rewritten: RewriteCounts } {
  const rewritten: RewriteCounts = { calc: 0, vh: 0, 'rgba-to-argb': 0 }
  let out = css

  // ③ rgba → #RRGGBBAA（先做：其 #rrggbbaa 形态不应再被 calc/vh 规则触碰）
  out = out.replace(RGBA_RE, (_m, r: string, g: string, b: string, a: string) => {
    rewritten['rgba-to-argb']++
    return `#${toHexByte(parseInt(r, 10))}${toHexByte(parseInt(g, 10))}${toHexByte(parseInt(b, 10))}${alphaToByte(a)}`
  })

  // ① calc 数值折叠
  out = out.replace(CALC_BINARY_RE, (m) => {
    const folded = foldCalcExpr(m)
    if (folded !== null) {
      rewritten.calc++
      return folded
    }
    return m // 混合单位保留（lint 已报 CSS008，引导 p-*）
  })

  // ② vh/vw → %（height/width 等值语义近似：相对视口 → 相对容器，B2 映射 p-h-safe）
  out = out.replace(VH_RE, (m) => {
    rewritten.vh++
    return m.replace(/vh|vw/i, '%')
  })

  return { css: out, rewritten }
}
