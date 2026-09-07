// 诊断：action-sheet + popover 点击后 DOM
import { preview } from 'vite'
import { chromium } from 'playwright'
import path from 'node:path'
const ROOT = path.resolve('.')
const EXAMPLES_ROOT = path.join(ROOT, 'examples')
const server = await preview({ root: EXAMPLES_ROOT, mode: 'web', build: { outDir: path.join(EXAMPLES_ROOT, 'dist/web') }, preview: { port: 4183 } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
await page.goto('http://localhost:4183/pages/semantic-primitives-demo', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
async function probe(label, text) {
  try { await page.click('text=' + text, { timeout: 5000 }) } catch (e) { console.log(label, 'click err', String(e.message).slice(0, 80)) }
  await page.waitForTimeout(1000)
  const r = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div')).filter((x) => {
      const c = (x.className || '').toString()
      return /as-|popover|sheet|action/.test(c)
    })
    return els.map((x) => ({ c: (x.className || '').toString().slice(0, 70), vis: x.getBoundingClientRect().height > 0, r: Math.round(x.getBoundingClientRect().top) })).slice(0, 14)
  })
  console.log(label, JSON.stringify(r))
}
await probe('AS', '打开动作面板')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await probe('POP', '触发气泡')
console.log('ERRS:', JSON.stringify(errs).slice(0, 800))
await browser.close()
await server.close()
