#!/usr/bin/env node
// scripts/css-conformance.mjs —— ★★★CSS 一致性验收项目跑器（用户 2026-10-05 指定：
//   「CSS视觉验收也新建一个单独的项目……需要真实的 vue 页面里面去做真实编译渲染验收，不是装置写逻辑代码」）
//
// 【它做什么】驱动 `css-conformance/` **独立项目**的逐端真实渲染验收：
//   · `collect-web`：真实构建（proteus build --target web）→ 真 Chromium 打开页面 →
//       逐页整屏截图 + 逐案例（`id="case-*"`）裁剪截图 + getComputedStyle 读数 → **基准产物**
//   · `shot-mp`：真实构建（--target skyline）→ wechatide 模拟器导航 + 逐页整屏截图
//   · `shot-app <android|ios|harmony>`：提示走宿主既有链路（PROTEUS_APP_PROJECT=css-conformance），
//       跑完把截屏复制进 results/<end>/（本脚本**不重造**设备链——那是 hosts/* 的职责）
//   · `side-by-side`：逐页把「Web 基准 | 该端」拼一行（D1：左半恒为 Web 基准）→ 供独立视觉评审
//   · `status`：证据齐备表（哪些端已有截图）——缺证据**如实列出**，不静默
//
// 【★纪律】
//   · 案例清单**机器提取**（从页面 SFC 的 `id="case-*"`），不手写——防"文档说三个、实采两个"漂移
//   · 本脚本**不做视觉判断**（那是独立子代理的职责）；它只产证据（截图/读数/并排/状态表）
//   · 禁止盲等：本脚本不 sleep；需要等待时用有界条件（wait_for.sh / Playwright 自身等待）
//
// 用法：
//   node scripts/css-conformance.mjs collect-web
//   node scripts/css-conformance.mjs shot-mp
//   node scripts/css-conformance.mjs shot-app android|ios|harmony
//   node scripts/css-conformance.mjs side-by-side [end]
//   node scripts/css-conformance.mjs status
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.join(ROOT, 'css-conformance')
const RESULTS = path.join(PROJ, 'results')
const ROUTES = path.join(PROJ, 'router', 'auto-routes.ts')

/** 冻结的采集环境（与 G-61 基准同口径：390×844 / DPR2 / 浅色） */
const VIEWPORT = { width: 390, height: 844 }
const DPR = 2
const WEB_PORT = 4183

/** 案例元素上要读的计算属性（文本/盒/布局族——与 StyleIR semantic 域对齐） */
const COMPUTED_PROPS = [
  'display', 'position', 'width', 'height',
  'overflow-x', 'overflow-y', 'white-space', 'text-overflow', 'word-break',
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color',
  'background-color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'flex-direction', 'justify-content', 'align-items', 'flex-grow', 'flex-shrink', 'gap', 'row-gap', 'column-gap',
  'max-width', 'min-width', 'box-sizing', 'opacity', 'visibility', 'transform', 'box-shadow',
]

