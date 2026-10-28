#!/usr/bin/env node
// scripts/check-studio-capture.mjs —— 设备源「到底抓不抓得到帧」门禁（决策 #1340）
//
// 【为什么需要这一条】iOS 模拟器源（#1302）与 iPhone 镜像源（#1316）上线后，
//   它们的画面通路**一条判据都没有**：
//     · `check:studio-panel` 跑的是浏览器桩，压根不碰 ScreenCaptureKit；
//     · `check:studio-live` 只看 Android 的 H264 解码健康度。
//   于是"抓不到帧"这类故障只能靠用户发现——今天已经发生过两次同类型事故
//   （设备选中态、切换中反馈都是"没有判据 → 活到用户面前"）。
//
// 【判据只有三条，但都是硬事实】
//   ① `window-cast --list` 能在 3 秒内返回（它曾经在 Studio 里挂死 8 秒 ⇒ 列表时有时无）；
//   ② 对**镜像窗口 / 模拟器窗口**各抓一小段，必须真的出现 `KCFRAME`（不是空跑）；
//   ③ 帧数据量 > 2KB（排除"有帧头但内容是黑的"）。
//
// 【没有目标就跳过】镜子没连、模拟器没启动都属正常；跳过时打明原因并 rc=0，
//   不制造假红（与 `check:studio-live` 同一策略）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

/** helper 路径：默认取 kcode 的构建产物；可用 `STUDIO_CAST` 覆盖 */
const CAST =
  process.env.STUDIO_CAST ||
  '/Volumes/data1/work/office/kags/kcode/crates/kcode-desktop/binaries/kcode-window-cast'

const checks = []
const note = (label, ok) => checks.push([label, ok])

if (!fs.existsSync(CAST)) {
  console.log(`  ⤵ 跳过：找不到 window-cast helper（${CAST}）`)
  process.exit(0)
}

/** ① 列窗口必须又快又成功 */
const t0 = Date.now()
const list = spawnSync(CAST, ['--list'], { encoding: 'utf8', timeout: 3000 })
const listMs = Date.now() - t0
note(
  `① window-cast --list 在 3s 内返回（实测 ${listMs}ms · ${list.stdout?.trim().split('\n').length ?? 0} 个窗口）`,
  list.status === 0 && listMs < 3000,
)

const lines = (list.stdout || '').split('\n').filter(Boolean)
const parse = (line) => {
  const [id, title, size] = line.split('\t')
  return { id: Number(id), title, size }
}
const windows = lines.map(parse).filter((w) => w.id)

const mirror = windows.find((w) => /镜像|iphone mirroring/i.test(w.title || ''))
const sim = windows.find((w) => /Simulator/i.test(w.title || ''))

/** ②③ 抓一小段，必须有真实帧且不是空数据 */
function capture(win) {
  const out = spawnSync(
    CAST,
    ['--window', String(win.id), '--fps', '2', '--width', '300', '--duration', '900', '--device-aspect', '0'],
    { timeout: 8000, maxBuffer: 64 << 20 },
  )
  const buf = out.stdout || Buffer.alloc(0)
  const frames = (buf.toString('latin1').match(/KCFRAME /g) || []).length
  const err = (out.stderr || '').toString()
  /* ★**不要拿日志文本当判据**：不同版本 helper 打的日志不同（这版没有"流已启动"），
     结果我在第一版里把它写成硬条件 ⇒ 明明抓到 16 帧却被判红（假红）。
     判据只认**事实**：有没有帧、数据够不够。尺寸从 `KCDEVICE_CROP` 行取。 */
  const crop = err.match(/KCDEVICE_CROP\s+\S+\s+\S+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/)
  const size = crop ? `${Math.round(Number(crop[1]))}x${Math.round(Number(crop[2]))}` : '?'
  return { frames, bytes: buf.length, size, err }
}

/* ★**Studio 正在跑就跳过**（决策 #1340 的实测发现）：
   同一个窗口不能被两个 SCK 客户端同时抓 —— Studio 已经在抓镜像窗口时，
   这里再起一个 helper 会"连上但拿不到帧"（实测：帧数 0、数据 0，而 Studio 画面正常）。
   那是**环境冲突**，不是缺陷 ⇒ 跳过并说明，避免假红。 */
const studio = spawnSync('pgrep', ['-f', 'proteus-studio-shell'], { encoding: 'utf8' })
if ((studio.stdout || '').trim()) {
  console.log('  ⤵ 跳过：Studio 正在运行（它可能已占用同一窗口；同一窗口不能被两个 SCK 客户端同时抓）')
  process.exit(0)
}

const targets = [
  ['iPhone 镜像', mirror],
  ['iOS 模拟器', sim],
].filter(([, w]) => !!w)

if (!targets.length) {
  console.log('  ⤵ 跳过：既没有「iPhone 镜像」窗口，也没有「Simulator」窗口（未连接/未启动属正常）')
} else {
  for (const [name, win] of targets) {
    const r = capture(win)
    note(
      `${name}（窗口 ${win.id} · ${win.size || '?'}）能抓到真实帧：帧数=${r.frames} · 数据=${(r.bytes / 1024).toFixed(1)}KB · 帧尺寸=${r.size}`,
      r.frames >= 2 && r.bytes > 2048,
    )
    if (!(r.frames >= 2 && r.bytes > 2048)) {
      /* 失败时把 helper 自己的说法带出来（否则只剩"没帧"三个字，等于没信息） */
      for (const l of r.err.split('\n').filter(Boolean).slice(-4)) console.log(`      ${l.slice(0, 150)}`)
    }
  }
}

let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) bad++
}
process.exit(bad ? 1 : 0)
