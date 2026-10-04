// packages/css-compat/src/layout-semantics/mappings.ts
// ★css-compat G-21 B2 数据层：Style IR → **三端** Renderer 映射表（04-semantic-style-components.md + 05-five-end-mapping.md）
// 纯数据契约（L0，NAVIGATION_MAP / PLATFORM_LENGTH_RULES 同模式）。
// ★★2026-10-04 重构：**五端 → 三端**。App 端已是**自研自绘 Rust 引擎**（一套，覆盖 iOS/Android/鸿蒙
//   三具体平台）⇒ 旧的 iOS=UIStackView / Android=ConstraintLayout / 鸿蒙=Row 三列（非自绘时代的原生
//   组件映射）在自绘模型下已失效，合并为一个 **App** 端。三端 = Web（浏览器 CSS）/ Skyline（微信容器
//   CSS，唯一刚性外部约束）/ App（自研引擎，taffy flex + 自绘）。
// ★「平台适配」是另一条轴（密度单位 / 原生组件 / 安全区 / 导航）——那仍是具体平台维度，不在本表。
export type CssPlatform = 'web' | 'skyline' | 'app'

export const CSS_PLATFORMS: CssPlatform[] = ['web', 'skyline', 'app']

/** 04 §一：语义样式组件清单（一个语义组件 = 一个跨端能力；业务层零平台分支） */
export interface SemanticComponentSpec {
  tag: string
  /** 设计语义 props（blur/elevation/preset——非平台术语，04 §二 原则 2） */
  props: string[]
  /** 跨端能力描述 */
  capability: string
}

export const SEMANTIC_COMPONENTS: SemanticComponentSpec[] = [
  { tag: 'p-glass', props: ['preset', 'blur'], capability: '背景模糊（Glass L3）' },
  { tag: 'p-sticky', props: ['offset'], capability: '吸顶' },
  { tag: 'p-scroll', props: ['direction', 'bounces'], capability: '滚动容器' },
  { tag: 'p-shadow', props: ['elevation', 'color'], capability: '阴影' },
  { tag: 'p-bg-gradient', props: ['direction', 'stops'], capability: '渐变' },
  { tag: 'p-safe-area', props: ['edges'], capability: '安全区' },
]

/** 05 §二：布局容器映射（语义 → 三端实现）。★App = 自绘引擎（taffy flex），不再按 iOS/Android/鸿蒙 分列。 */
export type LayoutSemantic = 'flex-row' | 'flex-col' | 'stack' | 'grid' | 'scroll'

export const LAYOUT_SEMANTICS: LayoutSemantic[] = ['flex-row', 'flex-col', 'stack', 'grid', 'scroll']

export const LAYOUT_SEMANTICS_MAP: Record<LayoutSemantic, Record<CssPlatform, string>> = {
  'flex-row': {
    web: 'flex row',
    skyline: 'flex row',
    app: 'taffy flex row（内核）',
  },
  'flex-col': {
    web: 'flex col',
    skyline: 'flex col',
    app: 'taffy flex column（内核）',
  },
  stack: {
    web: 'position:relative + absolute',
    skyline: 'Stack',
    app: 'absolute 子节点（内核 position）',
  },
  grid: {
    // ★grid：引擎 taffy 有完整 Grid 能力但 Display 枚举未接（见 css-capability-alignment 的 App 可扩展档位 L2）
    web: 'grid',
    skyline: 'grid',
    app: '待接（taffy Grid 已有；引擎 Display 未开放 —— 可扩展 L2）',
  },
  scroll: {
    web: 'overflow:auto',
    skyline: '<scroll-view>',
    app: 'overflow:scroll（内核）+ <p-scroll> 语义容器',
  },
}

/** 05 §四：视觉映射（background-color/opacity/color/backdrop-filter） */
export type VisualProperty = 'background-color' | 'opacity' | 'color' | 'backdrop-filter'

export const VISUAL_PROPERTIES: VisualProperty[] = ['background-color', 'opacity', 'color', 'backdrop-filter']

export const VISUAL_MAP: Record<VisualProperty, Record<CssPlatform, string>> = {
  'background-color': {
    web: 'background-color',
    skyline: 'background-color',
    app: '引擎 backgroundColor 通道',
  },
  opacity: {
    web: 'opacity',
    skyline: 'opacity',
    app: '引擎 opacity（叶子节点）',
  },
  color: {
    web: 'color',
    skyline: 'color',
    app: '引擎 textColor 通道',
  },
  'backdrop-filter': {
    web: 'backdrop-filter',
    skyline: 'backdrop-filter',
    // ★App 自绘引擎无 backdrop-filter；走 <p-glass> 语义组件（组件内部复用各平台原生玻璃）
    app: '<p-glass> 语义组件（非裸属性）',
  },
}

/** 05 §五：Skyline 专项（小程序端 CSS 子集矩阵——选 Skyline 换原生渲染的约束清单） */
export const SKYLINE_CSS_SUPPORT: {
  supported: string[]
  unsupported: string[]
  partial: string[]
} = {
  supported: ['border-box/content-box', 'linear-gradient', 'backdrop-filter', ':active', ':first-child', ':nth-child'],
  unsupported: ['通用选择器', '属性选择器', 'float', 'inline（除 text 嵌套）', '裸 overflow:scroll'],
  partial: ['z-index 仅兄弟节点生效（无层叠上下文）', 'transform 仅 translate/scale', ':hover 有限'],
}

/** 06 端差异收敛：业务层禁平台分支（if platform === ios 反模式）；差异内聚 Renderer */
export const CONVERGENCE_RULE = '业务代码禁止平台分支处理样式差异；统一入口 = 语义组件 + Compiler 映射表'
