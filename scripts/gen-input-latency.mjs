#!/usr/bin/env node
// scripts/gen-input-latency.mjs —— ★★输入延迟报告**生产者**（S6.1/S6.5 · 输入延迟专项 #767）
//
// 【为什么是"生产者 + 判据"两件（本仓纪律）】性能项没有机器可判的产物等于没做。本脚本把**外部读数**
//   （Android `dumpsys gfxinfo`）解析成**结构化报告** `hosts/android/results/input-latency.json`，
//   供 `check:input-latency` 门禁消费 + 后续 S1/S2 收益对比。
//
// 【口径（对齐对标 Benchmark Checklist）】
//   · 帧耗时百分位（p50/p90/p95/p99）= gfxinfo 的 "Nth percentile"（**帧渲染**，非端到端输入延迟）；
//   · `high_input_latency` = gfxinfo 的 "Number High input latency"（**端到端输入延迟的官方计数**，
//     受设备/系统版本影响，**跨设备不可比** ⇒ 只作**本机基线**，不做跨端比）。
//   · ★诚实边界：**真正的"触摸时间戳→提交时间戳"端到端延迟**需 Perfetto/Instruments（S6.4，外部工具）；
//     本脚本先落**可离线复算**的 gfxinfo 口径，作为 S1/S2 收益的**前后对比基线**。
//
// 用法：node scripts/gen-input-latency.mjs [--gfxinfo <path>] [--out <path>]
//   缺省：gfxinfo = hosts/android/results/gfxinfo.txt · out = hosts/android/results/input-latency.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const GFX = path.resolve(ROOT, argOf('--gfxinfo', 'hosts/android/results/gfxinfo.txt'))
const OUT = path.resolve(ROOT, argOf('--out', 'hosts/android/results/input-latency.json'))

if (!fs.existsSync(GFX)) { console.error(`✗ 缺 gfxinfo：${GFX}`); process.exit(2) }
const txt = fs.readFileSync(GFX, 'utf-8')
const num = (re) => { const m = txt.match(re); return m ? Number(m[1]) : null }

// gfxinfo 字段（缺 ⇒ null，如实，不猜）
const total = num(/Total frames rendered:\s*(\d+)/)
const janky = num(/Janky frames:\s*(\d+)/)
const jankyPct = (() => { const m = txt.match(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/); return m ? Number(m[1]) : null })()
const p50 = num(/\n50th percentile:\s*(\d+)/)
const p90 = num(/\n90th percentile:\s*(\d+)/)
const p95 = num(/\n95th percentile:\s*(\d+)/)
const p99 = num(/\n99th percentile:\s*(\d+)/)
const highInputLatency = num(/Number High input latency:\s*(\d+)/)
const missedVsync = num(/Number Missed Vsync:\s*(\d+)/)
const slowUi = num(/Number Slow UI thread:\s*(\d+)/)

// gfxinfo 里没带 host_id ⇒ 由路径推断端
const end = OUT.includes('/ios/') ? 'ios' : OUT.includes('/harmony/') ? 'harmony' : 'android'

const report = {
  end,
  source: 'dumpsys-gfxinfo',
  generated_at: new Date().toISOString(),
  // 帧渲染（毫秒）——端到端延迟的**代理**（见口径注释）
  frame_p50_ms: p50, frame_p90_ms: p90, frame_p95_ms: p95, frame_p99_ms: p99,
  total_frames: total, janky_frames: janky, janky_pct: jankyPct,
  // 官方输入延迟计数（本机基线；跨设备不可比）
  high_input_latency: highInputLatency,
  missed_vsync: missedVsync, slow_ui_thread: slowUi,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
console.log(`[gen-input-latency] ✅ ${path.relative(ROOT, OUT)}`)
console.log(`   ${end} · 帧 p50/p95/p99 = ${p50}/${p95}/${p99}ms · janky ${janky}(${jankyPct}%) · High input latency ${highInputLatency}`)
