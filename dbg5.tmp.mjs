import { preview } from 'vite'
import { chromium } from 'playwright'
import path from 'node:path'
const APP_ROOT = '/Volumes/data1/work/office/debug/proteus/superapp'
const server = await preview({ root: APP_ROOT, mode: 'web', build: { outDir: path.join(APP_ROOT, 'dist/web') }, preview: { port: 4214 } })
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await page.goto('http://localhost:4214/pages/mine', { waitUntil: 'networkidle' })
await page.waitForSelector('#mine-dark', { timeout: 15000 })
await page.waitForTimeout(500)
const r = await page.evaluate(() => {
  const el = document.querySelector('#mine-dark')
  const b = el.getBoundingClientRect()
  const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
  return { top: at ? String(at.className || '').slice(0, 60) : null }
})
console.log('TOP:', JSON.stringify(r))
await page.click('#mine-dark', { timeout: 5000 }).catch((e) => console.log('click err', String(e).slice(0, 80)))
await page.waitForTimeout(600)
console.log('THEME:', await page.evaluate(() => globalThis.__SUPERAPP_GLOBAL__?.theme?.value))
await browser.close(); await server.close()
