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
  | 'TextAlign'
  // ★★★G-61 后批（2026-10-05）：文本换行/空白语义（white-space）——CSE 与旧折叠器都已支持，
  //   但注册表/矩阵/runtime 三处漏登记（**四同步缺口**，清单审计抓出）⇒ 补齐（INV-CE-07）。
  | 'TextWrap'
  // ★★★逐边 border 批（2026-10-05 · border-bottom 等 4 个 P0 项）：边框线型（per-side style）。
  //   理由：语料 `border-bottom: 1px dashed #999` 等——线型是独立维度（solid/dashed/dotted/none），
  //   与宽度/颜色不同轴。新级别四同步（INV-CE-07）：本表 + runtime PROP_TYPES/narrowing
  //   + compiler 静态校验 + 注册表 VALUE_TYPE_BY_LEVEL（照 TextWrap 先例）。
  | 'BorderStyle'
  | 'Transform'
  | 'TransformOrigin'
  | 'SEMANTIC_ONLY'
  | 'FORBIDDEN'

/** 属性白名单（03 §1 全量；compiler 编译期校验 + runtime 运行时校验共用） */
export const STYLE_PROP_LEVELS = {
  // ── ✅ 直映射：三端（Web / Skyline / App）原生都有对应，值经类型守卫后放行 ──
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
  fontWeight: 'Integer',
  textAlign: 'TextAlign',
  whiteSpace: 'TextWrap',
  borderRadius: 'Length',
  borderWidth: 'Length',
  // ★★★逐边 border 批（2026-10-05）：四边各自独立（width/color/style）——语料 21 处
  //   `border-<side>: <w> <style> <color>`（列表分隔线/卡片顶线/侧边强调）。
  //   App 端折叠为 per-side 字段（宿主逐边绘制；uniform `borderWidth` 保留为四边缺省值）。
  borderTopWidth: 'Length',
  borderRightWidth: 'Length',
  borderBottomWidth: 'Length',
  borderLeftWidth: 'Length',
  borderTopColor: 'Color',
  borderRightColor: 'Color',
  borderBottomColor: 'Color',
  borderLeftColor: 'Color',
  borderTopStyle: 'BorderStyle',
  borderRightStyle: 'BorderStyle',
  borderBottomStyle: 'BorderStyle',
  borderLeftStyle: 'BorderStyle',  transform: 'Transform',
  transformOrigin: 'TransformOrigin',
  flex: 'FlexNumber',
  flexGrow: 'FlexNumber',
  flexShrink: 'FlexNumber',
  alignSelf: 'FlexAlign',
  justifyContent: 'FlexJustify',
  alignItems: 'FlexAlign',
  // ── 🔶 语义组件：必须用 p-* 封装，禁止裸写 ──
  backdropFilter: 'SEMANTIC_ONLY', // → <p-glass>
  filter: 'SEMANTIC_ONLY', // → <p-filter>
  // ★★LY0/LY1（2026-10-02 · 页面层级规范）：**层级语义化，禁裸数值**。
  //   理由（规范 §3.1）：数值无跨端意义（CSS 需 position / 鸿蒙不跨容器 / Android elevation 带阴影）；
  //   任意数值 = 收敛模型的逃生口；语义才能编译期校验（"Popout 在 Content 之下"可判）。
  //   ⇒ 替代物 = `layer="content|navigation|mask|popout"` 属性（见 contracts/layers.ts 的映射表）。
  //   ★原先列 'Integer'（可直映射）——本改动**是行为变更**（zIndex 从"允许"变"拒绝"），
  //     由 LY1 编译期报错 + 运行时 validateStyle 兜底（STS 码见 compiler/style-safety）。
  zIndex: 'FORBIDDEN', // → layer 属性（WeUI 四层语义；contracts/layers.ts）
  display: 'FORBIDDEN', // inline/float 禁用，用 p-flex/p-stack
  float: 'FORBIDDEN',
  clear: 'FORBIDDEN',
  verticalAlign: 'FORBIDDEN',
} as const

export type AllowedStyleProp = keyof typeof STYLE_PROP_LEVELS
