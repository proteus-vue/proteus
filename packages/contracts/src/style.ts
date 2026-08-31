// packages/contracts/src/style.ts
// @proteus-vue/contracts —— 样式安全白名单数据契约（G-31 style-safety 共享，铁律 #9 同源）
// 定位：CSS 矩阵（G-21）定义「什么合法」→ 本表是运行时 Validator（runtime/style-safety）与
// 编译期推导（compiler/style-safety）共用的**单一来源**；零运行时依赖纯数据。
// 级别语义（03-semantic-token-layer.md §1）：
//   Length/Color/Opacity/... = ✅ 直映射（值经类型守卫）
//   SEMANTIC_ONLY = 🔶 必须用 p-* 语义组件
//   FORBIDDEN     = ❌ 禁止（CSS 矩阵 ❌ 级）

export type StylePropLevel =
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

/** 属性白名单（03 §1 全量；compiler 编译期校验 + runtime 运行时校验共用） */
export const STYLE_PROP_LEVELS = {
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

export type AllowedStyleProp = keyof typeof STYLE_PROP_LEVELS
