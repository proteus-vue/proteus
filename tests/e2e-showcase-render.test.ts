// tests/e2e-showcase-render.test.ts
// ★showcase 页面渲染门禁（E2E）——★用户实测教训（2026-09-13）后新增：
//   p-button 在 Web 端因缺 style.css 而不可见，此前 E2E 只断言路由/data/文本 → 全绿却人眼可见故障。
//   本 spec 对 showcase 每个页面跑「非空白 + 关键元素可见 + 无 console 错误」，
//   **人眼能看到的渲染故障，这里必须红**。
// 运行：npm run test:e2e:showcase（先 build:web）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'
import { createWebDriver } from '@proteus-vue/test-core/driver'
import { assertPageRendered } from '@proteus-vue/test-core'

const SHOWCASE_ROOT = path.resolve(__dirname, '../showcase')
const PORT = 4175
const BASE = `http://localhost:${PORT}`

/** 页面 → 关键元素选择器（该页至少应有一个可见） + 预期总数/可见占比
 *  ★expectedCount / minVisibleRatio 是抓「按钮都不见了」的关键（minVisible=1 抓不住整体消失） */
const PAGES: Array<{ route: string; keySelector: string; label: string; minVisibleRatio: number; expectedCount?: number }> = [
  { route: '/pages/index', keySelector: 'img, svg, [class*=sp-], [class*=row]', label: '首页（品牌立方体+分区卡）', minVisibleRatio: 0.8 },
  // ★详情页已迁入分包（2026-09-13）：subpackages/<pkg>/pages/<name>
  // ★p-button 页：实测 10 个按钮全部可见——少于 10 个即「按钮消失」（用户 2026-09-13 报告的故障类型）
  { route: '/subpackages/components/pages/p-button', keySelector: 'button', label: 'p-button（真渲染按钮）', minVisibleRatio: 1, expectedCount: 10 },
  { route: '/subpackages/components/pages/p-input', keySelector: 'input', label: 'p-input（真渲染输入框）', minVisibleRatio: 1, expectedCount: 2 },
  { route: '/subpackages/capabilities/pages/camera', keySelector: '[class*=db], [class*=out]', label: 'useCamera（能力详情样板）', minVisibleRatio: 1 },
  // ★分组目录页（官网式信息架构）：断言分组卡片可见
  { route: '/pages/components', keySelector: '[class*=cat-group]', label: '组件库分组目录', minVisibleRatio: 1, expectedCount: 6 },
  { route: '/pages/capabilities', keySelector: '[class*=cat-group]', label: '能力分组目录', minVisibleRatio: 1, expectedCount: 10 },
  { route: '/pages/system-glass', keySelector: '[class*=glass], [class*=stage]', label: '液态玻璃', minVisibleRatio: 0.8 },
  { route: '/pages/engineering-state', keySelector: 'button', label: '状态管理（Pinia）', minVisibleRatio: 1 },
  { route: '/pages/semantics', keySelector: '[class*=pipe], [class*=code]', label: '语义与编译', minVisibleRatio: 0.8 },
]

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({
    root: SHOWCASE_ROOT,
    mode: 'web',
    build: { outDir: path.join(SHOWCASE_ROOT, 'dist/web') },
    preview: { port: PORT },
  })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('★showcase 页面渲染门禁（非空白 + 关键元素可见 + 无 console 错误）', () => {
  for (const { route, keySelector, label, minVisibleRatio, expectedCount } of PAGES) {
    it(`${route}（${label}）`, async () => {
      const errs: string[] = []
      const onErr = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') errs.push(m.text()) }
      page.on('console', onErr as never)
      const onPageErr = (e: Error) => errs.push('PAGEERROR: ' + e.message)
      page.on('pageerror', onPageErr)
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(800)
        const driver = createWebDriver(page)
        // ★核心断言：人眼能看到的渲染故障必须红（含「元素整体消失」「大部分不可见」「白底白字」）
        const m = await assertPageRendered(driver, { keySelector, minVisible: 1, minVisibleRatio, expectedCount, minContrast: 1.5, assertNoErrors: false })
        expect(m.textLen, `${route} 疑似空白`).toBeGreaterThan(0)
        // 渲染错误单列（可能来自被测页自身的第三方资源，与"元素不可见"分开判）
        expect(errs.filter((e) => /Uncaught|undefined is not|is not a function/.test(e)), `${route} 渲染期 JS 错误`).toEqual([])
      } finally {
        page.off('console', onErr as never)
        page.off('pageerror', onPageErr)
      }
    })
  }

  // ★p-button 交互门禁（2026-09-13 用户实测教训）：按钮「存在且可见」还不够——
  //   还要能**按下有反馈**（此前 Web 端 hover-class 已加但背景不变；原生 disabled/loading 视觉/行为）。
  it('★/subpackages/components/pages/p-button 交互（点击反馈 + 禁用 + 加载态）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-button', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // ① 按下反馈：mousedown 期间背景必须变化（框架 hover-class 生效）
    const basic = page.locator('button:has-text("点击我")')
    const bgIdle = await basic.evaluate((el) => getComputedStyle(el).backgroundColor)
    const box = await basic.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(120)
    const bgPressed = await basic.evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.mouse.up()
    expect(bgPressed, '按下时背景应变化（点击反馈）').not.toBe(bgIdle)
    // ② 禁用按钮不可点击：disabled 属性真实存在
    expect(await page.locator('button:has-text("禁用按钮")').isDisabled()).toBe(true)
    // ③ 加载态：点击「提交」→ loading 生效期间按钮禁用，1.2s 后恢复
    await page.click('button:has-text("提交")')
    await page.waitForTimeout(200)
    expect(await page.locator('button:has-text("提交")').isDisabled(), 'loading 期间应自动禁用').toBe(true)
    await page.waitForTimeout(1400)
    expect(await page.locator('button:has-text("提交")').isDisabled(), 'loading 结束应恢复').toBe(false)
  })
})
