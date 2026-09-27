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
import fs from 'node:fs'
import path from 'node:path'
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
  position?: 'static' | 'relative' | 'absolute'
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
  /* ────────── ★层叠（stacking）用例组：命中/绘制序的地基 ──────────
     为什么单独成组：绘制序的「两相位」模型（在流 → 定位）是命中正确性的核心，
     而这些用例专门制造**重叠**，让浏览器 elementsFromPoint 把相位关系暴露出来。
     实测背景：初版模型是纯树序，靠这组用例（探针 D/E 等价结构）才发现是错的。 */
  {
    // 探针 D/E 的等价结构：**深层 static 子树内的 absolute** vs 更外层**后置**的在流兄弟
    name: '★层叠：深层 absolute 覆盖后置在流兄弟（相位按层叠上下文，非按父级）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), height: N(120) }),
      [
        withChildren(pn(2, { flexDirection: 'column', width: N(200), height: N(60) }), [
          withChildren(pn(3, { flexDirection: 'column', width: N(200), height: N(10) }), [
            pn(4, { position: 'absolute', top: N(20), left: N(20), width: N(100), height: N(60) }),
          ]),
        ]),
        pn(5, { width: N(200), height: N(60), margin: { top: -40 } }),
      ],
    ),
  },
  {
    // absolute 弟弟 vs 在流哥哥：弟弟必须画在哥哥**之上**（即使在流元素树序更靠后）
    name: '★层叠：absolute 覆盖后置的在流兄弟',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), height: N(120) }),
      [
        pn(2, { width: N(200), height: N(40) }),
        pn(3, { position: 'absolute', top: N(20), left: N(20), width: N(100), height: N(60) }),
        pn(4, { width: N(200), height: N(60), margin: { top: -50 } }),
      ],
    ),
  },
  {
    // 两个 absolute 重叠：**树序靠后**者在上（同相位内按树序）
    name: '★层叠：两个 absolute 重叠（同相位按树序）',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), height: N(120) }),
      [
        pn(2, { position: 'absolute', top: N(10), left: N(10), width: N(120), height: N(80) }),
        pn(3, { position: 'absolute', top: N(40), left: N(40), width: N(120), height: N(80) }),
      ],
    ),
  },
  {
    // relative 也属「定位元素」→ 绘制在在流兄弟之上（本仓翻译必须**最小化**才测得准，
    // 因为给所有元素加 relative 会把这个语义抹平——见 styleFor 注释）
    name: '★层叠：relative 覆盖后置在流兄弟',
    root: withChildren(
      pn(1, { flexDirection: 'column', width: N(200), height: N(120) }),
      [
        pn(2, { width: N(200), height: N(60) }),
        pn(4, { position: 'relative', top: N(-30), width: N(200), height: N(60) }),
      ],
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
 * 该节点是否有 absolute 子级（决定是否需要 `position:relative` 建立 containing block）
 *
 * ★只判断**直接子级**：求解器的 absolute containing block 是**父**的 padding 盒
 *   （本仓 M1 已与浏览器对拍确认），故只需直接父级定位。
 */
function hasAbsoluteChild(node: PNode): boolean {
  return node.children.some((c) => c.props.layout.position === 'absolute')
}

/**
 * 把 PNode 逐属性翻译成 CSS —— **刻意保持「朴素」**：不模拟求解器的任何内部决策，
 * 让浏览器用标准 CSS 算法算出基准真值。
 *
 * ★「朴素」的含义包括**不得副作用**：翻译只能表达 PNode 已有的语义，
 *   不能顺手引入新语义（如给所有元素加 relative 会改变层叠相位——见下方注释）。
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
    //   故**有 absolute 子级的**元素设为 relative（否则 absolute 子级会去找更上层定位祖先）。
    //
    // ★★这里必须**最小化**（本仓实测踩到，含真实后果）：
    //   初版给**所有**非 absolute 元素加 `position:relative` —— 不仅对齐 containing block，
    //   还**悄悄改变了层叠语义**：CSS 里 relative 属于「定位元素」，绘制在在流元素之上
    //   （相位 2），于是「在流兄弟」被提升到绝对定位元素之上 → 浏览器给出的命中序
    //   与**真实 CSS 语义**不符（`absolute 定位` 用例实测：浏览器报 [4,3]，真 CSS 应为 [3,4]）。
    //   那会让命中对拍**测的是翻译层的假象**，而不是 Profile 的语义。
    //   ⇒ 只有「直接父级」需要 relative（建立 containing block），其余保持 static。
    out.push(`position:${L.position === 'absolute' ? 'absolute' : hasAbsoluteChild(node) ? 'relative' : L.position === 'relative' ? 'relative' : 'static'}`)
    if (L.position === 'absolute') {
      if (L.top) out.push(`top:${cssValue(L.top)}`)
      if (L.left) out.push(`left:${cssValue(L.left)}`)
      out.push('right:auto', 'bottom:auto')
    } else if (L.position === 'relative') {
      // ★relative 的 inset 是**视觉偏移**：不改布局、不影响兄弟（与求解器语义一致）
      if (L.top) out.push(`top:${cssValue(L.top)}`)
      if (L.left) out.push(`left:${cssValue(L.left)}`)
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

/* ────────────────────── golden 导出（供 Rust 排版核心 conformance 消费） ────────────────────── */

/**
 * 布局输入的**扁平可序列化**形态——引擎就绪（全是数值，无 CSS 字符串）。
 * ★为什么导出它：DCP-1 定案「Rust + Taffy」后，App 端 L1 排版核心是 Rust；它的正确性必须
 *   锚定到**浏览器**（方案 §5.7：以浏览器为布局真值基准），而不是锚定到本仓的 TS 参考实现。
 *   故本文件在跑 Chromium 对拍的同时，把「引擎就绪输入 + 浏览器实测输出」一并冻结成 JSON，
 *   Rust 侧的 `tests/conformance.rs` 直接消费它——**无需浏览器即可回归**。
 */
interface GoldenNode {
  id: number
  parentId: number | null
  tag: string
  width?: number
  height?: number
  widthRatio?: number
  heightRatio?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  margin: { top: number; right: number; bottom: number; left: number }
  padding: { top: number; right: number; bottom: number; left: number }
  flexDirection: string
  justifyContent: string
  alignItems: string
  alignSelf?: string
  flexGrow: number
  flexShrink: number
  flexBasis?: number
  flexBasisRatio?: number
  gap: number
  display: string
  position: string
  top?: number
  left?: number
  overflow: string
  /** 是否文本叶子（Rust 侧据此决定是否走注入的度量回调） */
  isText: boolean
}

interface GoldenCase {
  name: string
  nodes: GoldenNode[]
  /** 文本度量（浏览器实测值；id → size）——Rust 侧作为「平台注入」的返回值 */
  textMeasures: Record<number, { width: number; height: number }>
  /** 浏览器基准真值（已换算为相对根原点，与求解器同口径） */
  rects: Record<number, { x: number; y: number; width: number; height: number }>
  /**
   * ★★命中测试基准真值（浏览器 `elementsFromPoint`）。
   *
   * 【为什么必须有】（M3 事件系统的地基）
   *   命中的正确性依赖「逆绘制序 + 裁剪（overflow）」—— 这两条如果各端自己实现，
   *   必然出现「同一份 IR 在浏览器点得到、在 Rust 点不到」这类**语义分叉**。
   *   故与布局同法：把浏览器当**真值基准**，Rust 侧只消费冻结的 golden。
   *
   * 【坐标口径】与 `rects` 同——已换算为「相对根原点」（见 `normPoint`）。
   *
   * 【顺序语义】`ids` 自**最上层到根**（浏览器 `elementsFromPoint` 的原生顺序）——
   *   即 Rust 侧 `hit_path` 的期望值。
   */
  hitProbes: Array<{ x: number; y: number; ids: number[] }>
}

/** LayoutNode 树 → 扁平 golden 节点表 */
function serializeLayoutTree(root: LayoutNode): GoldenNode[] {
  const out: GoldenNode[] = []
  const walk = (n: LayoutNode, parentId: number | null): void => {
    out.push({
      id: n.id,
      parentId,
      tag: n.tag,
      width: typeof n.width === 'number' ? n.width : undefined,
      height: typeof n.height === 'number' ? n.height : undefined,
      widthRatio: n.widthRatio,
      heightRatio: n.heightRatio,
      minWidth: n.minWidth,
      maxWidth: n.maxWidth,
      minHeight: n.minHeight,
      maxHeight: n.maxHeight,
      margin: n.margin,
      padding: n.padding,
      flexDirection: n.flexDirection,
      justifyContent: n.justifyContent,
      alignItems: n.alignItems,
      alignSelf: n.alignSelf,
      flexGrow: n.flexGrow,
      flexShrink: n.flexShrink,
      flexBasis: typeof n.flexBasis === 'number' ? n.flexBasis : undefined,
      flexBasisRatio: n.flexBasisRatio,
      gap: n.gap,
      display: n.display,
      position: n.position,
      top: n.top,
      left: n.left,
      overflow: n.overflow,
      isText: n.measureText !== undefined,
    })
    for (const c of n.children) walk(c, n.id)
  }
  walk(root, null)
  return out
}

/** golden 落盘位置（Rust crate 的测试夹具目录） */
const GOLDEN_PATH = path.resolve(__dirname, '../packages/layout-core-rust/tests/golden/browser-layout.json')

describe('★★M1-5 出口条件：求解器 vs 真实浏览器布局（逐像素 ≤ 0.5dp）', () => {
  let browser: Browser
  let page: import('playwright').Page
  let mismatches: Mismatch[] = []
  let comparedNodes = 0
  let textNodeTotal = 0
  let hitProbeTotal = 0
  let hitProbeHitTotal = 0

  beforeAll(async () => {
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height } })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('全部用例逐节点比对（x / y / width / height）', async () => {
    const goldenCases: GoldenCase[] = []
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

      // ── 命中测试探针（★浏览器 elementsFromPoint 为真值）
      //
      // 探针网格：视口范围内按 1/12 × 1/16 分数取点，**加 0.5 偏移**避开「恰好落在
      // 盒边界」的整数坐标（边界归属在亚像素下有歧义，会让 golden 不稳定）。
      const probes: Array<{ x: number; y: number }> = []
      for (let i = 1; i < 12; i++) {
        for (let j = 1; j < 16; j++) {
          probes.push({ x: Math.round((VIEWPORT.width * i) / 12) + 0.5, y: Math.round((VIEWPORT.height * j) / 16) + 0.5 })
        }
      }
      // 再加「盒子内部」采样：每个节点的中心点（覆盖小盒子——网格可能整片错过它）
      const centers = (node: PNode): void => {
        const r = browserRects[node.id]
        if (r && r.width > 0 && r.height > 0) {
          probes.push({ x: r.x + r.width / 2 + 0.5, y: r.y + r.height / 2 + 0.5 })
        }
        node.children.forEach(centers)
      }
      centers(c.root)

      const hitRaw = (await page.evaluate((pts) => {
        const out: Array<{ x: number; y: number; ids: number[] }> = []
        for (const p of pts) {
          // ★elementsFromPoint 已按「最上层 → 最下层」返回（与 Rust hit_path 同序）
          const els = document.elementsFromPoint(p.x, p.y)
          const ids: number[] = []
          for (const el of els) {
            const v = (el as HTMLElement).dataset ? (el as HTMLElement).dataset.lc : undefined
            if (v !== undefined) ids.push(Number(v))
          }
          out.push({ x: p.x, y: p.y, ids })
        }
        return out
      }, probes)) as Array<{ x: number; y: number; ids: number[] }>

      // 归一为「相对根原点」坐标（与 rects 同口径）
      const normPoint = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x - rootB.x + rootM.x,
        y: p.y - rootB.y + rootM.y,
      })
      const hitProbes = hitRaw.map((h) => {
        const n = normPoint(h)
        return { x: n.x, y: n.y, ids: h.ids }
      })

      // ── 冻结 golden（引擎就绪输入 + 浏览器实测输出，已归一为「相对根原点」）
      const normRects: GoldenCase['rects'] = {}
      for (const [idStr, b] of Object.entries(browserRects)) {
        normRects[Number(idStr)] = {
          x: b.x - rootB.x + rootM.x,
          y: b.y - rootB.y + rootM.y,
          width: b.width,
          height: b.height,
        }
      }
      hitProbeTotal += hitProbes.length
      hitProbeHitTotal += hitProbes.filter((h) => h.ids.length > 0).length

      goldenCases.push({
        name: c.name,
        nodes: serializeLayoutTree(tree[0]!),
        textMeasures: Object.fromEntries(measurements),
        rects: normRects,
        hitProbes,
      })

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
        // ★防空跑：非有限值（NaN/Infinity）必须当场暴露，而不是靠 delta 比较
        //   （`NaN > TOLERANCE` 是 false → 求解器产出 NaN 几何时比对会**静默通过**；
        //    本仓实测踩到：golden 里混入非法值后比对仍全绿。用 isFinite 显式拦截。）
        for (const prop of ['x', 'y', 'width', 'height'] as const) {
          if (!Number.isFinite(mine[prop])) {
            mismatches.push({ caseName: c.name, nodeId: id, prop: `${prop}(非有限)`, mine: mine[prop], browser: theirs[prop], delta: Infinity })
          }
        }
        for (const prop of ['x', 'y', 'width', 'height'] as const) {
          const delta = Math.abs(mine[prop] - theirs[prop])
          // ★★NaN 必须算不一致（本仓实测踩到）：`NaN > TOLERANCE` 是 **false**，
          //   于是求解器产出 NaN 几何时比对会**静默通过**（恰好与浏览器 0 相比也不报）。
          //   这正是「golden 里混入非法值」能溜过比对的原因——用 `!(delta <= TOLERANCE)` 修复。
          const bad = !(delta <= TOLERANCE)
          if (bad) {
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

    // ★冻结 golden（供 Rust 排版核心 conformance 消费；无浏览器即可回归）
    //   只在**比对全绿**时写（避免把失败状态冻结进去）
    const golden = {
      generatedBy: `tests/e2e-layout-core-pixel.test.ts（真实 Chromium；browser ${browser.version()}）`,
      note: '★基准真值 = 浏览器（布局 rects 用 getBoundingClientRect，命中 hitProbes 用 elementsFromPoint）。Rust 侧 conformance 直接消费本文件，无需浏览器。重新生成：pnpm run test:e2e:web',
      viewport: VIEWPORT,
      tolerance: TOLERANCE,
      cases: goldenCases,
    }
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true })
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`)
    expect(goldenCases.length, 'golden 用例数应与 CASES 一致').toBe(CASES.length)
  })

  it('比对规模有效性：参与比对的节点数足够（防空跑通过）', () => {
    // ★防空跑：若用例构建失败/选择器失效，比对节点数会塌缩，此断言会拦住「什么都没比却绿了」
    // ★防空跑：用例构建失败 / 选择器失效时节点数会塌缩（实测 17 例 = 67 个有盒节点）
    expect(comparedNodes, '参与比对的节点数').toBeGreaterThanOrEqual(60)
    expect(CASES.length).toBeGreaterThanOrEqual(21)
    // 实测 4 个文本节点（两个文本用例共 4 个）——数量下探即说明用例或度量桥失效
    expect(textNodeTotal, '文本度量条目总数（浏览器注入）').toBeGreaterThanOrEqual(4)
    // ★命中探针防空跑：必须有足量「有命中」的探针（全为空的 golden 会让 Rust 侧恒真通过）
    // 实测：17 用例 × (11×15 网格 + 各节点中心) = 探针总数 ≥ 2800，其中有命中 ≥ 375
    // （用例都是小盒子放在 375×667 视口里，网格点多数落在空白处——这是用例几何的正常结果）
    expect(hitProbeTotal, '命中探针总数').toBeGreaterThanOrEqual(2800)
    expect(hitProbeHitTotal, '有命中的探针数').toBeGreaterThanOrEqual(250)
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
