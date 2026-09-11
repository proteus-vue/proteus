// packages/glass/src/presets.ts
// ★G-07（proteus-glass-plan 09-presets）：预设表唯一事实源——业务优先用 preset，避免手调
//   参数口径（§09）：navigationBar/tabBar 直角 + 单侧细边；modal 大圆角；card thin；floating thick + 噪点
import type { GlassPreset, GlassPresetName } from './types'

/** 七内置预设（与 09-presets.md 预设表逐条对齐） */
export const GLASS_PRESETS: Record<GlassPresetName, GlassPreset> = {
  navigationBar: { blur: 20, intensity: 'regular', tint: 'rgba(255, 255, 255, 0.15)', radius: 0, border: true, borderSide: 'bottom', noise: 0, solid: 'rgba(18, 18, 22, 0.92)' },
  tabBar: { blur: 20, intensity: 'regular', tint: 'rgba(255, 255, 255, 0.15)', radius: 0, border: true, borderSide: 'top', noise: 0, solid: 'rgba(18, 18, 22, 0.92)' },
  modal: { blur: 24, intensity: 'regular', tint: 'rgba(255, 255, 255, 0.15)', radius: 24, border: true, borderSide: 'all', noise: 0.04, solid: 'rgba(24, 24, 30, 0.96)' },
  card: { blur: 16, intensity: 'thin', tint: 'rgba(255, 255, 255, 0.08)', radius: 16, border: true, borderSide: 'all', noise: 0.03, solid: 'rgba(20, 20, 26, 0.94)' },
  floating: { blur: 28, intensity: 'thick', tint: 'rgba(255, 255, 255, 0.18)', radius: 20, border: true, borderSide: 'all', noise: 0.05, interactive: true, solid: 'rgba(28, 28, 36, 0.96)' },
  sidebar: { blur: 20, intensity: 'regular', tint: 'rgba(255, 255, 255, 0.12)', radius: 0, border: true, borderSide: 'right', noise: 0, solid: 'rgba(18, 18, 22, 0.92)' },
  custom: { blur: 20, intensity: 'regular', tint: 'rgba(255, 255, 255, 0.12)', radius: 0, border: true, borderSide: 'all', noise: 0, solid: 'rgba(18, 18, 22, 0.92)' },
}

/** 强度缩放（thin 更薄 / thick·ultra 更厚；none = 0 模糊） */
export const GLASS_INTENSITY_SCALE: Record<string, number> = { none: 0, thin: 0.6, regular: 1, thick: 1.4, ultra: 1.8 }

/** 全部预设名（供校验/审计遍历） */
export const GLASS_PRESET_NAMES: GlassPresetName[] = ['navigationBar', 'tabBar', 'modal', 'card', 'floating', 'sidebar', 'custom']

/** 业务可注册的自定义 preset（09-presets「预设扩展」）——运行期登记，不入内置表 */
const customPresets = new Map<string, GlassPreset>()

/**
 * 注册自定义 preset（业务如需品牌玻璃）。
 * @returns 归一化后的 preset 定义（供链式使用）
 */
export function defineGlassPreset(name: string, preset: GlassPreset): GlassPreset {
  if (!name) throw new Error('[proteus-glass] defineGlassPreset 需要非空 name')
  const norm: GlassPreset = {
    blur: Number.isFinite(preset.blur) ? preset.blur : 20,
    intensity: preset.intensity ?? 'regular',
    tint: preset.tint ?? 'rgba(255, 255, 255, 0.12)',
    radius: Number.isFinite(preset.radius) ? preset.radius : 0,
    border: preset.border ?? true,
    borderSide: preset.borderSide ?? 'all',
    noise: clamp01(preset.noise ?? 0),
    interactive: Boolean(preset.interactive),
    solid: preset.solid,
  }
  customPresets.set(name, norm)
  return norm
}

/** 取预设（内置优先；未知名回退 custom） */
export function getGlassPreset(name: string | undefined): GlassPreset {
  if (name && name in GLASS_PRESETS) return GLASS_PRESETS[name as GlassPresetName]
  if (name && customPresets.has(name)) return customPresets.get(name) as GlassPreset
  return GLASS_PRESETS.custom
}

/** 是否为已登记 preset（内置或自定义） */
export function hasGlassPreset(name: string): boolean {
  return name in GLASS_PRESETS || customPresets.has(name)
}

/** 测试/隔离用：清空自定义 preset 登记 */
export function resetCustomPresets(): void {
  customPresets.clear()
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
