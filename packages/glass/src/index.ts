// packages/glass/src/index.ts
// @proteus-vue/glass —— ★G-07 液态玻璃横切能力（proteus-glass-plan）：纯逻辑 SSOT，零依赖
//   单入口铁律：业务只写 <pg-glass>（src/components/pg-glass），禁止平台分支/裸 backdrop-filter 散落（GLS001-006）
//   本包提供：preset 表 + props 归一解析 + 三级降级决策 + 能力矩阵——渲染层（pg-glass 组件 / 各端 Backend）消费这些，
//   不各自解释 props（铁律 #9 跨层一致性）。
export type {
  GlassProps,
  GlassPreset,
  GlassPresetName,
  GlassIntensity,
  GlassBorderSide,
  GlassFallback,
  GlassLevel,
  ResolvedGlass,
} from './types'

export {
  GLASS_PRESETS,
  GLASS_PRESET_NAMES,
  GLASS_INTENSITY_SCALE,
  defineGlassPreset,
  getGlassPreset,
  hasGlassPreset,
  resetCustomPresets,
} from './presets'

export { resolveGlass, intensityScale, normalizeIntensity } from './resolve'

export {
  resolveGlassLevel,
  glassStyleFor,
  glassClassList,
  showsDecoration,
} from './degrade'
export type { GlassEnv } from './degrade'

export { GLASS_CAPABILITY, GLASS_L1_MANDATORY, GLASS_DEGRADE_CHAIN, glassCeilingFor } from './capability'
export type { GlassPlatform, GlassPlatformGate } from './platforms'
export { platformSupportsSystemMaterial, isNativePlatform } from './platforms'
