// tests/e2e-web-gp5.test.ts —— ★★★GP5：八条超级应用场景（Web 端）真浏览器 E2E（2026-10-03）
//
// 【这张卡验什么（任务卡 GP5 验收原文）】八条场景**任一条需要每页引入 ⇒ 方案不成立**。
//   Web 端机制与 MP 不同（无编译期注入——App.vue 是真根组件）：宿主/场景**在 App.vue 声明一次**，
//   页面通过 `globalThis.__PROTEUS_GP5__`（App.vue onMounted 注册的桥）控制。
//   本用例在**零声明的演示页**（subpackages/svg-lab/pages/gp5-scenarios-demo.vue）上操作：
//     ① 场景元素在 DOM（来自 App.vue 的 Global 层，不是页面自己渲染的）；
//     ② 点页面按钮 → 场景出现（桥生效）；
//     ③ **路由切换后仍在**（Global 层在 RouterView 之外 ⇒ 同一 DOM 节点存活——GP3-a 结论的复用）。
//
// 【运行】`pnpm --filter proteus-examples build:web` 之后
//   `PROTEUS_WEB_E2E=1 npx vitest run tests/e2e-web-gp5.test.ts`
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4176'
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')
const ENABLED = process.env.PROTEUS_WEB_E2E === '1'

let server: PreviewServer
let browser: Browser
let page: Page

describe.skipIf(!ENABLED)('★GP5 · Web 端八条场景（Global 层声明一次、页面零引入）', () => {
  beforeAll(async () => {
    server = await preview({
      root: EXAMPLES_ROOT,
      mode: 'web',
      build: { outDir: path.join(EXAMPLES_ROOT, 'dist/web') },
      preview: { port: 4176 },
    })
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('① 场景元素在 Global 层（DOM 序：global 容器内），且初始隐藏', async () => {
    const info = await page.evaluate(() => {
      const globalLayer = document.querySelector('[data-mount-layer="global"]') as HTMLElement | null
      return {
        hasGlobalLayer: Boolean(globalLayer),
        themeBgInGlobal: Boolean(globalLayer?.querySelector('.gl-theme-bg')),
        fabVisible: Boolean(document.querySelector('#gl-fab')),
        musicVisible: Boolean(document.querySelector('#gl-music-bar')),
        imBadgeVisible: Boolean(document.querySelector('#gl-im-badge')),
      }
    })
    expect(info.hasGlobalLayer, 'Global 层容器存在').toBe(true)
    expect(info.themeBgInGlobal, '★主题容器在 Global 层内（App.vue 声明——不是页面渲染的）').toBe(true)
    expect(info.fabVisible, '初始悬浮球隐藏（v-if false）').toBe(false)
    expect(info.musicVisible, '初始音乐条隐藏').toBe(false)
    expect(info.imBadgeVisible, '初始角标隐藏（未读 0）').toBe(false)
  })

  it('② 跳演示页 → 点按钮 → 四条场景出现（页面零声明、经桥控制）', async () => {
    // 进演示页（SPA 路由：直接 goto 对应路径）
    await page.goto(`${BASE}/subpackages/svg-lab/pages/gp5-scenarios-demo`, { waitUntil: 'networkidle' })
    // 等页面挂载（演示页按钮出现）
    await page.waitForSelector('#gp5-fab', { timeout: 10_000 })

    // 页面源码零场景元素（在页面容器内查——都不该有）
    const inPage = await page.evaluate(() => {
      const pageLayer = document.querySelector('[data-mount-layer="page"]') as HTMLElement | null
      return {
        fabInPage: Boolean(pageLayer?.querySelector('#gl-fab')),
        themeInPage: Boolean(pageLayer?.querySelector('.gl-theme-bg')),
      }
    })
    expect(inPage.fabInPage, '★悬浮球不在页面层内（来自 Global 层）').toBe(false)
    expect(inPage.themeInPage, '★主题容器不在页面层内').toBe(false)

    // ④ 悬浮球
    await page.click('#gp5-fab')
    await page.waitForSelector('#gl-fab', { timeout: 3_000 })
    expect(await page.isVisible('#gl-fab'), '★点后悬浮球出现（桥生效）').toBe(true)

    // ⑤ 音乐条
    await page.click('#gp5-music')
    await page.waitForSelector('#gl-music-bar', { timeout: 3_000 })
    expect(await page.isVisible('#gl-music-bar'), '★音乐条出现').toBe(true)

    // ⑧ IM 角标 +1 ×2
    await page.click('#gp5-im-bump')
    await page.click('#gp5-im-bump')
    await page.waitForSelector('#gl-im-badge', { timeout: 3_000 })
    expect((await page.textContent('#gl-im-badge'))?.trim(), '★角标计数 2').toBe('2')

    // ⑦ 主题切换（数据面：容器类名切换）
    await page.click('#gp5-theme')
    await page.waitForFunction(() => Boolean(document.querySelector('.gl-theme-bg--dark')), null, { timeout: 3_000 })
    expect(await page.evaluate(() => Boolean(document.querySelector('.gl-theme-bg--dark'))), '★主题切到暗色（无需刷新）').toBe(true)
  })

  it('③ 路由切换（点站内链接 → SPA 导航）→ 场景仍在且状态保留（Global 层同一实例存活）', async () => {
    const beforeNode = await page.evaluate(() => Boolean(document.querySelector('#gl-im-badge')))
    expect(beforeNode, '切换前角标已在').toBe(true)

    // ★必须用**站内 SPA 导航**（点链接）而不是 page.goto——后者是整页刷新，
    //   会重置模块单例并把"路由切换保状态"测成"重新加载"（判据失真）。
    //   ★选择器纪律（实测）：演示页的 `<navigator>` 在 Web 端渲染为
    //   `<a class="proteus-web-navigator" href="javascript:void(0)">`（见 built-in-components 的
    //   WebNavigator 实现——href 是 javascript:void(0) 而非 /pages/...）
    //   ⇒ 不能按 `href.includes('/pages/')` 找（那是首页普通 `<a>` 的形态），要按 class 找。
    const clicked = await page.evaluate(() => {
      const nav = document.querySelector('a.proteus-web-navigator') as HTMLAnchorElement | null
      if (!nav) return false
      nav.click()
      return true
    })
    expect(clicked, '应能点到站内链接（演示页"去首页"的 navigator）').toBe(true)
    // 等演示页控件消失（确认导航真发生）
    await page.waitForFunction(() => !document.querySelector('#gp5-fab'), null, { timeout: 5_000 })

    const after = await page.evaluate(() => ({
      fab: Boolean(document.querySelector('#gl-fab')),
      badge: Boolean(document.querySelector('#gl-im-badge')),
      badgeText: document.querySelector('#gl-im-badge')?.textContent?.trim() ?? '',
      dark: Boolean(document.querySelector('.gl-theme-bg--dark')),
      inGlobal: Boolean((document.querySelector('[data-mount-layer="global"]'))?.querySelector('#gl-im-badge')),
    }))
    expect(after.fab, '★路由切换后悬浮球仍在').toBe(true)
    expect(after.badge, '★角标仍在').toBe(true)
    expect(after.badgeText, '★未读计数保留（=2，状态不在页面里）').toBe('2')
    expect(after.dark, '★主题仍是暗色').toBe(true)
    expect(after.inGlobal, '★场景节点在 Global 层容器内（跨路由存活的正是它）').toBe(true)
  })
})
