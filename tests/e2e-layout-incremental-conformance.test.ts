// tests/e2e-layout-incremental-conformance.test.ts
// ★★V6：**增量路径直接对拍浏览器**（补上「21 个 golden 全是首帧」的覆盖缺口）
//
// 【缺口是什么（本仓实测的确切描述）】
//   `tests/golden/browser-layout.json` 的 21 个用例**全部只覆盖首次布局**——
//   而增量路径（改一个值 → 重排 → 只更新受影响的范围）恰恰活在**变更之后**。
//   此前增量路径的正确性靠一条**传递链**保证：增量 ≡ 全量（`incremental_equivalence.rs`）
//   ∧ 全量 ≡ 浏览器（21 个 golden）⇒ 增量 ≡ 浏览器。
//   传递链在逻辑上成立，但**每一步都是间接的**；本文件做**直接**对拍：
//   「浏览器在变更后的布局」 vs 「求解器增量重排的结果」。
//
// 【对拍方法（与既有 golden 同款纪律：不自己判自己的卷子）】
//   ① 把一棵 **显式节点表**（与 Rust DTO 同形）渲染到真实 Chromium
//   ② 读变更**前**的 rects
//   ③ 在 DOM 上施加变更（改一个节点的 height/width/margin/…）
//   ④ 读变更**后**的 rects ← ★这是基准真值
//   ⑤ 冻结成 golden（节点表 + 变更 + 变更前后 rects）
//   ⇒ Rust 侧 `tests/incremental_browser_conformance.rs` 消费它：
//     建树 → 全量（应对上"变更前"）→ 施加同一变更 → **增量**重排（应对上"变更后"）
//
// 【模型对齐（与既有 e2e 同款两条，非"迁就"）】
//   · `box-sizing: border-box`：求解器 width/height **含 padding**；CSS 默认 content-box
//   · `min-width/min-height: 0`：CSS flex 项默认 `min-*: auto`（不许收缩到内容以下），
//     求解器不建模该规则 —— 与 RN 一致地显式清零
//
// 用法：pnpm vitest run tests/e2e-layout-incremental-conformance.test.ts
//   （需要 Chromium；生成 golden 后 Rust 侧无需浏览器即可回归）

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

/* ────────────────────────── 场景定义（与 Rust DTO 同形） ────────────────────────── */

/**
 * 节点（**扁平列表**，与 `layout-core-rust` 的 `NodeDto` 字段同名 camelCase）
 *
 * ★为什么用这套形状而不是 PNode：golden 要**被 Rust 直接消费**，
 *   中间不经 PNode 管线 ⇒ 减少一层转译 = 少一处可能对不上的语义。
 */
interface DNode {
  id: number
  parentId: number | null
  width?: number
  height?: number
  flexDirection?: 'row' | 'column'
  flexGrow?: number
  flexShrink?: number
  alignItems?: string
  justifyContent?: string
  margin?: { top?: number; right?: number; bottom?: number; left?: number }
  padding?: { top?: number; right?: number; bottom?: number; left?: number }
  backgroundColor?: string
}

/** 变更（与指令集同语义：SET_STYLE / SET_PROP 的键名） */
interface Mutation {
  /** 目标节点 id */
  id: number
  /** 归一化键（`layout.height` / `layout.width` / `layout.flexGrow` …） */
  key: string
  /** 新值（f32） */
  value: number
}

interface Scenario {
  name: string
  nodes: DNode[]
  mutation: Mutation
  /** 该场景是否**应当**触发增量（而非退化全量）——供 Rust 侧断言"路径确实生效" */
  expectIncremental: boolean
}

const VIEWPORT = { width: 375, height: 667 }

/**
 * 场景集（覆盖"变更**位置**"的三种形态——本仓对增量的核心分类）
 *   · 类A 边界内：改行内子节点 ⇒ 范围应止于该行
 *   · 类B 边界自身：改行自身高度 ⇒ 兄弟移位
 *   · 文本/内容类：改叶子尺寸（不涉文本度量，便于跨端对齐）
 */