/** 页面清单（机器来源：router/auto-routes.ts 的 routes 表） */
function pageList() {
  if (!fs.existsSync(ROUTES)) {
    console.error(`✗ 缺 ${path.relative(ROOT, ROUTES)}——先构图：cd css-conformance && npx proteus build --target web`)
    process.exit(2)
  }
  const src = fs.readFileSync(ROUTES, 'utf-8')
  const out = []
  for (const m of src.matchAll(/\{ name: "([^"]+)", path: "(pages\/[^"]+)"/g)) {
    out.push({ name: m[1], route: '/' + m[2] })
  }
  return out
}

/** 案例 id 清单（机器来源：页面 SFC 的 id="case-*"——不手写） */
function casesOf(page) {
  const f = path.join(PROJ, `${page.route.replace(/^\//, '')}.vue`)
  const src = fs.readFileSync(f, 'utf-8')
  return [...new Set([...src.matchAll(/id="(case-[^"]+)"/g)].map((m) => m[1]))]
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}

function build(target) {
  console.log(`[css-conf] 构建 ${target} …`)
  const r = spawnSync('npx', ['proteus', 'build', '--target', target], { cwd: PROJ, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`✗ 构建失败（${target}）`)
    process.exit(1)
  }
}

/* ══════════════════ collect-web：Web 基准（B-a 计算样式 + B-c 截图） ══════════════════ */
async function collectWeb() {
  build('web')
  const { preview } = await import('vite')
  const { chromium } = await import('playwright')
  const outDir = path.join(RESULTS, 'web')
  ensureDir(outDir)

  const server = await preview({
    root: PROJ,
    mode: 'web',
    build: { outDir: path.join(PROJ, 'dist/web') },
    preview: { port: WEB_PORT },
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR, colorScheme: 'light' })
  const index = { env: null, pages: {} }
  try {
    index.env = {
      browser: `chromium ${browser.version()}`,
      viewport: VIEWPORT,
      dpr: DPR,
      theme: 'light',
      collectedAt: new Date().toISOString(),
    }
    for (const p of pageList()) {
      const url = `http://localhost:${WEB_PORT}${p.route}`
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForSelector('.cc-page', { timeout: 15_000 })
      // 整屏截图（与各端真截图同幅）
      await page.screenshot({ path: path.join(outDir, `${p.name}.png`), type: 'png' })
      const cases = casesOf(p)
      const reads = {}
      for (const id of cases) {
        const el = await page.$(`#${id}`)
        if (!el) {
          console.error(`✗ 案例元素缺失：#${id}（${p.name}）——页面与清单不一致`)
          process.exit(1)
        }
        const box = await el.boundingBox()
        if (box) {
          await page.screenshot({
            path: path.join(outDir, `${p.name}.${id}.png`),
            type: 'png',
            clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: box.height + 8 },
          })
        }
        reads[id] = await page.evaluate(
          ({ id, props }) => {
            const root = document.getElementById(id)
            if (!root) return null
            const pick = (el) => {
              const cs = getComputedStyle(el)
              const o = {}
              for (const k of props) o[k] = cs.getPropertyValue(k).trim()
              return o
            }
            const r = root.getBoundingClientRect()
            return {
              tag: root.tagName.toLowerCase(),
              text: (root.textContent ?? '').trim().slice(0, 120),
              rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              computed: pick(root),
              // 首个元素子节点（案例的"内容元素"——多数判据看它）
              child: root.firstElementChild
                ? { tag: root.firstElementChild.tagName.toLowerCase(), computed: pick(root.firstElementChild) }
                : null,
            }
          },
          { id, props: COMPUTED_PROPS },
        )
      }
      index.pages[p.name] = { route: p.route, cases: reads }
      console.log(`[css-conf] web/${p.name}.png（案例 ${cases.length}：${cases.join(', ')}）`)
    }
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
    console.log(`✅ Web 基准已采集 → css-conformance/results/web/（${Object.keys(index.pages).length} 页）`)
  } finally {
    await browser.close()
    await server.close()
  }
}

/* ══════════════════ shot-mp：微信开发者工具（模拟器真实渲染） ══════════════════ */
function shotMp() {
  build('skyline')
  const outDir = path.join(RESULTS, 'mp')
  ensureDir(outDir)
  const mpProj = path.join(PROJ, 'dist/mp-weixin')
  const CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
  const waitSh = path.join(ROOT, '.agents/skills/ai-efficiency-rules/scripts/wait_for.sh')

  /** wechatide skill-CLI 调用（与 scripts/showcase-shot.mjs 同通道）
   *  ★实测教训：simulator_screenshot 在**项目窗口未打开**时返回 `mcp_business_fail`（而退出码仍 0）——
   *    故先 open_project_window；且错误检测必须看 `ok`（顶层）而非只 `result.success`。 */
  const wxide = (tool, extra = {}) => {
    const argv = ['-c', 'zed', tool, '--project', mpProj]
    for (const [k, v] of Object.entries(extra)) argv.push(`--${k}`, String(v))
    const r = spawnSync(CLI, argv, { encoding: 'utf8', timeout: 90_000 })
    const m = (r.stdout || '').match(/\{[\s\S]*\}/)
    if (!m) throw new Error(`${tool} 无 JSON 输出：${(r.stderr || r.stdout || '').slice(0, 200)}`)
    const body = JSON.parse(m[0])
    const res = body.result ?? body
    if (body.ok === false || res.success === false) {
      throw new Error(`${tool} 失败：${body.reason ?? res.error ?? res.message ?? JSON.stringify(body).slice(0, 200)}`)
    }
    return res
  }

  // ★前置：打开项目窗口（未打开时 screenshot 返回 mcp_business_fail）
  console.log(`[css-conf] 打开项目窗口（${path.relative(ROOT, mpProj)}）…`)
  wxide('open_project_window')

  for (const p of pageList()) {
    // 导航（reLaunch）→ 条件等待 currentPage 到位（wait_for.sh 有界轮询；本脚本零 sleep）
    spawnSync(CLI, ['-c', 'zed', 'automation_navigate', '--project', mpProj, '--action', 'reLaunch', '--url', p.route], {
      encoding: 'utf8',
      timeout: 90_000,
    })
    const name = p.name
    const probe = `'${CLI}' -c zed automation_runtime_info --project '${mpProj}' | grep -q '"${name}"'`
    const w = spawnSync('bash', [waitSh, '--cmd', probe, '--timeout', '30', '--interval', '2'], { encoding: 'utf8' })
    if (w.status !== 0) console.warn(`  ⚠ ${p.route} 未确认到达（30s）——仍截图`)
    const out = path.join(outDir, `${p.name}.png`)
    const res = wxide('simulator_screenshot', { path: out })
    console.log(`✓ mp/${p.name}.png（${res.imageWidth ?? '?'}×${res.imageHeight ?? '?'}）${p.route}`)
  }
  console.log('✅ MP 截图完成 → css-conformance/results/mp/')
}

/* ══════════════════ shot-app：宿主既有链路的**产物归位** ══════════════════ */
function shotApp(end) {
  if (!['android', 'ios', 'harmony'].includes(end)) {
    console.error('用法：shot-app android|ios|harmony')
    process.exit(2)
  }
  console.log(`[css-conf] App 端（${end}）走宿主既有链路——本项目以 css-conformance 为应用工程注入：`)
  console.log(`    export PROTEUS_APP_PROJECT=css-conformance`)
  console.log(`    ① cd css-conformance && npx proteus build --target ${end}        # 屏内容（dist/app/${end}/screen-content.json）`)
  if (end === 'android') {
    console.log('    ② node hosts/android/bridge/build-batch.mjs && bash hosts/android/build-and-run.sh --no-install')
    console.log('    ③ bash hosts/android/run-superapp.sh')
    console.log('    ④ node scripts/css-conformance.mjs shot-app android --take   # 把 hosts/android/results/superapp.json 同名图归位（可选）')
  } else if (end === 'ios') {
    console.log('    ② bash hosts/ios/run-selfdraw.sh --superapp --drive')
  } else {
    console.log('    ② bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-superapp.sh')
  }
  console.log('    ★跑完后：node hosts/shared/bridge/gen-app-screen-content.mjs  # 把 generated 文件恢复为 superapp（避免误提交）')
}

/* ══════════════════ side-by-side：Web 基准 | 该端（逐页一行） ══════════════════ */
function sideBySide(end) {
  const ends = end ? [end] : ['mp', 'android', 'ios', 'harmony']
  const webDir = path.join(RESULTS, 'web')
  if (!fs.existsSync(webDir)) {
    console.error('✗ 缺 Web 基准——先跑：node scripts/css-conformance.mjs collect-web')
    process.exit(2)
  }
  const outDir = path.join(RESULTS, 'side-by-side')
  ensureDir(outDir)
  const rows = []
  for (const e of ends) {
    const dir = path.join(RESULTS, e)
    if (!fs.existsSync(dir)) {
      rows.push({ end: e, status: '缺证据（未跑该端）' })
      continue
    }
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'))
    if (pngs.length === 0) {
      rows.push({ end: e, status: '缺证据（目录空）' })
      continue
    }
    for (const f of pngs) {
      const webPng = path.join(webDir, f)
      if (!fs.existsSync(webPng)) {
        rows.push({ end: e, page: f, status: 'Web 基准缺此页截图' })
        continue
      }
      const out = path.join(outDir, `${f.replace(/\.png$/, '')}.${e}-vs-web.png`)
      // sips 拼合：等高缩放后横向拼接（左 = Web 基准（D1），右 = 该端真截图）
      const h = 844
      const half = synthesize(webPng, path.join(dir, f), out, h)
      rows.push({ end: e, page: f, out: path.relative(ROOT, out), status: half ?? 'ok' })
    }
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + '\n')
  for (const r of rows) console.log(r.status === 'ok' ? `✓ ${r.out}` : `⚠ ${r.end}${r.page ? '/' + r.page : ''}：${r.status}`)
  console.log('⏭ 视觉判断：把这些 PNG 交给独立子代理（按 Web 基准评审），AI 不代替人看')
}

/** 等高缩放 + 横向拼接（ffmpeg hstack；左 = Web 基准（D1），右 = 该端真截图）
 *  ★实测：`sips` 只做缩放/转换、**不做拼接**（首版误用它 ⇒ 必然失败）。ffmpeg 为本机既装工具。
 *  缩放到同高（-1:targetH 保宽比）后 hstack；两图宽度不同也可。 */
function synthesize(leftPng, rightPng, outPng, targetH) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', leftPng, '-i', rightPng,
      '-filter_complex', `[0:v]scale=-1:${targetH}[a];[1:v]scale=-1:${targetH}[b];[a][b]hstack=inputs=2`,
      outPng,
    ],
    { encoding: 'utf8' },
  )
  if (r.status === 0 && fs.existsSync(outPng)) return null
  const tail = (r.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300)
  return `ffmpeg 拼接失败（${tail}）`
}

