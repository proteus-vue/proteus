// tests/e2e-web-keypaths.test.ts
// ★test-framework B4：Web E2E 关键路径（04-e2e-web-playwright.md——真实浏览器 + data-testid 定位）
// 覆盖：① PlatformAPI storage 收口闭环（写入→读取→删除）② UI 模态（showModal DOM overlay）
//       ③ Pinia 状态跨页保留（volume 持久化 + playing 瞬时态语义）
// 运行：npm run test:e2e:web（先 build:web，再用 preview 服务产物；Chromium）
// ★断言用 waitForFunction（vitest 无 Playwright matcher；对齐 e2e-web.test.ts waitText 风格）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4175'
// ★产物在 examples/dist/web；preview 须 root=examples（默认 cwd 根会 404）
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: EXAMPLES_ROOT, mode: 'web', preview: { port: 4175 } })
  browser = await chromium.launch()
  page = await browser.newPage()
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 轮询等待 data-testid 元素文本匹配（正则或子串） */
async function waitTestIdText(testId: string, matcher: RegExp | string): Promise<void> {
  await page.waitForFunction(
    ([tid, m]) => {
      const el = document.querySelector(`[data-testid="${tid}"]`)
      if (!el || !el.textContent) return false
      const text = el.textContent
      return m instanceof RegExp ? m.test(text) : text.includes(m)
    },
    [testId, matcher] as const,
    { timeout: 15_000 },
  )
}

/** 轮询等待选择器出现（布尔条件） */
async function waitSelector(selector: string, visible: boolean): Promise<void> {
  await page.waitForFunction(
    ([sel, vis]) => {
      const el = document.querySelector(sel)
      if (!vis) return !el || (el as HTMLElement).style.display === 'none'
      return !!el && el.getBoundingClientRect().height > 0
    },
    [selector, visible] as const,
    { timeout: 15_000 },
  )
}

describe('Web E2E 关键路径（B4，data-testid 定位）', () => {
  it('PlatformAPI storage 收口闭环：写入 → 读取（JSON 往返）→ 删除', async () => {
    await page.goto(`${BASE}/pages/platform-api-demo`)
    await waitSelector('[data-testid="pad-storage-set"]', true)
    await page.getByTestId('pad-storage-set').click()
    await page.getByTestId('pad-storage-get').click()
    // 读取到 t = <时间戳>（api.storage → localStorage JSON 往返）
    await waitTestIdText('pad-storage-log', /读取到 t = \d+/)
    await page.getByTestId('pad-storage-remove').click()
    await waitTestIdText('pad-storage-log', '已删除')
  }, 30_000)

  it('UI 模态关键路径：showModal → WeUI modal 出现 → 确认关闭 + 回调', async () => {
    await page.goto(`${BASE}/pages/platform-api-demo`)
    await waitSelector('[data-testid="pad-storage-set"]', true)
    await page.getByTestId('pad-modal').click()
    // ★web 端 wx 全局已装（@proteus-vue/web installWxApi）→ showModal 走 WeUI 模拟层 .proteus-web-modal
    await waitSelector('.proteus-web-modal', true)
    await page.click('.pwu-modal-btn--confirm')
    await waitSelector('.proteus-web-modal', false)
    await waitTestIdText('pad-ui-log', 'showModal → 点了确定')
  }, 30_000)

  it('Pinia 状态持久化：volume 经 reload 恢复（playing 瞬时态重置）', async () => {
    await page.goto(`${BASE}/pages/pinia-demo`)
    // 初始 80%（新 context 无持久化）
    await waitTestIdText('pinia-volume', /80%/)
    await page.getByTestId('pinia-play').click()
    await waitTestIdText('pinia-now', 'Proteus Theme')
    await waitTestIdText('pinia-now', '播放中')
    // 音量 - 一次 → 70%
    await page.getByTestId('pinia-vol-down').click()
    await waitTestIdText('pinia-volume', /70%/)
    // ★确定性等待持久化落盘（异步 Adapter 写入）再 reload，避免竞态；浮点存 0.7000000000000001
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('proteus:player-state')
      if (!raw) return false
      const v = (JSON.parse(raw) as { volume?: number }).volume
      return typeof v === 'number' && Math.abs(v - 0.7) < 0.001
    })
    // ★reload（真实持久化路径：LocalStorageAdapter 恢复）→ volume 70% 恢复；playing/current 瞬时态重置
    await page.reload()
    await waitTestIdText('pinia-volume', /70%/)
    await waitTestIdText('pinia-now', '未播放')
  }, 30_000)
})
