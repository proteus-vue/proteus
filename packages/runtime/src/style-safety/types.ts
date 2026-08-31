// packages/runtime/src/style-safety/types.ts
// G-31 style-safety B2：样式值类型系统（04-type-system.md §1-§2）
// 命名类型守卫（类型谓词）：isLength/isColor/isOpacity/isInteger/isFlexNumber
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

/** 长度：number(px) | 带单位字符串 | auto（04 §1） */
export type Length = number | `${number}px` | `${number}rem` | `${number}%` | 'auto'

/** 颜色：hex / rgba / var()（Theme token 编译期展开） */
export type Color = string

/** 透明度：0-1 的有限数 */
export type Opacity = number

/** 整数（zIndex 等） */
export type Integer = number

/** 弹性系数 */
export type FlexNumber = number | 'auto'

/** 变换：translate/scale 为主（rotate/skew 受限，见 CSS 矩阵） */
export type Transform = string

export function isLength(v: unknown): v is Length {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (t === 'auto') return true
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|%)?$/.test(t)
}

export function isColor(v: unknown): v is Color {
  if (typeof v !== 'string') return false
  const s = v.trim()
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(s) ||
    /^rgba?\([\d.,\s%]+\)$/.test(s) ||
    /^hsla?\([\d.,\s%deg]+\)$/.test(s) ||
    /^var\(--/.test(s) || // Theme token
    s === 'transparent' ||
    s === 'inherit'
  )
}

export function isOpacity(v: unknown): v is Opacity {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

export function isInteger(v: unknown): v is Integer {
  return typeof v === 'number' && Number.isInteger(v)
}

export function isFlexNumber(v: unknown): v is FlexNumber {
  return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && (v.trim() === 'auto' || /^-?(?:\d+(?:\.\d+)?)$/.test(v.trim())))
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 枚举守卫（FlexAlign/FlexJustify） */
export function isEnum(allowed: string[]): (v: unknown) => boolean {
  return (v: unknown) => typeof v === 'string' && allowed.indexOf(v) >= 0
}