const SCENARIOS: Scenario[] = [
  {
    name: '类A · 改行内子节点尺寸（边界内，应有穷重排）',
    nodes: [
      { id: 0, parentId: null, width: 375, height: 600, flexDirection: 'column' },
      { id: 1, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 2, parentId: 1, width: 36, height: 36 },
      { id: 3, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 4, parentId: 3, width: 36, height: 36 },
      { id: 5, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 6, parentId: 5, width: 36, height: 36 },
    ],
    mutation: { id: 2, key: 'layout.width', value: 80 },
    expectIncremental: true,
  },
  {
    name: '类B · 改行自身高度（兄弟移位，范围上浮根）',
    nodes: [
      { id: 0, parentId: null, width: 375, height: 600, flexDirection: 'column' },
      { id: 1, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 2, parentId: 1, width: 36, height: 36 },
      { id: 3, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 4, parentId: 3, width: 36, height: 36 },
      { id: 5, parentId: 0, width: 375, height: 60, flexDirection: 'row', flexShrink: 0 },
      { id: 6, parentId: 5, width: 36, height: 36 },
    ],
    mutation: { id: 1, key: 'layout.height', value: 140 },
    expectIncremental: true,
  },
  {
    name: '非零偏移链 · 改深层叶子宽（范围非根，验证坐标换算）',
    nodes: [
      { id: 0, parentId: null, width: 320, height: 480, flexDirection: 'column' },
      { id: 1, parentId: 0, width: 200, height: 160, flexDirection: 'column', margin: { top: 40 } },
      { id: 2, parentId: 1, width: 120, height: 80, flexDirection: 'row', margin: { left: 24 } },
      { id: 3, parentId: 2, width: 30, height: 30, margin: { top: 12 } },
    ],
    mutation: { id: 3, key: 'layout.width', value: 90 },
    expectIncremental: true,
  },
  {
    name: 'contention · flex-grow 兄弟存在（改尺寸会重分配 ⇒ 必须回退全量）',
    nodes: [
      { id: 0, parentId: null, width: 300, height: 400, flexDirection: 'column' },
      { id: 1, parentId: 0, width: 300, height: 50, flexShrink: 0 },
      { id: 2, parentId: 0, width: 300, flexGrow: 1, height: 100, flexShrink: 0 },
      { id: 3, parentId: 2, width: 20, height: 20 },
    ],
    mutation: { id: 1, key: 'layout.height', value: 120 },
    expectIncremental: false,
  },
]

/* ────────────────────────── DTO → HTML（模型对齐见文件头） ────────────────────────── */

const px = (v: number | undefined): string | null => (v === undefined ? null : `${v}px`)

function styleOf(n: DNode): string {
  const out: string[] = ['box-sizing:border-box', 'min-width:0', 'min-height:0', 'display:flex']
  out.push(`flex-direction:${n.flexDirection ?? 'column'}`)
  out.push(`justify-content:${n.justifyContent ?? 'flex-start'}`)
  out.push(`align-items:${n.alignItems ?? 'stretch'}`)
  out.push(`flex-grow:${n.flexGrow ?? 0}`, `flex-shrink:${n.flexShrink ?? 1}`)
  const w = px(n.width)
  const h = px(n.height)
  if (w) out.push(`width:${w}`)
  if (h) out.push(`height:${h}`)
  const edges = (prefix: string, e?: DNode['margin']): void => {
    if (!e) return
    out.push(`${prefix}-top:${px(e.top) ?? '0px'}`, `${prefix}-right:${px(e.right) ?? '0px'}`, `${prefix}-bottom:${px(e.bottom) ?? '0px'}`, `${prefix}-left:${px(e.left) ?? '0px'}`)
  }
  edges('padding', n.padding)
  edges('margin', n.margin)
  // ★背景色仅用于视觉/调试，不参与布局
  if (n.backgroundColor) out.push(`background:${n.backgroundColor}`)
  return out.join(';')
}

