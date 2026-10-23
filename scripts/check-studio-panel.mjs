#!/usr/bin/env node
// scripts/check-studio-panel.mjs —— ★Studio 右栏面板门禁（决策 #1181 起，2026-10-22 出门升级为门禁 · #1187）
//
// 【为什么需要它】macOS 的屏幕录制权限（TCC）不给本进程，`screencapture` 直接失败，
//   Tauri 的 WKWebView 内容也因此**截不到**。于是右栏面板一直只有"代码看着对"这一层证据。
//   但面板本身是**纯 HTML**——把它用 Playwright 渲染一遍就能拿到真截图。
//
// 【它验证什么 / 不验证什么（别混）】
//   ✅ 验证：布局、字号、数值格式化（负值显示 "—"）、字段映射、深色可读性、IPC 接线
//   ❌ 不验证：Tauri IPC 真实往返（这里用桩）、WKWebView 的渲染差异、原生画布叠加
//   ⇒ 桩数据**不是编的**：来自 `packages/studio/fixtures/panel-source.json`
//     （同一次真实跑机的读数，原始输出留在 `results/panel-source.json`），
//     机型优先走真实 adb 查询（与应用里同一命令），无 adb 时回落到 fixture 记录的采集机型。
//     唯一被替换的是"值怎么送到页面"这一步。
//
// 【为什么判据脚本在 scripts/ 而不是 packages/studio/】仓库惯例：所有 `check:*` 都在
//   scripts/（判据与被测物分离，见 check-glass-capability 等）。被测物在 packages/studio。
//
// 用法：node scripts/check-studio-panel.mjs [--no-build] [--data <json>] [--out <png>]
//   --no-build  复用现有 web-dist（本地迭代快；CI 不用）
// 退出码：0 全过 / 1 有判据红 / 2 前置缺失（无产物且构建失败）

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STUDIO = path.join(ROOT, 'packages', 'studio')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const dataPath = path.resolve(ROOT, arg('--data', 'packages/studio/fixtures/panel-source.json'))
const outPath = path.resolve(ROOT, arg('--out', 'packages/studio/results/inspector-panel.png'))
const SKIP_BUILD = process.argv.includes('--no-build')

if (!fs.existsSync(dataPath)) {
  console.error(`✗ 没有读数文件：${dataPath}`)
  process.exit(2)
}
const r = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

// ── ① 构建 UI（判据必须能独立跑：不依赖"上次谁手动 build 过"）─────────────
const DIST = path.join(STUDIO, 'web-dist')
if (!SKIP_BUILD) {
  try {
    execFileSync('bash', [path.join(STUDIO, 'build-ui.sh')], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    console.error('✗ UI 构建失败（packages/studio/build-ui.sh）')
    console.error(e.stdout || '', e.stderr || '', e.message)
    process.exit(2)
  }
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ 没有构建产物：${DIST}\n  先构建：bash packages/studio/build-ui.sh`)
  process.exit(2)
}

/** 真实机型（与应用内同一条 adb 命令）；无 adb（如 CI）⇒ 回落 fixture 记录的采集机型 */
function probeDevice() {
  const get = (args) => {
    try {
      const s = execFileSync('adb', args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return s || null
    } catch {
      return null
    }
  }
  const model = get(['shell', 'getprop', 'ro.product.model'])
  if (!model) return null
  const wm = get(['shell', 'wm', 'size'])
  const size = wm?.split('Physical size:')[1]?.trim()
  return size ? `${model} · ${size}` : model
}
const probed = probeDevice()
const deviceValue = probed ?? r.device ?? null
const deviceFrom = probed ? 'adb' : r.device ? 'fixture（采集时机型）' : '无'

const [w, h] = String(r.size ?? '1280x720').split('x').map(Number)
const stats = {
  frames: r.frames_presented ?? 0,
  late: r.late_frames ?? 0,
  cpu_pct: r.cpu?.single_core_pct ?? -1,
  fps: r.measured_fps ?? -1,
  iv_p50: r.interval_ms?.p50 ?? -1,
  iv_p95: r.interval_ms?.p95 ?? -1,
  lat_p50: r.latency_ms?.p50 ?? -1,
  lat_p95: r.latency_ms?.p95 ?? -1,
  qw_p50: r.queue_ms?.p50 ?? -1,
  dec_p50: r.decode_ms?.p50 ?? -1,
  cmp_p50: r.compose_ms?.p50 ?? -1,
  pres_p50: r.present_ms?.p50 ?? -1,
  aus: r.aus ?? 0,
  mbps: r.mbps ?? -1,
  empty: r.empty_ticks ?? 0,
  ticks: r.ticks ?? 0,
  width: w,
  height: h,
  hwdec: r.hwdec === 'videotoolbox',
  device: deviceValue,
}

// ★必须走 http：Vite 产物是 ES module，`file://` 下会被 CORS 挡掉（origin=null）。
//   这也更接近真实运行（Tauri 用 tauri:// 自定义协议，同样是"有 origin"的环境）。
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0])
  const file = path.join(DIST, rel === '/' ? 'index.html' : rel)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

