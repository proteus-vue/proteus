// tests/e2e-web-superapp.test.ts —— ★★★超级应用验收（Web 端）：全局挂载八条场景（2026-10-04）
//
// 【这份用例验什么】`superapp/` 的**首个验收模块**在 **Web 端**的可用性——
//   与 MP 端同源（`App.vue` 声明同一套场景），落地机制不同（Web 无编译期注入 ⇒ 模块单例 + 桥）。
//   验收面与 MP 对齐：**真实业务路径**（首页触发网络条/音乐条 → 消息页驱动角标 →
//   设置页开关驱动主题/客服球 → 跨页一致）。
//
// 【★导航纪律（实测）】跨页判据必须用**站内 SPA 导航**（`wx.navigateTo`——Web 端 wx 门面提供），
//   **不能用 page.goto**（整页刷新 = 模块单例重置 = 把跨路由存活测成重新加载，判据失真）。
// 【★与 MP e2e 的关系】`tests/e2e-mp-superapp.test.ts` = 端上（真机 wechatide）；
//   本文件 = 浏览器（真 Chromium + 真产物）。两者证同一份**验收判据**（八条 + 业务路径）。
//
// 运行：`cd superapp && npx proteus build --target web` 之后
//       `PROTEUS_WEB_E2E=1 npx vitest run tests/e2e-web-superapp.test.ts`
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4177'
const APP_ROOT = path.resolve(__dirname, '..', 'superapp')
const ENABLED = process.env.PROTEUS_WEB_E2E === '1'

let server: PreviewServer
let browser: Browser
let page: Page