/* ══════════════════ status：证据齐备表 ══════════════════ */
function status() {
  const pages = pageList()
  const inner = ['web', 'mp', 'android', 'ios', 'harmony']
  console.log('CSS 验收证据表（css-conformance/results/）')
  console.log(`  ${'页面'.padEnd(10)} ${inner.map((e) => e.padEnd(9)).join('')}`)
  const missing = []
  for (const p of pages) {
    const cells = inner.map((e) => {
      const dir = path.join(RESULTS, e)
      const hit = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f === `${p.name}.png`)
      if (!hit && e !== 'web') missing.push(`${e}/${p.name}`)
      return (hit ? '✅' : '—').padEnd(9)
    })
    console.log(`  ${p.name.padEnd(10)} ${cells.join('')}`)
  }
  if (missing.length) console.log(`  ⚠ 缺证据 ${missing.length} 项：${missing.join(' / ')}（不静默——如实列出）`)
  else console.log('  ✅ 五端证据齐备')
}

/* ══════════════════ CLI ══════════════════ */
const [cmd, arg] = process.argv.slice(2)
if (cmd === 'collect-web') await collectWeb()
else if (cmd === 'shot-mp') shotMp()
else if (cmd === 'shot-app') shotApp(arg)
else if (cmd === 'side-by-side') sideBySide(arg)
else if (cmd === 'status') status()
else {
  console.log('用法：node scripts/css-conformance.mjs <collect-web|shot-mp|shot-app <end>|side-by-side [end]|status>')
  process.exit(2)
}