function htmlFor(nodes: DNode[]): string {
  const byParent = new Map<number | null, DNode[]>()
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n)
    byParent.set(n.parentId, arr)
  }
  const render = (n: DNode): string => {
    const kids = (byParent.get(n.id) ?? []).map(render).join('')
    return `<div data-lc="${n.id}" style="${styleOf(n)}">${kids}</div>`
  }
  return (byParent.get(null) ?? []).map(render).join('')
}

/** 归一化键 → DOM 上要改的 CSS 属性（与求解器的键名对齐） */
const CSS_OF_KEY: Record<string, string> = {
  'layout.width': 'width',
  'layout.height': 'height',
  'layout.flexGrow': 'flex-grow',
  'layout.flexShrink': 'flex-shrink',
  'layout.flexBasis': 'flex-basis',
}

/* ────────────────────────── 生成 golden ────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = path.resolve(HERE, '../packages/layout-core-rust/tests/golden')
const GOLDEN = path.join(GOLDEN_DIR, 'browser-mutation.json')

describe('V6 · 增量路径对拍浏览器（变更前/后双状态 golden）', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: VIEWPORT })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('逐场景采集"变更前/后"浏览器 rects 并冻结 golden', async () => {
    const out: Array<{
      name: string
      nodes: DNode[]
      mutation: Mutation
      expectIncremental: boolean
      rectsBefore: Record<string, { x: number; y: number; width: number; height: number }>
      rectsAfter: Record<string, { x: number; y: number; width: number; height: number }>
    }> = []

    for (const sc of SCENARIOS) {
      await page.setContent(`<!doctype html><html><body style="margin:0">${htmlFor(sc.nodes)}</body></html>`)

      const read = async (): Promise<Record<string, { x: number; y: number; width: number; height: number }>> =>
        (await page.evaluate(() => {
          const o: Record<string, { x: number; y: number; width: number; height: number }> = {}
          document.querySelectorAll('[data-lc]').forEach((el) => {
            const id = Number((el as HTMLElement).dataset.lc)
            const r = el.getBoundingClientRect()
            o[id] = { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          return o
        })) as Record<string, { x: number; y: number; width: number; height: number }>

      const rectsBefore = await read()
      // ★先在浏览器里施加变更 → 读"变更后"（**基准真值**）
      const css = CSS_OF_KEY[sc.mutation.key]
      expect(css, `未登记的键：${sc.mutation.key}`).toBeTruthy()
      await page.evaluate(
        ([id, prop, value]) => {
          const el = document.querySelector(`[data-lc="${id}"]`) as HTMLElement | null
          if (!el) throw new Error(`未找到节点 ${id}`)
          el.style.setProperty(prop as string, `${value}px`)
        },
        [sc.mutation.id, css, sc.mutation.value] as const,
      )
      // 强制同步布局（读 rect 本身会触发，但显式一次更稳）
      await page.evaluate(() => document.body.getBoundingClientRect())
      const rectsAfter = await read()

      // 自检：变更**必须真的改变了至少一个节点的几何**（否则用例在测空气——本仓多次吃亏）
      const moved = Object.keys(rectsAfter).filter(
        (k) => JSON.stringify(rectsBefore[k]) !== JSON.stringify(rectsAfter[k]),
      )
      expect(moved.length, `场景「${sc.name}」的变更未产生任何几何变化 ⇒ 用例无意义`).toBeGreaterThan(0)

      out.push({ ...sc, rectsBefore, rectsAfter })
    }

    fs.mkdirSync(GOLDEN_DIR, { recursive: true })
    fs.writeFileSync(
      GOLDEN,
      JSON.stringify(
        {
          generatedBy: 'tests/e2e-layout-incremental-conformance.test.ts',
          note: '★增量路径的浏览器基准：变更前/后两态。Rust 侧消费方式见 tests/incremental_browser_conformance.rs',
          viewport: VIEWPORT,
          tolerance: 0.5,
          scenarios: out,
        },
        null,
        2,
      ) + '\n',
    )

    expect(out.length).toBe(SCENARIOS.length)
  }, 120_000)
})