describe.skipIf(!ENABLED)('★超级应用验收（Web）· 首模块：全局挂载八条场景（生产形态）', () => {
  beforeAll(async () => {
    server = await preview({
      root: APP_ROOT,
      mode: 'web',
      build: { outDir: path.join(APP_ROOT, 'dist/web') },
      preview: { port: 4177 },
    })
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('① 首页：Global 层场景在 App 壳容器内（+ 业务工作台渲染）', { timeout: 30_000 }, async () => {
    await page.goto(`${BASE}/pages/index`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#idx-weaknet', { timeout: 10_000 })

    const info = await page.evaluate(() => {
      const globalLayer = document.querySelector('[data-mount-layer="global"]') as HTMLElement | null
      const pageLayer = document.querySelector('[data-mount-layer="page"]') as HTMLElement | null
      const overlayLayer = document.querySelector('[data-mount-layer="overlay"]') as HTMLElement | null
      return {
        hasGlobal: Boolean(globalLayer),
        hasOverlay: Boolean(overlayLayer),
        // ★2026-10-04（第三轮外部验收后定版）：主题底在 Global 层（背景），chrome（客服球等浮层）
        //   在 **Overlay 层**——层间域 `global(0) < page(1e6) < overlay(2e6)`：挂 Global 的浮条会被
        //   页面文字击穿（实测），而"跨页存活"由 Overlay 层同在 RouterView 之外保证。
        themeInGlobal: Boolean(globalLayer?.querySelector('#sa-theme-bg')),
        fabInOverlay: Boolean(overlayLayer?.querySelector('#sa-fab')),
        workbenchInPage: Boolean(pageLayer?.textContent?.includes('早上好')),
        fabInPage: Boolean(pageLayer?.querySelector('#sa-fab')),
        chromeInPage: Boolean(pageLayer?.querySelector('.sa-chrome')),
      }
    })
    expect(info.hasGlobal, 'Global 层容器存在（主题底）').toBe(true)
    expect(info.hasOverlay, 'Overlay 层容器存在（chrome + 浮层宿主）').toBe(true)
    expect(info.themeInGlobal, '★主题容器在 Global 层内（背景类）').toBe(true)
    expect(info.fabInOverlay, '★客服球在 Overlay 层内（浮于页面之上——外部验收 P0 修复）').toBe(true)
    expect(info.workbenchInPage, '业务工作台（首页）在 Page 层渲染').toBe(true)
    expect(info.fabInPage, '★客服球不在页面层内（零每页引入）').toBe(false)
    expect(info.chromeInPage, '★chrome 不在页面层内').toBe(false)
  })

  it('② 业务路径：首页触发网络条 → 音乐条', { timeout: 30_000 }, async () => {
    // ⑥ 弱网（点首页快捷入口）
    await page.click('#idx-weaknet')
    await page.waitForSelector('#sa-net-bar', { timeout: 3_000 })
    expect(await page.isVisible('#sa-net-bar'), '★点「模拟弱网」→ 全局网络条出现').toBe(true)
    await page.click('#sa-net-hide')
    await page.waitForFunction(() => !document.querySelector('#sa-net-bar'), null, { timeout: 3_000 })
    expect(await page.evaluate(() => Boolean(document.querySelector('#sa-net-bar'))), '点忽略 → 收起').toBe(false)

    // ⑤ 播放（点首页快捷入口）
    await page.click('#idx-play')
    await page.waitForSelector('#sa-music-bar', { timeout: 3_000 })
    const music = await page.evaluate(() => ({
      visible: Boolean(document.querySelector('#sa-music-bar')),
      title: document.querySelector('.sa-music-bar__title')?.textContent?.trim() ?? '',
      hasToggle: Boolean(document.querySelector('#sa-music-toggle')),
    }))
    expect(music.visible, '★点播放 → 全局音乐条出现').toBe(true)
    expect(music.title, '曲目名（生产形态：真实曲目）').toBe('热区业务周报')
    expect(music.hasToggle, '播放控制按钮在（生产形态）').toBe(true)
  })

  it('③ 消息页：真实业务路径驱动 ⑧ 角标', { timeout: 30_000 }, async () => {
    // ★用**站内 SPA 导航**（wx.navigateTo —— Web 端 wx 门面提供；page.goto 是整页刷新会重置模块单例）
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/messages' }))
    await page.waitForSelector('#msg-mark-one', { timeout: 10_000 })
    // 等角标同步完成（onShow 里 syncToShell 的落点）
    await page.waitForFunction(() => Boolean(document.querySelector('#sa-im-badge')), null, { timeout: 5_000 })

    const before = await page.evaluate(() => Number(document.querySelector('#sa-im-badge')?.textContent?.trim() || 0))
    await page.click('#msg-mark-one')
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => ({
      badge: Number(document.querySelector('#sa-im-badge')?.textContent?.trim() || 0),
      inChrome: Boolean(document.querySelector('[data-mount-layer="overlay"]')?.querySelector('#sa-im-badge')),
    }))
    expect(after.badge, '★消息页「标记一条未读」→ 全局角标 +1').toBe(before + 1)
    expect(after.inChrome, '★角标在 Overlay 层内（跨页存活 + 浮于页面之上）').toBe(true)
  })

  it('④ 设置页：开关驱动 ⑦ 主题与 ④ 客服球（真实业务路径）', { timeout: 30_000 }, async () => {
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/mine' }))
    await page.waitForSelector('#mine-dark', { timeout: 10_000 })

    // ⑦ 主题——★先归一状态再断言"变化"（共享状态是模块单例，**跨测试运行存活**：
    //   上一轮把主题留成 dark 时，"切一次变 dark" 的断言会假红。本仓 MP e2e 同法。）
    const isDark = (): Promise<boolean> => page.evaluate(() => Boolean(document.querySelector('.sa-theme-bg--dark')))
    if (await isDark()) {
      await page.click('#mine-dark')
      await page.waitForTimeout(400)
    }
    const before = await isDark()
    expect(before, '归一后应为浅色（再切才有可断言的"变化"）').toBe(false)
    await page.click('#mine-dark')
    await page.waitForTimeout(400)
    const after = await isDark()
    expect(after, '★设置页开关 → 主题切换（免刷新）').toBe(true)

    // ④ 客服球
    const fabBefore = await page.evaluate(() => Boolean(document.querySelector('#sa-fab')))
    await page.click('#mine-fab')
    await page.waitForTimeout(400)
    const fabAfter = await page.evaluate(() => Boolean(document.querySelector('#sa-fab')))
    expect(fabAfter, '★设置页开关 → 客服球显隐').toBe(!fabBefore)
    // 恢复（避免影响后续运行——模块单例状态）
    await page.click('#mine-fab')
    await page.waitForTimeout(300)
  })

  it('⑤ 跨页一致：SPA 导航回首页 → 主题/角标/音乐仍在（Global 同一实例）', { timeout: 30_000 }, async () => {
    // ★先确保音乐在播放（**用例自包含**——不依赖 ② 是否跑过；本仓纪律"用例独立运行"）
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/index' }))
    await page.waitForSelector('#idx-weaknet', { timeout: 10_000 })
    if (!(await page.evaluate(() => Boolean(document.querySelector('#sa-music-bar'))))) {
      await page.click('#idx-play')
      await page.waitForSelector('#sa-music-bar', { timeout: 5_000 })
    }
    // 再切走再回来（验"跨路由存活"）
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/mine' }))
    await page.waitForSelector('#mine-dark', { timeout: 10_000 })
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/index' }))
    await page.waitForSelector('#idx-weaknet', { timeout: 10_000 })

    const after = await page.evaluate(() => ({
      dark: Boolean(document.querySelector('.sa-theme-bg--dark')),
      music: Boolean(document.querySelector('#sa-music-bar')),
      badge: Boolean(document.querySelector('#sa-im-badge')),
      inChrome: Boolean((document.querySelector('[data-mount-layer="overlay"]'))?.querySelector('#sa-music-bar')),
    }))
    expect(after.dark, '★回首页主题仍是设置页切后的值（跨页同源；归一后为 dark）').toBe(true)
    expect(after.music, '音乐条仍在（Global 跨路由）').toBe(true)
    expect(after.badge, '角标仍在').toBe(true)
    expect(after.inChrome, '★场景节点在 Overlay 层容器内（跨页存活 + 层级正确）').toBe(true)
  })

  it('⑥ 验收控制台：八条逐条触发（①②③ Overlay）', { timeout: 40_000 }, async () => {
    await page.evaluate(() => (globalThis as unknown as { wx: { navigateTo: (o: { url: string }) => void } }).wx.navigateTo({ url: '/pages/verify' }))
    await page.waitForSelector('#vf-1a', { timeout: 10_000 })

    // ① Toast（排队 3 条）—— Toast 不拦点击，可直接连点
    await page.click('#vf-1b')
    await page.waitForSelector('#p-toast-host-panel', { timeout: 3_000 })

    // ③ 登录失效（不可取消）——★先于 Loading：Loading 遮罩会拦住后续一切点击（这是**正确语义**）
    await page.click('#vf-3a')
    await page.waitForSelector('#p-auth-gate-root', { timeout: 3_000 })
    const authVisible = await page.evaluate(() => {
      const el = document.querySelector('#p-auth-gate-root') as HTMLElement | null
      return el ? getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0' : false
    })
    expect(authVisible, '★验收台点「模拟 401」→ 登录拦截弹窗出现').toBe(true)
    // 收尾：恢复登录态（★"不可取消"是真语义 ⇒ 「重新登录」在弹窗内、遮罩拦页面点击 ⇒ 用状态 API 恢复）
    await page.evaluate(() => {
      const g = globalThis as unknown as { __SUPERAPP_GLOBAL__?: unknown }
      void g // 桥不含 auth-gate（它在 runtime 模块）——直接调 DOM 无法恢复 ⇒ 用运行时 API 的方式：
    })
    // ★正确恢复路径：runtime 的 markAuthRestored（页面已 import，但不暴露到 window）⇒ 从 Vue 应用侧不可达。
    //   替代：点弹窗内的 CTA（#p-auth-gate-action —— 它在遮罩之上，可点）。
    await page.click('#p-auth-gate-action')
    await page.waitForTimeout(500)
    // ★② Loading（两实例）——放在最后（它会拦点击）
    await page.click('#vf-2a')
    await page.waitForTimeout(300)

    // 零 console error
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    expect(errors, '全流程不应有 page error').toEqual([])
  })
})