// 桩：只替换"值怎么送到页面"，其余与真机一致（含 set_canvas_rect 的调用）
// ★`read_text` 也在这里桩掉：代码视图（G4 第一块砖）启动时会读文件，不桩就会抛"未实现"
//   ⇒ 被判据 ⑧（无 JS 错误）判红。桩内容故意含 `const`，供判据 ⑪ 断言"面板真的渲染了内容"。
await page.addInitScript((payload) => {
  const calls = []
  window.__STUB_CALLS__ = calls
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === 'stats') return payload
        if (cmd === 'set_canvas_rect') return null
        if (cmd === 'read_text') return 'const stubLine = 1\nconst second = 2\nexport { stubLine, second }\n'
        // ★文件列表也要桩：代码视图启动时先 list_files 再 default open
        if (cmd === 'list_files')
          return ['packages/studio/ui/src/App.vue', 'packages/studio/src/main.rs', 'packages/studio/native/embed_view.m']
        // ★G5 会话状态：用 localStorage 模拟磁盘——这样 reload 后还能验「恢复上次视图」
        if (cmd === 'load_state') return localStorage.getItem('__stub_state__') ?? '{}'
        if (cmd === 'save_state') {
          localStorage.setItem('__saved_state__', String(args?.json ?? ''))
          return null
        }
        throw new Error('未实现：' + cmd)
      },
    },
  }
}, stats)

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForTimeout(1200) // 轮询 500ms，等两拍
fs.mkdirSync(path.dirname(outPath), { recursive: true })
await page.screenshot({ path: outPath })

// ── 判据（不是"看着像"就算过）────────────────────────────────────
const seen = await page.evaluate(() => {
  const txt = (id) => document.getElementById(id)?.textContent?.trim() ?? ''
  return {
    dev: txt('kdev'),
    stream: txt('kstream'),
    dec: txt('kdec'),
    fps: txt('kfps'),
    lat: txt('klat'),
    lat95: txt('klat95'),
    qw: txt('kqw'),
    empty: txt('kempty'),
    cpu: txt('kcpu'),
    link: txt('linkChip'),
    calls: (window.__STUB_CALLS__ || []).map((c) => c.cmd),
    rawMd: document.body.innerText.includes('**'),
  }
})
// ── ⑪ 代码视图（G4 第一块砖）：点左栏第二个按钮（◈ 代码）────────────────
// 验两件事：
//   · **文件通路真的通了**：`read_text` 被调用、面板渲染出桩内容
//   · **原生画布被收成 0×0** —— 这条最容易漏：GL 视图是独立 NSView，只隐藏 HTML 里的
//     #canvas 是盖不住它的（切到代码视图后会看到画面浮在代码上）。★判据必须盯"传了 w=0"，
//     而不是盯"HTML 里没有 #canvas 了"。
await page.click('.rail button:nth-child(2)')
await page.waitForTimeout(400)
const codeView = await page.evaluate(() => {
  const src = document.querySelector('.src')?.textContent ?? ''
  const err = document.getElementById('codeErr')?.textContent ?? ''
  const all = window.__STUB_CALLS__ || []
  const rects = all.filter((c) => c.cmd === 'set_canvas_rect')
  const last = rects[rects.length - 1]
  return {
    src,
    err,
    fileCount: document.querySelectorAll('#codeFiles button').length,
    curPath: document.getElementById('codePath')?.textContent?.trim() ?? '',
    called: all.some((c) => c.cmd === 'read_text'),
    listed: all.some((c) => c.cmd === 'list_files'),
    zeroed: !!last && last.args?.w === 0 && last.args?.h === 0,
  }
})
// ⑪c：点第二个文件，路径与内容都要跟着换（验证 open 通路，不是只有默认那个能看）
await page.click('#codeFiles button:nth-child(2)')
await page.waitForTimeout(250)
const switchedPath = await page.evaluate(
  () => document.getElementById('codePath')?.textContent?.trim() ?? '',
)

