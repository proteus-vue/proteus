// tests/e2e-web.test.ts
// Web 端 E2E 实测（P6 验收）：vite preview 产物 + Playwright Chromium
// 覆盖：首页渲染 / SPA 跳转 / 浏览器前进后退 / 直接访问深层 URL（刷新恢复）/ 分包页 / 404
// 运行：npm run test:e2e:web（先 build:web，再用 preview 服务产物）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

const BASE = 'http://localhost:4174'

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ mode: 'web', preview: { port: 4174 } })
  browser = await chromium.launch()
  page = await browser.newPage()
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 轮询等待页面出现包含指定文本的元素 */
async function waitText(selector: string, text: string): Promise<void> {
  await page.waitForFunction(
    ([sel, txt]) => {
      const el = document.querySelector(sel)
      return !!el && el.textContent!.includes(txt)
    },
    [selector, text] as const,
    { timeout: 10_000 },
  )
}

describe('Web 端 E2E 实测（预览产物）', () => {
  it('首页渲染：RouterView 显示 index 页面', async () => {
    await page.goto(`${BASE}/`)
    await waitText('h1', 'Proteus')
    await waitText('p', 'One Vue source')
  })

  it('SPA 跳转：pushState + popstate → 渲染目标页面', async () => {
    await page.goto(`${BASE}/`)
    await waitText('h1', 'Proteus')
    await page.evaluate(() => {
      history.pushState({}, '', '/pages/user/profile')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitText('h2', '个人资料')
    expect(page.url()).toContain('/pages/user/profile')
  })

  it('浏览器前进/后退驱动路由（popstate）', async () => {
    await page.goto(`${BASE}/`)
    await waitText('h1', 'Proteus')
    await page.evaluate(() => {
      history.pushState({}, '', '/pages/user/profile')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitText('h2', '个人资料')
    await page.goBack() // 真实 popstate → 回到根路径（归一化首页，防 404）
    await waitText('h1', 'Proteus')
    await page.goForward()
    await waitText('h2', '个人资料')
  })

  it('直接访问深层 URL：刷新恢复正确渲染', async () => {
    await page.goto(`${BASE}/pages/user/profile`)
    await waitText('h2', '个人资料')
  })

  it('分包页面在 Web 端可渲染', async () => {
    await page.goto(`${BASE}/subpackages/order/pages/list`)
    await waitText('h2', '订单列表')
  })

  it('点击 tap 按钮 → count 可见更新（Vue 响应式，用户实测场景）', async () => {
    await page.goto(`${BASE}/`)
    await waitText('.tapped-count', 'tapped 0 times')
    await page.click('button')
    await waitText('.tapped-count', 'tapped 1 times')
    await page.click('button')
    await waitText('.tapped-count', 'tapped 2 times')
  })

  it('A 页面点击链接跳转 B 页面（SPA 无整页刷新）', async () => {
    await page.goto(`${BASE}/`)
    await waitText('h1', 'Proteus')
    // 标记 window 状态，验证点击后无整页刷新（SPA pushState）
    await page.evaluate(() => { (window as unknown as Record<string, string>).__navMarker = 'alive' })
    await page.click('a[href="/pages/user/profile"]')
    await waitText('h2', '个人资料')
    expect(page.url()).toContain('/pages/user/profile')
    const marker = await page.evaluate(() => (window as unknown as Record<string, string>).__navMarker)
    expect(marker).toBe('alive') // 未刷新
    // 浏览器后退回首页 → 再 SPA 跳转分包页
    await page.goBack()
    await waitText('h1', 'Proteus')
    await page.click('a[href="/subpackages/order/pages/list"]')
    await waitText('h2', '订单列表')
    expect(page.url()).toContain('/subpackages/order/pages/list')
  })

  it('未知路由 → 404 提示', async () => {
    await page.goto(`${BASE}/pages/not-exist`)
    await waitText('body', '404')
  })
})
