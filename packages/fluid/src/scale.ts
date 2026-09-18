// packages/fluid/src/scale.ts
// ★Fluid System S4（无障碍）：动态字号级别 + 密度语义——把系统字号缩放/密度偏好收敛进框架（essence 原则 #10）
//   字号：level 0-3（小/标准/大/特大）→ 倍率，叠加宿主注入的全局字号缩放 var(--proteus-font-scale)
//   密度：compact / regular / comfortable → 行高 + 子项间距 token（--proteus-density-gap）
//   纯逻辑（组件 p-scale 薄壳引用；字符串级断言可单测）
export type FluidDensity = 'compact' | 'regular' | 'comfortable'

/** 字号级别表：level → 倍率（0 小 0.875 / 1 标准 1 / 2 大 1.125 / 3 特大 1.25——无障碍档位） */
export const SCALE_LEVELS: Array<{ level: number; ratio: number }> = [
  { level: 0, ratio: 0.875 },
  { level: 1, ratio: 1 },
  { level: 2, ratio: 1.125 },
  { level: 3, ratio: 1.25 },
]

/** 级别 → 倍率（level ≥ 表内最高档 → 最大倍率；≤ 0 → 0.875；缺省 1） */
export function resolveScaleRatio(level: number): number {
  const n = typeof level === 'number' && level > 0 ? level : 0
  for (let i = SCALE_LEVELS.length - 1; i >= 0; i--) {
    const s = SCALE_LEVELS[i] as { level: number; ratio: number }
    if (n >= s.level) return s.ratio
  }
  return 1
}

/** 密度 → 行高 + 子项间距（gap px） */
export function resolveDensity(density: FluidDensity): { lineHeight: number; gap: number } {
  if (density === 'compact') return { lineHeight: 1.4, gap: 8 }
  if (density === 'comfortable') return { lineHeight: 1.8, gap: 16 }
  return { lineHeight: 1.6, gap: 12 }
}

export interface ScaleStyleOptions {
  /** 字号级别（0-3） */
  level?: number
  /** 密度（compact/regular/comfortable） */
  density?: FluidDensity
  /** 基准字号（px；缺省 16）——子项用 em 继承即随缩放 */
  baseSize?: number
}

/**
 * 构建 p-scale 容器样式：fontSize = base × 级别倍率 × 全局字号缩放（var(--proteus-font-scale, 1) 宿主/系统注入）；
 * lineHeight + --proteus-density-gap 按密度
 */
export function buildScaleStyle(options: ScaleStyleOptions = {}): Record<string, string> {
  const baseSize = typeof options.baseSize === 'number' && options.baseSize > 0 ? options.baseSize : 16
  const ratio = resolveScaleRatio(options.level ?? 1)
  const density = resolveDensity(options.density ?? 'regular')
  return {
    fontSize: 'calc(' + baseSize + 'px * ' + ratio + ' * var(--proteus-font-scale, 1))',
    lineHeight: String(density.lineHeight),
    '--proteus-density-gap': density.gap + 'px',
  }
}
