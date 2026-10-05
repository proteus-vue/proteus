// tests/e2e-cse-dynamic.test.ts
// ★★★G-61 B2：**动态 `:class` 预计算 ⇄ 浏览器实测一致性**（plan B2 验收判据 · 真 Chromium）
//
// 【判据（plan `04-batches-and-boundaries.md` B2 行）】
//   ①「动态组合 IR 与浏览器该组合实测一致」——**每个组合**都要对：对每种 class 组合，
//      把 CSE 生成的计划表读出的字段值 ⇄ 浏览器在**同一 DOM + 同一活跃类**下的 getComputedStyle。
//   ②「查表 O(1) 有 profile 证据」——见 `tests/cse-dynamic.test.ts`（Proxy 计次）。
//
// 【装置（与 B1 parity 同族，但换了比对面）】
//   B1 是「静态 CSS → CSE ⇄ 浏览器」；本文件是「**动态类各组合** → 计划表 ⇄ 浏览器」——
//   装置上必须**实际切换 DOM 上的类**再读（不能只读基线），否则测不到动态语义。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { extractFromSfc, buildDynamicClassPlans } from '@proteus-vue/compiler'
import { applyDynamicClassPlan } from '@proteus-vue/slot-runtime'

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

interface DynCase {
  id: string
  /** SFC（template + style；`<template>` 里的 `:class` 就是被测绑定） */
  sfc: string
  /** 探针元素的选择器（与 sfc 里的元素对应） */
  probeSelector: string
  /** 逐组合：绑定值（喂给 applyDynamicClassPlan）+ 该组合下 DOM 上的活跃类 */
  combos: Array<{ id: string; classValue: unknown; activeClasses: string[] }>
  /** 比对的字段（IR 字段名 → 浏览器 CSS 属性） */
  fields: Array<{ field: string; css: string; kind: 'color' | 'length' | 'number' | 'enum' }>
}

const CASES: DynCase[] = [
  {
    id: 'dyn-toggle-two',
    sfc: `<template>
  <view class="card" :class="{ on: x, big: y }"><text class="label">x</text></view>
</template>
<style>
.card { padding: 8px; color: #333333; background-color: #ffffff }
.on { background-color: #ff0000; color: #ffffff }
.big { font-size: 20px; padding: 16px }
</style>`,
    probeSelector: '.card',
    combos: [
      { id: 'none', classValue: {}, activeClasses: ['card'] },
      { id: 'on', classValue: { on: true }, activeClasses: ['card', 'on'] },
      { id: 'big', classValue: { big: true }, activeClasses: ['card', 'big'] },
      { id: 'both', classValue: { on: true, big: true }, activeClasses: ['card', 'on', 'big'] },
    ],
    fields: [
      { field: 'backgroundColor', css: 'background-color', kind: 'color' },
      { field: 'color', css: 'color', kind: 'color' },
      { field: 'fontSize', css: 'font-size', kind: 'number' },
      { field: 'paddingTop', css: 'padding-top', kind: 'length' },
    ],
  },
  {
    id: 'dyn-ternary-mutex',
    sfc: `<template>
  <view class="chip" :class="state === 'on' ? 'is-on' : 'is-off'">s</view>
</template>
<style>
.chip { background-color: #eeeeee; color: #111111; padding: 4px }
.is-on { background-color: #00cc00; color: #ffffff }
.is-off { background-color: #cccccc; color: #444444 }
</style>`,
    probeSelector: '.chip',
    combos: [
      { id: 'off', classValue: 'is-off', activeClasses: ['chip', 'is-off'] },
      { id: 'on', classValue: 'is-on', activeClasses: ['chip', 'is-on'] },
    ],
    fields: [
      { field: 'backgroundColor', css: 'background-color', kind: 'color' },
      { field: 'color', css: 'color', kind: 'color' },
    ],
  },
  {
    id: 'dyn-cascade-vs-static',
    sfc: `<template>
  <view class="box" :class="{ strong: s }">b</view>
</template>
<style>
.box { color: #123456; padding: 2px }
.box.strong { color: #ff0000 }
strong { font-size: 30px }
</style>`,
    probeSelector: '.box',
    combos: [
      { id: 'plain', classValue: {}, activeClasses: ['box'] },
      { id: 'strong', classValue: { strong: true }, activeClasses: ['box', 'strong'] },
    ],
    fields: [{ field: 'color', css: 'color', kind: 'color' }],
  },
  {
    id: 'dyn-three-way',
    sfc: `<template>
  <view class="t" :class="{ a: p, b: q, c: r }">t</view>
</template>
<style>
.t { opacity: 1; letter-spacing: 0px }
.a { opacity: 0.8 }
.b { letter-spacing: 2px }
.c { opacity: 0.5 }
</style>`,
    probeSelector: '.t',
    combos: [
      { id: 'none', classValue: {}, activeClasses: ['t'] },
      { id: 'a', classValue: { a: true }, activeClasses: ['t', 'a'] },
      { id: 'b', classValue: { b: true }, activeClasses: ['t', 'b'] },
      { id: 'c', classValue: { c: true }, activeClasses: ['t', 'c'] },
      { id: 'ac', classValue: { a: true, c: true }, activeClasses: ['t', 'a', 'c'] },
    ],
    fields: [
      { field: 'opacity', css: 'opacity', kind: 'number' },
      { field: 'letterSpacing', css: 'letter-spacing', kind: 'number' },
    ],
  },
]

