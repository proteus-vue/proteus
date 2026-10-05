// tests/degrade-conformance.test.ts
// ★★★G-61 B4：**降级配方 conformance**（plan B4 行：「降级产物过 Applier conformance」）
//
// 【怎么判"降级语义等价"（真 Chromium，零设备）】
//   同一份 IR **两种渲染**：
//     A（原样）：原生 grid CSS（浏览器原生支持——A 端真值）
//     B（降级）：配方改写后的 flex + 子项 flex 比例 CSS
//   ⇒ 逐节点 `getBoundingClientRect` 比 **≤0.5dp**。这就是"配方不改变版面"的机器判据。
//   ★诚实边界：只对**配方声明适用的形态**（单行/无跨行）判等价；不适用的形态必须**拒绝**
//     （测试里专门断言：多行网格必须 ok=false——不静默近似）。
//
// 【lint 判据（同批）】E-CSS-004/005/006 与 W-CSS-101/102/103/105 的**触发与不触发**成对断言
//   （防"规则写了但永不触发"的假门禁——本仓纪律：判据须证明能抓）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { parseStyleSheet, computeTree, applyDegradeRecipe, lintCse } from '@proteus-vue/compiler'
import type { CseNode } from '@proteus-vue/compiler'

let browser: Browser | undefined
let browserError: string | null = null

beforeAll(async () => {
  try {
    browser = await chromium.launch()
  } catch (e) {
    browserError = e instanceof Error ? e.message : String(e)
  }
}, 120_000)
afterAll(async () => {
  await browser?.close()
})

interface GridCase {
  id: string
  /** 容器 CSS（原生 grid） */
  containerCss: string
  /** 子项 CSS（可选） */
  childCss?: string
  /** 子项数 */
  childCount: number
  /** 是否期望可降级 */
  degradable: boolean
  /** 不可降级的原因片段（degradable=false 时断言） */
  reasonIncludes?: string
}

const GRID_CASES: GridCase[] = [
  { id: 'single-row-fr', containerCss: 'display: grid; grid-template-columns: 1fr 2fr; width: 300px; height: 60px', childCount: 2, degradable: true },
  { id: 'single-row-fr-gap', containerCss: 'display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; width: 300px; height: 40px', childCount: 3, degradable: true },
  { id: 'single-row-px-fr', containerCss: 'display: grid; grid-template-columns: 100px 1fr; width: 300px; height: 40px', childCount: 2, degradable: true },
  { id: 'two-row-must-reject', containerCss: 'display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 40px 40px; width: 300px; height: 100px', childCount: 4, degradable: false, reasonIncludes: '多行' },
  { id: 'no-fr-must-reject', containerCss: 'display: grid; grid-template-columns: 100px 200px; width: 300px; height: 40px', childCount: 2, degradable: false, reasonIncludes: '无 fr' },
]

function irOf(css: string, childCount: number): { fields: Record<string, unknown>; roots: CseNode[] } {
  const kids: CseNode[] = Array.from({ length: childCount }, (_, i) => ({
    key: `k${i}`, tag: 'div', classes: ['kid'], index: i, count: childCount, children: [],
  }))
  const root: CseNode = { key: 'root', tag: 'div', classes: ['box'], index: 0, count: 1, children: kids }
  const sheet = parseStyleSheet(`.box { ${css} } .kid { height: 20px; background-color: #eee }`)
  const r = computeTree([root], sheet, { viewport: { width: 390, height: 844 } })
  return { fields: r.byKey['root']!.fields, roots: [root] }
}

/** 由 IR 字段表还原成可渲染 CSS（测试装置：值已在编译期折叠——直接拼） */
function cssOf(fields: Record<string, unknown>): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    const cssKey = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (typeof v === 'object' && v !== null && 'kind' in (v as Record<string, unknown>)) {
      const l = v as { kind: string; dp?: number; ratio?: number; base?: string }
      if (l.kind === 'absolute') out.push(`${cssKey}: ${l.dp}px`)
      else if (l.kind === 'ratio') out.push(`${cssKey}: ${(l.ratio ?? 0) * 100}%`)
      else if (l.kind === 'auto') out.push(`${cssKey}: auto`)
      continue
    }
    if (typeof v === 'number') out.push(`${cssKey}: ${v}px`)
    else out.push(`${cssKey}: ${String(v)}`)
  }
  return out.join('; ')
}

