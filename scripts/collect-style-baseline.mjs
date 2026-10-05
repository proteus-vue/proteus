#!/usr/bin/env node
// scripts/collect-style-baseline.mjs —— ★★★G-61 B0：**Web 基准采集器**（B-a 计算样式 / B-b 几何 / B-c 截图）
//
// 【它是什么（plan `03-consistency-gates.md` §1.1）】基准三件套的真采集实现——
//   在**真浏览器**（Playwright chromium）里打开 superapp 的 Web 产物，按**冻结的视口/DPR/主题**读数：
//     B-a `getComputedStyle`（语义字段对应的 CSS 属性全量）
//     B-b `getBoundingClientRect`（几何快照）
//     B-c 视口截图（PNG——各端真截图的参照物）
//   ⇒ 产物入仓（D2 冻结）+ 登记环境指纹（D3）⇒ `docs/generated/style-baseline/manifest.json` 寻址。
//
// 【为什么要独立成脚本（而不是"验收时随手跑一段"）】
//   #542/#543/#545 三轮视觉修复的基准都是**临时执行**的——没有指纹、没有冻结、没有寻址。
//   ⇒ 基准随运行漂移、差异无法归因、"三端同时偏且一致"会被判绿（D1 缺陷的最常见形态）。
//   本脚本把基准变成**可重复的采集作业**：同一命令、同一指纹、同一产物路径。
//
// 【基准纪律（本脚本内建）】
//   D3 可复现：视口 390×844 / DPR 2 / 浅色主题 / chromium——写入产物的 `env`（含浏览器版本 + UA）
//   D4 合法：采完校验**锚点文本存在**（基准不得是错误页/空态——"以坏基准比对通过所有端"是最危险的假绿）
//   D5 不自证：本脚本是**基准侧**采集器；被测端（App/Skyline）脚本**只读**本次产物，不得写入
//
// 【用法】
//   node scripts/collect-style-baseline.mjs            # 采集 + 写产物（需先构建 superapp Web 产物）
//   cd superapp && npx proteus build --target web      # （前置）构建
//   ★采集后跑 node scripts/gen-style-baseline-manifest.mjs --check 验证清单寻址一致。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ROOT = path.join(ROOT, 'superapp')
const OUT_DIR = path.join(ROOT, 'docs/generated/style-baseline')
const PORT = 4181
const BASE = `http://localhost:${PORT}`
const ROUTE = '/pages/mine'

/** ★冻结的采集环境（D3——改这里 = 基准变更，须走审批 + diff 审计） */
const VIEWPORT = { width: 390, height: 844 }
const DPR = 2
const THEME = 'light'

/** 锚点文本（D4：基准必须是**真页面**——文本缺失即采集失败，不产出"错误页基准"） */
const ANCHOR_TEXTS = ['验收控制台', 'v0.1.0 · Proteus 超级应用', '深色模式', '客服悬浮球']

/** 采集目标节点（稳定选择器——按 id/类；采集产物按 `id` 寻址） */
const TARGETS = [
  { id: 'page-root', selector: '.sa-page' },
  { id: 'mine-head', selector: '.mine-head' },
  { id: 'mine-avatar', selector: '.mine-avatar' },
  { id: 'dark-row', selector: '#mine-row-dark' },
  { id: 'dark-label', selector: '#mine-row-dark .sa-item__label' },
  { id: 'dark-desc', selector: '#mine-row-dark .sa-item__desc' },
  { id: 'dark-switch', selector: '#mine-dark' },
  { id: 'section-title', selector: '.sa-section' },
  { id: 'sa-list', selector: '.sa-list' },
  { id: 'sa-item', selector: '.sa-item' },
  { id: 'version-value', selector: '.sa-list .sa-item:last-child .sa-item__value' },
]

/** 采集的计算样式属性（对齐 StyleIR `semantic` 域的 CSS 属性——判据①/② 的比对面） */
const COMPUTED_PROPS = [
  'display', 'position', 'width', 'height',
  'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
  'flex-grow', 'flex-shrink', 'flex-basis', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left',
  'background-color', 'color', 'opacity', 'visibility', 'pointer-events',
  'border-radius', 'border-top-width', 'border-top-color', 'box-shadow',
  'font-size', 'font-weight', 'font-family', 'line-height', 'text-align',
  'letter-spacing', 'text-decoration-line', 'text-overflow', 'white-space',
  'transform', 'transform-origin', 'z-index',
]

