// tests/e2e-overlay-family.test.ts
// ★2026-09-07 弹层族自动化复测（验证框架自动化能否提前抓 p-modal 类定位问题）：
//   覆盖 p-drawer（side=left 左侧滑出）/ p-action-sheet（底部弹出）/ p-popover（anchor 气泡）
//   断言 = 面板出现 + 定位语义（drawer left≈0 全高 / action-sheet bottom≈视口底）+ mask 点击关闭（v-model 回传）
//   若某弹层「不出现 / 位置错 / 关不掉」→ 测试红 = 自动化提前抓到（无需真机）
// 运行：npm run test:e2e:web（build:web + preview examples/dist/web + Chromium）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4176'
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: EXAMPLES_ROOT, mode: 'web', build: { outDir: path.join(EXAMPLES_ROOT, 'dist/web') }, preview: { port: 4176 } })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 按文本找按钮并点击 */
async function clickButtonByText(text: string): Promise<boolean> {
  return page.evaluate((t) => {
    const all = [...document.querySelectorAll('button, [role="button"], .p-button')] as HTMLElement[]
    const b = all.find((x) => (x.textContent ?? '').includes(t))
    if (b) b.click()
    return !!b
  }, text)
}

/** 等选择器出现且可见（height>0） */
async function waitVisible(selector: string, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    ([sel]) => {
      const el = document.querySelector(sel)
      return !!el && el.getBoundingClientRect().height > 0 && (el as HTMLElement).style.display !== 'none'
    },
    [selector] as const,
    { timeout },
  )
}

/** 等选择器消失（元素移除或不可见） */
async function waitGone(selector: string, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    ([sel]) => {
      const el = document.querySelector(sel)
      if (!el) return true
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.height === 0 || style.display === 'none' || style.visibility === 'hidden'
    },
    [selector] as const,
    { timeout },
  )
}

async function rectOf(selector: string): Promise<{ x: number; y: number; w: number; h: number; vw: number; vh: number }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!el) return { x: -1, y: -1, w: 0, h: 0, vw, vh }
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw, vh }
  }, selector)
}

describe('弹层族自动化复测（★自动化提前抓定位问题）', () => {
  it('p-drawer side=left：点「打开抽屉」→ 面板左侧滑出（x≈0 全高）+ 点遮罩关闭', async () => {
    await page.goto(`${BASE}/pages/semantic-primitives-demo`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    expect(await clickButtonByText('打开抽屉')).toBe(true)
    await waitVisible('.p-drawer-mask')
    await page.waitForTimeout(450) // drawer transform 滑入 0.25s——等动画完成再测定位
    const r = await rectOf('.p-drawer')
    // side=left：面板 x≈0、宽度≈240、高度≈视口
    expect(r.w).toBeGreaterThan(100)
    expect(Math.abs(r.x)).toBeLessThan(20)
    expect(r.h).toBeGreaterThan(r.vh * 0.8)
    // 遮罩点击关闭（v-model 回传 false）
    await page.click('.p-drawer-mask', { position: { x: 380, y: 400 } })
    await waitGone('.p-drawer-mask')
  }, 30_000)

  it('p-action-sheet：点「打开动作面板」→ 面板底部弹出（bottom≈视口底）+ cancel 关闭', async () => {
    await page.goto(`${BASE}/pages/semantic-primitives-demo`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    expect(await clickButtonByText('打开动作面板')).toBe(true)
    await waitVisible('.p-as-mask')
    const r = await rectOf('.p-as-panel')
    expect(r.w).toBeGreaterThan(100)
    // 底部 sheet：panel 底 ≈ 视口底
    expect(Math.abs(r.y + r.h - r.vh)).toBeLessThan(30)
    // cancel 元素直接点（文本各语言/自定义不定）关闭
    await page.click('.p-as-cancel', { timeout: 5000 })
    await waitGone('.p-as-mask')
  }, 30_000)

  it('p-popover：点「触发气泡」→ 气泡面板出现（anchor 下方区域）+ 遮罩关闭', async () => {
    await page.goto(`${BASE}/pages/semantic-primitives-demo`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    expect(await clickButtonByText('触发气泡')).toBe(true)
    await waitVisible('.p-popover-panel, .p-popover-mask')
    const r = await rectOf('.p-popover-panel')
    expect(r.w).toBeGreaterThan(50)
    expect(r.h).toBeGreaterThan(20)
    // 遮罩关闭
    await page.click('.p-popover-mask', { position: { x: 200, y: 700 } })
    await waitGone('.p-popover-mask')
  }, 30_000)
})
