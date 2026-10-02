#!/usr/bin/env node
// 六端 SFC 压力夹具采集（Web 端）——`examples/pages/consistency-stress.vue` 的 **Proteus 编译产物**（Vue SPA）
// → Playwright 截图 → docs/generated/consistency-samples/sfc/sfc.web.png
//
// 【与 shoot-l4-web.mjs 的差别】L4 采的是手写 HTML 夹具；本脚本采的是 **SFC 经完整编译链**
//   （examples 项目：Proteus 编译器 → Vite → Vue SPA）渲染的同一份页面。
//   ⇒ 与 iOS/Android 的 Vapor 链**同源**（同一个 .vue 文件）。
//
// 【viewport 与 SFC 的关系】SFC 根声明 375×800（逻辑 px）⇒ 浏览器 viewport 取 390×844（略大，
//   让 375×800 内容完整可见 + 留边），DPR2（原生渲染，避免插值污染）。
//   ★锚定归一（报告侧）会按锚块把它们定标到统一尺寸——各端 DPR 差异由它吸收。
//
// 【退出条件】`load` + `document.fonts.ready`（两者都是"完成即返回"）；零轮询/零 sleep。
// 【防假绿】特征色探针（锚块蓝 / chip 紫 / 行底深灰）+ `#stress-anchor` 元素存在断言。
//
// 用法：node scripts/shoot-stress-web.mjs
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { decodePng } from '../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.env.PROTEUS_STRESS_WEB_DIST ?? path.join(ROOT, 'examples/dist/web')
const OUT = process.env.PROTEUS_STRESS_OUT ?? path.join(ROOT, 'docs/generated/consistency-samples/sfc')
const PAGE_PATH = process.env.PROTEUS_STRESS_PAGE ?? '/pages/consistency-stress'
const OUT_PNG = path.join(OUT, 'sfc.web.png')
const TMP_PNG = path.join(OUT, 'sfc.web.tmp.png')

if (!fs.existsSync(DIST)) {
  console.error(`[stress-web] ✗ 缺构建产物：${DIST}（先跑 cd examples && npx tsx ../packages/cli/src/index.ts build --target web）`)
  process.exit(2)
}
fs.mkdirSync(OUT, { recursive: true })

// SPA 静态服务（深链 fallback 到 index.html——与 pages.yml 的 404.html 兜底同款）
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.json': 'application/json', '.mp4': 'video/mp4',
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let fp = path.join(DIST, decodeURIComponent(url.pathname))
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST, 'index.html')
  res.setHeader('content-type', MIME[path.extname(fp)] ?? 'application/octet-stream')
  fs.createReadStream(fp).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch({ headless: true })
let probe = null
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  try {
    await page.goto(`http://127.0.0.1:${port}${PAGE_PATH}`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    // ★锚点存在断言（防"路由没匹配上/页面没渲染"——比颜色探针更早失败更明确）
    await page.waitForSelector('#stress-anchor', { timeout: 15000 })
    // ★★等**路由转场结束**（本仓实测踩到的假红）：examples 的路由有**层叠转场**
    //   （`router-view layered` + barrier 遮罩压暗旧页）⇒ 转场期间截图会把整页颜色压暗
    //   （实测锚块蓝被压成 [162,190,246] 而非 [47,111,237]）。
    //   判据 = **锚块元素的 `opacity` 已回到 1 且其祖先链无半透明遮挡**——条件等待（有界 15s，
    //   超时不报错：无转场形态是合法的，后续像素探针兜底）。
    await page
      .waitForFunction(
        () => {
          let el = document.querySelector('#stress-anchor')
          for (let d = 0; el && d < 12; d++) {
            const cs = getComputedStyle(el)
            if (Number(cs.opacity) < 1) return false
            el = el.parentElement
          }
          return true
        },
        { timeout: 15000 },
      )
      .catch(() => { /* 超时 ⇒ 交给像素探针判（不在这里静默放行） */ })
    // ★等两帧（v-for 渲染 + 布局稳定）
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))
    const anchorBox = await page.evaluate(() => {
      const el = document.querySelector('#stress-anchor')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    probe = { anchorBox, pageErrors: errs.length ? errs.slice(0, 3) : [] }
    await page.screenshot({ path: TMP_PNG })
  } finally {
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}

// ★防假绿（**锚点位置断言**——比"全图任意位置命中"强得多，本仓实测的判据升级）：
//   首版用 `assertPixelsPresent`（全图找色）有盲区：页面**任意位置**有该色即通过，
//   而"锚块本身没画对"（被转场压暗/位置错/被覆盖）照样绿（实测踩到：压暗后整页无 #2f6fed，
//   但探针是"全图找"，转场一结束就恢复了——判据看不出"什么时候采的"）。
//   ⇒ 改用 **DOM 锚块矩形 → 截图同区域采样**：期望色与声明色逐通道精确相等（±2），
//     且区域内 ≥50% 像素为该色（比例断言同时覆盖"取景对/被遮挡"两类异常）。
const img = await decodePng(new Uint8Array(fs.readFileSync(TMP_PNG)))
if (!probe?.anchorBox) {
  console.error('[stress-web] ✗ 缺 #stress-anchor 的 DOM 矩形（无法做位置断言）')
  process.exit(1)
}
const DPR = 2
const box = {
  x: Math.round(probe.anchorBox.x * DPR),
  y: Math.round(probe.anchorBox.y * DPR),
  w: Math.round(probe.anchorBox.w * DPR),
  h: Math.round(probe.anchorBox.h * DPR),
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
let hitCount = 0
let firstMiss = null
// 内缩 4px：避开圆角边缘的 AA 像素（角上是背景色，属正常）
for (let y = box.y + 4; y < box.y + box.h - 4; y++) {
  for (let x = box.x + 4; x < box.x + box.w - 4; x++) {
    const i = (y * img.width + x) * 4
    if (near(img.rgba[i], 47) && near(img.rgba[i + 1], 111) && near(img.rgba[i + 2], 237)) hitCount++
    else if (!firstMiss) firstMiss = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]
  }
}
const total = Math.max(1, (box.w - 8) * (box.h - 8))
const ratio = hitCount / total
if (ratio < 0.5) {
  console.error(
    `[stress-web] ✗ 锚块位置断言失败：DOM 矩形 (${box.x},${box.y}) ${box.w}×${box.h} 内仅 ${(ratio * 100).toFixed(1)}% 像素为 #2f6fed` +
      `（首个非命中样本 RGB=${JSON.stringify(firstMiss)}）——转场/覆盖/取景异常`,
  )
  process.exit(1)
}
fs.renameSync(TMP_PNG, OUT_PNG)
console.log(`[stress-web] ✅ ${img.width}x${img.height} → ${path.relative(ROOT, OUT_PNG)}`)
console.log(`            锚块位置断言通过：${(ratio * 100).toFixed(1)}% 像素 = #2f6fed @DOM (${box.x},${box.y}) ${box.w}×${box.h}`)
if (probe?.anchorBox) {
  console.log(`            #stress-anchor DOM box: ${JSON.stringify(probe.anchorBox)}（与截图锚定归一交叉验证）`)
}
if (probe?.pageErrors?.length) {
  console.log(`            ⚠ 页面错误：${JSON.stringify(probe.pageErrors)}`)
}
