// scripts/cdp-style-check.mjs —— CDP 检查 mp-semantics-demo Web 渲染样式（对比微信小程序默认）
// 用法：node scripts/cdp-style-check.mjs
import { chromium } from 'playwright'

const URL = 'http://localhost:4174/pages/mp-semantics-demo'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// 收集关键元素 computed style
const result = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      display: cs.display,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      background: cs.backgroundColor,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      margin: cs.margin,
      width: rect.width,
      height: rect.height,
    }
  }
  const body = pick('body')
  const msd = pick('.msd')
  const box = pick('.msd-box')
  const title = pick('.msd-title')
  const sub = pick('.msd-sub')
  const buttons = [...document.querySelectorAll('button')].slice(0, 3).map((b) => {
    const cs = getComputedStyle(b)
    return {
      text: b.textContent.trim().slice(0, 20),
      display: cs.display,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      background: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      margin: cs.margin,
      w: b.getBoundingClientRect().width,
      h: b.getBoundingClientRect().height,
      after: getComputedStyle(b, '::after').borderTopWidth + ' ' + getComputedStyle(b, '::after').borderTopStyle,
    }
  })
  const input = document.querySelector('input')
  const inputStyle = input
    ? (() => {
        const cs = getComputedStyle(input)
        return { display: cs.display, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, background: cs.backgroundColor, h: input.getBoundingClientRect().height }
      })()
    : null
  const img = document.querySelector('img')
  const imgStyle = img ? { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, objectFit: getComputedStyle(img).objectFit } : null
  // 渲染 DOM 结构（小程序语义组件是否生效）
  const hasProteusWeb = document.querySelectorAll('.proteus-web-view, .proteus-web-button, .proteus-web-input').length
  return { body, msd, box, title, sub, buttons, inputStyle, imgStyle, hasProteusWeb }
})

console.log(JSON.stringify(result, null, 2))

await page.screenshot({ path: '/tmp/mp-semantics-web.png' })
console.log('screenshot: /tmp/mp-semantics-web.png')
await browser.close()
