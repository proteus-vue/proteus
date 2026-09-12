// packages/test-core/src/assert-render.ts
// ★G-32.x / 端能力对齐配套：**页面渲染门禁**（render gate）——跨端可复用的「页面真的渲染出来了吗」断言。
//
// 背景（2026-09-13 用户实测教训）：框架 E2E 此前只断言「路由到了 / data 对不对 / 某元素文本」，
//   **没有断言「元素在视觉上可见」** → `p-button` 在 Web 端因缺 style.css 而塌陷/不可见，全部门禁绿却人眼可见故障。
//   同类盲区：元素存在但 0 尺寸（display:none / 样式缺失）/ 页面整体空白 / 内容被样式压没。
//
// 本文件补齐三类断言（跨端统一，经 TestDriver.evaluate 取渲染度量）：
//   ① assertNotBlank   —— 页面非空白（body 有可见文本或子元素达到最小面积）
//   ② assertVisible    —— 指定选择器的元素**存在且视觉可见**（有尺寸 + 未被 display:none/visibility:hidden 隐藏）
//   ③ assertNoErrors   —— 无 console error / pageerror（渲染期报错）
//
// 用法（E2E）：
//   import { assertPageRendered } from '@proteus-vue/test-core'
//   await assertPageRendered(driver, { keySelector: 'button', minVisible: 1 })
import type { TestDriver } from './driver/types'

export interface RenderGateOptions {
  /** 关键元素选择器（应可见）——如 'button' / '.db' */
  keySelector?: string
  /**
   * 关键元素最少可见数量（缺省 1）。
   * ★注意：minVisible=1 只能证明「至少一个还在」，抓不住「大部分/全部消失」——
   *   要抓「按钮都不见了」这类故障，必须给 expectedCount（断言总数）或 minVisibleRatio（断言可见占比）。
   *   2026-09-13 教训：p-button 页曾以 minVisible=1 通过，而页面实际有 10 个按钮。
   */
  minVisible?: number
  /** ★关键元素预期最少总数——少于它即失败（抓「元素整体消失/未渲染」）。 */
  expectedCount?: number
  /** ★可见占比下限 0..1（keyVisible/keyTotal ≥ ratio）——抓「一半以上不可见」。 */
  minVisibleRatio?: number
  /**
   * ★最小对比度（前景/背景）——抓「元素有尺寸但看不清」（白底白字 = 1.0）。
   *   缺省不检（undefined）；演示页建议 1.5（宽松阈值，只拦近不可见，不误伤浅色设计）。
   *   2026-09-13 教训：暗色媒体查询压过主题化 → 浅色卡片上按钮白底白字，尺寸非零故 size/display 断言全绿。
   */
  minContrast?: number
  /** body 最小可见文本长度（判非空白；缺省 1） */
  minTextLen?: number
  /** 是否断言无 console error（缺省 true） */
  assertNoErrors?: boolean
}

export interface RenderGateResult {
  /** 是否存在可见文本 */
  hasText: boolean
  /** 可见文本长度 */
  textLen: number
  /** 关键元素：总数 / 可见数 */
  keyTotal: number
  keyVisible: number
  /** 可见占比（keyTotal>0 时 = keyVisible/keyTotal；否则 0） */
  visibleRatio: number
  /** 不可见元素示例（排障用） */
  invisibleSamples: Array<{ text: string; w: number; h: number; display: string; visibility: string }>
  /** ★低对比度元素示例（有尺寸但前景/背景难辨——如白底白字） */
  lowContrastSamples: Array<{ text: string; color: string; bg: string; ratio: number }>
  /** console error / pageerror 文本 */
  errors: string[]
}

/**
 * 采集渲染度量（经 driver.evaluate 在目标端执行）。
 * ★跨端注意：MP 端 evaluate 必须传函数（automator toString 序列化）——本函数传函数字面量，两端通用。
 */
