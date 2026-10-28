#!/usr/bin/env node
// scripts/calibrate-sim-crop.mjs —— 标定「模拟器窗口 → 设备屏幕」的裁剪矩形（决策 #1303）
//
// 【为什么需要它】kcode 的 `kcode-window-cast` 用**黑带检测**定位设备区，
//   那是给"带黑色外框"的老模拟器窗口写的。iOS 26 的模拟器窗口**没有黑带**
//   （壁纸贴边、圆角、还有 82px 高的标题栏）⇒ 检测失准，实测把 426 宽的设备区
//   裁成 358 ⇒ 画面右侧被切掉一条。
//
// 【它怎么算】用**设备精确截图**（`simctl io screenshot`，就是设备像素的"标准答案"）
//   去和一张**未裁剪的窗口帧**做模板匹配：枚举"设备高度/水平偏移"，取平均色差最小的那个。
//   匹配是稀疏采样（400 个点）+ 逐像素搜索，本机 ~5 秒，只在窗口尺寸变化时跑一次。
//
// 【产物】`packages/studio/native/sim/crop.json`：按 `窗口宽x高` 记一条矩形的记录，
//   Studio 连接模拟器时读它；**读不到就退回"不裁剪"**（宁可带标题栏，也不裁错——
//   这与 kcode 自己写下的纪律一致：裁错会让点击整体偏移）。
//
// 用法：node scripts/calibrate-sim-crop.mjs [--udid <UDID>] [--cast <path>] [--window <id>]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'packages/studio/native/sim/crop.json')
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) ?? 'ffmpeg'
const DEV_DIR = process.env.DEVELOPER_DIR ?? '/Volumes/data1/work/office-applications/Xcode.app/Contents/Developer'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : dflt
}
const CAST = arg('--cast', '/Volumes/data1/work/office/kags/kcode/crates/kcode-desktop/binaries/kcode-window-cast')
const UDID = arg('--udid', null)

/** 读 PPM（P6）——ffmpeg 直接吐这个，省掉图像库依赖 */
function readPPM(file) {
  const buf = fs.readFileSync(file)
  // header: P6\n<w> <h>\n<max>\n
  let pos = 0
  const token = () => {
    while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++
    let s = ''
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++])
    return s
  }
  if (token() !== 'P6') throw new Error('不是 P6 PPM')
  const w = Number(token())
  const h = Number(token())
  token() // maxval
  pos++ // 单个空白
  return { w, h, data: buf.subarray(pos) }
}

/** 调 cast 抓一帧（未裁剪）→ JPEG 字节 */
function grabFrame(windowId) {
  const out = execFileSync(
    CAST,
    ['--window', String(windowId), '--fps', '2', '--width', '448', '--duration', '900', '--device-aspect', '0'],
    { maxBuffer: 64 << 20 },
  )
  const i = out.indexOf('KCFRAME ')
  if (i < 0) throw new Error('cast 没有产出帧（窗口 id 变了？）')
  const j = out.indexOf(0x0a, i)
  const n = Number(out.subarray(i + 8, j).toString())
  return out.subarray(j + 1, j + 1 + n)
}

function listWindows() {
  const out = execFileSync(CAST, ['--list']).toString()
  const rows = []
  for (const line of out.split('\n')) {
    const [id, title, size] = line.split('\t')
    if (id && title && size) rows.push({ id: Number(id), title, size })
  }
  return rows
}

function main() {
  const win = arg('--window', null)
  const windows = listWindows()
  const target = win ? windows.find((w) => w.id === Number(win)) : windows.find((w) => w.title === 'Simulator')
  if (!target) throw new Error('找不到 Simulator 窗口：先 `open -a Simulator`')
  const [winW, winH] = target.size.split('x').map(Number)
  console.log(`窗口 ${target.id}「${target.title}」${winW}x${winH}`)

  const udid = UDID ?? process.env.PROTEUS_SIM_UDID
  if (!udid) throw new Error('缺 --udid（模拟器 UDID）')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simcal-'))
  const jpg = path.join(tmp, 'frame.jpg')
  fs.writeFileSync(jpg, grabFrame(target.id))

  // 设备精确截图（"标准答案"）
  const png = path.join(tmp, 'dev.png')
  execFileSync('/usr/bin/xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', png], {
    env: { ...process.env, DEVELOPER_DIR: DEV_DIR },
  })

  const framePPM = path.join(tmp, 'frame.ppm')
  const devPPM = path.join(tmp, 'dev.ppm')
  for (const [src, dst] of [[jpg, framePPM], [png, devPPM]]) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', src, '-y', dst])
  }
  const F = readPPM(framePPM)
  const D = readPPM(devPPM)
  const aspect = D.w / D.h
  console.log(`帧 ${F.w}x${F.h} · 设备截图 ${D.w}x${D.h}（比例 ${aspect.toFixed(4)}）`)

  const fpx = (x, y) => {
    const i = (y * F.w + x) * 3
    return [F.data[i], F.data[i + 1], F.data[i + 2]]
  }
  const dpx = (x, y) => {
    const i = (y * D.w + x) * 3
    return [D.data[i], D.data[i + 1], D.data[i + 2]]
  }
  // 固定采样点（伪随机但可复现）
  const samples = []
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
  for (let i = 0; i < 400; i++) samples.push([rnd(), rnd()])

  let best = null
  for (let h = Math.floor(F.h * 0.6); h <= F.h; h++) {
    const w = Math.round(h * aspect)
    if (w > F.w) continue
    for (let x0 = 0; x0 + w <= F.w; x0++) {
      let err = 0
      for (const [uy, ux] of samples) {
        const gx = x0 + Math.floor(ux * (w - 1))
        let gy = F.h - h + Math.floor(uy * (h - 1))
        if (gy < 0) gy = 0
        const a = fpx(gx, gy)
        const b = dpx(Math.floor(ux * (D.w - 1)), Math.floor(uy * (D.h - 1)))
        err += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
      }
      err /= samples.length
      if (!best || err < best.err) best = { err, x: x0, y: F.h - h, w, h }
    }
  }
  console.log(`最佳矩形 x=${best.x} y=${best.y} ${best.w}x${best.h}（平均色差 ${best.err.toFixed(1)}）`)
  if (best.err > 90) {
    console.warn('⚠ 平均色差偏大：画面可能已经变了（截图与帧不同步）⇒ 这次结果不可信，不写入')
    process.exit(3)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
  db[`${winW}x${winH}`] = { x: best.x, y: best.y, w: best.w, h: best.h, frame: `${F.w}x${F.h}`, err: Math.round(best.err) }
  fs.writeFileSync(OUT, JSON.stringify(db, null, 2) + '\n')
  console.log(`已写入 ${path.relative(ROOT, OUT)}（键 ${winW}x${winH}）`)
}

main()
