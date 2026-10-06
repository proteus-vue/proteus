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
/** ★批次 4：`text-align` 封闭集（App 自绘文本水平对齐） */
const TEXT_ALIGN = ['left', 'center', 'right']
/**
 * ★★★G-61 后批（2026-10-05）：`white-space` 封闭集（Web 标准关键字）。
 *   与"各端可表达值"是两个轴：App 单行文本模型把 `nowrap` 当默认（no-op），
 *   其余值由 Applier/折叠器如实降级（诊断）——本层按 Web 标准收口，端侧收窄不在这层。
 */
const TEXT_WRAP = ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces']
/** ★★★逐边 border 批（2026-10-05）：边框线型封闭集（per-side style；'' 缺省=solid）。 */
const BORDER_STYLE = ['solid', 'dashed', 'dotted', 'none']
/** ★★★overflow-x 项（2026-10-06）：溢出封闭集（与内核 Overflow 枚举同集；Web 的 clip 不支持⇒诊断）。 */
const OVERFLOW = ['visible', 'hidden', 'scroll', 'auto']
/**
 * ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐封闭集（CSS Box Alignment 3 `<self-position>` 全集）。
 *   `auto`/`normal` 为 CSS 初值/标准关键字（内核映射：auto ⇒ 未设置、normal ⇒ stretch——按 Web 对 grid 项的语义）；
 *   `baseline`/`left`/`right` 未列 ⇒ 诊断跳过（taffy 在 grid 里把 baseline 按 start 处理 = 与 Web 不符，不静默近似）。
 */
const JUSTIFY_SELF = ['auto', 'normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch']
/** ★★★place-items/justify-items 项（2026-10-08）：`justify-items` 值集（= `<self-position>`，**无 `auto`**）——容器级对齐。 */
const JUSTIFY_ITEMS = ['normal', 'start', 'end', 'flex-start', 'flex-end', 'self-start', 'self-end', 'center', 'stretch']
/** ★★★grid-auto-flow 项（2026-10-08）：自动放置方向/密度（四端可表达子集；Web `row dense` 归一为 `dense`）。 */
const GRID_AUTO_FLOW = ['row', 'column', 'dense', 'column dense']
/**
 * ★★★word-break 项（2026-10-06）：行内断词策略封闭集（四端可表达子集：normal / break-all——Skyline 官方表即此二值）。
 *   `keep-all`（CJK 专用，Skyline 无）/ `break-word`（Skyline 无）/ `auto-phrase`（实验）未列 ⇒ 诊断跳过（不静默近似）。
 */
const WORD_BREAK = ['normal', 'break-all']
/**
 * ★★★背景定位家族（2026-10-07 · css:next background-position · 静态单层）：**背景图层的图像盒**尺寸/位置/平铺。
 *   值集为**声明形态**（长度/百分比/关键字）——真正的几何解析（pos% 减图尺寸、repeat 平铺相位）在宿主/snapshot 侧。
 *   size：单/双值（长度或百分比；auto）；position：1-2 个（关键字/长度/百分比）；repeat：关键字枚举。
 */
const BACKGROUND_REPEAT = ['repeat', 'no-repeat']
const isBgSize = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0 && /^(auto|\d*\.?\d+(px|%)?)(\s+(auto|\d*\.?\d+(px|%)?))?$/.test(v.trim())
const isBgPosition = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0 && /^(left|center|right|top|bottom|\d*\.?\d+(px|%)?)(\s+(left|center|right|top|bottom|\d*\.?\d+(px|%)?)){0,2}$/.test(v.trim())

export const PROP_TYPES = {
  Length: isLength,
  Color: isColor,
  Opacity: isOpacity,
  Integer: isInteger,
  FlexNumber: isFlexNumber,
  FlexAlign: isEnum(FLEX_ALIGN),
  FlexJustify: isEnum(FLEX_JUSTIFY),
  TextAlign: isEnum(TEXT_ALIGN),
  TextWrap: isEnum(TEXT_WRAP),
  BorderStyle: isEnum(BORDER_STYLE),
  Overflow: isEnum(OVERFLOW),
  JustifySelf: isEnum(JUSTIFY_SELF),
  // ★★★place-items/justify-items 项（2026-10-08）：网格容器内子项行内轴对齐（值集 = JustifySelf 去 auto）
  JustifyItems: isEnum(JUSTIFY_ITEMS),
  // ★★★line-clamp 项（2026-10-08）：多行截断行数（正整数）
  LineClamp: (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0,
  GridAutoFlow: isEnum(GRID_AUTO_FLOW),
  // ★★★outline 族项（2026-10-08）：轮廓宽度/偏移（长度，可负——偏移允许负值）
  OutlineWidth: isLength,
  OutlineOffset: (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && /^-?\d*\.?\d+(px|rpx|%)?$/.test(v.trim())),
  WordBreak: isEnum(WORD_BREAK),
  BackgroundSize: isBgSize,
  BackgroundPosition: isBgPosition,
  BackgroundRepeat: isEnum(BACKGROUND_REPEAT),
  Transform: (v: unknown): boolean => typeof v === 'string' && /^(translate|scale|rotate|skew)/i.test(v.trim()),
  TransformOrigin: (v: unknown): boolean => typeof v === 'string' && /^(left|right|top|bottom|center|\d+)/i.test(v.trim()),
} as const
