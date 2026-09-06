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
  /** CSS aspect-ratio（宽高比盒——p-aspect 原生支撑；不支持 → padding-top hack 降级） */
  aspectRatio: boolean
}

/** CSS.supports 结构类型（(property, value) 双参；浏览器全局或注入 fake） */
export type FluidSupportsFn = (property: string, value: string) => boolean

/** 无探测能力时的缺省：假设全支持（WebView/SSR——渲染端自决降级，不在逻辑层误判） */
const ALL_SUPPORTED: FluidCapabilities = { clamp: true, grid: true, containerQuery: true, flexGap: true, aspectRatio: true }

/** Skyline 渲染端判定（★#495c）：小程序自研引擎仅 flex/block 子集——grid/columns/container-query/aspect-ratio 不支持；
 *  CSS.supports 只在浏览器存在，逻辑层必须显式判 Skyline（否则恒全真 → 组件输 grid style 被渲染端忽略 = 布局丢失） */
function skylineRenderer(): boolean {
  const g = globalThis as { wx?: { getSystemInfoSync?: () => { renderer?: string } } }
  const wxApi = g.wx
  if (!wxApi || typeof wxApi.getSystemInfoSync !== 'function') return false
  try {
    return wxApi.getSystemInfoSync().renderer === 'skyline'
  } catch {
    return false
  }
}

/** Skyline 能力集（自研引擎子集——flex/gap/px 可用；grid/columns 布局与 aspect-ratio/container 不可用） */
const SKYLINE_SUPPORTED: FluidCapabilities = { clamp: true, grid: false, containerQuery: false, flexGap: true, aspectRatio: false }

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
 * 检测目标环境柔性能力（clamp / grid(auto-fit) / containerQuery / flexGap / aspectRatio）
 * - 传入 supports（测试注入 fake）优先；否则读全局 CSS.supports
 * - 无 CSS.supports：Skyline 渲染端显式判（★#495c grid/aspect/container 不可用）；WebView/SSR 假设全支持
 */
export function detectFluidCapabilities(supports?: FluidSupportsFn | null): FluidCapabilities {
  const fn: FluidSupportsFn | null = typeof supports === 'function' ? supports : globalSupports()
  if (!fn) return skylineRenderer() ? SKYLINE_SUPPORTED : ALL_SUPPORTED
  return {
    clamp: probe(fn, 'width', 'clamp(1px, 1vw, 10px)'),
    grid: probe(fn, 'display', 'grid') && probe(fn, 'grid-template-columns', 'repeat(auto-fit, minmax(1px, 1fr))'),
    containerQuery: probe(fn, 'container-type', 'inline-size'),
    flexGap: probe(fn, 'gap', '1px'),
    aspectRatio: probe(fn, 'aspect-ratio', '1 / 1'),
  }
}
