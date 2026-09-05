// CDP 验证：Home 学习路径区（★#398）——卡片数/居中/横滚/报错 + 截图
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1. 学习路径区结构
const cards = await page.locator('.journey .journey-card').count()
const titles = await page.locator('.journey .pillar-title').allTextContents()
const hrefs = await page.locator('.journey .journey-card').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
console.log(JSON.stringify({ cards, titles, hrefs }))

// 2. 区块水平居中（标题中心 ≈ 视口中心，偏差 < 4px）
const m = await page.locator('.journey .section-title').evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, vw: window.innerWidth }
})
const centerOffset = Math.abs(m.left + m.right - 2 * (m.vw / 2)) / 2
console.log(JSON.stringify({ titleCenterOffset: Math.round(centerOffset * 10) / 10 }))

// 3. 卡片链接可达（抽一个 href 实际跳转）
await page.goto(base + '/docs/08-structure', { waitUntil: 'networkidle' })
const h1 = await page.locator('.doc-body h1').textContent()
console.log(JSON.stringify({ target08: h1?.trim() }))

// 4. 截图：学习路径区（滚动到位）
await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.evaluate(() => document.querySelector('.journey')?.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(900)
await page.screenshot({ path: '../.cdp-shots/home-journey-1440.png' })

// 5. 移动端：零横滚 + 卡片纵排
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('console', (mm) => { if (mm.type() === 'error') errors.push('[m] console: ' + mm.text()) })
mobile.on('pageerror', (e) => errors.push('[m] pageerror: ' + String(e)))
await mobile.goto(base + '/', { waitUntil: 'networkidle' })
await mobile.waitForTimeout(600)
await mobile.evaluate(() => document.querySelector('.journey')?.scrollIntoView({ block: 'center' }))
await mobile.waitForTimeout(900)
const scroll = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
const mCards = await mobile.locator('.journey .journey-card').count()
await mobile.screenshot({ path: '../.cdp-shots/home-journey-390.png' })
console.log(JSON.stringify({ mobileNoHScroll: scroll.sw <= scroll.iw, sw: scroll.sw, mCards }))

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
