// CDP 验证：29 篇分组文档——分组侧边栏 / 内容渲染 / TOC / prev-next / 零 console 报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

await page.goto(base + '/docs/01-intro', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1. 侧边栏分组数 + 总链接数
const groups = await page.locator('.toc-group-name').allTextContents()
const links = await page.locator('.toc-link').count()
console.log(JSON.stringify({ groups, linkCount: links }))

// 2. 内容量抽查：12 布局组件（最长篇）+ 26 一致性（新增）+ 28 FAQ
for (const slug of ['12-layout-components', '26-conformance', '28-faq']) {
  await page.goto(base + '/docs/' + slug, { waitUntil: 'networkidle' })
  const h1 = await page.locator('.doc-body h1').count()
  const h2 = await page.locator('.doc-body h2').count()
  const tables = await page.locator('.doc-body table').count()
  const codes = await page.locator('.doc-body pre').count()
  const toc = await page.locator('.page-toc-link').count()
  const bodyLen = (await page.locator('.doc-body').textContent())?.length ?? 0
  console.log(JSON.stringify({ slug, h1, h2, tables, codes, toc, bodyLen }))
}

// 3. 截图：分组侧边栏 + 内容页
await page.goto(base + '/docs/12-layout-components', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.screenshot({ path: '../.cdp-shots/docs-groups-1440.png' })

// 4. 移动端（p-sidebar 收敛模式 + 零横滚）
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (m) => { if (m.type() === 'error') errors.push('[m] console: ' + m.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/docs/12-layout-components', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(600)
const scroll = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
await mobile.screenshot({ path: '../.cdp-shots/docs-groups-390.png' })
console.log(JSON.stringify({ mobileNoHScroll: scroll.sw <= scroll.iw, sw: scroll.sw }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