/** 子项字段 → CSS（margin/flex 等） */
function childCssOf(f: Record<string, unknown> | null): string {
  if (!f) return ''
  const out: string[] = []
  for (const [k, v] of Object.entries(f)) {
    const cssKey = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (typeof v === 'object' && v !== null && 'kind' in (v as Record<string, unknown>)) {
      const l = v as { kind: string; dp?: number }
      if (l.kind === 'absolute') out.push(`${cssKey}: ${l.dp}px`)
      else if ((l as { kind: string }).kind === 'auto') out.push(`${cssKey}: auto`)
      continue
    }
    if (typeof v === 'number') out.push(`${cssKey}: ${k === 'flexGrow' || k === 'flexShrink' ? v : v + 'px'}`)
    else out.push(`${cssKey}: ${String(v)}`)
  }
  return out.join('; ')
}

async function rect(page: Page, html: string): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  await page.setContent(`<!doctype html><html><head><style>html{font-size:16px}body{margin:0}</style></head><body>${html}</body></html>`)
  return page.evaluate(() =>
    [...document.querySelectorAll('.kid')].map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
}

describe('★★★G-61 B4 · 降级配方 conformance（grid→flex 与原生 grid 逐节点 ≤0.5dp）', () => {
  it('前置：Chromium 可用', () => {
    expect(browserError).toBeNull()
  })

  it(`全部 ${GRID_CASES.length} 用例：可降级者对拍 ≤0.5dp；不可降级者**拒绝**（不静默近似）`, async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const failures: string[] = []
    for (const c of GRID_CASES) {
      const { fields } = irOf(c.containerCss, c.childCount)
      const deg = applyDegradeRecipe('grid-to-flex', fields, { childCount: c.childCount })
      if (!c.degradable) {
        if (deg.ok) failures.push(`${c.id}: 应拒绝降级但 ok=true（静默近似——违约）`)
        else if (c.reasonIncludes && !deg.reason?.includes(c.reasonIncludes)) {
          failures.push(`${c.id}: 拒绝原因不含「${c.reasonIncludes}」（实际：${deg.reason}）`)
        }
        continue
      }
      if (!deg.ok) {
        failures.push(`${c.id}: 应可降级但 ok=false（${deg.reason}）`)
        continue
      }
      // A：原生 grid
      const kidsA = Array.from({ length: c.childCount }, () => `<div class="kid"></div>`).join('')
      const rectsA = await rect(page, `<div class="box" style="${cssOf(fields)}">${kidsA}</div>`)
      // B：降级 flex（容器改写 + 子项补充；★若子项拿到 flexBasis=0，还原 CSS 时 0px 需正确）
      const kidsB = Array.from({ length: c.childCount }, (_, i) => {
        const cf = deg.childFields?.[i] ?? null
        return `<div class="kid" style="${childCssOf(cf)}"></div>`
      }).join('')
      const rectsB = await rect(page, `<div class="box" style="${cssOf(deg.fields)}">${kidsB}</div>`)
      if (rectsA.length !== rectsB.length) {
        failures.push(`${c.id}: 子项数不同（${rectsA.length} vs ${rectsB.length}）`)
        continue
      }
      for (let i = 0; i < rectsA.length; i++) {
        for (const k of ['x', 'w'] as const) {
          const d = Math.abs(rectsA[i]![k] - rectsB[i]![k])
          if (d > 0.5) failures.push(`${c.id} · 子项${i}.${k}: grid=${rectsA[i]![k]} flex=${rectsB[i]![k]}（Δ${d.toFixed(2)}）`)
        }
      }
    }
    await page.close()
    if (failures.length) console.log('  ✗\n    ' + failures.join('\n    '))
    expect(failures).toEqual([])
  })

  it('gap→margin 配方：逐子项半距叠加 = 原 gap（几何对拍）', async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const count = 3
    const gap = 12
    // A：原生 gap
    const kidsA = Array.from({ length: count }, () => `<div class="kid"></div>`).join('')
    const rectsA = await rect(page, `<div style="display:flex; gap:${gap}px; width:300px">${kidsA}</div>`)
    // B：配方（gap→margin）
    const deg = applyDegradeRecipe('gap-to-margin', { display: 'flex', gap }, { childCount: count })
    expect(deg.ok).toBe(true)
    const kidsB = Array.from({ length: count }, (_, i) => `<div class="kid" style="${childCssOf(deg.childFields?.[i] ?? null)}"></div>`).join('')
    const rectsB = await rect(page, `<div style="${cssOf(deg.fields)}; width:300px">${kidsB}</div>`)
    const failures: string[] = []
    for (let i = 0; i < count; i++) {
      const d = Math.abs(rectsA[i]!.x - rectsB[i]!.x)
      if (d > 0.5) failures.push(`子项${i}.x: gap=${rectsA[i]!.x} margin=${rectsB[i]!.x}（Δ${d.toFixed(2)}）`)
    }
    await page.close()
    if (failures.length) console.log('  ✗ ' + failures.join('; '))
    expect(failures).toEqual([])
  })
})

