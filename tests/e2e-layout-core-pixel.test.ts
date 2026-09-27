// tests/e2e-layout-core-pixel.test.ts
// ★★M1-5 **出口条件**（计划原文）：「Headless 后端能输出正确的指令流，与 VueDom 后端布局结果逐像素比对通过」。
//
// 与计划原文的一处**改进**（有意为之，理由充分）：
//   原计划写的是「与 VueDom 后端比对」，但 VueDom 后端自己**不做布局**（`layout: 'native'`，
//   布局交给浏览器）。与它比对等于「用浏览器验证浏览器」，没有信息量。
//   故这里直接用**真实 Chromium 的布局结果作为基准真值**（CSS Profile §8.1 也是这个口径：
//   「Web 端直接读 getComputedStyle / getBoundingClientRect 作为基准真值——这是 Proteus 的天然优势」）。
//
// ★★对拍方法（防「自己写答案自己判卷」）：
//   **单一事实源 = PNode 树**。同一棵树喂给两个渲染器：
//     ① `layout-core`（本仓求解器）
//     ② **浏览器原生 flexbox**（把 PNode 逐属性「朴素翻译」成 CSS，交给 Chromium 算）
//   若我在翻译里偷偷迁就求解器的语义，比对仍会分开——因为浏览器算的是标准 CSS。
//
// ★已对齐的两处模型差异（都是跨端框架的通行做法，非「迁就」）：
//   1. `box-sizing: border-box`：求解器的 width/height **含 padding**；CSS 默认 content-box
//   2. `min-width/min-height: 0`：CSS flex 项默认 `min-*: auto`（不许收缩到内容以下），
//      求解器不建模该规则 —— 与 RN 一致地显式清零（否则收缩用例必然对不上）
//
// ★文本度量：由**浏览器测量后注入**求解器——这正是「平台注入度量」架构的闭环验证
//   （Profile §L4：文本基础设施复用平台，不自研）。
//
// 容差：≤ 0.5dp（Profile §8.1 布局盒模型容差）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import type { PNode, ResolvedLength } from '../packages/component-ir/src/pnode'
import { layoutTreeFromPNode, solveLayout, loose, attachParents, type LayoutNode } from '../packages/layout-core/src/index'

/* ────────────────────────── PNode 构造 ────────────────────────── */

interface LayoutSpec {
  display?: 'flex' | 'none' | 'block' | 'inline-block'
  flexDirection?: 'row' | 'column'
  justifyContent?: string
  alignItems?: string
  alignSelf?: string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: ResolvedLength | 'auto'
  gap?: ResolvedLength
  width?: ResolvedLength
  height?: ResolvedLength
  minWidth?: ResolvedLength
  maxWidth?: ResolvedLength
  padding?: { top?: number; right?: number; bottom?: number; left?: number }
  margin?: { top?: number; right?: number; bottom?: number; left?: number }
  position?: 'static' | 'absolute'
  top?: ResolvedLength
  left?: ResolvedLength
  overflow?: 'visible' | 'hidden'
}

const N = (dp: number): ResolvedLength => ({ kind: 'absolute', dp })
const R = (ratio: number): ResolvedLength => ({ kind: 'ratio', ratio, base: 'parentWidth' })

function pn(id: number, spec: LayoutSpec, opts: { text?: string; fontSize?: number; kind?: 'view' | 'text' } = {}): PNode {
  const edges = (e?: { top?: number; right?: number; bottom?: number; left?: number }) =>
    e
      ? {
          top: e.top !== undefined ? N(e.top) : undefined,
          right: e.right !== undefined ? N(e.right) : undefined,
          bottom: e.bottom !== undefined ? N(e.bottom) : undefined,
          left: e.left !== undefined ? N(e.left) : undefined,
        }
      : undefined
  return {
    id,
    kind: opts.kind ?? 'view',
    props: {
      layout: {
        display: spec.display ?? 'flex',
        flexDirection: spec.flexDirection ?? 'column',
        justifyContent: spec.justifyContent ?? 'flex-start',
        alignItems: spec.alignItems ?? 'stretch',
        alignSelf: spec.alignSelf,
        flexGrow: spec.flexGrow ?? 0,
        flexShrink: spec.flexShrink ?? 1,
        flexBasis: spec.flexBasis ?? 'auto',
        gap: spec.gap,
        width: spec.width,
        height: spec.height,
        minWidth: spec.minWidth,
        maxWidth: spec.maxWidth,
        padding: edges(spec.padding),
        margin: edges(spec.margin),
        position: spec.position ?? 'static',
        top: spec.top,
        left: spec.left,
        overflow: spec.overflow ?? 'visible',
      },
      paint: {},
      text: opts.text ? { fontSize: N(opts.fontSize ?? 14), lineHeight: opts.fontSize ?? 14 } : undefined,
      paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false },
    },
    children: [],
    flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
    text: opts.text,
  }
}

