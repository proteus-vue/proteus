// packages/fluid/src/adaptive.ts
// ★p-adaptive（adaptive-container-plan G-22 §5 / B1）：容器形态自适应纯逻辑
//   把系统「同一语义随尺寸切换形态」能力语义化（iOS UISheet / Android BottomSheet / 鸿蒙 SideBarContainer）
//   B1 零依赖纯函数：解析（字符串→区间）/ 校验（FLD007 连续不重叠）/ 求解（宽度→形态）
//   形态切换是「换容器」由渲染层 nodeOps 实现（B3+）；Web 端 B2 AdaptiveController 在此之上监听容器宽度
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