function normalizeBrowser(raw: string): unknown {
  const v = raw.trim()
  // ★letter-spacing 的 0 等价形态：浏览器对 `letter-spacing: 0px` 返回 `normal`（且 normal = 0）
  //   ⇒ 归一为 0（CSE 侧同口径；B1 parity 未覆盖此等价，B2 抓到）
  if (v === 'normal') return 0
  if (/^-?[\d.]+px$/.test(v)) return Number(v.slice(0, -2))
  if (/^-?[\d.]+$/.test(v)) return Number(v)
  const m = /^rgba?\(([^)]+)\)$/.exec(v)
  if (m) {
    const parts = m[1]!.split(',').map((s) => Number(s.trim()))
    const hx = (x: number): string => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')
    const base = '#' + hx(parts[0]!) + hx(parts[1]!) + hx(parts[2]!)
    return parts.length >= 4 && parts[3]! < 1 ? base + hx(parts[3]! * 255) : base
  }
  return v.toLowerCase()
}

function fieldMatches(actual: unknown, expected: unknown, kind: string): boolean {
  if (kind === 'length') {
    if (actual === undefined || actual === null) return expected === undefined
    const dp = typeof actual === 'object' && actual !== null && 'dp' in actual ? (actual as { dp: number }).dp : undefined
    return dp !== undefined && Math.abs(dp - (expected as number)) < 0.01
  }
  if (kind === 'number') return Math.abs((actual as number) - (expected as number)) < 0.001
  return String(actual).toLowerCase() === String(expected).toLowerCase()
}

describe('★★★G-61 B2 · 动态 :class 计划 ⇄ 浏览器逐组合实测', () => {
  it('前置：Chromium 可用', () => {
    expect(browserError, `Chromium 启动失败：${browserError ?? ''}`).toBeNull()
  })

  it(`全部 ${CASES.length} 用例 × 逐组合 × 逐字段一致`, async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const failures: string[] = []
    let combosChecked = 0
    let fieldsChecked = 0

    for (const c of CASES) {
      // ① 计划（编译期）
      const ex = extractFromSfc(c.sfc)
      const { plans, diagnostics } = buildDynamicClassPlans(ex.roots, ex.sheet, ex.classBindings, { inlineStyles: ex.inlineStyles })
      const errors = diagnostics.filter((d) => d.level === 'error')
      if (errors.length) {
        failures.push(`${c.id}: 生成端 error——${errors.map((e) => e.code).join(',')}`)
        continue
      }
      const planKey = Object.keys(plans)[0]
      if (!planKey) {
        failures.push(`${c.id}: 未产出计划（动态类未影响任何字段？）`)
        continue
      }
      const plan = plans[planKey]!

      // ② 逐组合：计划表读值 ⇄ 浏览器（真的切 DOM 类再读）
      const styleTag = c.sfc.slice(c.sfc.indexOf('<style>') + 7, c.sfc.lastIndexOf('</style>'))
      const cls = c.probeSelector.replace(/^\./, '')
      await page.setContent(`<!doctype html><html><head><style>html{font-size:16px}body{margin:0}${styleTag}</style></head>
        <body><div class="${cls}" id="probe"></div></body></html>`)

      for (const combo of c.combos) {
        combosChecked++
        await page.evaluate((classes) => {
          const el = document.getElementById('probe')!
          el.className = classes.join(' ')
        }, combo.activeClasses)
        const browserVals = await page.evaluate(
          ({ props }) => {
            const el = document.getElementById('probe')!
            const cs = getComputedStyle(el)
            const out: Record<string, string> = {}
            for (const p of props) out[p] = cs.getPropertyValue(p).trim()
            return out
          },
          { props: c.fields.map((f) => f.css) },
        )
        const out: Record<string, unknown> = {}
        applyDynamicClassPlan(combo.classValue, plan, out)
        for (const f of c.fields) {
          fieldsChecked++
          const actual = out[f.field]
          const expected = normalizeBrowser(browserVals[f.css]!)
          if (!fieldMatches(actual, expected, f.kind)) {
            failures.push(`${c.id} · combo=${combo.id} · ${f.field}：计划=${JSON.stringify(actual)} 浏览器=${JSON.stringify(expected)}`)
          }
        }
      }
    }
    await page.close()
    console.log(`  动态组合比对：${combosChecked} 组合 / ${fieldsChecked} 字段项`)
    if (failures.length) console.log('  ✗\n    ' + failures.join('\n    '))
    expect(failures).toEqual([])
  })
})
