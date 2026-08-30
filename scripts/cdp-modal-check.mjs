// scripts/cdp-modal-check.mjs —— CDP 验证 modal 对齐微信 WeUI（标题/内容间距、按钮 48px、分割线）
import { chromium } from 'playwright'

const URL = 'http://localhost:4174/pages/mp-semantics-demo'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// 点击 wx.showModal 按钮
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find((x) => x.textContent.includes('showModal'))
  b?.click()
})
await page.waitForTimeout(300)

const result = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      rect: { w: rect.width, h: rect.height, top: rect.top, left: rect.left },
      padding: cs.padding,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      background: cs.backgroundColor,
    }
  }
  const modal = pick('.proteus-web-modal')
  const title = pick('.pwu-modal-title')
  const content = pick('.pwu-modal-content')
  const cancel = pick('.pwu-modal-btn--cancel')
  const confirm = pick('.pwu-modal-btn--confirm')
  const btns = pick('.pwu-modal-btns')
  return { modal, title, content, cancel, confirm, btns }
})

console.log(JSON.stringify(result, null, 2))

await page.screenshot({ path: '/tmp/modal-web.png' })
console.log('screenshot: /tmp/modal-web.png')
await browser.close()
