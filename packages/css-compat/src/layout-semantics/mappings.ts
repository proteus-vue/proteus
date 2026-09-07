// packages/css-compat/src/layout-semantics/mappings.ts
// ★css-compat G-21 B2 数据层：Style IR → 五端 Renderer 映射表（04-semantic-style-components.md + 05-five-end-mapping.md）
// 纯数据契约（L0，NAVIGATION_MAP / PLATFORM_LENGTH_RULES 同模式）——G-22 App Renderer 消费即插即用
// 渲染器消费（Web CSSOM / Skyline WXSS / App JSI 属性）待 G-22；本表先锁定映射语义
export type CssPlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

export const CSS_PLATFORMS: CssPlatform[] = ['web', 'skyline', 'ios', 'android', 'harmony']

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

/** 05 §二：布局容器映射（语义 → 五端原生实现） */
export type LayoutSemantic = 'flex-row' | 'flex-col' | 'stack' | 'grid' | 'scroll'

export const LAYOUT_SEMANTICS: LayoutSemantic[] = ['flex-row', 'flex-col', 'stack', 'grid', 'scroll']

export const LAYOUT_SEMANTICS_MAP: Record<LayoutSemantic, Record<CssPlatform, string>> = {
  'flex-row': {
    web: 'flex row',
    skyline: 'flex row',
    ios: 'UIStackView(axis:.horizontal)',
    android: 'ConstraintLayout chain / Row',
    harmony: 'Row()',
  },
  'flex-col': {
    web: 'flex col',
    skyline: 'flex col',
    ios: 'UIStackView(axis:.vertical)',
    android: 'LinearLayout vertical',
    harmony: 'Column()',
  },
  stack: {
    web: 'position:relative + absolute',
    skyline: 'Stack',
    ios: 'UIView + frame/constraints',
    android: 'FrameLayout / ConstraintLayout',
    harmony: 'Stack()',
  },
  grid: {
    web: 'grid',
    skyline: 'grid',
    ios: 'UICollectionView + compositional',
    android: 'GridLayoutManager',
    harmony: 'Grid()',
  },
  scroll: {
    web: 'overflow:auto',
    skyline: '<scroll-view>',
    ios: 'UIScrollView',
    android: 'RecyclerView / NestedScrollView',
    harmony: 'Scroll() / List()',
  },
}

/** 05 §四：视觉映射（background-color/opacity/color/backdrop-filter） */
export type VisualProperty = 'background-color' | 'opacity' | 'color' | 'backdrop-filter'

export const VISUAL_PROPERTIES: VisualProperty[] = ['background-color', 'opacity', 'color', 'backdrop-filter']

export const VISUAL_MAP: Record<VisualProperty, Record<CssPlatform, string>> = {
  'background-color': {
    web: 'background-color',
    skyline: 'background-color',
    ios: 'backgroundColor',
    android: 'background',
    harmony: 'backgroundColor',
  },
  opacity: {
    web: 'opacity',
    skyline: 'opacity',
    ios: 'alpha',
    android: 'alpha',
    harmony: 'opacity',
  },
  color: {
    web: 'color',
    skyline: 'color',
    ios: 'textColor',
    android: 'textColor',
    harmony: 'fontColor',
  },
  'backdrop-filter': {
    web: 'backdrop-filter',
    skyline: 'backdrop-filter',
    ios: 'UIGlassEffect',
    android: 'RenderEffect',
    harmony: 'effect:blur',
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
