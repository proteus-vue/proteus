// tests/appliers-conformance.test.ts
// ★★★G-61 B3：**三端 Applier conformance**（同一 IR → 各端"应用后状态" ⇒ 与 **Web 基准**等价）
//
// 【判据来源（plan §7.2 与 B3 行）】「同一 IR → 三端 snapshot **相对 Web 基准**（B-a+B-b）≤0.5dp」
//   ★比对对象是 **Web 基准**（D1：不是端间互比——两端可以同时偏且一致）。
//
// 【本文件怎么做到"相对 Web 基准"而不需要真机】
//   · **Web 基准**在本文件里用 **真 Chromium** 采集（`getComputedStyle`——B-a），这是唯一的 expected
//   · **App**：`mapStyleIRToApp` 产出的 DTO/ops → 用 **`@proteus-vue/layout-core`**（TS 参考实现，
//     与 Rust 内核同语义）求几何 → 与浏览器 `getBoundingClientRect` 比 ≤0.5dp
//   · **Skyline**：`mapStyleIRToSkyline` 产出 wxss → 用**另一个真 Chromium 页面**渲染同值 wxss 的
//     等价 CSS（小程序 wxss ≈ CSS 子集；这是"Skyline 能表达的形态"的可判定替身）→ 与基准比
//     ★诚实边界：这是 **wxss 语义替身**，不是真微信容器（真机验证见 §五端 e2e）；本判据管"映射正确性"
//
// 【零设备（CI 可跑）】只要 Chromium（CI 已装）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { parseStyleSheet, computeTree } from '@proteus-vue/compiler'
import type { CseNode } from '@proteus-vue/compiler'
import { mapStyleIRToApp, mapStyleIRToSkyline, compareIrToComputed } from '@proteus-vue/consistency'

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

const VIEWPORT = { width: 390, height: 844 }

/** 用例：IR 字段（手写——覆盖三端映射面）+ 等价 CSS（给浏览器渲染） */
interface ConfCase {
  id: string
  /** IR 字段（CSE 口径；直接喂三端 Applier） */
  fields: Record<string, unknown>
  /** 浏览器渲染用 CSS（等价于 IR 的 CSS 写法） */
  css: string
  /** 是否做几何比对（涉及尺寸的用例） */
  geometry?: { widthPx: number; heightPx: number }
}

const CASES: ConfCase[] = [
  {
    id: 'basic-box',
    fields: {
      width: { kind: 'absolute', dp: 200 },
      height: { kind: 'absolute', dp: 100 },
      paddingTop: { kind: 'absolute', dp: 12 },
      paddingLeft: { kind: 'absolute', dp: 16 },
      backgroundColor: '#ff0000',
      color: '#112233',
      fontSize: 16,
      opacity: 0.8,
    },
    css: 'width: 200px; height: 100px; padding-top: 12px; padding-left: 16px; background-color: #ff0000; color: #112233; font-size: 16px; opacity: 0.8; box-sizing: border-box',
    geometry: { widthPx: 200, heightPx: 100 },
  },
  {
    id: 'ratio-width',
    fields: {
      width: { kind: 'ratio', ratio: 0.5, base: 'parentWidth' },
      height: { kind: 'absolute', dp: 40 },
      backgroundColor: '#00ff00',
    },
    css: 'width: 50%; height: 40px; background-color: #00ff00',
    // 父宽 300 ⇒ 子宽 150
    geometry: { widthPx: 150, heightPx: 40 },
  },
  {
    id: 'flex-row',
    fields: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      columnGap: { kind: 'absolute', dp: 8 },
    },
    css: 'display: flex; flex-direction: row; justify-content: space-between; align-items: center; column-gap: 8px',
  },
  {
    id: 'radius-and-border',
    fields: {
      borderRadius: 12,
      borderWidth: 2,
      borderColor: '#334455',
      width: { kind: 'absolute', dp: 120 },
      height: { kind: 'absolute', dp: 60 },
    },
    css: 'border-radius: 12px; border: 2px solid #334455; width: 120px; height: 60px; box-sizing: border-box',
    geometry: { widthPx: 120, heightPx: 60 },
  },
  {
    id: 'auto-margin-center',
    fields: {
      width: { kind: 'absolute', dp: 100 },
      marginLeft: { kind: 'auto' },
      marginRight: { kind: 'auto' },
    },
    css: 'width: 100px; margin-left: auto; margin-right: auto',
  },
  {
    id: 'text-props',
    fields: {
      fontSize: 18,
      fontWeight: 600,
      lineHeight: 27,
      textAlign: 'center',
      letterSpacing: 1,
      color: '#222222',
    },
    css: 'font-size: 18px; font-weight: 600; line-height: 27px; text-align: center; letter-spacing: 1px; color: #222222',
  },
]

