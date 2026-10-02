#!/usr/bin/env node
// scripts/parse-perfetto-harmony.mjs —— ★矩阵 #22 判据：hitrace 帧标记 → 帧区间统计
//
// 【输入】`grep 'FrameS-BeginScene' <trace>` 的产物（ftrace 文本行，格式：
//   `<comm>-<tid>    (  <pid>) [cpu] .... <uptime_sec>: tracing_mark_write: B|<pid>|H:<mark>...`）
// 【输出】帧区间统计（p50/p95/p99/avg/fps + 帧数）——与 iOS 帧统计同口径
//
// 判据：① 帧数 ≥ 30（活动期样本足够）② p50 在 8–40ms（60Hz 带）③ fps > 10
// 用法：node parse-perfetto-harmony.mjs <frames.txt> [out.json]
import fs from 'node:fs'

const [file, out] = process.argv.slice(2)
if (!file) {
  console.error('用法：node parse-perfetto-harmony.mjs <frames.txt> [out.json]')
  process.exit(2)
}
const lines = fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.includes('FrameS-BeginScene'))
// 时间戳：行内 `<秒>.<微秒>:`（uptime 时钟）
const stamps = []
for (const l of lines) {
  const m = l.match(/\s(\d+\.\d+):\s+tracing_mark_write/)
  if (m) stamps.push(parseFloat(m[1]) * 1000)   // → ms
}
if (stamps.length < 2) {
  console.error(`✗ 可解析时间戳不足（${stamps.length}）`)
  process.exit(1)
}
stamps.sort((a, b) => a - b)
const gaps = []
for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1])
const sorted = gaps.slice().sort((a, b) => a - b)
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
const total = stamps[stamps.length - 1] - stamps[0]
const fps = total > 0 ? (stamps.length - 1) / (total / 1000) : -1
const rd = (v) => Math.round(v * 100) / 100
const p50 = p(0.5), p95 = p(0.95), p99 = p(0.99)
// ★两套口径（如实并列——trace 窗口含 App 启动与空闲段）：
//   · raw：全部帧间隔（含空闲间隔——空闲期系统仍偶发帧，间隔大）
//   · active：过滤间隔 > 100ms 的段（"连续出帧期"的节奏——帧率真值）
const activeGaps = sorted.filter((g) => g <= 100)
const activeAvg = activeGaps.length ? activeGaps.reduce((a, b) => a + b, 0) / activeGaps.length : -1
const activeFps = activeAvg > 0 ? 1000 / activeAvg : -1
const checks = {
  frames_enough: stamps.length >= 30,
  p50_in_band: p50 >= 8 && p50 <= 40,
  fps_ok: fps > 10,
}
const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
const report = {
  ok: verdict === 'PASS',
  path: 'perfetto',
  host_id: 'harmony',
  tool: 'hitrace（OpenHarmony ftrace 前端——Perfetto 同族）',
  note: '鸿蒙腿：系统级 trace 采活动期帧标记（FrameS-BeginScene）→ 帧区间统计（与 iOS 帧统计同口径）；'
    + '★与 Android Perfetto 的差异：Android 由系统直接给帧区间，本腿从 ftrace 标记序列算——量纲同、来源同族',
  frames: stamps.length,
  gaps_ms: { avg: rd(avg), p50: rd(p50), p95: rd(p95), p99: rd(p99), min: rd(sorted[0]), max: rd(sorted[sorted.length - 1]) },
  fps_avg: rd(fps),
  active_gaps_ms: { count: activeGaps.length, avg: rd(activeAvg), fps: rd(activeFps) },
  total_span_ms: rd(total),
  checks,
  verdict,
}
console.log(JSON.stringify(report, null, 1))
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n')
process.exit(report.ok ? 0 : 1)
