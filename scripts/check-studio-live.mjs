#!/usr/bin/env node
// scripts/check-studio-live.mjs —— 投屏**解码健康**门禁（决策 #1259）
//
// 【为什么需要】今天连续三个 bug（#1256 坏 extradata / #1257 HTML 糊住画布 / #1259 关键帧被切碎）
//   的共同形态是：**面板读数一切正常（出帧、帧率、延迟都有），只有人眼看画面才知道坏了**。
//   `check:studio-panel` 跑的是 Playwright 桩，压根不解码真流 ⇒ 这一整类缺陷它天生抓不到。
//   ⇒ 这条门禁的判据只有一句：**真机跑几秒，零解码错误、出帧数是正数**。
//
// 【没有设备就跳过】CI 上没有 adb 设备属正常，跳过时打明原因并 rc=0（不制造假红）；
//   但**本机有人用**时它会真的挡住"画面糊了还合并"。
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(import.meta.dirname, '..')
const STUDIO = path.join(ROOT, 'packages/studio')
const BIN =
  process.env.STUDIO_LIVE_BIN ||
  path.join(STUDIO, 'build-app', 'Proteus Studio.app', 'Contents', 'MacOS', 'proteus-studio-shell')
const SECONDS = Number(process.env.STUDIO_LIVE_SECONDS || 6)

function hasDevice() {
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' })
    return out.split('\n').slice(1).some((l) => /\tdevice$/.test(l.trim()))
  } catch {
    return false
  }
}

