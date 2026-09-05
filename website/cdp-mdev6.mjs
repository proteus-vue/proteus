import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 90)))
await page.goto('http://localhost:5180/multi-device', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
// 同壳断言：导航存在 & 仍在 SPA
const shell = await page.evaluate(() => ({
  hasNav: !!document.querySelector('.nav-shell'),
  path: location.pathname,
}))
const per = {}
for (const k of ['phone', 'tablet', 'pc', 'car', 'tv', 'watch']) {
  await page.locator(`.dev-btn:has-text("${k === 'pc' ? 'PC' : k === 'tv' ? 'TV' : k === 'car' ? 'In-car' : k === 'watch' ? 'Watch' : k === 'tablet' ? 'Tablet' : 'Phone'}")`).first().click().catch(async () => {
    // fallback: 按 index 顺序
    const idx = { phone: 0, tablet: 1, pc: 2, car: 3, tv: 4, watch: 5 }[k]
    await page.locator('.dev-btn').nth(idx).click()
  })
  await page.waitForTimeout(260)
  per[k] = (await page.locator('.screen').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 70)
}
// EN
await page.locator('.lang-switch').click()
await page.waitForTimeout(700)
const en = await page.evaluate(() => {
  const body = document.body.textContent ?? ''
  const m = (body.match(/[\u4e00-\u9fff]/g) ?? []).join('')
  return { cjk: m.slice(0, 20), len: m.length }
})
console.log(JSON.stringify({ shell, per, en, errors: errs.length ? errs : 'none' }, null, 1))
await browser.close()