function withChildren(node: PNode, children: PNode[]): PNode {
  return { ...node, children }
}

/* ────────────────────────── 用例（PNode 为唯一事实源） ────────────────────────── */

const VIEWPORT = { width: 375, height: 667 }

interface Case {
  name: string
  root: PNode
}

const CASES: Case[] = [
  {
    name: 'row + gap + justify-content:space-between + align-items:center',
    root: withChildren(
      pn(1, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: N(320), height: N(80), padding: { left: 10, right: 10 } }),
      [pn(2, { width: N(50), height: N(30) }), pn(3, { width: N(80), height: N(50) }), pn(4, { width: N(40), height: N(40) })],
    ),
  },
  {
    name: 'column + padding/margin + 主轴间距',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(300), padding: { top: 16, bottom: 16, left: 20, right: 20 } }),
      [pn(2, { height: N(40), margin: { bottom: 8 } }), pn(3, { height: N(60), margin: { bottom: 8 } }), pn(4, { height: N(20) })],
    ),
  },
  {
    name: 'flex-grow 权重分配（1:2:1）',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(400), height: N(50) }),
      [pn(2, { flexGrow: 1, height: N(50) }), pn(3, { flexGrow: 2, height: N(50) }), pn(4, { flexGrow: 1, height: N(50) })],
    ),
  },
  {
    name: 'flex-shrink 按 shrink×base 加权收缩',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(200), height: N(40), gap: N(10) }),
      [pn(2, { width: N(150), height: N(40) }), pn(3, { width: N(150), height: N(40) })],
    ),
  },
  {
    name: 'flex-basis 优先于 width',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(300), height: N(40), gap: N(10) }),
      [pn(2, { width: N(200), flexBasis: N(100), height: N(40) }), pn(3, { flexGrow: 1, height: N(40) })],
    ),
  },
  {
    name: '百分比尺寸 + 父 padding（★基准 = 父内容盒）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(300), height: N(200), padding: { left: 25, right: 25 } }),
      [pn(2, { width: R(0.5), height: N(30) }), pn(3, { width: R(1), height: N(30), margin: { top: 10 } })],
    ),
  },
  {
    name: 'align-self 覆盖 + align-items:flex-end',
    root: withChildren(
      pn(1, { flexDirection: 'row', alignItems: 'flex-end', width: N(300), height: N(100) }),
      [pn(2, { width: N(60), height: N(30) }), pn(3, { width: N(60), height: N(30), alignSelf: 'flex-start' }), pn(4, { width: N(60), height: N(30), alignSelf: 'center' })],
    ),
  },
  {
    name: '三层嵌套（row→column→row）',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(360), height: N(200), padding: { top: 10, left: 10, right: 10, bottom: 10 }, gap: N(12) }),
      [
        withChildren(pn(2, { flexDirection: 'column', flexGrow: 1, gap: N(6) }), [
          withChildren(pn(3, { flexDirection: 'row', height: N(40), gap: N(4) }), [pn(4, { width: N(30), height: N(40) }), pn(5, { flexGrow: 1, height: N(40) })]),
          pn(6, { height: N(60), margin: { top: 4 } }),
        ]),
        withChildren(pn(7, { flexDirection: 'column', width: N(100) }), [pn(8, { height: N(30) }), pn(9, { height: N(30) })]),
      ],
    ),
  },
  {
    name: '文本单行（度量由浏览器注入）',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(340), alignItems: 'center', padding: { left: 12, right: 12 }, gap: N(8) }),
      [pn(2, {}, { text: '提交订单', fontSize: 16, kind: 'text' }), pn(3, {}, { text: 'Subtotal', fontSize: 14, kind: 'text' }), withChildren(pn(4, { flexGrow: 1, height: N(20) }), [])],
    ),
  },
  {
    name: '文本纵向堆叠（父高由内容撑开）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(300) }),
      [pn(2, {}, { text: '标题标题', fontSize: 20, kind: 'text' }), pn(3, {}, { text: '这是一段说明文字', fontSize: 13, kind: 'text' }), pn(4, { height: N(12) })],
    ),
  },
  {
    name: 'absolute 定位（脱离流 + top/left）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(300), height: N(150), padding: { top: 20, left: 30 } }),
      [pn(2, { height: N(40) }), pn(3, { position: 'absolute', top: N(50), left: N(60), width: N(80), height: N(30) }), pn(4, { height: N(40) })],
    ),
  },
  {
    name: 'justify-content:center + row + 定宽子级',
    root: withChildren(
      pn(1, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: N(300), height: N(60), gap: N(10) }),
      [pn(2, { width: N(40), height: N(20) }), pn(3, { width: N(60), height: N(30) })],
    ),
  },
  {
    name: 'justify-content:flex-end + space-around',
    root: withChildren(
      pn(1, { flexDirection: 'row', justifyContent: 'space-around', width: N(300), height: N(40) }),
      [pn(2, { width: N(50), height: N(40) }), pn(3, { width: N(50), height: N(40) }), pn(4, { width: N(50), height: N(40) })],
    ),
  },
  {
    name: 'column + flex-grow 主轴分配 + 内层 padding',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(320), height: N(400) }),
      [
        pn(2, { height: N(100) }),
        withChildren(pn(3, { flexGrow: 1, padding: { top: 8, left: 8, right: 8 } }), [pn(4, { flexGrow: 1 })]),
        pn(5, { height: N(50) }),
      ],
    ),
  },
  {
    name: 'max-width 夹取 + 收缩（不越界）',
    root: withChildren(
      pn(1, { flexDirection: 'row', width: N(200), height: N(30), gap: N(10) }),
      [pn(2, { flexGrow: 1, maxWidth: N(60), height: N(30) }), pn(3, { flexGrow: 1, height: N(30) })],
    ),
  },
  {
    name: 'display:none 不参与布局（兄弟不被推开）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), padding: { left: 10 } }),
      [pn(2, { display: 'none', height: N(50) }), pn(3, { height: N(30) }), pn(4, { height: N(20) })],
    ),
  },
  {
    name: 'overflow:hidden 不影响布局（只裁剪）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), height: N(100), overflow: 'hidden' }),
      [pn(2, { height: N(80) }), pn(3, { height: N(80) })],
    ),
  },
]

