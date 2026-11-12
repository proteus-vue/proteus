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
  /** 数值下界（仅当 minRaw 是纯数字时有意义；否则为 0） */
  min: number
  /** 数值上界（仅当 maxRaw 是纯数字时有意义；否则为 0） */
  max: number
  /** 原始实参文本（`16` / `var(--sp-4)` / `50%` / `auto`）——非纯数字时原样透传 */
  minRaw?: string
  maxRaw?: string
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
 * ★2026-11-12（F-40）修正上述判断：**"±1-2px 可忽略" 是错的前提**。实测：
 *   1600 宽 → 33.8px（应 32，超 1.8px）；designWidth=1280 时 390 宽 → **-46.8px（负字号）**。
 *   故 MP 产物改用 clamp（见 fluidDecl）；本函数保留为「纯线性段」供调用方自行包 clamp。
 */
export function linearFluid(min: number, max: number, designWidth: number, viewportRange: ViewportRange = DEFAULT_VIEWPORT_RANGE): string {
  const range = viewportRange.max - designWidth
  const slope = range > 0 ? (max - min) / range : 0
  const intercept = min - slope * designWidth
  return `calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw)`
}

/** 实参是否为纯数字（可插值） */
const NUMERIC_ARG = /^-?\d+(?:\.\d+)?$/

/**
 * 生成一条 p-fluid 声明（prop: 值）。
 *
 * ★2026-11-12（F-39/F-40）：这是 p-fluid 的**唯一出口**，三件事在这里收口：
 *  ① **非纯数字实参原样透传**（`var(--sp-4)` / `50%` / `auto`）——
 *     原先 `parseFluidExpr` 直接不匹配 ⇒ 整组被丢弃且**无告警**，柔性布局与 token 体系无法共存。
 *     透传是正确语义：这些值本就随容器/主题变化，不需要线性插值。
 *  ② **纯数字用 clamp 包住**（不是裸 calc）——
 *     裸 calc 在 viewportMax 之外不夹取（1600 宽 33.8px 应 32），
 *     designWidth 大于实际端时还会外推出负值（390 宽 -46.8px）。
 *  ③ min/max 任一非数字时**两端都不插值**（原样输出）——混写（`16, var(--x)`）无法定义线性段，
 *     强行插值等于猜；原样透传是诚实降级。
 */
export function fluidDecl (g: FluidGroup, designWidth: number, viewportRange: ViewportRange = DEFAULT_VIEWPORT_RANGE): string {
  const minRaw = g.minRaw ?? String(g.min)
  const maxRaw = g.maxRaw ?? String(g.max)
  // ★单实参（minRaw === maxRaw，如 `font-size(20)` / `padding(var(--sp-4))`）⇒ 原样透传，不做插值。
  //   没有区间就没有流式可言；旧实现会退化成 clamp(20px, calc(20px+0vw), 20px) 这种无意义产物。
  if (minRaw === maxRaw) return `${g.prop}: ${minRaw}`
  if (!NUMERIC_ARG.test(minRaw) || !NUMERIC_ARG.test(maxRaw)) {
    // 非纯数字：原样透传（取 min 侧；两侧都写时按 CSS 语义后者覆盖，这里取 min 更符合「至少这个值」直觉）
    const value = !NUMERIC_ARG.test(minRaw) ? minRaw : maxRaw
    return `${g.prop}: ${value}`
  }
  const min = Number(minRaw)
  const max = Number(maxRaw)
  // ★clamp 下界用 min、上界用 max；中间线性段由 linearFluid 给
  return `${g.prop}: clamp(${min}px, ${linearFluid(min, max, designWidth, viewportRange)}, ${max}px)`
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

/**
 * 解析 p-fluid 表达式（`prop(min,max)` 空格分隔组）。
 * ★CLI fluid:check 与模板规则共用（非法组忽略，FLD003 由调用方判定）。
 *
 * ★2026-11-12 重写（F-39）：原正则 `([A-Za-z][A-Za-z-]*)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)`
 *   只接受**两个纯数字**，于是 `var(--sp-4)` / `50%` / `auto` 这类实参整组不匹配、被静默丢弃
 *   （产物无 style、无告警）⇒ 柔性布局与 CSS 变量 token 体系二选一。
 *
 * 现在的实参语法（每个实参 = 数字 | 单位值 | 函数 | 关键字）：
 *   `font-size(20, 32)`             两个实参：线性段
 *   `padding(var(--sp-4))`          一个实参：原样透传
 *   `width(50%, 100%)`              两个单位值：原样透传
 *   `margin(0, auto)`               数字 + 关键字：原样透传
 * 括号配平由扫描器保证（`var(--x)` 内层括号不会截断）。
 */
export function parseFluidExpr(expr: string): FluidGroup[] {
  const out: FluidGroup[] = []
  const src = String(expr ?? '')
  let i = 0
  while (i < src.length) {
    // ① 属性名（CSS 属性：字母开头，允许 - 与数字）
    const nameStart = i
    while (i < src.length && /[A-Za-z-]/.test(src[i])) i++
    const prop = src.slice(nameStart, i)
    if (!prop) {
      i++
      continue
    }
    // ② 必须紧跟左括号（否则不是 p-fluid 组，跳过该词）
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] !== '(') continue
    i++
    // ③ 配平扫描到匹配的右括号（支持 var()/calc() 嵌套）
    const argStart = i
    let depth = 1
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
      if (depth === 0) break
      i++
    }
    if (depth !== 0) break // 括号不配平 —— 整体放弃（调用方按 FLD003 处置）
    const rawArgs = src.slice(argStart, i).trim()
    i++ // 跳过右括号
    // ④ 按顶层逗号切成实参（跳过 var() 内部包含的逗号，如 `min(10px, 2vw)`）
    const args: string[] = []
    let cur = ''
    let d = 0
    for (const ch of rawArgs) {
      if (ch === '(') d++
      if (ch === ')') d--
      if (ch === ',' && d === 0) {
        args.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    if (cur.trim()) args.push(cur.trim())
    if (!args.length) continue
    // ⑤ 单位/关键字实参（非纯数字）⇒ 数值字段置 0、原文进 minRaw/maxRaw 供透传
    const isNum = (s: string): boolean => /^-?\d+(?:\.\d+)?$/.test(s)
    const minRaw = args[0]
    const maxRaw = args.length > 1 ? args[1] : args[0]
    out.push({
      prop,
      min: isNum(minRaw) ? Number(minRaw) : 0,
      max: isNum(maxRaw) ? Number(maxRaw) : 0,
      minRaw,
      maxRaw,
    })
  }
  return out
}

/** Web 端 p-grid 的 CSS Grid 模板（repeat(auto-fill, minmax(minColWidth, 1fr))） */
export function gridTemplate(minColWidth: number): string {
  return `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`
}