export async function collectRenderMetrics(driver: TestDriver, opts: RenderGateOptions = {}): Promise<RenderGateResult> {
  const keySelector = opts.keySelector ?? ''
  type Sample = { text: string; w: number; h: number; display: string; visibility: string }
  type Metrics = { hasText: boolean; textLen: number; keyTotal: number; keyVisible: number; invisibleSamples: Sample[]; lowContrastSamples: Array<{ text: string; color: string; bg: string; ratio: number }> }
  const minContrast = opts.minContrast ?? 1.5
  // ★evaluate 只传「一个」对象实参：Playwright page.evaluate 仅接受单参（多参报 Too many arguments）
  const metrics = await driver.evaluate<Promise<Metrics>>((arg: unknown) => {
    const o = (arg ?? {}) as { sel?: unknown; minContrast?: unknown }
    const minC = typeof o.minContrast === 'number' ? o.minContrast : 1.5
    const selStr = String(o.sel ?? '')
    const doc = (globalThis as { document?: any }).document
    // Web 端：真实 DOM 度量（统一返回 Promise——与 MP 分支签名一致）
    if (doc && typeof doc.querySelectorAll === 'function') {
      return Promise.resolve((() => {
        const body = doc.body
        const text = (body?.innerText ?? '').trim()
        const keyEls = selStr ? Array.from(doc.querySelectorAll(selStr)) : []
        const g = globalThis as unknown as { getComputedStyle?: (e: unknown) => any }
        const cs = (el: any) => (g.getComputedStyle ? g.getComputedStyle(el) : null)
        // 解析 'rgb(r, g, b)' / 'rgba(r,g,b,a)' → {r,g,b,a}
        const parse = (c: string): { r: number; g: number; b: number; a: number } | null => {
          const m = c && c.match(/rgba?\(([^)]+)\)/)
          if (!m) return null
          const p = m[1].split(',').map((x: string) => parseFloat(x))
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
        }
        const lum = (c: { r: number; g: number; b: number }) => {
          const f = (v: number) => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
          }
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
        }
        // 沿祖先链找第一个非透明背景（含 alpha 叠加近似）；兜底 body
        const effBg = (el: any): { r: number; g: number; b: number } => {
          let node: any = el
          while (node && node.nodeType === 1) {
            const c = parse(cs(node)?.backgroundColor ?? '')
            if (c && c.a > 0.9) return c
            node = node.parentElement
          }
          const bc = parse(cs(doc.body)?.backgroundColor ?? '')
          return bc && bc.a > 0.9 ? bc : { r: 255, g: 255, b: 255 }
        }
        const contrast = (el: any) => {
          const fg = parse(cs(el)?.color ?? '')
          if (!fg || fg.a < 0.1) return null
          const bg = effBg(el)
          const l1 = lum(fg)
          const l2 = lum(bg)
          const hi = Math.max(l1, l2)
          const lo = Math.min(l1, l2)
          return (hi + 0.05) / (lo + 0.05)
        }
        const measurable = (el: any) => {
          const r = el.getBoundingClientRect()
          const s = cs(el)
          const display = s?.display ?? ''
          const visibility = s?.visibility ?? ''
          const visible = r.width > 0 && r.height > 0 && display !== 'none' && visibility !== 'hidden' && s?.opacity !== '0'
          // ★仅对「自己渲染文本」的元素做对比度检查：容器元素（文本全来自子元素）其自身 color
          //   可能只是继承色，与背景同色也非故障（真实文本由子元素以正确色渲染）——否则误报。
          //   2026-09-13：semantics 页 `.code` 容器（继承深色字 + 深色底）被误判，实际文本在
          //   `.code-text` 子元素（浅字 ✓）。
          let ownText = ''
          for (const n of Array.from(el.childNodes) as Array<{ nodeType: number; textContent?: string }>) {
            if (n.nodeType === 3) ownText += n.textContent ?? ''
          }
          return { visible, w: Math.round(r.width), h: Math.round(r.height), display, visibility, text: (el.textContent ?? '').trim().slice(0, 20), ownText: ownText.trim(), el }
        }
        const measured = keyEls.map(measurable)
        const lowContrast: Array<{ text: string; color: string; bg: string; ratio: number }> = []
        for (const m of measured) {
          if (!m.visible || !m.ownText) continue // 无自有文本 → 跳过（子元素各自受检）
          const ratio = contrast(m.el)
          if (ratio != null && ratio < minC) {
            const bg = effBg(m.el)
            lowContrast.push({ text: m.ownText.slice(0, 20), color: cs(m.el)?.color ?? '', bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`, ratio: Math.round(ratio * 100) / 100 })
          }
        }
        return {
          hasText: text.length > 0,
          textLen: text.length,
          keyTotal: keyEls.length,
          keyVisible: measured.filter((m) => m.visible).length,
          invisibleSamples: measured.filter((m) => !m.visible).slice(0, 5).map(({ visible, el, ownText, ...rest }) => rest),
          lowContrastSamples: lowContrast.slice(0, 5),
        }
      })())
    }
    // MP 端（Skyline）：无 DOM——用 selectorQuery 取 boundingClientRect（宽高为 0 = 不可见）
    const g = globalThis as unknown as { wx?: { createSelectorQuery?: () => { selectAll: (s: string) => { boundingClientRect: () => unknown }; exec: (cb: (out: Array<Array<{ width?: number; height?: number }>>) => void) => void } } }
    return new Promise<Metrics>((resolve) => {
      const query = g.wx?.createSelectorQuery?.()
      if (!query) {
        resolve({ hasText: true, textLen: -1, keyTotal: -1, keyVisible: -1, invisibleSamples: [], lowContrastSamples: [] })
        return
      }
      query.selectAll(selStr || 'view').boundingClientRect()
      query.exec((out) => {
        const rects = Array.isArray(out?.[0]) ? out[0] : []
        const visible = rects.filter((r) => r && (r.width ?? 0) > 0 && (r.height ?? 0) > 0)
        resolve({
          hasText: true, // MP 端无 body 文本通道（另经页面 data 断言）
          textLen: -1,
          keyTotal: rects.length,
          keyVisible: visible.length,
          invisibleSamples: rects.filter((r) => !r || (r.width ?? 0) <= 0 || (r.height ?? 0) <= 0).slice(0, 5).map((r) => ({ text: '', w: r?.width ?? 0, h: r?.height ?? 0, display: '', visibility: '' })),
          lowContrastSamples: [], // MP 无计算样式通道（对比度由 Web 端 + 视觉核验覆盖）
        })
      })
    })
  }, { sel: keySelector, minContrast })
  const errors = opts.assertNoErrors === false ? [] : (await driver.consoleLogs('error')).map((e) => e.text)
  const visibleRatio = metrics.keyTotal > 0 ? metrics.keyVisible / metrics.keyTotal : 0
  return { ...metrics, visibleRatio, errors }
}

/**
 * 页面渲染门禁：断言页面非空白 + 关键元素可见 + 无 console 错误。
 * 失败时抛出**带度量明细**的错误（人眼可见的故障，此门禁必须能抓到）。
 */
export async function assertPageRendered(driver: TestDriver, opts: RenderGateOptions = {}): Promise<RenderGateResult> {
  const minVisible = opts.minVisible ?? 1
  const minTextLen = opts.minTextLen ?? 1
  const m = await collectRenderMetrics(driver, opts)
  const problems: string[] = []
  if (m.textLen >= 0 && m.textLen < minTextLen) problems.push(`页面疑似空白（可见文本 ${m.textLen} < ${minTextLen}）`)
  if (m.keyTotal >= 0 && m.keyVisible < minVisible) {
    problems.push(`关键元素 "${opts.keySelector}" 可见数不足（${m.keyVisible}/${minVisible}；总 ${m.keyTotal}）`)
    if (m.invisibleSamples.length) problems.push(`不可见示例：${JSON.stringify(m.invisibleSamples)}`)
  }
  // ★抓「元素整体消失」：总数低于预期即失败（minVisible=1 抓不住此类故障）
  if (m.keyTotal >= 0 && opts.expectedCount != null && m.keyTotal < opts.expectedCount) {
    problems.push(`关键元素 "${opts.keySelector}" 总数不足（${m.keyTotal} < 预期 ${opts.expectedCount}）——元素未渲染或已消失`)
  }
  // ★抓「大部分不可见」：可见占比低于下限即失败
  if (m.keyTotal >= 0 && opts.minVisibleRatio != null && m.visibleRatio < opts.minVisibleRatio) {
    problems.push(`关键元素 "${opts.keySelector}" 可见占比不足（${(m.visibleRatio * 100).toFixed(0)}% < ${(opts.minVisibleRatio * 100).toFixed(0)}%；${m.keyVisible}/${m.keyTotal}）`)
    if (m.invisibleSamples.length) problems.push(`不可见示例：${JSON.stringify(m.invisibleSamples)}`)
  }
  // ★抓「有尺寸但看不清」（白底白字等低对比度）——尺寸/display 断言抓不住
  if (opts.minContrast != null && m.lowContrastSamples.length) {
    problems.push(`关键元素 "${opts.keySelector}" 存在低对比度（前景/背景难辨，阈值 ${opts.minContrast}）：${JSON.stringify(m.lowContrastSamples)}`)
  }
  if (m.errors.length) problems.push(`存在 console 错误：${m.errors.slice(0, 3).join(' | ')}`)
  if (problems.length) {
    throw new Error(`[test-core] 页面渲染门禁未通过：\n  - ${problems.join('\n  - ')}`)
  }
  return m
}