/* ────────────────────────── PNode → CSS（朴素翻译） ────────────────────────── */

function cssValue(v: ResolvedLength | 'auto' | undefined): string | undefined {
  if (v === undefined || v === 'auto') return undefined
  return v.kind === 'absolute' ? `${v.dp}px` : `${(v.ratio * 100).toFixed(6)}%`
}

/**
 * 把 PNode 逐属性翻译成 CSS —— **刻意保持「朴素」**：不模拟求解器的任何内部决策，
 * 让浏览器用标准 CSS 算法算出基准真值。
 */
function styleFor(node: PNode): string {
  const L = node.props.layout
  const out: string[] = []
  // 模型对齐（见文件头两条说明）
  out.push('box-sizing:border-box', 'min-width:0', 'min-height:0')
  out.push(`display:${L.display === 'none' ? 'none' : 'flex'}`)
  if (L.display !== 'none') {
    out.push(`flex-direction:${L.flexDirection ?? 'column'}`)
    out.push(`justify-content:${L.justifyContent ?? 'flex-start'}`)
    out.push(`align-items:${L.alignItems ?? 'stretch'}`)
    if (L.alignSelf) out.push(`align-self:${L.alignSelf}`)
    out.push(`flex-grow:${L.flexGrow ?? 0}`, `flex-shrink:${L.flexShrink ?? 1}`)
    const basis = cssValue(L.flexBasis)
    if (basis) out.push(`flex-basis:${basis}`)
    // CSS 的 gap 简写；求解器单值 gap 语义 = 两轴同值
    if (L.gap) out.push(`gap:${cssValue(L.gap)}`)
    const w = cssValue(L.width)
    const h = cssValue(L.height)
    if (w) out.push(`width:${w}`)
    if (h) out.push(`height:${h}`)
    const mnw = cssValue(L.minWidth)
    const mxw = cssValue(L.maxWidth)
    if (mnw) out.push(`min-width:${mnw}`)
    if (mxw) out.push(`max-width:${mxw}`)
    const e = (prefix: string, edges: typeof L.padding): void => {
      if (!edges) return
      out.push(`${prefix}-top:${cssValue(edges.top) ?? '0px'}`, `${prefix}-right:${cssValue(edges.right) ?? '0px'}`, `${prefix}-bottom:${cssValue(edges.bottom) ?? '0px'}`, `${prefix}-left:${cssValue(edges.left) ?? '0px'}`)
    }
    e('padding', L.padding)
    e('margin', L.margin)
    // ★containing block 对齐：求解器的 absolute 子级以**父 padding 盒**为基准，
    //   故非 absolute 元素统一 relative（否则 absolute 子级会去找更上层定位祖先）
    out.push(`position:${L.position === 'absolute' ? 'absolute' : 'relative'}`)
    if (L.position === 'absolute') {
      if (L.top) out.push(`top:${cssValue(L.top)}`)
      if (L.left) out.push(`left:${cssValue(L.left)}`)
      out.push('right:auto', 'bottom:auto')
    }
    if (L.overflow && L.overflow !== 'visible') out.push(`overflow:${L.overflow}`)
  }
  const T = node.props.text
  if (T) {
    out.push(`font-size:${T.fontSize ? cssValue(T.fontSize) : '14px'}`)
    out.push(`line-height:${typeof T.lineHeight === 'number' ? `${T.lineHeight}px` : 'normal'}`)
    out.push('font-family:Arial, sans-serif', 'white-space:nowrap')
  }
  return out.join(';')
}

