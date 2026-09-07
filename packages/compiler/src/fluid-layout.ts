// src/compiler/fluid-layout.ts
// ★G-22 柔性布局（fluid-layout-plan B1）：三个纯算法——流式 clamp 生成 / 断点推导 / 网格列数求解
//   零依赖纯函数（Web/Skyline 编译期生成 CSS；App 端由原生布局引擎求解——B4/B5 延后）
//   ★注意：clamp 公式以设计稿宽度为插值起点（与 02-compiler-implementation.md 的 minVw 写法有出入，
//   以 01-fluid-layout.md「已验证」输出为准：slope=(max-min)/(maxVw-designWidth)，intercept=min-slope*designWidth）

export interface Breakpoint {
  name: string
  min: number
}

export interface FluidGroup {
  prop: string
  min: number
  max: number
}

export interface ViewportRange {
  min: number
  max: number
}

/** 默认视口区间 [320, 1440]（01 §4.1） */
export const DEFAULT_VIEWPORT_RANGE: ViewportRange = { min: 320, max: 1440 }

/** 默认断点比例（sm/md/lg/xl × 设计稿宽度；01 §4.2） */
export const DEFAULT_BREAKPOINT_RATIOS: Array<{ name: string; ratio: number }> = [
  { name: 'sm', ratio: 0.5 },
  { name: 'md', ratio: 0.875 },
  { name: 'lg', ratio: 1.25 },
  { name: 'xl', ratio: 1.625 },
]

/**
 * 流式尺寸线性段（calc + vw）：设计稿宽度处 = min，视口 maxVw 处 = max，中间线性插值
 * ★#496 M3 Skyline：无 clamp/min/max（官方表），MP 共用产物（Skyline/WebView 同一 wxml）→ p-fluid 用线性 calc，
 *   vw 天然随窗口流式、零运行时；clamp 边界夹取在真实 CSS 引擎才有意义（<minVw/>maxVw 屏 ±1-2px，小程序宽度域可忽略）。
 *   例：linearFluid(20, 32, 375) → "calc(15.77px + 1.1268vw)"
 */
export function linearFluid(min: number, max: number, designWidth: number, viewportRange: ViewportRange = DEFAULT_VIEWPORT_RANGE): string {
  const range = viewportRange.max - designWidth
  const slope = range > 0 ? (max - min) / range : 0
  const intercept = min - slope * designWidth
  return `calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw)`
}

/**
 * 流式尺寸 clamp 生成（Web 真实 CSS 引擎用——clamp 夹取；MP 模板产物用 linearFluid，#496 M3）
 * 例：generateClamp(20, 32, 375, [320, 1440])
 *   slope = (32-20)/(1440-375) = 0.011268；intercept = 20 - 0.011268*375 = 15.77
 *   → "clamp(20px, calc(15.77px + 1.1268vw), 32px)"
 */
export function generateClamp(min: number, max: number, designWidth: number, viewportRange: ViewportRange = DEFAULT_VIEWPORT_RANGE): string {
  return `clamp(${min}px, ${linearFluid(min, max, designWidth, viewportRange)}, ${max}px)`
}

/** 断点推导：设计稿宽度 × 比例 → sm/md/lg/xl（四舍五入） */
export function deriveBreakpoints(designWidth: number, ratios: Array<{ name: string; ratio: number }> = DEFAULT_BREAKPOINT_RATIOS): Breakpoint[] {
  return ratios.map((r) => ({ name: r.name, min: Math.round(designWidth * r.ratio) }))
}

/** 网格列数求解：minmax 语义（每列至少 minColWidth，间隙 gap） */
export function calcColumns(viewportWidth: number, minColWidth: number, gap: number): number {
  const per = minColWidth + gap
  return Math.max(1, Math.floor((viewportWidth + gap) / per))
}

/** 解析 p-fluid 表达式（prop(min,max) 空格分隔组；★CLI fluid:check 与模板规则共用——非法组忽略，FLD003 由调用方判定） */
export function parseFluidExpr(expr: string): FluidGroup[] {
  const out: FluidGroup[] = []
  const re = /([A-Za-z][A-Za-z-]*)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expr))) {
    out.push({ prop: m[1], min: Number(m[2]), max: Number(m[3]) })
  }
  return out
}

/** Web 端 p-grid 的 CSS Grid 模板（repeat(auto-fill, minmax(minColWidth, 1fr))） */
export function gridTemplate(minColWidth: number): string {
  return `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`
}