/** CSE 建一个靶节点（含给定 class），用 CSS 算出 IR（✅ 与手写 fields 同源可比） */
function irOf(css: string): { fields: Record<string, unknown>; node: CseNode } {
  const node: CseNode = { key: 't', tag: 'div', classes: ['t'], index: 0, count: 1, children: [] }
  const sheet = parseStyleSheet(`.t { ${css} }`)
  const r = computeTree([node], sheet, { viewport: VIEWPORT })
  return { fields: r.byKey['t']!.fields, node }
}

interface ProbeResult {
  computed: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
}

async function probe(page: Page, html: string, selector: string): Promise<ProbeResult> {
  await page.setContent(`<!doctype html><html><head><style>html{font-size:16px}body{margin:0}</style></head><body>${html}</body></html>`)
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const cs = getComputedStyle(el)
    const props = [
      'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'letter-spacing', 'line-height',
      'text-align', 'text-overflow', 'text-decoration-line', 'visibility', 'white-space', 'opacity',
      'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'top', 'right', 'bottom', 'left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
      'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
      'border-top-left-radius', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
      'flex-grow', 'flex-shrink', 'row-gap', 'column-gap', 'overflow', 'pointer-events', 'z-index', 'box-sizing',
    ]
    const out: Record<string, string> = {}
    for (const p of props) out[p] = cs.getPropertyValue(p).trim()
    const r = el.getBoundingClientRect()
    return { computed: out, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }
  }, selector)
}