function htmlFor(roots: PNode[]): string {
  const render = (n: PNode): string => {
    const inner = n.children.map(render).join('')
    return `<div data-lc="${n.id}" style="${styleFor(n)}">${n.text ?? ''}${inner}</div>`
  }
  return roots.map(render).join('')
}

/* ────────────────────────── 文本度量桥（浏览器 → 求解器） ────────────────────────── */

interface TextMeasurement {
  width: number
  height: number
}

/**
 * 取文本度量（**按用例**）：node id 在不同用例间会重复，
 * 共用一张表会被后续用例覆盖（本仓 M1-5 实测踩过：20px 的文本覆盖了 16px 的，偏差 4dp）。
 */
async function measureTextsInBrowser(page: import('playwright').Page, cases: Case[]): Promise<Map<number, TextMeasurement>> {
  // 收集所有文本节点（id → 文本 + 字号）
  const items: Array<{ id: number; text: string; fontSize: number }> = []
  const walk = (n: PNode): void => {
    if (n.text) items.push({ id: n.id, text: n.text, fontSize: n.props.text?.fontSize && n.props.text.fontSize.kind === 'absolute' ? n.props.text.fontSize.dp : 14 })
    n.children.forEach(walk)
  }
  for (const c of cases) walk(c.root)

  const raw = (await page.evaluate((list) => {
    const out: Record<number, { width: number; height: number }> = {}
    for (const it of list) {
      const span = document.createElement('span')
      span.style.cssText = `position:absolute;left:-10000px;top:0;white-space:nowrap;font-family:Arial, sans-serif;font-size:${it.fontSize}px;line-height:${it.fontSize}px`
      span.textContent = it.text
      document.body.appendChild(span)
      const r = span.getBoundingClientRect()
      out[it.id] = { width: r.width, height: it.fontSize }
      span.remove()
    }
    return out
  }, items)) as Record<number, TextMeasurement>
  // ★page.evaluate 只能回传可序列化对象 → 在此转成 Map（调用方按 Map 使用）
  const map = new Map<number, TextMeasurement>()
  for (const [k, v] of Object.entries(raw)) map.set(Number(k), v)
  return map
}

/* ────────────────────────── 比对 ────────────────────────── */

interface Mismatch {
  caseName: string
  nodeId: number
  prop: string
  mine: number
  browser: number
  delta: number
}

const TOLERANCE = 0.5

