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
import { spawnSync, execFileSync } from 'node:child_process'

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
  // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐 + 网格证据键（Web 基准读数——逐案例证据）
  'justify-self', 'grid-template-columns', 'grid-column',
  // ★★★背景定位家族（2026-10-07）：size/position/repeat 的 Web 基准读数（逐案例证据）
  'background-size', 'background-position', 'background-repeat',
  // ★★★outline 族项（2026-10-08）：轮廓宽/色/线型/偏移（Web 基准读数）
  'outline-width', 'outline-color', 'outline-style', 'outline-offset',
  // ★★★line-clamp 项（2026-10-08）：多行截断行数（Web 基准读数）
  '-webkit-line-clamp',
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
      // ★修正（2026-10-05 · 回退 fullPage）：**视口截图**——真机截图恒为视口大小，两者须同坐标系可比。
      //   （页面应装进视口：案例过多时拆页/压缩，而不是长截图。）
      await page.screenshot({ path: path.join(outDir, `${p.name}.png`), type: 'png' })
      // ★★孤儿清理（2026-10-05 · 子代理评审发现）：页面**删案例**后重采不删旧裁剪图
      //   ⇒ `<page>.case-<已删id>.png` 残留（易被误引为"本轮证据"）。
      //   纪律与"旧图门禁"同源：**证据集必须与页面案例清单一致**——重采前按前缀清掉。
      for (const f of fs.readdirSync(outDir)) {
        if (f.startsWith(`${p.name}.case-`) && f.endsWith('.png')) fs.unlinkSync(path.join(outDir, f))
      }
      const cases = casesOf(p)
      const reads = {}
      for (const id of cases) {
        const el = await page.$(`#${id}`)
        if (!el) {
          console.error(`✗ 案例元素缺失：#${id}（${p.name}）——页面与清单不一致`)
          process.exit(1)
        }
        // ★修正（同①）：scrollIntoView 后按**视口坐标**裁剪（页面应装进视口）
        await el.scrollIntoViewIfNeeded()
        const box = await el.boundingBox()
        if (box && box.width > 0 && box.height > 0) {
          await page.screenshot({
            path: path.join(outDir, `${p.name}.${id}.png`),
            type: 'png',
            clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(box.width + 8, VIEWPORT.width), height: Math.min(box.height + 8, VIEWPORT.height) },
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
    // ★（2026-10-08 修）`automation_runtime_info` 现要求 `--action`（缺省调用返 INPUT_ERROR ⇒
    //   grep 永不命中 ⇒ 每页白等 30s 超时）。改用 `--action currentPage` 并按**路由**判到达。
    const probe = `'${CLI}' -c zed automation_runtime_info --project '${mpProj}' --action currentPage | grep -q '"route": "${p.route}"'`
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
  // ★★旧图门禁（2026-10-05）：stale 截图会误导视觉评审（子代理成本昂贵）——默认拒绝生成并排图
  const { stale } = freshCheck()
  if (stale.length && process.env.PROTEUS_ALLOW_STALE !== '1') {
    console.error(`✗ 拒绝生成并排图：${stale.length} 张截图 stale（${stale.join(' / ')}）——先重截`)
    console.error('  查看明细：node scripts/css-conformance.mjs fresh（显式绕过：PROTEUS_ALLOW_STALE=1）')
    process.exit(2)
  }
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

/** 递归取目录/文件的最新 mtime（ms） */
function maxMtimeOf(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  let max = st.mtimeMs
  for (const f of fs.readdirSync(p)) max = Math.max(max, maxMtimeOf(path.join(p, f)))
  return max
}

/* ══════════════ fresh：截图新鲜度门禁（★防「旧图当证据」——用户 2026-10-05 点名） ══════════════
 * 【为什么有这一条】
 *   子代理视觉验收成本 ≥10 分钟/轮（昂贵）——把**旧版截图**交给它 = 白烧一整轮。
 *   实测踩过两次：① 鸿蒙图不是 css-conformance 应用的（产物未重建）；② Android/iOS 图含已删除的
 *   F 段（只重截了鸿蒙）。⇒ 交图前**机器先判新旧**，不靠人记得：
 *   判据 = 截图 mtime ≥ max(页面 SFC, styles/global.css, RouterView.vue, 该端宿主源, 该端构建产物)。
 *   ★注意：mtime 判据是**保守**的（源改了就要求重截，哪怕视觉无变化）——这是刻意的：
 *   漏报的代价（旧图烧子代理一轮）远高于误报的代价（重截一次 ~2 分钟）。
 */
const END_SRC = {
  web: [],
  mp: [],
  android: ['hosts/android/app/src/main/java/dev/proteus/layoutcore'],
  ios: ['hosts/ios/ProteusHost'],
  // ★只扫宿主源码（cpp/ets）；不含 resources/rawfile——那是**项目产物**（把 app-screen-content/
  //   bundle 拷进 HAP），其新鲜度已由 HAP 产物 mtime 覆盖；仓库侧恢复 superapp 产物不应误报。
  harmony: ['hosts/harmony/host-app/entry/src/main/cpp', 'hosts/harmony/host-app/entry/src/main/ets'],
  // ★不放 hosts/shared/bridge：构建期 build-id 注入（inject-build-id）会改其 mtime ⇒ 每次构建
  //   都把所有图误判 stale。其真实影响已由「该端构建产物」覆盖（产物 mtime 恒为最后一次构建）。
}
const END_ARTIFACT = {
  web: 'css-conformance/dist/web/index.html',
  mp: 'css-conformance/dist/mp-weixin/app.js',
  android: 'hosts/android/build/proteus-layoutcore.apk',
  ios: 'hosts/ios/build-selfdraw/ProteusSelfDraw.app/bundle-superapp.js',
  harmony: 'hosts/harmony/host-app/entry/build/default/outputs/default/entry-default-signed.hap',
}

function freshCheck() {
  const stale = []
  const rows = []
  for (const p of pageList()) {
    for (const e of ['web', 'mp', 'android', 'ios', 'harmony']) {
      const shot = path.join(RESULTS, e, `${p.name}.png`)
      if (!fs.existsSync(shot)) continue // 缺证据由 status 管
      const srcs = [
        path.join(PROJ, 'pages', `${p.name}.vue`),
        path.join(PROJ, 'styles/global.css'),
        path.join(PROJ, 'router/RouterView.vue'),
        ...END_SRC[e].map((r) => path.join(ROOT, r)),
        path.join(ROOT, END_ARTIFACT[e]),
      ].filter((x) => fs.existsSync(x))
      let newest = 0
      let newestPath = ''
      for (const s of srcs) {
        const m = maxMtimeOf(s)
        if (m > newest) { newest = m; newestPath = path.relative(ROOT, s) }
      }
      const shotM = fs.statSync(shot).mtimeMs
      const ok = shotM >= newest
      if (!ok) stale.push(`${e}/${p.name}`)
      rows.push({ end: e, page: p.name, ok, shotMtime: new Date(shotM).toISOString(), newest: new Date(newest).toISOString(), newestPath })
    }
  }
  return { rows, stale }
}

function fresh() {
  const { rows, stale } = freshCheck()
  if (rows.length === 0) { console.log('（无截图可比——先采集各端）'); process.exit(1) }
  console.log('CSS 截图新鲜度（判据：截图 mtime ≥ 页面源 / 宿主源 / 构建产物）')
  for (const r of rows) {
    const mark = r.ok ? '✅' : '❌ 旧图'
    console.log(`  ${mark} ${r.end}/${r.page}  截图 ${r.shotMtime.slice(0, 19)} ≥? 最新源 ${r.newest.slice(0, 19)}（${r.newestPath}）`)
  }
  if (stale.length) {
    console.error(`\n✗ ${stale.length} 张截图 stale（源/产物已更新但图未重拍）：${stale.join(' / ')}`)
    console.error('  ⇒ 先重跑对应端再交子代理——旧图交子代理 = 白烧一轮（≥10 分钟）')
    process.exit(1)
  }
  console.log('✅ 全部截图均新于对应源与产物（可交视觉评审）')
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

/* ══════════════════ probe：程序化像素探针（页面级缺陷的机器判据） ══════════════════ */
//
// 【为什么有它（2026-10-05 · white-space 五轮复评复盘）】上一项跑了 **5 轮**独立视觉评审；
//   第 3–5 轮抓到的全是**页面级几何/底色**缺陷（黑块/白带/白框/右缘 1px 缝/系统栏遮挡/卡片贴边）——
//   这些**不需要人看**：本探针把它们变成 4 条机器判据（秒级）。子代理只保留**文本语义级**评审
//   （折行点/省略号/裁切/缩进/字面转义）。预期：复评轮次 5 → 2（详见 PLAYBOOK.md）。
//
// 判据（每端 vs Web 基准，逐页面）：
//   ① darkEdges   页面区四边条带深色占比（黑块 / 深色线 / 系统栏遮挡）
//   ② edgeColor   边缘主色 ≈ Web 边缘主色（白带/白框：ΔRGB 和 > 24 即红）
//   ③ seam        页面区最右 2 列深色占比（右缘 1px 缝——全高特征 ≈50%）
//   ④ cardMargins 卡片行左右边距存在且对称（贴边 / 宽窄失衡）
// 依赖：macOS `sips`（读尺寸）+ `ffmpeg`（取像素）；均为本机既有工具。
// 用法：node scripts/css-conformance.mjs probe [end] [--json]（不带 end = 四端全跑；退出码 0=全过 / 1=有红 / 2=缺基准）

/** 各端**已知 chrome 区**（系统/模拟器装饰——探针跳过并在输出中注明；不计页面缺陷） */
const CHROME = {
  web: {},
  mp: { top: 60, bottom: 110 }, // 模拟器：顶部黑刘海区 + 底部手势条/圆角遮罩
  android: { top: 56, bottom: 64 }, // ★顶部系统状态栏（默认显示，实测 inset≈48vp）+ 底部系统导航栏（决策 #594）
  ios: {},
  // ★★★补（2026-10-05 · probe 抓出鸿蒙 ΔB28）：**底部导航区**——状态栏已隐藏（Superapp.ets），
  //   但系统导航条（白色 + 手势横条）仍在截图底部（实测 1320×2856 图的下 ~120px）。
  //   与 Android `bottom:64` 同源（系统 chrome，不计页面缺陷）。
  harmony: { top: 60, bottom: 120 }, // ★顶部状态栏（默认显示，实测 inset≈48vp）+ 底部导航区（决策 #594）
}

function pngSizeOf(p) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf-8' })
  const mw = /pixelWidth:\s*(\d+)/.exec(out)
  const mh = /pixelHeight:\s*(\d+)/.exec(out)
  return { w: mw ? Number(mw[1]) : 0, h: mh ? Number(mh[1]) : 0 }
}

/** 取一块区域的原生像素（RGB24 字节流；尺寸非法 ⇒ 空） */
function readRgb(png, x, y, w, h) {
  if (w <= 0 || h <= 0 || x < 0 || y < 0) return Buffer.alloc(0)
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', png, '-vf', 'crop=' + w + ':' + h + ':' + x + ':' + y, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 },
  )
}

/** 条带统计：深色占比（亮度 <120）+ 量化主色（众数桶中心，抗噪） */
function stripStats(buf) {
  const n = Math.floor(buf.length / 3)
  let dark = 0
  const buckets = new Map()
  for (let i = 0; i < n * 3; i += 3) {
    const r = buf[i]
    const g = buf[i + 1]
    const b = buf[i + 2]
    if (0.299 * r + 0.587 * g + 0.114 * b < 120) dark++
    // ★★破坏性验证修正（2026-10-05）：量化从 >>3（桶中心 ±4）改 >>1（±1）——
    //   首版把「白带 255」与「页底 244」都量化成相邻桶（252 / 244）⇒ Δ=24 **恰好**撞上
    //   阈值 24 ⇒ 注入白带仍判绿（破坏性验证当场抓出的**探针自身假绿**）。
    //   >>1 后：白→254 / 灰→244（Δ30 > 24 ⇒ 红），且仍抗 JPEG 噪声（±1 抖动落同桶）。
    const k = (r >> 1) + ',' + (g >> 1) + ',' + (b >> 1)
    buckets.set(k, (buckets.get(k) || 0) + 1)
  }
  let mode = [0, 0, 0]
  let max = -1
  for (const kv of buckets) { if (kv[1] > max) { max = kv[1]; mode = kv[0].split(',').map(Number) } }
  return { count: n, darkRatio: n ? dark / n : 0, mode: [mode[0] * 2 + 1, mode[1] * 2 + 1, mode[2] * 2 + 1] }
}

/** 单端单页采集：四条带 + 右缘缝 + 卡片行 */
function analyzeEnd(png, end) {
  const { w, h } = pngSizeOf(png)
  const ch = CHROME[end] || {}
  const topY = (ch.top || 0) + 2
  const botY = h - (ch.bottom || 0) - 6
  const S = 4
  const strips = {
    left: stripStats(readRgb(png, 0, topY, S, botY - topY)),
    right: stripStats(readRgb(png, w - S, topY, S, botY - topY)),
    // ★修正（2026-10-05 · 破坏性验证抓出探针削弱）：采样带**加高到 40px**——首版 4px 只在 chrome 下缘
    //   蹭一条，注入的「顶部黑条」（50px 高、y=70 起）落在带外 ⇒ 漏报。40px 覆盖该类缺陷典型高度。
    //   配合分层阈值（top 0.15）：标题笔画（~3%）不误报、色条（≥50%）照抓。
    top: stripStats(readRgb(png, 20, topY, w - 40, 40)),
    bottom: stripStats(readRgb(png, 20, botY, w - 40, 4)),
  }
  const seam = stripStats(readRgb(png, w - 2, topY, 2, botY - topY))
  // 卡片行探测：页面区自上而下找「中间为白」的行（= 卡片带），量左右边距
  let card = null
  for (let f = 0.15; f <= 0.7501; f += 0.05) {
    const y = Math.round(topY + (botY - topY) * f)
    if (y >= h - 2) break
    // ★实测：ffmpeg `crop=w:1` 在部分尺寸下 "Error reinitializing filters" ⇒ 取 2 行（取首行像素）
    const row = readRgb(png, 0, y, w, 2)
    const mi = (w >> 1) * 3
    if (row[mi] < 250 || row[mi + 1] < 250 || row[mi + 2] < 250) continue
    let lm = 0
    let rm = 0
    for (let x = 0; x < w; x++) { const i = x * 3; if (row[i] >= 250 && row[i + 1] >= 250 && row[i + 2] >= 250) { lm = x; break } }
    for (let x = w - 1; x >= 0; x--) { const i = x * 3; if (row[i] >= 250 && row[i + 1] >= 250 && row[i + 2] >= 250) { rm = w - 1 - x; break } }
    card = { y, leftMargin: lm, rightMargin: rm, yFraction: f }
    break
  }
  return { end, file: path.relative(ROOT, png), size: { w, h }, chrome: ch, strips, seam, card }
}

function probe(end) {
  const ends = end ? [end] : ['android', 'ios', 'harmony', 'mp']
  const webDir = path.join(RESULTS, 'web')
  const out = { baseline: 'web', generatedAt: new Date().toISOString(), pages: {} }
  const lines = []
  let allPass = true
  let missing = 0
  lines.push('CSS 像素探针（机器判据 · 秒级）——页面级缺陷先机器判；子代理只补文本语义（折行/省略号/裁切/缩进）')
  for (const p of pageList()) {
    const webPng = path.join(webDir, p.name + '.png')
    if (!fs.existsSync(webPng)) { console.error('✗ 缺 Web 基准 ' + path.relative(ROOT, webPng) + '——先跑 collect-web'); process.exit(2) }
    const web = analyzeEnd(webPng, 'web')
    lines.push('  ◆ 页面 ' + p.name + '（基准 Web ' + web.size.w + 'x' + web.size.h + '：边缘主色 ' + web.strips.left.mode.join(',') + ' · 卡片 L' + (web.card ? web.card.leftMargin : '-') + '/R' + (web.card ? web.card.rightMargin : '-') + '）')
    const rows = []
    const dc = (m1, m2) => Math.abs(m1[0] - m2[0]) + Math.abs(m1[1] - m2[1]) + Math.abs(m1[2] - m2[2])
    for (const e of ends) {
      const png = path.join(RESULTS, e, p.name + '.png')
      if (!fs.existsSync(png)) { rows.push({ end: e, pass: false, note: '缺截图（先跑该端）' }); allPass = false; missing++; continue }
      const a = analyzeEnd(png, e)
      const darkMax = Math.max(a.strips.left.darkRatio, a.strips.right.darkRatio, a.strips.top.darkRatio)
      // ★修正（2026-10-05 · border 项 MP 误报 3.1%）：**top 带阈值分层**——
      //   top 采样带（页面区上缘）必然切过**页面标题文字**（黑字占比 ~3%，各端皆有）；
      //   而「顶部深色条」类真缺陷（系统栏遮挡/黑块）是**宽幅均匀深色**（≥50%）。
      //   ⇒ top 用 0.15 阈值（文字不误报、色条照抓）；left/right 是页边距带（无文字）保持 0.03。
      const darkLR = Math.max(a.strips.left.darkRatio, a.strips.right.darkRatio)
      const dL = dc(a.strips.left.mode, web.strips.left.mode)
      const dR = dc(a.strips.right.mode, web.strips.right.mode)
      const dB = dc(a.strips.bottom.mode, web.strips.bottom.mode)
      const checks = {
        darkEdges: {
          pass: darkLR < 0.03 && a.strips.top.darkRatio < 0.15 && a.strips.bottom.darkRatio < 0.05,
          detail: 'L/R ' + (darkLR * 100).toFixed(1) + '% T ' + (a.strips.top.darkRatio * 100).toFixed(1) + '% B ' + (a.strips.bottom.darkRatio * 100).toFixed(1) + '%',
        },
        edgeColor: { pass: dL <= 24 && dR <= 24 && dB <= 24, detail: 'ΔL' + dL + ' ΔR' + dR + ' ΔB' + dB },
        seam: { pass: a.seam.darkRatio < 0.25, detail: '右缘深色 ' + (a.seam.darkRatio * 100).toFixed(1) + '%' },
        cardMargins: a.card
          ? { pass: a.card.leftMargin >= 2 && a.card.rightMargin >= 2 && Math.abs(a.card.leftMargin - a.card.rightMargin) <= Math.max(6, a.size.w * 0.02), detail: 'L' + a.card.leftMargin + '/R' + a.card.rightMargin + 'px' }
          : { pass: true, detail: '无卡片行（跳过）' },
      }
      const pass = Object.keys(checks).every((k) => checks[k].pass)
      if (!pass) allPass = false
      rows.push({ end: e, pass, size: a.size, chrome: a.chrome, checks })
    }
    out.pages[p.name] = rows
    for (const r of rows) {
      if (r.note) { lines.push('    ' + r.end.padEnd(8) + ' ⚠ ' + r.note); continue }
      const c = r.checks
      const fmt = (ck) => (ck.pass ? '✅' : '❌') + ck.detail
      lines.push('    ' + r.end.padEnd(8) + ' ' + fmt(c.darkEdges).padEnd(22) + ' ' + fmt(c.edgeColor).padEnd(22) + ' ' + fmt(c.seam).padEnd(24) + ' ' + fmt(c.cardMargins).padEnd(18) + (r.pass ? ' ⇒ PASS' : ' ⇒ FAIL'))
    }
  }
  lines.push('  ★ chrome 跳过区（系统/模拟器装饰，不计页面缺陷）：' + ends.map((e) => e + '=' + (Object.keys(CHROME[e] || {}).length ? JSON.stringify(CHROME[e]) : '无')).join(' · '))
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    for (const l of lines) console.log(l)
    console.log(
      allPass
        ? '✅ 页面级判据全过（darkEdges/edgeColor/seam/cardMargins）——文本语义级交子代理一次终评'
        : '❌ 有页面级判据未过' + (missing ? '（' + missing + ' 端缺证据）' : '') + '——先修，**不要**交子代理（省一轮往返）',
    )
  }
  process.exit(allPass ? 0 : 1)
}
/** ★★耗时台账（2026-10-05 · 复盘效率方案）：每次运行追加一行到 `results/timings.jsonl`——
 *   【为什么】white-space 五轮复评共 ~100 分钟，但当时**没有分段耗时数据**（只能事后估）。
 *   有了台账，下一项可直接回答「哪一步最贵、该优化谁」，也让 PLAYBOOK 的耗时表可被实测校准。 */
function recordTiming(cmd, ms, extra) {
  try {
    ensureDir(RESULTS)
    const row = JSON.stringify({ cmd, ms: Math.round(ms), at: new Date().toISOString(), ...(extra || {}) })
    fs.appendFileSync(path.join(RESULTS, 'timings.jsonl'), row + '\n')
  } catch { /* 台账失败不阻断主流程 */ }
}

const T0 = Date.now()

/* ══════════════════ CLI ══════════════════ */
const [cmd] = process.argv.slice(2)
// ★耗时台账：**所有退出路径**都记档（含自然结束与失败——失败同样要归因）
//   `process.exit` 包装漏「自然结束」（status/side-by-side/shot-* 不显式 exit）⇒ 用 `exit` 事件。
let __recorded = false
process.on('exit', (code) => {
  if (__recorded) return
  __recorded = true
  recordTiming(cmd || '(none)', Date.now() - T0, { rc: code })
})
// 子命令的首个非选项参数（跳过 cmd 自身；`--json` 等选项不计）
const arg = process.argv.slice(3).find((a) => !a.startsWith('--'))
if (cmd === 'collect-web') await collectWeb()
else if (cmd === 'shot-mp') shotMp()
else if (cmd === 'shot-app') shotApp(arg)
else if (cmd === 'side-by-side') sideBySide(arg)
else if (cmd === 'status') status()
else if (cmd === 'fresh') fresh()
else if (cmd === 'probe') probe(arg)
else {
  console.log('用法：node scripts/css-conformance.mjs <collect-web|shot-mp|shot-app <end>|side-by-side [end]|status|probe [end]>')
  process.exit(2)
}
