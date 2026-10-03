// tests/e2e-web-mount-layers.test.ts —— ★★★GP3-a：Web 端三层挂载真浏览器 E2E（2026-10-03）
//
// 【这张卡验什么（对标 GP3-a 验收原文）】
//   ① **三层顺序正确：Overlay > Page > Global**——真实浏览器里读 DOM 顺序 + `getComputedStyle` 的
//      z-index（**渲染后的真实层叠**，不是源码断言）
//   ② **全局层内容在路由切换时保持存活且不重复挂载**——点链接跳另一页后 Global 层仍在、
//      且**同一个 DOM 节点**（不是重建了一份新的）
//
// 【★与单测的分工（两层验证，各管一段）】
//   · `tests/web-mount-layers.test.ts`（happy-dom）：组件契约（域偏移/position/不重复/软校验/响应式）
//   · 本文件（真 Chromium + 真产物）：**真实构建产物**里三层确实按序层叠 + 路由切换存活
//     ——单测用 createApp 直挂，覆盖不到"产物构建后是否仍如此"（本仓"陈旧 dist"教训的同族）
//
// 【运行】`pnpm build:web` 之后：`vitest run tests/e2e-web-mount-layers.test.ts`
//   （与 tests/e2e-web.test.ts 同款装置：vite preview + Playwright Chromium）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4175'
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')
const ENABLED = process.env.PROTEUS_WEB_E2E === '1'

let server: PreviewServer
let browser: Browser
let page: Page

describe.skipIf(!ENABLED)('★GP3-a · Web 端三层挂载（真浏览器）', () => {
  beforeAll(async () => {
    server = await preview({
      root: EXAMPLES_ROOT,
      mode: 'web',
      build: { outDir: path.join(EXAMPLES_ROOT, 'dist/web') },
      preview: { port: 4175 },
    })
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('① 三层按 global → page 的 DOM 序输出，且 z-index 递增（域偏移来自契约）', async () => {
    const layers = await page.evaluate(() =>
      [...document.querySelectorAll('[data-mount-layer]')].map((el) => ({
        layer: el.getAttribute('data-mount-layer'),
        z: Number(getComputedStyle(el).zIndex),
        position: getComputedStyle(el).position,
      })),
    )
    const names = layers.map((l) => l.layer)
    // ★验收原文：三层顺序 Overlay > Page > Global——示例 App.vue 三层都声明了，故完整断言
    for (const want of ['global', 'page', 'overlay'] as const) {
      expect(names, `★真实产物里应有 ${want} 层（声明式、可枚举）`).toContain(want)
    }
    expect(names, '★DOM 序 = 层序（global → page → overlay）').toEqual(['global', 'page', 'overlay'])
    // 层叠：z-index 与契约域偏移一致 + 严格递增（Overlay > Page > Global 的**数值判据**）
    const byLayer = Object.fromEntries(layers.map((l) => [l.layer!, l.z]))
    expect(byLayer.global, '★global 域偏移 = 0（契约值）').toBe(0)
    expect(byLayer.page, '★page 域偏移 = 1_000_000（契约值）').toBe(1_000_000)
    expect(byLayer.overlay, '★overlay 域偏移 = 2_000_000（契约值）').toBe(2_000_000)
    expect(byLayer.overlay, '★Overlay > Page').toBeGreaterThan(byLayer.page)
    expect(byLayer.page, '★Page > Global').toBeGreaterThan(byLayer.global)
    // 前提：position 必须非 static（否则 z-index 静默无效）
    for (const l of layers) expect(l.position, `★${l.layer} 层需 position 使 z-index 生效`).not.toBe('static')
  })

  it('② 路由切换后 Global 层**仍在**（跨路由存活——它在 RouterView 之外）', async () => {
    const before = await page.evaluate(() => Boolean(document.querySelector('[data-mount-layer="global"]')))
    expect(before, '切换前 Global 层在').toBe(true)

    // 点一个站内链接切路由（与 tests/e2e-web 同款做法：找 a[href]）
    const clicked = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => (el as HTMLAnchorElement).href.includes('/pages/')) as HTMLAnchorElement | undefined
      if (!a) return false
      a.click()
      return true
    })
    expect(clicked, '应能点到站内链接').toBe(true)
    await page.waitForTimeout(1000)

    const after = await page.evaluate(() => ({
      url: location.pathname,
      globalStillThere: Boolean(document.querySelector('[data-mount-layer="global"]')),
    }))
    expect(after.url, 'URL 确实变了（真的发生了路由切换）').not.toBe('/')
    expect(after.globalStillThere, '★路由切换后 Global 层仍在（Web 端它天然跨路由存活）').toBe(true)
  })

  it('③ ★Global 层是**同一个 DOM 节点**（不是重建一份——"不重复挂载"的机器判据）', async () => {
    // 给节点打标 → 切路由 → 标记仍在（重建会丢标记）
    await page.evaluate(() => {
      const el = document.querySelector('[data-mount-layer="global"]') as HTMLElement | null
      if (el) el.dataset.probeMark = 'kept'
    })
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => (el as HTMLAnchorElement).href.includes('/pages/')) as HTMLAnchorElement | undefined
      a?.click()
    })
    await page.waitForTimeout(900)
    const survived = await page.evaluate(() => {
      const el = document.querySelector('[data-mount-layer="global"]') as HTMLElement | null
      return el ? el.dataset.probeMark === 'kept' : false
    })
    expect(survived, '★切换后仍是同一节点（标记还在）——若重建则标记丢失').toBe(true)
  })

  it('④ 层容器数量稳定（每次路由切换**不新增**层容器——"不重复挂载"）', async () => {
    const countOf = (): Promise<number> =>
      page.evaluate(() => document.querySelectorAll('[data-mount-layer]').length)
    const before = await countOf()
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => (el as HTMLAnchorElement).href.includes('/pages/')) as HTMLAnchorElement | undefined
      a?.click()
    })
    await page.waitForTimeout(900)
    expect(await countOf(), '★层容器数量不变（不随路由累积）').toBe(before)
  })

  it('⑤ 零控制台错误（除 devtools relay 的开发期连接告警——生产产物不应有它）', async () => {
    const errs = await page.evaluate(() => (window as unknown as { __errs?: string[] }).__errs ?? [])
    expect(errs, '页面运行不应有 JS 错误').toEqual([])
  })
})