const png = (page) => page.screenshot({ type: 'png' })

async function main() {
  if (!fs.existsSync(path.join(APP_ROOT, 'dist/web/index.html'))) {
    console.error('✗ 缺 superapp Web 产物——先跑：cd superapp && npx proteus build --target web')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const server = await preview({
    root: APP_ROOT,
    mode: 'web',
    build: { outDir: path.join(APP_ROOT, 'dist/web') },
    preview: { port: PORT },
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR, colorScheme: 'light' })

  try {
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#mine-row-dark', { timeout: 15_000 })

    // D4：锚点校验（真页面，不是错误页/空态）
    const bodyText = await page.evaluate(() => document.body.innerText)
    const missing = ANCHOR_TEXTS.filter((t) => !bodyText.includes(t))
    if (missing.length) {
      console.error(`✗ 基准锚点缺失：${missing.join(' / ')}（页面是错误页/空态——拒绝产出基准）`)
      process.exit(1)
    }

    // B-a + B-b 采集
    const nodes = {}
    for (const t of TARGETS) {
      const data = await page.evaluate(
        ({ selector, props }) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const cs = getComputedStyle(el)
          const computed = {}
          for (const p of props) computed[p] = cs.getPropertyValue(p).trim()
          const r = el.getBoundingClientRect()
          return {
            selector,
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? '').trim().slice(0, 60),
            computed,
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          }
        },
        { selector: t.selector, props: COMPUTED_PROPS },
      )
      if (!data) {
        console.error(`✗ 采集目标缺失：${t.id}（${t.selector}）——选择器已失效，改目标表后重采`)
        process.exit(1)
      }
      nodes[t.id] = data
    }

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
    }))

    const env = {
      browser: `chromium ${browser.version()}`,
      userAgent: await page.evaluate(() => navigator.userAgent),
      dpr: DPR,
      viewport: VIEWPORT,
      theme: THEME,
      url: `${BASE}${ROUTE}`,
    }
    const collectedAt = new Date().toISOString()

    // B-c 截图（视口幅——与各端真截图同幅比对；**非** fullPage，避免长度差异判不回）
    fs.writeFileSync(path.join(OUT_DIR, 'superapp-mine.png'), await png(page))
    // B-a
    fs.writeFileSync(
      path.join(OUT_DIR, 'superapp-mine.computed.json'),
      JSON.stringify(
        {
          _note:
            'G-61 B0 · Web 基准 B-a（getComputedStyle 逐属性）。由 scripts/collect-style-baseline.mjs 采集；' +
            '环境指纹见 env（D3：任一变化 ⇒ 基准变更须审批+diff 审计）。被测端只读，不得写入（D5 基准不自证）。',
          route: ROUTE,
          env,
          collectedAt,
          properties: COMPUTED_PROPS,
          nodes,
        },
        null,
        2,
      ) + '\n',
    )
    // B-b
    fs.writeFileSync(
      path.join(OUT_DIR, 'superapp-mine.geometry.json'),
      JSON.stringify(
        {
          _note:
            'G-61 B0 · Web 基准 B-b（getBoundingClientRect 几何）。与 B-a 同源同批采集（同一 env）。' +
            '各端 snapshot 的比对对象是**本文件**（D1：不是端间互比）。',
          route: ROUTE,
          env,
          collectedAt,
          viewport: VIEWPORT,
          scroll,
          nodes: Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, { selector: v.selector, text: v.text, rect: v.rect }])),
        },
        null,
        2,
      ) + '\n',
    )

    console.log('✅ Web 基准已采集（G-61 B0 · B-a/B-b/B-c）')
    console.log(`   ${env.browser} · DPR ${DPR} · ${VIEWPORT.width}×${VIEWPORT.height} · ${THEME}`)
    console.log(`   节点 ${Object.keys(nodes).length}（${Object.keys(nodes).join(', ')}）`)
    console.log(`   产物：docs/generated/style-baseline/{superapp-mine.computed.json, .geometry.json, .png}`)
    console.log('   下一步：node scripts/gen-style-baseline-manifest.mjs --check（核对清单寻址与指纹）')
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((e) => {
  console.error('✗ 采集失败：', e?.message ?? e)
  process.exit(1)
})
