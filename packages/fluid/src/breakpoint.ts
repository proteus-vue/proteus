// packages/fluid/src/breakpoint.ts
// ★Fluid System：容器级断点推导（响应式基准 = 容器而非视口——车机/多窗口/嵌入场景核心）
//   语义与 fluid-layout 的 deriveBreakpoints 同源（sm 0.5/md 0.875/lg 1.25/xl 1.625 × 设计稿宽度）；
//   独立实现（fluid 是运行时包，不依赖 build-tool compiler）
export interface FluidBreakpoint {
  name: string
  min: number
}

export const DEFAULT_BREAKPOINT_RATIOS: Array<{ name: string; ratio: number }> = [
  { name: 'sm', ratio: 0.5 },
  { name: 'md', ratio: 0.875 },
  { name: 'lg', ratio: 1.25 },
  { name: 'xl', ratio: 1.625 },
]

/** 断点推导：设计稿宽度 × 比例（四舍五入；与 fluid-layout deriveBreakpoints 同输出） */
export function deriveContainerBreakpoints(
  designWidth: number,
  ratios: Array<{ name: string; ratio: number }> = DEFAULT_BREAKPOINT_RATIOS,
): FluidBreakpoint[] {
  return ratios.map((r) => ({ name: r.name, min: Math.round(designWidth * r.ratio) }))
}

/** 容器宽度 → 断点名（从大到小找第一个 width >= min；都不满足 → 最小断点） */
export function resolveBreakpoint(width: number, breakpoints: FluidBreakpoint[]): string {
  let fallback = breakpoints.length ? (breakpoints[0] as FluidBreakpoint).name : 'sm'
  for (let i = breakpoints.length - 1; i >= 0; i--) {
    const bp = breakpoints[i] as FluidBreakpoint
    if (width >= bp.min) return bp.name
    fallback = bp.name
  }
  return fallback
}
