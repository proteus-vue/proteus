// tests/e2e-driver-web.test.ts
// ★统一测试 API（TestDriver）实战验证——Web 端：Playwright Chromium 真实浏览器
// 装配：vite preview（examples 产物）+ chromium → createDriver({ platform: 'web', page }) → 同一份跨端用例 runSharedSmoke
// 运行：npm run build:web && npx vitest run tests/e2e-driver-web.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'
import { createDriver } from '@proteus-vue/test-core/driver'
import { runSharedSmoke } from './e2e-driver-shared'

const PORT = 4176
const BASE = `http://localhost:${PORT}`
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: EXAMPLES_ROOT, mode: 'web', preview: { port: PORT } })
  browser = await chromium.launch()
  page = await browser.newPage()
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('TestDriver 统一测试 API（Web 端真实浏览器）', () => {
  it('同一份跨端用例 runSharedSmoke → driver 能力接口全链路跑通', async () => {
    const driver = createDriver({ platform: 'web', page })
    await runSharedSmoke(driver, {
      route: `${BASE}/pages/index`,
      tapSelector: 'button',
      shotPath: '/tmp/proteus-e2e-driver-web.png',
    })
  }, 60_000)

  it('web 专属：tap 后真实响应式更新（locator 文本读取能力）', async () => {
    const driver = createDriver({ platform: 'web', page })
    await driver.reLaunch(`${BASE}/pages/index`)
    const count = driver.element('.tapped-count')
    await count.waitFor({ timeout: 10_000 })
    expect(await count.text()).toContain('tapped 0 times')
    await driver.element('button').tap()
    // ★web 渲染更新在微任务队列 → 轮询等待（driver.waitFor 固定等待 + 重读）
    for (let i = 0; i < 10; i++) {
      if ((await count.text()).includes('tapped 1 times')) break
      await driver.waitFor(200)
    }
    expect(await count.text()).toContain('tapped 1 times')
    await driver.close()
  }, 30_000)
})