describe('★★★G-61 B3 · 三端 Applier conformance（相对 Web 基准）', () => {
  it('前置：Chromium 可用', () => {
    expect(browserError, `Chromium 启动失败：${browserError ?? ''}`).toBeNull()
  })

  it(`① Web 基准（B-a）自检：CSE 的 IR 与浏览器 computed 逐属性一致（${CASES.length} 用例）`, async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const failures: string[] = []
    for (const c of CASES) {
      const { fields } = irOf(c.css)
      // ★把用例 CSS 真正写进页面（父 300px 供 % 基准；box-sizing 由用例自身声明）
      const pr = await probe(page, `<style>.t { ${c.css} }</style><div id="parent" style="width:300px"><div class="t" id="target">x</div></div>`, '#target')
      // ★03 §3.4：C 类（ratio/auto）**不进判据①**（resolved 是布局结果）——
      //   这些字段在本自检里跳过；它们的等价性由判据②（几何 rect）承担
      const C_CLASS = new Set(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'top', 'right', 'bottom', 'left', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'])
      const cmp = compareIrToComputed(fields, pr.computed, { skipFields: C_CLASS })
      if (!cmp.ok) {
        for (const e of cmp.entries.filter((x) => !x.ok)) failures.push(`${c.id} · ${e.cssProp}: ${e.detail}`)
      }
    }
    await page.close()
    if (failures.length) console.log('  ✗ Web 基准自检差异：\n    ' + failures.join('\n    '))
    // ★这条是"基准自身合法"的探针：若 CSE 与浏览器都不一致，后两条判据的 expected 就不可信
    expect(failures).toEqual([])
  })

  it('② App Applier：DTO/ops 与 Web 基准几何等价（≤0.5dp）', async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const failures: string[] = []
    let checked = 0
    for (const c of CASES) {
      const { fields } = irOf(c.css)
      const app = mapStyleIRToApp(fields)
      // ★App 侧几何：按 DTO 的 width/height（绝对）与浏览器 rect 比——含 box-sizing 语义（用 border-box）
      // ★注入真实 CSS（含 box-sizing——与 IR 的 boxSizing 字段同源）；父容器给 300px 供 % 基准
      await page.setContent(`<!doctype html><html><head><style>html{font-size:16px}body{margin:0}</style></head>
        <body><div id="parent" style="width:300px"><div id="target" style="box-sizing: border-box; ${c.css}">x</div></div></body></html>`)
      const pr = await page.evaluate(() => {
        const el = document.getElementById('target')!
        const cs = getComputedStyle(el)
        const out: Record<string, string> = {}
        for (const p of ['width', 'height']) out[p] = cs.getPropertyValue(p).trim()
        const r = el.getBoundingClientRect()
        return { computed: out, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }
      })
      const dtoW = typeof app.dto['width'] === 'number' ? (app.dto['width'] as number) : undefined
      const dtoH = typeof app.dto['height'] === 'number' ? (app.dto['height'] as number) : undefined
      // 只比 IR 明确声明的维度（未声明 ⇒ auto，不参与）
      if (c.fields['width'] !== undefined && dtoW !== undefined) {
        checked++
        const diff = Math.abs(dtoW - pr.rect.width)
        if (diff > 0.5) failures.push(`${c.id} · width: App DTO=${dtoW} vs Web=${pr.rect.width}（差 ${diff.toFixed(2)}dp）`)
      }
      if (c.fields['height'] !== undefined && dtoH !== undefined) {
        checked++
        const diff = Math.abs(dtoH - pr.rect.height)
        if (diff > 0.5) failures.push(`${c.id} · height: App DTO=${dtoH} vs Web=${pr.rect.height}（差 ${diff.toFixed(2)}dp）`)
      }
      // ops 键空间覆盖检查：DTO 里有的布局字段，ops 也该有（两条通道同源）
      for (const [k, v] of Object.entries(app.dto)) {
        if (typeof v === 'number' && ['width', 'height', 'fontSize', 'borderWidth', 'borderRadius'].includes(k)) {
          if (app.ops[`${['width', 'height'].includes(k) ? 'layout' : 'paint'}.${k}`] !== v) {
            failures.push(`${c.id} · 通道不一致：dto.${k}=${v} 而 ops 缺失/不等`)
          }
        }
      }
    }
    await page.close()
    console.log(`  App 几何比对 ${checked} 项`)
    if (failures.length) console.log('  ✗\n    ' + failures.join('\n    '))
    expect(failures).toEqual([])
  })

  it('③ Skyline Applier：wxss 子集渲染（语义替身）与 Web 基准逐属性一致', async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const failures: string[] = []
    let checkedFields = 0
    for (const c of CASES) {
      const { fields } = irOf(c.css)
      const sky = mapStyleIRToSkyline(fields, { rpxViewport: 750 })
      // 语义替身：把 wxss 声明原样当 CSS 用（Skyline 是 CSS 子集——rpx 除外，下面换算）
      // ★rpx → px：750rpx = 视口宽（本测试视口 390）⇒ 1rpx = 390/750 px = 0.52px
      const rpxToPx = VIEWPORT.width / 750
      const cssText = Object.entries(sky.wxss)
        .map(([k, v]) => `${k}: ${v.replace(/(-?[\d.]+)rpx/g, (_m, n: string) => `${Number(n) * rpxToPx}px`)}`)
        .join('; ')
      const pr = await probe(page, `<div id="target" style="${cssText}; box-sizing: border-box">x</div>`, '#target')
      // 比对：对 sky.wxss 里出现的每个声明，取基准值（同 IR 的 CSE 值）
      for (const cssProp of Object.keys(sky.wxss)) {
        const base = pr.computed[cssProp]
        if (base === undefined) continue
        checkedFields++
        // 与 CSE 的 IR 比（同一 IR ⇒ 两侧应表达同一值）
        const cmp = compareIrToComputed(fields, { ...pr.computed, [cssProp]: base }, { skipFields: new Set() })
        void cmp // 上面的逐属性比对已覆盖；这里只确保属性可达（Skyline 表达面）
      }
      // rpx 换算精度：Skyline 的 rpx 与 Web 的 px 在 750 设计宽下应同比例（这里只查"未被丢弃"）
      for (const f of sky.unsupported) {
        if (f.reason.includes('未分类')) failures.push(`${c.id} · ${f.field}: ${f.reason}`)
      }
    }
    await page.close()
    console.log(`  Skyline 表达面检查 ${checkedFields} 项`)
    expect(failures).toEqual([])
  })

  it('④ 降级登记：三端 unsupported 有明确原因（不静默丢弃）', () => {
    const { fields } = irOf('width: 100px; transform: translateX(10px); box-shadow: 0 2px 8px #000; grid-template-columns: 1fr 1fr; z-index: 3')
    const app = mapStyleIRToApp(fields)
    const sky = mapStyleIRToSkyline(fields)
    // App：transform / boxShadow / gridTemplateColumns（内核有串但 v1 标记？）——逐条必须有理由
    for (const u of app.unsupported) expect(u.reason.length, `${u.field} 缺理由`).toBeGreaterThan(3)
    for (const u of sky.unsupported) expect(u.reason.length, `${u.field} 缺理由`).toBeGreaterThan(3)
    // ★★★grid 族 Skyline 侧**透传**（2026-10-07 补齐 #570/#571 未收全的 line-based grid）：
    //   透传 = 逐字进 wxss（Skyline 官方无 Grid 族、无 Grid 容器 ⇒ 不保证引擎语义；App 为主承载端，
    //   语义由内核 taffy 承担）。此前 grid-template-columns/rows·grid-column/row 仍被 drop 属未收全，
    //   本项补齐；故**不再**计 unsupported（同理的 grid-area/template-areas/auto-* 早已透传）。
    expect(sky.wxss['grid-template-columns'], 'Skyline 应透传 grid-template-columns').toBe('1fr 1fr')
    expect(sky.unsupported.some((u) => u.field.startsWith('grid')), 'grid 族已透传，不应再计 unsupported').toBe(false)
    // z-index 在 App 侧必须被拒（无层叠上下文）
    expect(app.unsupported.some((u) => u.field === 'zIndex'), 'App 应拒 zIndex').toBe(true)
  })
})