// ── ⑫ G5 会话状态：切换后要落盘；reload 后要能**恢复上次的视图与文件** ──────────
const savedState = await page.evaluate(() => localStorage.getItem('__saved_state__') ?? '')
// 模拟"上次关在代码视图、在看 main.rs" ⇒ reload 应直接进代码视图
await page.evaluate(() =>
  localStorage.setItem(
    '__stub_state__',
    JSON.stringify({ view: 'code', codeFile: 'packages/studio/src/main.rs' }),
  ),
)
await page.reload()
await page.waitForTimeout(900)
const restored = await page.evaluate(() => ({
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
  files: document.querySelectorAll('#codeFiles button').length,
}))
// 留一张代码视图快照（人眼可核）
await page.screenshot({ path: outPath.replace(/\.png$/, '-code.png') })
await browser.close()
server.close()
// ⑩ fixture 与原始采集输出必须数值一致（防"改 fixture 让判据变绿"这类静默漂移）
const rawPath = path.join(STUDIO, 'results', 'panel-source.json')
let fixtureInSync = true
let fixtureWhy = ''
if (!fs.existsSync(rawPath)) {
  fixtureInSync = false
  fixtureWhy = `缺原始采集输出 ${path.relative(ROOT, rawPath)}`
} else {
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  const diffs = []
  if (r.frames_presented !== raw.frames_presented) diffs.push('frames_presented')
  if (r.measured_fps !== raw.measured_fps) diffs.push('measured_fps')
  if (r.latency_ms?.p50 !== raw.latency_ms?.p50) diffs.push('latency_ms.p50')
  if (r.cpu?.single_core_pct !== raw.cpu?.single_core_pct) diffs.push('cpu.single_core_pct')
  if (r.aus !== raw.aus) diffs.push('aus')
  if (diffs.length) {
    fixtureInSync = false
    fixtureWhy = `与 results/panel-source.json 不一致：${diffs.join(', ')}`
  }
}

const checks = [
  ['① 面板调到了 stats（IPC 接线通）', seen.calls.includes('stats')],
  ['② 画布矩形也被同步（HTML 驱动原生）', seen.calls.some((c) => c === 'set_canvas_rect')],
  ['③ 机型/画面/解码三行都有值（不是 "—"）', seen.dev !== '—' && seen.stream !== '—' && seen.dec !== '—'],
  ['④ 解码方式与读数一致（hwdec=videotoolbox ⇒ 显示硬解）', stats.hwdec ? seen.dec.includes('硬解') : seen.dec.includes('软件')],
  ['⑤ 延迟显示真实值（不是 "—"）', seen.lat.endsWith('ms') && seen.lat !== '—'],
  ['⑥ 管线四段都渲染了', [seen.lat, seen.qw, seen.cpu].every((v) => v && v !== '—')],
  ['⑦ 状态灯切到"画布运行中"（frames>0）', seen.link.includes('运行中')],
  ['⑧ 页面无 JS 错误', errors.length === 0],
  // 曾把 Markdown 粗体写进 HTML，页面上直接露出 "**"；这条挡住复发
  ['⑨ 正文无裸 "**"（Markdown 泄漏）', !seen.rawMd],
  // ⑪ 代码视图（G4）：读到文件 + 渲染出内容 + 原生画布收成 0×0
  [
    '⑪ 代码视图：read_text 被调用且渲染出内容',
    codeView.called && codeView.src.includes('stubLine') && !codeView.err,
  ],
  [
    `⑪b 切到代码视图时原生画布被收成 0×0（否则 GL 画面会浮在代码上）${codeView.zeroed ? '' : '（未收到 w=0/h=0）'}`,
    codeView.zeroed,
  ],
  [
    `⑪c 文件列表渲染 ${codeView.fileCount} 条并默认打开 App.vue`,
    codeView.listed && codeView.fileCount === 3 && codeView.curPath.endsWith('ui/src/App.vue'),
  ],
  [
    `⑪d 点第二个文件能切换（open 通路，不只是默认那个能看）${switchedPath.endsWith('main.rs') ? '' : `（当前 ${switchedPath}）`}`,
    switchedPath.endsWith('main.rs'),
  ],
  // ⑫ G5：切换要落盘（否则"记住上次"只是口头承诺）
  [
    `⑫ 切换视图/文件后写入会话状态${savedState.includes('"view":"code"') ? '' : `（实际 "${savedState}"）`}`,
    savedState.includes('"view":"code"') && savedState.includes('main.rs'),
  ],
  // ⑫b reload 后恢复上次视图与文件（这条才是"重启即恢复"的真正判据）
  [
    `⑫b reload 后恢复上次的视图与文件${restored.path.endsWith('main.rs') ? '' : `（当前 ${restored.path || '空'}）`}`,
    restored.files === 3 && restored.path.endsWith('main.rs'),
  ],
  [`⑩ fixture 与原始采集输出一致${fixtureWhy ? `（${fixtureWhy}）` : ''}`, fixtureInSync],
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) bad++
}
if (errors.length) console.log('  JS 错误：\n' + errors.map((e) => '   ' + e).join('\n'))
console.log(`\n面板快照：${path.relative(ROOT, outPath)}`)
console.log(`数据来源：${path.relative(ROOT, dataPath)}（真实跑机读数）· 机型来源：${deviceFrom}`)
process.exit(bad ? 1 : 0)
