// CDP 验证：框架分区上线——6 按钮横条 / overview 架构图 / runtime 页 / 移动端 / 零报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

// 1. overview：架构图 pre 渲染 + 侧栏分组
await page.goto(base + '/docs/framework/overview', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const tabs = (await page.locator('.docs-topbar').textContent())?.replace(/\s+/g, ' ').trim()
const groups = await page.locator('.toc-group-name').allTextContents()
const pre = await page.locator('.doc-body pre').count()
const h1 = (await page.locator('.doc-body h1').textContent())?.trim()
console.log(JSON.stringify({ tabs: tabs?.slice(0, 90), h1, groups, pre }))
await page.waitForTimeout(300)
await page.screenshot({ path: '../.cdp-shots/docs-framework-overview-1440.png' })

// 2. 编译期页抽查：compile-template / compile-script / compile-routes
for (const slug of ['compile-template', 'compile-script', 'compile-routes']) {
  await page.goto(base + '/docs/framework/' + slug, { waitUntil: 'networkidle' })
  const tables = await page.locator('.doc-body table').count()
  const codes = await page.locator('.doc-body pre').count()
  const bodyLen = (await page.locator('.doc-body').textContent())?.length ?? 0
  console.log(JSON.stringify({ slug, tables, codes, bodyLen }))
}

// 3. 运行期页：runtime-mp
await page.goto(base + '/docs/framework/runtime-mp', { waitUntil: 'networkidle' })
const h1b = (await page.locator('.doc-body h1').textContent())?.trim()
const codesB = await page.locator('.doc-body pre').count()
console.log(JSON.stringify({ h1: h1b, codes: codesB }))
await page.waitForTimeout(300)
await page.screenshot({ path: '../.cdp-shots/docs-framework-runtime-mp-1440.png' })

// 4. 移动端零横滚
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (mm) => { if (mm.type() === 'error') errors.push('[m] console: ' + mm.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/docs/framework/overview', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(500)
const scroll = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
console.log(JSON.stringify({ mobileNoHScroll: scroll.sw <= scroll.iw, sw: scroll.sw }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
