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
  // ★★★overflow-x 项（2026-10-06 · css:next P0·10×）：单轴溢出（overflow-x/y 长手 + overflow 1–2 值简写）。
  //   值集与内核封闭集对齐（visible/hidden/scroll/auto）——Web 的 clip 命中无内核对应 ⇒ 编译期诊断跳过（v1 边界）。
  //   四同步（INV-CE-07）：本表 + runtime PROP_TYPES/narrowing + compiler 静态校验 + 注册表 VALUE_TYPE_BY_LEVEL。
  | 'Overflow'
  // ★★★justify-self 项（2026-10-06 · css:next P0·9×）：网格项**行内轴自对齐**（CSS Box Alignment 3）。
  //   与 FlexAlign 不同轴：值集含 start/end/self-*（CSS `<self-position>` 全集）。语料 9 处全在 grid 上下文。
  //   四同步（INV-CE-07）：本表 + runtime PROP_TYPES/narrowing + compiler 静态校验 + 注册表 VALUE_TYPE_BY_LEVEL。
  | 'JustifySelf'
  // ★★★word-break 项（2026-10-06 · css:next P0·7× · CSS Text）：**行内断词策略**（继承属性）。
  //   值集 = 四端可表达子集（normal / break-all——Skyline 官方表即此二值）；keep-all（CJK 专用，Skyline 无）
  //   / break-word（Skyline 无，仅 Web+App 可表达）/ auto-phrase（实验）⇒ 编译期诊断跳过（v1 边界）。
  //   与 white-space 同轴（同属文本换行族）。四同步（INV-CE-07）：
  //   本表 + runtime PROP_TYPES/narrowing + compiler 静态校验 + 注册表 VALUE_TYPE_BY_LEVEL。
  | 'WordBreak'
  // ★★★背景定位家族（2026-10-07 · css:next background-position · 静态单层）：
  //   size/position/repeat 是「背景图/渐变定位」三件套（CSS Backgrounds 3）。
  //   值集 = **四端可表达子集**（MP/Web 原生直通；App 自绘按 Web 几何重写渐变端点/平铺）。
  //   四同步（INV-CE-07）：本表 + runtime PROP_TYPES/narrowing + compiler 静态校验 + 注册表 VALUE_TYPE_BY_LEVEL。
  | 'BackgroundSize'
  | 'BackgroundPosition'
  | 'BackgroundRepeat'
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
  borderLeftStyle: 'BorderStyle',
  // ★★★overflow-x 项：单轴溢出（'visible'/'hidden'/'scroll'/'auto'；编译期完成 Web 归一）
  overflowX: 'Overflow',
  overflowY: 'Overflow',
  // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（CSS Box Alignment 3 `<self-position>` 集；
  //   仅在 grid 容器内生效——flex 容器下按 Web 标准本就不生效，内核 taffy 同语义）
  justifySelf: 'JustifySelf',
  // ★★★word-break 项（2026-10-06）：行内断词策略（normal/break-all/break-word；keep-all 等诊断跳过）
  wordBreak: 'WordBreak',
  // ★★★背景定位家族（2026-10-07）：背景图/渐变的尺寸/位置/平铺（作用对象 = 背景图层的图像盒）
  backgroundSize: 'BackgroundSize',
  backgroundPosition: 'BackgroundPosition',
  backgroundRepeat: 'BackgroundRepeat',
  transform: 'Transform',
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
