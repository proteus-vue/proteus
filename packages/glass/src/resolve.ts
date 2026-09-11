// packages/glass/src/resolve.ts
// ★G-07（proteus-glass-plan 02-architecture「映射决议流程」）：props → 归一解析（纯函数，无平台依赖）
//   preset 缺省值 + props 覆盖 → ResolvedGlass（渲染层/Backend 直接消费）；此层不含平台判断（降级在 degrade.ts）
import type { GlassIntensity, GlassPresetName, GlassProps, ResolvedGlass } from './types'
import { GLASS_INTENSITY_SCALE, getGlassPreset, hasGlassPreset } from './presets'

const INTENSITY_NAMES: GlassIntensity[] = ['none', 'thin', 'regular', 'thick', 'ultra']

/** intensity 输入 → 缩放系数（档位查表 / 数字直接用；非法回退 1） */
export function intensityScale(intensity: GlassProps['intensity']): number {
  if (typeof intensity === 'number') return Number.isFinite(intensity) && intensity >= 0 ? intensity : 1
  if (intensity && intensity in GLASS_INTENSITY_SCALE) return GLASS_INTENSITY_SCALE[intensity]
  return 1
}

/** intensity 输入 → 归一档位（数字取最接近档；用于产出 class） */
export function normalizeIntensity(intensity: GlassProps['intensity']): GlassIntensity {
  if (typeof intensity === 'string' && INTENSITY_NAMES.includes(intensity)) return intensity
  if (typeof intensity === 'number' && Number.isFinite(intensity)) {
    if (intensity <= 0) return 'none'
    if (intensity < 0.8) return 'thin'
    if (intensity <= 1.2) return 'regular'
    if (intensity <= 1.6) return 'thick'
    return 'ultra'
  }
  return 'regular'
}

/**
 * 归一解析：preset 为底 + props 显式覆盖 → ResolvedGlass。
 * 覆盖规则：props 给值即覆盖 preset（tint 非空 / radius>0 / noise 非 undefined）；预设名未知名回退 custom。
 */
export function resolveGlass(props: GlassProps = {}): ResolvedGlass {
  const presetName: GlassPresetName = props.preset && hasGlassPreset(props.preset) ? (props.preset as GlassPresetName) : 'custom'
  const preset = getGlassPreset(presetName)
  const scale = intensityScale(props.intensity ?? preset.intensity)
  const normIntensity = normalizeIntensity(props.intensity ?? preset.intensity)
  const blurPx = Math.max(0, Math.round(preset.blur * scale))
  const tint = props.tint && props.tint.length > 0 ? props.tint : preset.tint
  const radiusPx = props.radius && props.radius > 0 ? props.radius : preset.radius
  const noise = props.noise !== undefined ? clamp01(props.noise) : preset.noise
  const solid = preset.solid ?? deriveSolid(tint)

  return {
    preset: presetName,
    intensity: normIntensity,
    blurPx,
    tint,
    radiusPx,
    border: props.border !== undefined ? Boolean(props.border) : preset.border,
    borderSide: preset.borderSide ?? 'all',
    noise,
    interactive: Boolean(preset.interactive),
    solid,
    fallback: props.fallback === 'flat' ? 'flat' : 'solid',
  }
}

/** 由 tint 推导降级实色（提亮 + 提高不透明度——保证不白屏/不黑块，铁律 3） */
function deriveSolid(tint: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(tint)
  if (m) {
    const [, r, g, b] = m
    return `rgba(${r}, ${g}, ${b}, 0.92)`
  }
  return 'rgba(18, 18, 22, 0.92)'
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
