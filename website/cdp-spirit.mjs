// CDP 验证：Three.js 3D 海神精灵（iframe）——渲染 / 点击变身 / 父页气泡 / 横滚 / console
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('../.cdp-shots', { recursive: true })
const base = 'http://localhost:5199'
const browser = await chromium.launch()
const errors = []

async function run(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ` + m.text()) })
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ` + String(e)))
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const frame = page.frames().find((f) => f.url().includes('spirit.html'))
  if (!frame) { errors.push(`[${tag}] spirit iframe 未找到`); await page.close(); return }
  const canvasCount = await frame.locator('canvas').count()
  const label0 = (await frame.locator('#spirit-label').textContent())?.trim()
  await page.screenshot({ path: `../.cdp-shots/spirit-3d-${tag}-0.png` })
  // 点击 iframe 中心（萌宠本体）变身
  const box = await page.locator('iframe.site-spirit').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(600)
  const label1 = (await frame.locator('#spirit-label').textContent())?.trim()
  const bubbleVisible = await page.locator('.spirit-speech').isVisible().catch(() => false)
  const bubbleName = bubbleVisible ? (await page.locator('.spirit-speech-name').textContent())?.trim() : ''
  const bubbleTheme = bubbleVisible ? (await page.locator('.spirit-speech-theme').textContent())?.trim() : ''
  await page.screenshot({ path: `../.cdp-shots/spirit-3d-${tag}-1-morph.png` })
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  console.log(JSON.stringify({ tag, canvasCount, label0, label1, morphOk: label0 !== label1, bubbleVisible, bubbleName, bubbleTheme, noHScroll: scroll.sw <= scroll.iw }))
  await page.close()
}

await run(1440, 900, '1440')
await run(390, 844, '390')
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('CDP OK — 零 console 报错')
