// packages/glass/src/types.ts
// ★G-07（proteus-glass-plan 02-architecture + 08-degradation + 09-presets）：液态玻璃横切能力公共类型
//   收口契约：GlassProps / GlassPreset / GlassLevel / ResolvedGlass——各端 Backend 只消费这些，不各自解释 props
//   （铁律 #9 跨层一致性：GlassProps / GlassLevel 为唯一事实源）

/** 可达层级（L1-L3 由玻璃能力矩阵定义；solid/flat 为降级终态） */
export type GlassLevel = 'l3' | 'l2' | 'l1' | 'solid' | 'flat'

/** 模糊强度档位（对应 iOS UIBlurEffect 语义；custom 走 number） */
export type GlassIntensity = 'none' | 'thin' | 'regular' | 'thick' | 'ultra'

/** 有名字的 preset（09-presets 预设表） */
export type GlassPresetName =
  | 'navigationBar'
  | 'tabBar'
  | 'modal'
  | 'card'
  | 'floating'
  | 'sidebar'
  | 'custom'

/** 边框朝向（preset 决定细边落在哪一侧；'all' = 四边） */
export type GlassBorderSide = 'all' | 'bottom' | 'top' | 'right'

/** 降级策略：solid = 半透明实色；flat = 无背景仅边框 */
export type GlassFallback = 'solid' | 'flat'

/** 单一事实源的 props（组件的 defineProps 与 resolveGlass 共用形状） */
export interface GlassProps {
  /** 预设名（默认 'custom'） */
  preset?: GlassPresetName
  /** 强度档位或自定义缩放（>1 更厚，<1 更薄） */
  intensity?: GlassIntensity | number
  /** 着色覆盖（空 = 用 preset 默认 tint） */
  tint?: string
  /** 圆角 px（0 = 用 preset 默认） */
  radius?: number
  /** 是否渲染边框/高光边 */
  border?: boolean
  /** 噪点强度 0-1（0 = 关闭；仅 L2 生效） */
  noise?: number
  /** 降级策略（能力不足时呈现方式） */
  fallback?: GlassFallback
  /** ★★★决策 #900：材质选择（自绘 GPU 材质 id）。缺省/未知 ⇒ 'glass'（真折射）。 */
  material?: GlassMaterialId
  /** ★★★决策 #905：触控形变流动（对齐 Apple `UIGlassEffect.isInteractive`）——点按/拖动时玻璃
   *   在触点处产生液态流动，松手回弹。缺省 = 用预设（仅 floating 预设为 true）。 */
  interactive?: boolean
}

/** ★#900：材质 id（与 `@proteus-vue/shader` 材质目录同源——宿主按 id 派发管线）。 */
export type GlassMaterialId = 'glass' | 'backdropBlur' | 'frosted' | 'vibrancy'

/** 预设定义（09-presets：一组经验证的最佳参数组合） */
export interface GlassPreset {
  /** 基础模糊半径 px（intensity 缩放前） */
  blur: number
  /** 默认强度档位 */
  intensity: GlassIntensity
  /** 默认着色（rgba 字符串） */
  tint: string
  /** 默认圆角 px */
  radius: number
  /** 是否含边框 */
  border: boolean
  /** 边框朝向（缺省 'all'） */
  borderSide?: GlassBorderSide
  /** 默认噪点强度 0-1 */
  noise: number
  /** 是否响应滚动/手势形变（L2，Skyline worklet / 原生） */
  interactive?: boolean
  /** 降级实色（无 backdrop-filter 时）——缺省按 tint 提亮 */
  solid?: string
}

/** 解析结果（preset + props 归一后的确定值——渲染层直接消费） */
export interface ResolvedGlass {
  preset: GlassPresetName
  /** 强度档位（显式档位归一后） */
  intensity: GlassIntensity
  /** intensity 缩放后的模糊半径 px */
  blurPx: number
  /** 最终着色 */
  tint: string
  /** 最终圆角 px（0 = 直角） */
  radiusPx: number
  /** 是否含边框 */
  border: boolean
  /** 边框朝向 */
  borderSide: GlassBorderSide
  /** 噪点强度 */
  noise: number
  /** 是否响应形变（L2 · ★#905：触控时玻璃液态流动；缺省随预设） */
  interactive: boolean
  /** 降级实色 */
  solid: string
  /** 降级策略 */
  fallback: GlassFallback
  /** ★#900：材质 id（宿主按此派发 GPU 管线） */
  material: GlassMaterialId
}