if (process.platform !== 'darwin') {
  console.log('— 跳过：投屏解码只在 macOS 宿主上有实现')
  process.exit(0)
}
if (!fs.existsSync(BIN)) {
  console.log(`— 跳过：没有打包产物 ${path.relative(ROOT, BIN)}（先 bash packages/studio/package-app.sh）`)
  process.exit(0)
}
if (!hasDevice()) {
  console.log('— 跳过：没有 adb 设备（CI 正常；本机请插上手机再跑这条）')
  process.exit(0)
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-'))
const json = path.join(outDir, 'report.json')
const logPath = path.join(outDir, 'stderr.log')

// ★清掉上一次残留的采集会话：Android 只允许一个 screenrecord，
//   残留会让这次"零帧"——那不是被测物的问题，会把门禁变成噪声。
try {
  execFileSync('adb', ['shell', 'pkill -x screenrecord'], { stdio: 'ignore' })
} catch {
  /* 没有残留时 pkill 返回 1，正常 */
}

/** 跑一次无头采集，返回 { rep, text } */
async function runOnce({ seconds, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-run-'))
  const j = path.join(dir, 'report.json')
  const lg = path.join(dir, 'stderr.log')
  try {
    execFileSync('adb', ['shell', 'pkill -x screenrecord'], { stdio: 'ignore' })
  } catch {
    /* 没有残留时 pkill 返回 1 */
  }
  /* ★设备侧释放采集权**不是瞬时**的（实测：pkill 后立刻新开会话，偶尔 0 帧但 0 错误）。
     等 350ms 再起，否则门禁会偶发假红，把环境问题当成代码坏。 */
  await new Promise((r) => setTimeout(r, 350))
  const fd = fs.openSync(lg, 'w')
  const child = spawn(BIN, {
    env: { ...process.env, ...env, POC_SECONDS: String(seconds), POC_JSON: j },
    stdio: ['ignore', fd, fd],
  })
  await new Promise((res) => child.on('exit', res))
  fs.closeSync(fd)
  return {
    rep: readReport(j),
    text: fs.readFileSync(lg, 'utf8'),
  }
}

/** 读报告（★报告不是合法 JSON 时**不许把门禁崩掉**，要说清楚哪一行坏了）
 *
 *  事故形态（2026-10-27 实测）：只出 1 帧 ⇒ 跨度算成 0 ⇒ 报告写出 `"measured_fps": inf`，
 *  而 JSON 没有 inf ⇒ `JSON.parse` 抛 SyntaxError ⇒ 整个门禁以 uncaught exception 结束。
 *  **判据崩掉比判据变红更糟**：它不告诉你"只出了 1 帧"，只丢一堆栈。
 *  （生产侧已修：embed_view.m 的 wall<=0 ⇒ fps=-1；这里是**消费侧**的兜底。） */
function readReport(file) {
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.log(`✗ 报告不是合法 JSON：${path.relative(ROOT, file)} — ${e.message}`)
    console.log('  原文片段：' + raw.slice(0, 240).replace(/\s+/g, ' '))
    return null
  }
}

let { rep, text } = await runOnce({ seconds: SECONDS })
if ((rep?.frames_presented ?? 0) === 0) {
  /* 零帧且零错误 = 没拿到流（环境抢占），重试一次并**明确说出来**，不静默吞掉 */
  console.log('… 首次运行没拿到帧（0 帧 / 0 错误）⇒ 设备采集权未释放，重试一次')
  ;({ rep, text } = await runOnce({ seconds: SECONDS }))
}

// 判据（三条，全部来自"用户真正看到什么"）
const hwErr = (text.match(/^\[h264 @/gm) || []).length          // 解码器内部错误（含 Invalid NAL / concealing）
const dirtyAu = (text.match(/必然花/g) || []).length             // AU 自检：这一帧结构已坏
const hardCut = (text.match(/硬切，这一段画面必然坏/g) || []).length // 单个 NAL 超过读缓冲
const frames = rep?.frames_presented ?? 0
const aus = rep?.aus ?? 0
const fps = rep ? Number(rep.measured_fps ?? 0) : 0

const checks = [
  [`出帧 > 0（拿到 ${frames} 帧 / ${aus} AU）`, frames > 0 && aus > 0],
  [`解码器零错误（${hwErr} 条 h264 错误）`, hwErr === 0],
  [`AU 结构零脏帧（${dirtyAu} 脏 / ${hardCut} 次硬切）`, dirtyAu === 0 && hardCut === 0],
]

/* ── 第二段：切画质档位（决策 #1263 / #1264）────────────────────────────────
 * 这条覆盖"停旧会话 → 起新会话 → 重建解码器"整条路——画质档位按钮背后就这一条。
 * ★判据按**画质档位**的真实语义断：**分辨率不变**、码率真的降了、仍有帧、零解码错误。
 *   （如果谁把它改成顺带切分辨率，这条会立刻红。） */
const baseSize = rep?.size ?? ''
const swSize = process.env.STUDIO_LIVE_SWITCH_SIZE || baseSize
const sw = await runOnce({
  seconds: 9,
  env: {
    POC_SWITCH_AFTER_MS: '2500',
    POC_SWITCH_CMD: `adb exec-out screenrecord --output-format=h264 --size ${swSize || '884x1920'} --bit-rate 4000000 --time-limit 180 -`,
  },
})
const swErr = (sw.text.match(/^\[h264 @/gm) || []).length
const swMbps = Number(sw.rep?.mbps ?? 99)
checks.push([
  `切画质（省流 4M）后仍在出帧（${sw.rep?.frames_presented ?? 0} 帧 · ${sw.rep?.size ?? '?'} · 实测 ${swMbps} Mbps）· 分辨率不变=${sw.rep?.size === baseSize} · 零解码错误（${swErr}）`,
  (sw.rep?.frames_presented ?? 0) > 0 && sw.rep?.size === baseSize && swMbps <= 8 && swErr === 0,
])

let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) bad++
}
console.log(`  （${SECONDS}s · ${rep?.size ?? '?'} · ${fps > 0 ? fps : '—'} fps · 解码 ${rep?.decode_ms?.p50 ?? '—'}ms · ${rep?.hwdec ?? '?'}）`)
if (bad) {
  console.log(`  stderr: ${logPath}`)
  for (const l of text.split('\n').filter((x) => /\[h264 @|必然花|硬切/.test(x)).slice(0, 6)) {
    console.log(`    ${l.slice(0, 140)}`)
  }
}
process.exit(bad ? 1 : 0)
