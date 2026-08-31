// packages/runtime/src/style-safety/whitelist.ts
// G-31 style-safety B1：ALLOWED_STYLE_PROPS 白名单 + PROP_TYPES 类型守卫 + 降级默认值
// 03-semantic-token-layer.md §1 全量清单（与 css-compat CSS 矩阵联动：✅直映射 / 🔶语义 / ❌禁止）
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

/** 白名单值类型（03 §1 级别语义） */
export type StylePropKind =
  | 'Length'
  | 'Color'
  | 'Opacity'
  | 'Integer'
  | 'FlexNumber'
  | 'FlexAlign'
  | 'FlexJustify'
  | 'Transform'
  | 'TransformOrigin'
  | 'SEMANTIC_ONLY'
  | 'FORBIDDEN'

export type AllowedStyleProp = keyof typeof ALLOWED_STYLE_PROPS

/** 属性白名单（03 §1；✅ 直映射走类型守卫，🔶 语义组件，❌ 禁止） */
export const ALLOWED_STYLE_PROPS = {
  // ── ✅ 直映射：五端原生都有对应，值经类型守卫后放行 ──
  width: 'Length',
  height: 'Length',
  minWidth: 'Length',
  maxWidth: 'Length',
  minHeight: 'Length',
  maxHeight: 'Length',
  padding: 'Length',
  paddingTop: 'Length',
  paddingRight: 'Length',
  paddingBottom: 'Length',
  paddingLeft: 'Length',
  margin: 'Length',
  marginTop: 'Length',
  marginRight: 'Length',
  marginBottom: 'Length',
  marginLeft: 'Length',
  color: 'Color',
  backgroundColor: 'Color',
  borderColor: 'Color',
  opacity: 'Opacity',
  borderRadius: 'Length',
  borderWidth: 'Length',
  borderTopWidth: 'Length',
  transform: 'Transform',
  transformOrigin: 'TransformOrigin',
  zIndex: 'Integer',
  flex: 'FlexNumber',
  flexGrow: 'FlexNumber',
  flexShrink: 'FlexNumber',
  alignSelf: 'FlexAlign',
  justifyContent: 'FlexJustify',
  alignItems: 'FlexAlign',
  // ── 🔶 语义组件：必须用 p-* 封装，禁止裸写 ──
  backdropFilter: 'SEMANTIC_ONLY', // → <p-glass>
  filter: 'SEMANTIC_ONLY', // → <p-filter>
  // ── ❌ 禁止（CSS 矩阵 ❌ 级）──
  display: 'FORBIDDEN', // inline/float 禁用，用 p-flex/p-stack
  float: 'FORBIDDEN',
  clear: 'FORBIDDEN',
  verticalAlign: 'FORBIDDEN',
} as const

/** 降级默认值（06 §5 / 01 §5）：非法值 → 此默认值，避免直达原生 */
export const FALLBACK_DEFAULTS: Record<string, unknown> = {
  width: 0,
  height: 0,
  opacity: 1,
  color: 'inherit',
  borderRadius: 0,
}

/** 值类型守卫（06 §2 第 2 步）——Length/Color/Opacity/Integer 基础类型检查 */
export const PROP_TYPES = {
  Length: (v: unknown): boolean => {
    // 数值（像素/逻辑单位）或带单位的字符串（px/rpx/rem/%）
    if (typeof v === 'number') return Number.isFinite(v)
    if (typeof v === 'string') return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rpx|rem|%)?$/.test(v.trim())
    return false
  },
  Color: (v: unknown): boolean => {
    if (typeof v !== 'string') return false
    const s = v.trim()
    return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\([\d.,\s%]+\)$/.test(s) || /^hsla?\([\d.,\s%deg]+\)$/.test(s) || s === 'transparent' || s === 'inherit'
  },
  Opacity: (v: unknown): boolean => {
    if (typeof v !== 'number') return false
    return v >= 0 && v <= 1
  },
  Integer: (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v),
  FlexNumber: (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?(?:\d+(?:\.\d+)?|auto)$/.test(v.trim())),
  FlexAlign: (v: unknown): boolean => ['flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'auto'].indexOf(String(v)) >= 0,
  FlexJustify: (v: unknown): boolean => ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'].indexOf(String(v)) >= 0,
  Transform: (v: unknown): boolean => typeof v === 'string' && /^(translate|scale|rotate|skew)/i.test(v.trim()),
  TransformOrigin: (v: unknown): boolean => typeof v === 'string' && /^(left|right|top|bottom|center|\d+)/i.test(v.trim()),
} as const
