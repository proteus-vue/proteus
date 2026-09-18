// CDP 验证：原语分区（★#460-#463）——顶栏 chips（8 分区）/ 组侧边栏 / 页面渲染 / 移动端零横滚 / 零 console 报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

// 1. 顶栏分区 chips：8 个含「原语」且激活；原语总览 h1/h2/表格
await page.goto(base + '/docs/primitives/00-overview', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const chips = await page.locator('.section-tab').allTextContents()
const h1 = await page.locator('.doc-body h1').textContent()
const h2 = await page.locator('.doc-body h2').count()
const tables = await page.locator('.doc-body table').count()
console.log(JSON.stringify({ chips, activeChip: await page.locator('.section-tab.active').textContent(), h1: h1?.trim(), h2, tables }))

// 2. 分组侧边栏（原语区组名 + 链接数）+ 截图
const groups = await page.locator('.toc-group-name').allTextContents()
const links = await page.locator('.toc-link').count()
console.log(JSON.stringify({ groups, linkCount: links }))
await page.screenshot({ path: '../.cdp-shots/primitives-overview-1440.png' })

// 3. 模块页抽查（scroll + eng-engineering：h2 段齐全含真实用法）+ 截图
for (const slug of ['desktop-scroll', 'gesture-use-gesture', 'eng-engineering']) {
  await page.goto(base + '/docs/primitives/' + slug, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const t = (await page.locator('.doc-body').textContent()) ?? ''
  console.log(JSON.stringify({ slug, h1: await page.locator('.doc-body h1').textContent(), hasRealUsage: t.includes('真实用法'), hasCode: await page.locator('.doc-body pre').count() }))
}
await page.goto(base + '/docs/primitives/desktop-scroll', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: '../.cdp-shots/primitives-scroll-1440.png' })

// 4. 移动端：总览 + 模块页零横滚
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (m) => { if (m.type() === 'error') errors.push('[m] console: ' + m.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/docs/primitives/00-overview', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(600)
const s1 = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
await mobile.screenshot({ path: '../.cdp-shots/primitives-overview-390.png' })
await mobile.goto(base + '/docs/primitives/eng-engineering', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(400)
const s2 = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
await mobile.screenshot({ path: '../.cdp-shots/primitives-eng-390.png' })
console.log(JSON.stringify({ mobileOverviewNoHScroll: s1.sw <= s1.iw, mobileEngNoHScroll: s2.sw <= s2.iw, sw1: s1.sw, sw2: s2.sw }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 原语分区零 console 报错')