describe('★★★G-61 B4 · lint 规则（E/W 族触发与不触发成对断言）', () => {
  const lintOf = (css: string, opts?: Parameters<typeof lintCse>[2]) => {
    const sheet = parseStyleSheet(css)
    const node: CseNode = { key: 'root', tag: 'div', classes: ['a'], index: 0, count: 1, children: [] }
    return lintCse(sheet, [node], opts)
  }

  it('W-CSS-101 嵌套 >3 触发；3 层不触发', () => {
    expect(lintOf('.a .b .c .d { color: #111111 }').some((d) => d.code === 'W-CSS-101')).toBe(true)
    expect(lintOf('.a .b .c { color: #111111 }').some((d) => d.code === 'W-CSS-101')).toBe(false)
  })

  it('W-CSS-102 !important / W-CSS-103 ID 触发', () => {
    expect(lintOf('.a { color: #111111 !important }').some((d) => d.code === 'W-CSS-102')).toBe(true)
    expect(lintOf('#x { color: #111111 }').some((d) => d.code === 'W-CSS-103')).toBe(true)
    expect(lintOf('.a { color: #111111 }').some((d) => d.code === 'W-CSS-102' || d.code === 'W-CSS-103')).toBe(false)
  })

  it('W-CSS-105 Skyline 的 grid ⇒ warn（可降级）；Web 同写法不触发', () => {
    const sky = lintOf('.a { display: grid }', {
      target: 'skyline',
      unsupportedDecls: [{ prop: 'display', accept: ['none', 'flex', 'block'] }],
    })
    expect(sky.some((d) => d.code === 'W-CSS-105')).toBe(true)
    const web = lintOf('.a { display: grid }', { target: 'web' })
    expect(web.some((d) => d.code === 'W-CSS-105')).toBe(false)
  })

  it('E-CSS-003 Profile 外属性 ⇒ error（Web 端同样报——D4 基准自身合法）', () => {
    const web = lintOf('.a { float: left }', {
      target: 'web',
      unsupportedDecls: [{ prop: 'float', accept: [] }],
    })
    expect(web.some((d) => d.code === 'E-CSS-003' && d.severity === 'error')).toBe(true)
  })

  it('E-CSS-004 不可枚举 :class / E-CSS-005 表超限 / W-CSS-104 接近阈值', () => {
    const err = lintOf('.a { color: #111111 }', { dynamicErrors: [{ nodeKey: 'root', expr: 'someVar', reason: '标识符' }] })
    expect(err.some((d) => d.code === 'E-CSS-004' && d.severity === 'error')).toBe(true)
    const over = lintOf('.a { color: #111111 }', {
      classPlans: { root: { classes: [], tables: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, { kind: 'bits', values: [] }])), stats: { dynamicProps: 17, maxValues: 1, combos: 17 } } },
    })
    expect(over.some((d) => d.code === 'E-CSS-005' && d.severity === 'error')).toBe(true)
    const near = lintOf('.a { color: #111111 }', {
      classPlans: { root: { classes: [], tables: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, { kind: 'bits', values: [] }])), stats: { dynamicProps: 13, maxValues: 1, combos: 13 } } },
    })
    expect(near.some((d) => d.code === 'W-CSS-104')).toBe(true)
  })

  it('E-CSS-006 拍平违规 ⇒ error（消费 component-ir 的产出）', () => {
    const d = lintOf('.a { color: #111111 }', { flattenViolations: [{ nodeId: 7, reason: '拍平节点绑定了事件' }] })
    expect(d.some((x) => x.code === 'E-CSS-006' && x.severity === 'error')).toBe(true)
  })
})
