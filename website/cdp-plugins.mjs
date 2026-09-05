// CDP 验证：插件 API 分区上线——5 按钮横条 / 生成页渲染 / 零报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

await page.goto(base + '/docs/plugin/host', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const tabs = await page.locator('.docs-topbar').textContent()
const h1 = await page.locator('.doc-body h1').textContent()
const h2s = await page.locator('.doc-body h2').count()
const links = await page.locator('.toc-link').count()
const generatedMark = (await page.locator('.doc-body').textContent())?.includes('请勿手工编辑')
console.log(JSON.stringify({ tabs: tabs?.replace(/\s+/g, ' ').trim().slice(0, 80), h1: h1?.trim(), h2s, links, generatedMark }))
await page.waitForTimeout(300)
await page.screenshot({ path: '../.cdp-shots/docs-plugins-host-1440.png' })

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
