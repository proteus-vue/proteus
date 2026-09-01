// packages/fluid/src/adaptive.ts
// ★p-adaptive（adaptive-container-plan G-22 §5 / B1+B2）：容器形态自适应纯逻辑
//   把系统「同一语义随尺寸切换形态」能力语义化（iOS UISheet / Android BottomSheet / 鸿蒙 SideBarContainer）
//   B1 零依赖纯函数：解析（字符串→区间）/ 校验（FLD007 连续不重叠）/ 求解（宽度→形态）
//   B2 运行时：createAdaptiveController（容器监听 + 求解，尺寸观察器可注入）+ resolveAdaptiveFormStyle（Web 形态样式）
//   形态切换是「换容器」由渲染层 nodeOps 实现（B3+）；本模块是 Web 端 B2 的纯逻辑底座
import { createContainerQuery } from './context'
import type { SizeObserverFactory } from './context'

export interface AdaptiveVariant {
  /** 形态名（sheet/dialog/popover/drawer/sidebar/...——语义由渲染层定义） */
  form: string
  /** 区间下界（含）——逻辑点 pt */
  lo: number
  /** 区间上界（不含）；Infinity = 无上界（∞） */
  hi: number
}

export interface AdaptiveDiagnostic {
  /** FLD007 区间连续不重叠 / FLD009 端点来自 breakpoints */
  code: string
  message: string
}

/**
 * 解析 p-adaptive 表达式：`sheet(0, 600) | dialog(600, 840) | popover(840, ∞)` → 有序形态区间
 * - 上界省略/∞/inf → Infinity；下界省略 → 0；格式非法项跳过
 */
export function parseAdaptiveExpression(expr: string): AdaptiveVariant[] {
  const out: AdaptiveVariant[] = []
  if (!expr) return out
  const parts = expr.split('|')
  for (const part of parts) {
    const m = part.trim().match(/^([\w-]+)\s*\(\s*([\d.]+)?\s*,\s*([\d.]*|∞|inf)?\s*\)$/i)
    if (!m) continue
    const form = m[1] as string
    const lo = m[2] && m[2].length ? Number(m[2]) : 0
    const hiRaw = m[3] as string | null
    const hi = hiRaw == null || hiRaw === '' || /^(∞|inf)$/i.test(hiRaw) ? Infinity : Number(hiRaw)
    out.push({ form, lo, hi })
  }
  return out
}

/** 区间连续性校验（FLD007）：非法区间（hi ≤ lo）/ 相邻重叠 / 相邻不连续（gap） */
export function validateAdaptiveRanges(modes: AdaptiveVariant[]): AdaptiveDiagnostic[] {
  const diags: AdaptiveDiagnostic[] = []
  if (!modes.length) {
    diags.push({ code: 'FLD007', message: 'p-adaptive 表达式为空或格式非法——需至少一个 形态(lo, hi) 区间（如 sheet(0,600)）' })
    return diags
  }
  for (let i = 0; i < modes.length; i++) {
    const cur = modes[i] as AdaptiveVariant
    if (!(cur.hi > cur.lo)) {
      diags.push({ code: 'FLD007', message: `p-adaptive 区间 ${cur.form}(${cur.lo}, ${cur.hi}) 非法——hi 须 > lo` })
    }
    if (i === 0) continue
    const prev = modes[i - 1] as AdaptiveVariant
    if (cur.lo < prev.hi) {
      diags.push({ code: 'FLD007', message: `p-adaptive 区间 ${cur.form}(${cur.lo}, ...) 与前一区间重叠——区间须连续不重叠` })
    } else if (cur.lo > prev.hi) {
      diags.push({ code: 'FLD007', message: `p-adaptive 区间 ${cur.form}(${cur.lo}, ...) 与前一区间不连续（gap）——区间须连续` })
    }
  }
  return diags
}

/**
 * 容器宽度 → 形态（左闭右开 [lo, hi)：600 → dialog 命中第二区间；840 → popover）
 * - width < 首区间 lo → 首形态兜底；width ≥ 末区间 hi（有限）→ 末形态兜底
 */
export function computeAdaptiveForm(modes: AdaptiveVariant[], width: number): string | null {
  if (!modes.length) return null
  for (const m of modes) {
    if (width >= m.lo && width < m.hi) return m.form
  }
  const first = modes[0] as AdaptiveVariant
  if (width < first.lo) return first.form
  const last = modes[modes.length - 1] as AdaptiveVariant
  if (width >= last.hi) return last.form
  return null
}

// ── B2：AdaptiveController（容器监听 + 求解，尺寸观察器工厂注入可单测）──

/** Web 端形态样式（applyAdaptiveForm 的 Web 实现底座）：sheet 底部全宽 / dialog·popover 居中 */
export function resolveAdaptiveFormStyle(form: string): Record<string, string> {
  const centered = { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  if (form === 'sheet') {
    return { position: 'fixed', left: '0px', right: '0px', bottom: '0px' }
  }
  if (form === 'popover') {
    // ★降级链（03 §6）：Web 不支持 popover 锚定定位时降级为 position: fixed 居中——文档明确
    return centered
  }
  // dialog / 其他形态：居中
  return centered
}

export interface AdaptiveControllerState {
  /** 当前形态（computeAdaptiveForm 求解；无区间 → null） */
  form: string | null
  /** 容器宽度（px） */
  width: number
}

export interface AdaptiveControllerOptions {
  /** 形态区间（有序、连续不重叠——由 parseAdaptiveExpression 解析或手写） */
  modes: AdaptiveVariant[]
  /** 尺寸观察器工厂（缺省 globalThis.ResizeObserver；无则容器保持初始/静态——MP 降级） */
  createObserver?: SizeObserverFactory
  /** 尺寸读取器（初始尺寸；测试注入） */
  readSize?: () => { width: number; height: number }
}

export interface AdaptiveController {
  get(): AdaptiveControllerState
  subscribe(cb: (state: AdaptiveControllerState) => void): () => void
  destroy(): void
}

/**
 * 容器形态控制器（B2）：监听容器尺寸变化 → computeAdaptiveForm 求解 → 订阅者收到形态切换
 * - 复用 createContainerQuery（容器查询运行时）；createObserver 工厂注入可单测
 * - 稳态零开销（只响应容器尺寸变化；不轮询、不监听屏幕旋转——铁律 G-22.6）
 */
export function createAdaptiveController(el: unknown, options: AdaptiveControllerOptions): AdaptiveController {
  const modes = options.modes
  const state: AdaptiveControllerState = { form: computeAdaptiveForm(modes, 0), width: 0 }
  const handlers: Array<(s: AdaptiveControllerState) => void> = []
  let destroyed = false

  const query = createContainerQuery(el, {
    createObserver: options.createObserver,
    readSize: options.readSize,
  })
  query.subscribe((s) => {
    state.form = computeAdaptiveForm(modes, s.width)
    state.width = s.width
    for (const h of handlers) h({ ...state })
  })

  return {
    get: () => ({ ...state }),
    subscribe(cb) {
      handlers.push(cb)
      cb({ ...state })
      let removed = false
      return () => {
        if (removed) return
        removed = true
        const idx = handlers.indexOf(cb)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      query.destroy()
      handlers.length = 0
    },
  }
}
