// docs/proteus-studio-poc/05-studio-shell/verify-panel.mjs
// ★ 面板渲染验证（决策 #1181）
//
// 【为什么需要它】macOS 的屏幕录制权限（TCC）不给本进程，`screencapture` 直接失败，
//   Tauri 的 WKWebView 内容也因此**截不到**。于是右栏面板一直只有"代码看着对"这一层证据。
//   但面板本身是**纯 HTML**——把它用 Playwright 渲染一遍就能拿到真截图。
//
// 【它验证什么 / 不验证什么（别混）】
//   ✅ 验证：布局、字号、数值格式化（负值显示 "—"）、字段映射、深色可读性
//   ❌ 不验证：Tauri IPC 真实往返（这里用的是桩）、WKWebView 的渲染差异、原生画布叠加
//   ⇒ 桩数据**不是编的**：来自 `results/panel-source.json`（同一次真实跑机采的读数），
//     机型仍走真实 adb 查询（和应用里同一命令）。唯一被替换的是"值怎么送到页面"这一步。
//
// 用法：node verify-panel.mjs [--data results/panel-source.json] [--out results/inspector-panel.png]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const dataPath = path.resolve(HERE, arg('--data', 'results/panel-source.json'))
const outPath = path.resolve(HERE, arg('--out', 'results/inspector-panel.png'))

if (!fs.existsSync(dataPath)) {
  console.error(`✗ 没有读数文件：${dataPath}\n  先跑一次真实测量：POC_SECONDS=14 POC_JSON=results/panel-source.json …`)
  process.exit(1)
}
const r = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

/** 真实机型（与应用内同一条 adb 命令；查不到就 null —— 面板会显示"未知"，不编） */
function probeDevice() {
  const get = (args) => {
    try {
      const s = execFileSync('adb', args, { encoding: 'utf8', timeout: 8000 }).trim()
      return s || null
    } catch { return null }
  }
  const model = get(['shell', 'getprop', 'ro.product.model'])
  if (!model) return null
  const wm = get(['shell', 'wm', 'size'])
  const size = wm?.split('Physical size:')[1]?.trim()
  return size ? `${model} · ${size}` : model
}

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
  device: probeDevice(),
}

// ★必须走 http：Vite 产物是 ES module，`file://` 下会被 CORS 挡掉（origin=null）。
//   这也更接近真实运行（Tauri 用 tauri:// 自定义协议，同样是"有 origin"的环境）。
const DIST = path.join(HERE, 'web-dist')
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ 没有构建产物：${DIST}\n  先构建：./node_modules/.bin/vite build --config docs/proteus-studio-poc/05-studio-shell/vite.config.mjs`)
  process.exit(1)
}
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
await page.addInitScript((payload) => {
  const calls = []
  window.__STUB_CALLS__ = calls
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === 'stats') return payload
        if (cmd === 'set_canvas_rect') return null
        throw new Error('未实现：' + cmd)
      },
    },
  }
}, stats)

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForTimeout(1200) // 轮询 500ms，等两拍
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
await browser.close()
server.close()

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
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) bad++
}
if (errors.length) console.log('  JS 错误：\n' + errors.map((e) => '   ' + e).join('\n'))
console.log(`\n面板快照：${path.relative(HERE, outPath)}`)
console.log(`数据来源：${path.relative(HERE, dataPath)}（真实跑机读数）+ adb 机型探测`)
process.exit(bad ? 1 : 0)
