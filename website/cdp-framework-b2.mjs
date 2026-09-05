// CDP 验证：框架分区 B2 扩充——25 页（route-config/skyline 新页 + 全量定序）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

// 1. route-config 新页
await page.goto(base + '/docs/framework/route-config', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const h1a = (await page.locator('.doc-body h1').textContent())?.trim()
const metaRows = await page.locator('.doc-body table tr').count()
const tocA = await page.locator('.page-toc-link').count()
console.log(JSON.stringify({ h1a, metaRows, tocA }))

// 2. skyline 新页
await page.goto(base + '/docs/framework/skyline', { waitUntil: 'networkidle' })
const h1b = (await page.locator('.doc-body h1').textContent())?.trim()
const tables = await page.locator('.doc-body table').count()
console.log(JSON.stringify({ h1b, tables }))

// 3. 侧栏顺序：框架 25 链接 + 组序
await page.goto(base + '/docs/framework/overview', { waitUntil: 'networkidle' })
const groups = await page.locator('.toc-group-name').allTextContents()
const sideLinks = await page.locator('.toc-link').count()
console.log(JSON.stringify({ groups, sideLinks }))
await page.waitForTimeout(300)
await page.screenshot({ path: '../.cdp-shots/docs-framework-route-config-1440.png' })

// 4. 移动端零横滚
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (mm) => { if (mm.type() === 'error') errors.push('[m] console: ' + mm.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/docs/framework/route-config', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(500)
const scroll = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
console.log(JSON.stringify({ mobileNoHScroll: scroll.sw <= scroll.iw, sw: scroll.sw }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
