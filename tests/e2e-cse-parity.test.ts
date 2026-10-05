// tests/e2e-cse-parity.test.ts
// ★★★G-61 B1：**CSE ⇄ 浏览器 getComputedStyle 逐属性一致性**（判据①-b · 真 Chromium）
//
// 【本文件是 B1 的核心判据（plan `03-consistency-gates.md` §3）】
//   「IR 与浏览器 `getComputedStyle` 逐属性比对，Profile 内目标一致率 **100%**」。
//   ★基准 = Web（D1）：**CSE 是被测方**，浏览器是真值。
//   ★本测试**不比对**：C 类（ratio/auto —— resolved 值是布局结果，归判据②几何，`03` §3.4）。
//     A/B 类（布局无关计算值 / 绝对长度）逐属性判等（见 `cse-parity-cases.ts` 的 `class` 标注）。
//
// 【装置】真 Chromium（Playwright）+ data: URL 注入样式与 DOM（单一 HTML 覆盖全部用例）：
//   一次加载 → `getComputedStyle` 读全部用例节点 → 与 CSE 输出逐属性比对。
//   ★为什么用一个 HTML：浏览器启动 ~1s，100 用例逐条开页面会到分钟级；单页批量把成本压到一次。
//
// 【运行】`npx vitest run tests/e2e-cse-parity.test.ts`（需本机 Playwright Chromium；无则跳过并说明）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { parseStyleSheet, computeTree } from '@proteus-vue/compiler'
import type { CseNode } from '@proteus-vue/compiler'
import { PARITY_CASES } from './fixtures/cse-parity-cases'

/** 视口（与 Web 基准 manifest 的指纹一致：390×844） */
const VIEWPORT = { width: 390, height: 844 }
/** 根 font-size（浏览器默认 16） */
const ROOT_FS = 16

interface CseCaseContext {
  /** CSE 需要的节点树（根应在注入的 HTML 里对应一个 `[data-cse-root="<id>"]` 元素） */
  root: () => CseNode
  css: string
}

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

describe('★★★G-61 B1 · 判据①-b：CSE ≡ 浏览器 getComputedStyle（逐属性）', () => {
  it('前置：Chromium 可用（不可用则本判据无法执行——如实失败，不静默跳过）', () => {
    expect(browserError, `Chromium 启动失败（本判据必须有真浏览器）：${browserError ?? ''}`).toBeNull()
  })

  it(`全部 ${PARITY_CASES.length} 用例逐属性一致（A/B 类；Profile 内目标 100%）`, async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const failures: string[] = []
    let checked = 0
    let compared = 0

    for (const c of PARITY_CASES) {
      // ① CSE 计算（独立于浏览器）
      const root = c.root()
      const sheet = parseStyleSheet(c.css)
      const cse = computeTree([root], sheet, { viewport: VIEWPORT, rootFontSize: ROOT_FS })

      // ② 浏览器：注入该用例的 DOM + 样式，读关键节点 computed
      const html = `<!doctype html><html><head><style>
        html { font-size: ${ROOT_FS}px }
        body { margin: 0 }
        #probe-root { font-size: ${ROOT_FS}px }
        ${c.css}
      </style></head><body><div id="probe-root"></div></body></html>`
      await page.setContent(html)
      // 由用例自声明 DOM 结构（与 CSE 的节点树同形——测试夹具两侧共源）
      await page.evaluate((domHtml) => {
        const holder = document.getElementById('probe-root')!
        const tpl = document.createElement('template')
        tpl.innerHTML = domHtml
        holder.appendChild(tpl.content.cloneNode(true))
      }, c.html)

      // ③ 读浏览器值：逐用例声明的探针（selector + 属性 + 节点 key）
      for (const probe of c.probes) {
        const cseNode = cse.byKey[probe.key]
        if (!cseNode) {
          failures.push(`${c.id}: CSE 缺节点 ${probe.key}`)
          continue
        }
        const browserVals = await page.evaluate(
          ({ selector, props }) => {
            const el = document.querySelector(selector)
            if (!el) return null
            const cs = getComputedStyle(el)
            const out: Record<string, string> = {}
            for (const p of props) out[p] = cs.getPropertyValue(p).trim()
            return out
          },
          { selector: probe.selector, props: probe.props.map((p) => p.css) },
        )
        if (!browserVals) {
          failures.push(`${c.id}: 浏览器找不到 ${probe.selector}`)
          continue
        }
        for (const p of probe.props) {
          checked++
          const expectVal = p.normalize ? p.normalize(browserVals[p.css]!) : normalizeBrowserValue(browserVals[p.css]!)
          const actual = cseNode.fields[p.field]
          const ok = compareValues(actual, expectVal, p.kind)
          compared++
          if (!ok) {
            failures.push(
              `${c.id} · ${probe.selector} · ${p.css} → 字段 ${p.field}\n     浏览器: ${JSON.stringify(expectVal)}\n     CSE   : ${JSON.stringify(actual)}`,
            )
          }
        }
      }
    }

    await page.close()
    console.log(`  比对 ${compared} 项（覆盖 ${PARITY_CASES.length} 用例 · checked=${checked}）`)
    if (failures.length) {
      console.log(`  ✗ ${failures.length} 项不一致：\n    ${failures.join('\n    ')}`)
    }
    expect(failures, `${failures.length} 项不一致`).toEqual([])
  })
})

/** 浏览器值的归一（把 resolved 值转成与 CSE fields 同形态） */
function normalizeBrowserValue(raw: string): unknown {
  const v = raw.trim()
  if (v === '') return undefined
  if (/^-?[\d.]+px$/.test(v)) return Number(v.slice(0, -2))
  if (/^-?[\d.]+$/.test(v)) return Number(v)
  if (/^rgba?\(/.test(v) || /^#/.test(v)) return normalizeColor(v)
  return v // 关键字/枚举/其余（font-family 等）原样
}

function normalizeColor(v: string): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(v)
  if (m) {
    const parts = m[1]!.split(',').map((s) => s.trim())
    const n = (i: number): number => Math.round(Number(parts[i]))
    const hex = (x: number): string => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')
    const base = '#' + hex(n(0)) + hex(n(1)) + hex(n(2))
    if (parts.length >= 4) {
      const a = Number(parts[3])
      if (a < 1) return base + hex(Math.round(a * 255))
    }
    return base
  }
  return v.toLowerCase()
}

/** 逐形态比对（长度/颜色/枚举；kind 决定归一） */
function compareValues(actual: unknown, expected: unknown, kind: string): boolean {
  if (kind === 'length') {
    // CSE 的 absolute 形态 vs 浏览器 px 数
    if (actual === null || actual === undefined) return expected === null || expected === undefined
    if (typeof actual === 'object' && actual !== null && 'kind' in actual) {
      const a = actual as { kind: string; dp?: number }
      if (a.kind === 'absolute') return Math.abs((a.dp ?? 0) - (expected as number)) < 0.01
      return false // ratio/auto ⇒ 不该出现在 length 类断言（夹具错误）
    }
    if (typeof actual === 'number') return Math.abs(actual - (expected as number)) < 0.01
    return false
  }
  if (kind === 'color') {
    const a = typeof actual === 'string' ? actual.toLowerCase() : actual
    const b = typeof expected === 'string' ? expected.toLowerCase() : expected
    return a === b
  }
  if (kind === 'number') {
    return Math.abs((actual as number) - (expected as number)) < 0.001
  }
  // enum / string：字符串等值
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual
  const b = typeof expected === 'string' ? expected.toLowerCase() : expected
  return a === b
}
