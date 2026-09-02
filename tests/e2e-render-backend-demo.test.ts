// tests/e2e-render-backend-demo.test.ts
// ★G-27 可视化验证 E2E：换 flag 切渲染后端（M1 退出标准 2「换 flag 切渲染后端 demo」）
//   同一份 C-IR 树（render-backend-demo.vue 页面）→ 各 ProteusRenderBackend 渲染产出实时对比：
//   vue-dom（真实 DOM + 控件快照 div.proteus-grid）/ headless（toPlainTree 序列化 grid）/
//   native-ios（UICollectionView）/ native-android（GridLayoutManager）/ native-harmony（Grid）/
//   flutter（GridView widget 树）/ hybrid（区域级切后端 + DevTools 路由 trace 含 native-ios + media 区域）
// 运行：npm run test:e2e:web（先 build:web，再用 preview 服务产物；Chromium）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4176'
// ★产物在 examples/dist/web；preview 须 root=examples（默认 cwd 根会 404）
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: EXAMPLES_ROOT, mode: 'web', preview: { port: 4176 } })
  browser = await chromium.launch()
  page = await browser.newPage()
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 轮询等待 data-testid 元素文本匹配（子串） */
async function waitTestIdText(testId: string, text: string): Promise<void> {
  await page.waitForFunction(
    ([tid, t]) => {
      const el = document.querySelector(`[data-testid="${tid}"]`)
      return !!el && !!el.textContent && el.textContent.includes(t)
    },
    [testId, text] as const,
    { timeout: 15_000 },
  )
}

/** 轮询等待 data-testid 元素出现指定数量的子元素（pred 参数不可序列化——用数字参数） */
async function waitChildCount(testId: string, count: number): Promise<void> {
  await page.waitForFunction(
    ([tid, n]) => {
      const el = document.querySelector(`[data-testid="${tid}"]`)
      return !!el && el.children.length === n
    },
    [testId, count] as const,
    { timeout: 15_000 },
  )
}

describe('渲染后端可插拔 demo（G-27 可视化验证）', () => {
  it('页面加载：同一份 C-IR 树展示 + 默认 vue-dom 真实 DOM 与控件快照', async () => {
    await page.goto(`${BASE}/pages/render-backend-demo`)
    await waitTestIdText('rb-ir', 'layout.grid')
    // vue-dom 为默认 flag：舞台容器被真实 DOM 铺满 + 快照 readback 出 div.proteus-grid
    await waitChildCount('rb-dom', 1)
    await waitTestIdText('rb-snap', 'div.proteus-grid')
    // 快照同时携带 semantic 行（语义收敛肉眼可见）
    await waitTestIdText('rb-snap', '[layout.grid]')
  })

  it('headless：内存节点树序列化（语义 → grid/box/text 节点类型）', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'headless' }).click()
    await waitChildCount('rb-dom', 0)
    await waitTestIdText('rb-snap', '"type": "grid"')
    await waitTestIdText('rb-snap', '"type": "button"')
  })

  it('native-ios：UIKit 控件名树 readback', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'native-ios' }).click()
    await waitTestIdText('rb-snap', 'UICollectionView')
    await waitTestIdText('rb-snap', 'UILabel')
  })

  it('native-android：Jetpack 控件名树 readback', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'native-android' }).click()
    await waitTestIdText('rb-snap', 'GridLayoutManager')
    await waitTestIdText('rb-snap', 'TextView')
  })

  it('native-harmony：ArkUI 控件名树 readback', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'native-harmony' }).click()
    await waitTestIdText('rb-snap', 'Grid')
    await waitTestIdText('rb-snap', 'Button')
  })

  it('flutter：widget 树序列化（GridView/Text/FilledButton）', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'flutter' }).click()
    await waitTestIdText('rb-snap', '"widget": "GridView"')
    await waitTestIdText('rb-snap', '"widget": "Text"')
  })

  it('hybrid：区域级切后端 + 纹理共享 + 路由 trace（ui.media → native-ios / media 区域）', async () => {
    await page.locator('.flag-row .flag-btn', { hasText: 'hybrid' }).click()
    // 路由 trace：media 语义节点被路由到 native-ios（media 区域），其余走 vue-dom 默认
    await waitTestIdText('rb-snap', 'p-media [ui.media] → native-ios（media）')
    await waitTestIdText('rb-snap', 'p-grid [layout.grid] → vue-dom（default）')
    // 纹理共享广播 + media 子树原生快照 readback（同一语义 ui.media → AVPlayerView）
    await waitTestIdText('rb-snap', 'registerExternalTexture(media-1)')
    await waitTestIdText('rb-snap', 'AVPlayerView')
    // 默认后端真实 DOM：grid 仍像素可见，media 槽位以「原生覆盖层」占位（宿主后接）
    await waitTestIdText('rb-dom', '原生覆盖层')
  })
})
