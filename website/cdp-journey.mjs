// CDP 验证：指南区 IA 重组（36 页 8 组初学者旅程）——分组/顺序/新页渲染/prev-next/零报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

// 1. 旅程起点：01-intro 分组与侧边栏
await page.goto(base + '/docs/01-intro', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const groups = await page.locator('.toc-group-name').allTextContents()
const links = await page.locator('.toc-link').count()
const firstGroupItems = await page.locator('.toc-link').evaluateAll((els) =>
  els.slice(0, 10).map((e) => e.textContent?.trim() ?? ''),
)
console.log(JSON.stringify({ groups, linkCount: links, firstGroupItems }))

// 2. 新页渲染抽查：02-difference / 03-playground / 09-page-anatomy / 10-config
for (const slug of ['02-difference', '03-playground', '09-page-anatomy', '10-config']) {
  await page.goto(base + '/docs/' + slug, { waitUntil: 'networkidle' })
  const h1 = await page.locator('.doc-body h1').count()
  const h2 = await page.locator('.doc-body h2').count()
  const tables = await page.locator('.doc-body table').count()
  const codes = await page.locator('.doc-body pre').count()
  const bodyLen = (await page.locator('.doc-body').textContent())?.length ?? 0
  console.log(JSON.stringify({ slug, h1, h2, tables, codes, bodyLen }))
}

// 3. prev-next 旅程衔接：05 → 06 → 07（开始组内连续）
await page.goto(base + '/docs/05-create-project', { waitUntil: 'networkidle' })
const nextHref = await page.locator('.pager-link').last().getAttribute('href')
await page.goto(base + '/docs/07-build-release', { waitUntil: 'networkidle' })
const prevHrefs = await page.locator('.pager-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
console.log(JSON.stringify({ nextFrom05: nextHref, pagersOn07: prevHrefs }))

// 4. 深页回归：23-render-backend / 29-conformance / 36-faq
for (const slug of ['23-render-backend', '29-conformance', '36-faq']) {
  await page.goto(base + '/docs/' + slug, { waitUntil: 'networkidle' })
  const bodyLen = (await page.locator('.doc-body').textContent())?.length ?? 0
  console.log(JSON.stringify({ slug, bodyLen }))
}

// 5. 截图：起步组 + 09 页面构成
await page.goto(base + '/docs/01-intro', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: '../.cdp-shots/docs-journey-01-intro-1440.png' })
await page.goto(base + '/docs/09-page-anatomy', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: '../.cdp-shots/docs-journey-09-anatomy-1440.png' })

// 6. 移动端：零横滚 + 零报错
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (m) => { if (m.type() === 'error') errors.push('[m] console: ' + m.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/docs/09-page-anatomy', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(500)
const scroll = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
await mobile.screenshot({ path: '../.cdp-shots/docs-journey-09-anatomy-390.png' })
console.log(JSON.stringify({ mobileNoHScroll: scroll.sw <= scroll.iw, sw: scroll.sw }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
