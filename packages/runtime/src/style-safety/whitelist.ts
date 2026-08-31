// packages/runtime/src/style-safety/whitelist.ts
// G-31 style-safety B1：ALLOWED_STYLE_PROPS 白名单 + PROP_TYPES 类型守卫 + 降级默认值
// ★白名单数据下沉 contracts（L0，铁律 #9 同源）：runtime 与 compiler 编译期推导共用同一张表
// 03-semantic-token-layer.md §1（与 css-compat CSS 矩阵联动：✅直映射 / 🔶语义 / ❌禁止）
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

import { STYLE_PROP_LEVELS } from '@proteus-vue/contracts/style'
import { isLength, isColor, isOpacity, isInteger, isFlexNumber, isEnum } from './types'

export type StylePropKind = import('@proteus-vue/contracts/style').StylePropLevel

/** 属性白名单（03 §1；✅ 直映射走类型守卫，🔶 语义组件，❌ 禁止）——contracts 单一来源 */
export const ALLOWED_STYLE_PROPS = STYLE_PROP_LEVELS

export type AllowedStyleProp = keyof typeof ALLOWED_STYLE_PROPS

/** 降级默认值（06 §5 / 01 §5）：非法值 → 此默认值，避免直达原生 */
export const FALLBACK_DEFAULTS: Record<string, unknown> = {
  width: 0,
  height: 0,
  opacity: 1,
  color: 'inherit',
  borderRadius: 0,
}

/** 值类型守卫（06 §2 第 2 步）——04 §2 命名守卫（types.ts）按属性类型映射 */
const FLEX_ALIGN = ['flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'auto']
const FLEX_JUSTIFY = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly']

export const PROP_TYPES = {
  Length: isLength,
  Color: isColor,
  Opacity: isOpacity,
  Integer: isInteger,
  FlexNumber: isFlexNumber,
  FlexAlign: isEnum(FLEX_ALIGN),
  FlexJustify: isEnum(FLEX_JUSTIFY),
  Transform: (v: unknown): boolean => typeof v === 'string' && /^(translate|scale|rotate|skew)/i.test(v.trim()),
  TransformOrigin: (v: unknown): boolean => typeof v === 'string' && /^(left|right|top|bottom|center|\d+)/i.test(v.trim()),
} as const
