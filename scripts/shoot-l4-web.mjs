#!/usr/bin/env node
// L4 真截图采集（Web 端）：用 Playwright/Chromium 截同一夹具的 HTML 版
// —— `spike/vc0-skyline-geom/web/l4.html`（与小程序两页同声明，见该文件头注）。
//
// 【这一端补什么】L4 此前只有小程序双渲染器一对截图（Skyline vs WebView——同一运行时）。
//   Web 端接入后，报告里新增 **跨运行时** 对照（浏览器 vs 小程序）——这才是"多端一致性"的主线。
//
// 【★为什么 viewport 390×844 @DPR2】对照物是小程序模拟器截图 640×1386（390×844 逻辑 × ≈1.64）。
//   若 Web 用 DPR=1（390×844），需上采样才知道细节——文字/AA 全是插值痕迹，观测退化成"比插值"。
//   DPR=2 ⇒ 780×1688 **原生渲染**，再由报告侧 `resampleTo` 归一到 640×1386（`alignSize` 的真实用例）。
//
// 【退出条件（零盲等）】load 事件 + `document.fonts.ready`（两者都是"完成即返回"）。
// 【防假绿】截完**断言特征色**（蓝块/阴影底/渐变两端）——截到空白/错误页当场红；
//   断言通过才原子换名到正式文件（失败不留下可疑 PNG 污染报告）。
//
// 用法：node scripts/shoot-l4-web.mjs
//   PROTEUS_L4_WEB_PAGE 覆盖夹具路径 · PROTEUS_L4_OUT 覆盖输出目录
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { decodePng, assertPixelsPresent } from '../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = process.env.PROTEUS_L4_WEB_PAGE ?? path.join(ROOT, 'spike/vc0-skyline-geom/web/l4.html')
const OUT_DIR = process.env.PROTEUS_L4_OUT ?? path.join(ROOT, 'docs/generated/consistency-samples/pixels')
const OUT = path.join(OUT_DIR, 'l4.web.png')
const TMP = path.join(OUT_DIR, 'l4.web.tmp.png')

if (!fs.existsSync(PAGE)) {
  console.error(`[l4-web] ✗ 夹具不存在：${PAGE}`)
  process.exit(2)
}

// ① 静态前置（**声明平价**）：Web 夹具与小程序夹具必须声明同一组值——
//    截完再发现两端声明不同 = 白采一轮，且把"夹具笔误"读成"端差异"。四组声明 + 内容文本全查。
{
  const mpWxml = fs.readFileSync(path.join(ROOT, 'spike/vc0-skyline-geom/pages/l4-skyline/index.wxml'), 'utf-8')
  const webHtml = fs.readFileSync(PAGE, 'utf-8')
  const decls = [
    'width:80px;height:48px;border-radius:14px;background-color:#2f6fed;margin-bottom:10px',
    'width:80px;height:48px;background-color:#2a3f66;box-shadow:0 3px 10px rgba(0,0,0,0.7);margin-bottom:10px',
    'width:80px;height:48px;background-image:linear-gradient(90deg,#7c5cff,#ff9a6c);margin-bottom:10px',
    'font-size:18px;color:#ffffff',
    '字形 Ag 8 中',
  ]
  const mpWxss = fs.readFileSync(path.join(ROOT, 'spike/vc0-skyline-geom/pages/l4-skyline/index.wxss'), 'utf-8')
  const missing = decls.filter((d) => !mpWxml.includes(d))            // 四组元素声明 + 文本（wxml 内联样式）
  const missingWeb = decls.filter((d) => !webHtml.includes(d))
  const padOk = mpWxss.includes('padding: 120px 16px 16px') && webHtml.includes('padding: 120px 16px 16px')  // 根容器声明在 wxss/style
  if (missing.length > 0 || missingWeb.length > 0 || !padOk) {
    console.error('[l4-web] ✗ 夹具声明不平价（Web 与小程序必须同声明——结构同构是同构比较的前提）')
    if (missing.length > 0) console.error('  小程序侧缺：' + JSON.stringify(missing))
    if (missingWeb.length > 0) console.error('  Web 侧缺：' + JSON.stringify(missingWeb))
    if (!padOk) console.error('  padding 声明不平价（wxss/html）')
    process.exit(2)
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  // 逻辑画布 = 小程序模拟器同款 390×844；DPR2 ⇒ 780×1688（见头注）
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  try {
    await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    await page.screenshot({ path: TMP })
  } finally {
    await page.close()
  }
} finally {
  await browser.close()
}

// 防假绿：特征色必须命中（与 mp 侧采集同一组颜色——见 probe-png-colors 调用点）
const img = await decodePng(new Uint8Array(fs.readFileSync(TMP)))
const probes = [
  { name: 'radius-blue', rgb: [47, 111, 237] },
  { name: 'shadow-bg', rgb: [42, 63, 102] },
  { name: 'gradient-start', rgb: [124, 92, 255] },
  { name: 'gradient-end', rgb: [255, 154, 108] },
]
const r = assertPixelsPresent(img, probes)
if (!r.ok) {
  fs.rmSync(TMP, { force: true })
  console.error(`[l4-web] ✗ ${img.width}x${img.height} 特征色未命中：${JSON.stringify(r.missed)}（空白/错误页？不留下可疑 PNG）`)
  process.exit(1)
}
fs.renameSync(TMP, OUT)
console.log(`[l4-web] ✅ ${img.width}x${img.height} 特征色全命中 → ${path.relative(ROOT, OUT)}`)