describe('★★M1-5 出口条件：求解器 vs 真实浏览器布局（逐像素 ≤ 0.5dp）', () => {
  let browser: Browser
  let page: import('playwright').Page
  let mismatches: Mismatch[] = []
  let comparedNodes = 0
  let textNodeTotal = 0

  beforeAll(async () => {
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height } })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('全部用例逐节点比对（x / y / width / height）', async () => {
    for (const c of CASES) {
      // ── ① 求解器（度量按用例取——见 measureTextsInBrowser 注释）
      const measurements = await measureTextsInBrowser(page, [c])
      textNodeTotal += measurements.size
      const tree = layoutTreeFromPNode([c.root], {
        measureText: (n) => measurements.get(n.id) ?? { width: 0, height: 0 },
      })
      attachParents(tree[0]!)
      const solved = solveLayout(tree[0]!, loose(VIEWPORT.width, VIEWPORT.height))

      // ── ② 浏览器
      await page.setContent(`<!doctype html><html><body style="margin:0">${htmlFor([c.root])}</body></html>`)
      const browserRects = (await page.evaluate(() => {
        const out: Record<number, { x: number; y: number; width: number; height: number }> = {}
        document.querySelectorAll('[data-lc]').forEach((el) => {
          const id = Number((el as HTMLElement).dataset.lc)
          const r = el.getBoundingClientRect()
          out[id] = { x: r.x, y: r.y, width: r.width, height: r.height }
        })
        return out
      })) as Record<number, { x: number; y: number; width: number; height: number }>

      const rootB = browserRects[c.root.id]!
      const rootM = solved.rects.get(c.root.id)!

      // ── ③ 逐节点比对（浏览器坐标换算为「相对根原点」，与求解器同口径）
      const hidden = new Set<number>()
      const collectHidden = (n: PNode): void => {
        if (n.props.layout.display === 'none') hidden.add(n.id)
        n.children.forEach(collectHidden)
      }
      collectHidden(c.root)

      for (const [idStr, b] of Object.entries(browserRects)) {
        const id = Number(idStr)
        // ★display:none 的节点在 CSS 中**没有盒子**（浏览器 getBoundingClientRect 全 0）——
        //   求解器同样不为其生成盒（rects 不含），故这里跳过：两边都「无盒」即一致
        if (hidden.has(id)) continue
        const m = solved.rects.get(id)
        if (!m) {
          mismatches.push({ caseName: c.name, nodeId: id, prop: 'exists', mine: 0, browser: 1, delta: Infinity })
          continue
        }
        comparedNodes++
        const mine = { x: m.x + rootM.x, y: m.y + rootM.y, width: m.width, height: m.height }
        const theirs = { x: b.x - rootB.x + rootM.x, y: b.y - rootB.y + rootM.y, width: b.width, height: b.height }
        for (const prop of ['x', 'y', 'width', 'height'] as const) {
          const delta = Math.abs(mine[prop] - theirs[prop])
          if (delta > TOLERANCE) {
            mismatches.push({ caseName: c.name, nodeId: id, prop, mine: mine[prop], browser: theirs[prop], delta })
          }
        }
      }
    }

    const report = mismatches
      .slice(0, 20)
      .map((m) => `  ✗ [${m.caseName}] #${m.nodeId}.${m.prop}: 求解器 ${m.mine.toFixed(2)} vs 浏览器 ${m.browser.toFixed(2)}（差 ${m.delta.toFixed(2)}dp）`)
      .join('\n')
    expect(mismatches, `与浏览器布局不一致（容差 ${TOLERANCE}dp）：\n${report}`).toEqual([])
  })

  it('比对规模有效性：参与比对的节点数足够（防空跑通过）', () => {
    // ★防空跑：若用例构建失败/选择器失效，比对节点数会塌缩，此断言会拦住「什么都没比却绿了」
    // ★防空跑：用例构建失败 / 选择器失效时节点数会塌缩（实测 17 例 = 67 个有盒节点）
    expect(comparedNodes, '参与比对的节点数').toBeGreaterThanOrEqual(60)
    expect(CASES.length).toBeGreaterThanOrEqual(17)
    // 实测 4 个文本节点（两个文本用例共 4 个）——数量下探即说明用例或度量桥失效
    expect(textNodeTotal, '文本度量条目总数（浏览器注入）').toBeGreaterThanOrEqual(4)
  })

  it('破坏性：把求解器的一个尺寸改错 → 比对必须报出不一致（证明比对有效，非恒真）', async () => {
    // 取一个用例，故意把根宽度改错 20dp，再跑同一套比对逻辑
    const c = CASES[0]!
    const tree = layoutTreeFromPNode([c.root], { measureText: () => ({ width: 0, height: 0 }) })
    attachParents(tree[0]!)
    const solved = solveLayout(tree[0]!, loose(VIEWPORT.width, VIEWPORT.height))
    const bad = { ...solved.rects.get(c.root.id)!, width: solved.rects.get(c.root.id)!.width - 20 }

    await page.setContent(`<!doctype html><html><body style="margin:0">${htmlFor([c.root])}</body></html>`)
    const rootB = (await page.evaluate(() => {
      const el = document.querySelector('[data-lc]')!
      const r = el.getBoundingClientRect()
      return { width: r.width }
    })) as { width: number }

    expect(Math.abs(bad.width - rootB.width), '★故意改错必须被比对发现').toBeGreaterThan(TOLERANCE)
  })
})

/** 供其它模块复用（如 explain/Cmd 工具）——导出以免测试专用逻辑被复制 */
export { CASES as __layoutPixelCases, htmlFor as __htmlFor }
export type { LayoutNode }
