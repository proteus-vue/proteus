// packages/fluid/src/capabilities.ts
// ★Fluid System（essence 02 §4 降级策略）：柔性能力检测——Web 端 CSS.supports 探测各能力，组件层据此降级
//   注入可单测；无 CSS.supports（MP 逻辑层 / SSR / 旧内核）→ 假设全支持（渲染端自决降级，铁律 G-22.2「朴素但正确」）
export interface FluidCapabilities {
  /** CSS clamp() 数值区间（流式尺寸下限/上限） */
  clamp: boolean
  /** CSS Grid repeat(auto-fit, minmax(...)) 自适应网格（auto-fill/auto-fit 同源） */
  grid: boolean
  /** Container Queries（@container 容器查询——车机/多窗口按容器而非视口） */
  containerQuery: boolean
  /** Flex gap（弹性布局子项间距） */
  flexGap: boolean
}

/** CSS.supports 结构类型（(property, value) 双参；浏览器全局或注入 fake） */
export type FluidSupportsFn = (property: string, value: string) => boolean

/** 无探测能力时的缺省：假设全支持（MP/SSR 渲染端自决降级，不在逻辑层误判） */
const ALL_SUPPORTED: FluidCapabilities = { clamp: true, grid: true, containerQuery: true, flexGap: true }

function probe(fn: FluidSupportsFn, property: string, value: string): boolean {
  try {
    return fn(property, value) === true
  } catch {
    return false
  }
}

function globalSupports(): FluidSupportsFn | null {
  const g = globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }
  const css = g.CSS
  if (!css || typeof css.supports !== 'function') return null
  const supports = css.supports
  return (property: string, value: string): boolean => supports(property, value)
}

/**
 * 检测目标环境柔性能力（clamp / grid(auto-fit) / containerQuery / flexGap）
 * - 传入 supports（测试注入 fake）优先；否则读全局 CSS.supports
 * - 无 CSS.supports → 全支持（Web 端才有探测条件；MP/SSR 渲染端自决降级）
 */
export function detectFluidCapabilities(supports?: FluidSupportsFn | null): FluidCapabilities {
  const fn: FluidSupportsFn | null = typeof supports === 'function' ? supports : globalSupports()
  if (!fn) return ALL_SUPPORTED
  return {
    clamp: probe(fn, 'width', 'clamp(1px, 1vw, 10px)'),
    grid: probe(fn, 'display', 'grid') && probe(fn, 'grid-template-columns', 'repeat(auto-fit, minmax(1px, 1fr))'),
    containerQuery: probe(fn, 'container-type', 'inline-size'),
    flexGap: probe(fn, 'gap', '1px'),
  }
}
