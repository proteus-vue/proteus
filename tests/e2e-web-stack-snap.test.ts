// tests/e2e-web-stack-snap.test.ts
// ★G-32 L3（2026-09-19）：p-stack snap/loop 轮播的**真实浏览器**行为验证（SOP ⑫ Web 侧）
//   背景：snap/loop 是 `<swiper>` 的语义消灭形态（G-31 §2.2、rules.md 拒绝 <p-swiper>）；
//     其真实行为（滚动吸附 + 末项回环）只有真浏览器能验——组件的样式在 scoped CSS 里，jsdom 不算样式。
//   断言：① 容器真的成为滚动容器且 scroll-snap-type 生效（computed style，非源码字符串）
//        ② 子项真的拿到 scroll-snap-align（scoped 样式落到了 DOM）
//        ③ ★真实交互：滚到末项 → 自动回环回首项（我们的 JS 逻辑，非浏览器特性）
//        ④ 演示页回显更新（SOP ⑨：演示须真交互，不摆静态图）
//   运行：npm run test:e2e:web（先 build:web，再用 preview 服务产物；Chromium）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4177'
const EXAMPLES_ROOT = path.resolve(__dirname, '../examples')
const PAGE = `${BASE}/pages/semantic-primitives-demo`

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: EXAMPLES_ROOT, mode: 'web', build: { outDir: path.join(EXAMPLES_ROOT, 'dist/web') }, preview: { port: 4177 } })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(PAGE, { waitUntil: 'networkidle' })
  // 页面很长：先把轮播滚进视口（SOP T6：不滚动会假阴性）
  await page.waitForFunction(() => document.querySelector('.carousel') !== null, undefined, { timeout: 15_000 })
  await page.evaluate(() => document.querySelector('.carousel')?.scrollIntoView({ block: 'center' }))
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 读取轮播容器的几何与滚动状态 */
async function readCarousel(): Promise<{ scrollLeft: number; scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('.carousel') as HTMLElement
    return { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
}

describe('p-stack snap/loop（真实浏览器）', () => {
  it('① 容器成为滚动容器 + scroll-snap-type 生效（computed style）', async () => {
    const style = await page.evaluate(() => {
      const el = document.querySelector('.carousel') as HTMLElement
      const cs = getComputedStyle(el)
      return { snapType: cs.scrollSnapType, overflowX: cs.overflowX, display: cs.display, flexDirection: cs.flexDirection }
    })
    expect(style.snapType).toBe('x mandatory')
    expect(style.overflowX).toBe('auto')
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('row')
  })

  it('② 内容真的可横向溢出（否则吸附无从谈起——防「样样式在但没内容」假绿）', async () => {
    const { scrollWidth, clientWidth } = await readCarousel()
    expect(scrollWidth).toBeGreaterThan(clientWidth)
  })

  it('③ 子项拿到 scroll-snap-align（scoped 样式真落到 DOM）+ 不收缩', async () => {
    const child = await page.evaluate(() => {
      const el = document.querySelector('.carousel > *') as HTMLElement
      const cs = getComputedStyle(el)
      return { align: cs.scrollSnapAlign, shrink: cs.flexShrink }
    })
    expect(child.align).toBe('start')
    expect(child.shrink).toBe('0')
  })

  it('★④ 真实交互：滚到末项 → 自动回环回首项（loop）+ 演示回显更新', async () => {
    // ★回显读的是 **scroll 载荷**（e.scrollLeft）——本断言同时锁住「Web 端载荷补全」这一契约
    //   （原生 DOM scroll Event 不含滚动量；缺补全则回显恒为 0，本用例即会红）
    const hintText = () => page.evaluate(() => document.querySelector('.hint')?.textContent ?? '')

    // 初始应在首屏
    expect(await hintText()).toContain('当前定位：0')

    // 先滑到第二屏 → 回显更新为 1
    await page.evaluate(() => {
      const el = document.querySelector('.carousel') as HTMLElement
      el.scrollTo({ left: 240, behavior: 'auto' })
    })
    await page.waitForFunction(
      () => (document.querySelector('.hint')?.textContent ?? '').includes('当前定位：1'),
      undefined,
      { timeout: 5_000 },
    )

    // 再滑到最末 —— loop 应在滚动停止后把位置拉回 0
    // ★注：mandatory snap 下浏览器把位置吸附到吸附点，末屏起点超出 maxScroll
    //   → 实际可达末位是 maxScroll；loop 判定正是「到 maxScroll 即回环」，故此处滚到 scrollWidth 触发。
    await page.evaluate(() => {
      const el = document.querySelector('.carousel') as HTMLElement
      el.scrollTo({ left: el.scrollWidth, behavior: 'auto' })
    })
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.carousel') as HTMLElement
        return el.scrollLeft < 40 // 平滑回滚到首项（留容差）
      },
      undefined,
      { timeout: 10_000 },
    )
    // 回显也回到首屏（真实交互闭环，不摆静态图）
    await page.waitForFunction(
      () => (document.querySelector('.hint')?.textContent ?? '').includes('当前定位：0'),
      undefined,
      { timeout: 5_000 },
    )
  }, 30_000)
})
