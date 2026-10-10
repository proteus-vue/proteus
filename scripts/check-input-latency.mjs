#!/usr/bin/env node
// scripts/check-input-latency.mjs —— ★★输入延迟门禁（S6.2 · 输入延迟专项 #767）
//
// 【判据（分硬/宽两档——对齐方案 §7 R5「区分回归阻断与机器抖动」）】
//   硬档（回归即红）：
//     ① 每份 `input-latency.json` 必须**格式良好**（含 end / frame_p95_ms / high_input_latency）；
//     ② `frame_p95_ms <= FRAME_P95_BUDGET_MS`（8.3ms@120Hz——`Proteus_Benchmark案例规格.md` 的 1 帧预算）；
//   宽档（机器负载相关，防**粗暴**回归、不误伤抖动）：
//     ③ `high_input_latency <= baseline * TOL`（缺省 2.0）——**官方计数受设备/系统/时长影响**，
//        故只拦"翻倍级"回归；同比接近基线不动。
//   ◐ 某端无 `input-latency.json` ⇒ 如实跳过（不判红）。
//
// 【为什么不用严格棘轮（方案 §7 R5）】gfxinfo 的 High input latency 受机器负载/系统版本影响，
//   机器抖动能翻倍 ⇒ 严格棘轮会**随机红**（比没有门禁更糟：逼人 `--update` 假绿）。
//
// 用法：node scripts/check-input-latency.mjs [--write]
//   --write  把当前读数写回基线（**仅在确认是改善/换机后**用）
// 退出码：0 通过 / 1 命中 / 2 环境错
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts', 'input-latency-baseline.json')
const ENDS = ['android', 'harmony', 'ios']
const FRAME_P95_BUDGET_MS = 8.3
const TOL = 2.0
const WRITE = process.argv.includes('--write')

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) : {}
const next = { ...baseline }
let failed = false
const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }

console.log('═══ 输入延迟门禁（S6 · 输入延迟专项 #767）═══')
let seen = 0
for (const end of ENDS) {
  const f = path.join(ROOT, `hosts/${end}/results/input-latency.json`)
  if (!fs.existsSync(f)) { console.log(`  ◐ ${end}：无 input-latency.json（如实跳过）`); continue }
  let rep
  try { rep = JSON.parse(fs.readFileSync(f, 'utf-8')) } catch (e) { fail(`${end}：input-latency.json 解析失败（${e.message}）`); continue }
  seen++
  // ① 格式
  if (typeof rep.frame_p95_ms !== 'number' || typeof rep.high_input_latency !== 'number' || !rep.end) {
    fail(`${end}：报告字段缺失（需 end / frame_p95_ms / high_input_latency）`)
    continue
  }
  // ② 帧预算（硬）
  if (rep.frame_p95_ms > FRAME_P95_BUDGET_MS) {
    fail(`${end}：帧 p95 = ${rep.frame_p95_ms}ms > 预算 ${FRAME_P95_BUDGET_MS}ms`)
  }
  // ③ 输入延迟计数（宽棘轮 vs 基线）
  const base = baseline[end]
  if (base && typeof base.high_input_latency === 'number' && base.high_input_latency > 0) {
    const cap = base.high_input_latency * TOL
    if (rep.high_input_latency > cap) fail(`${end}：High input latency ${rep.high_input_latency} > 基线 ${base.high_input_latency}×${TOL}（粗暴回归）`)
  }
  next[end] = { high_input_latency: rep.high_input_latency, frame_p95_ms: rep.frame_p95_ms, source: rep.source }
  console.log(`  ✓ ${end}：帧 p95 ${rep.frame_p95_ms}ms · High input latency ${rep.high_input_latency}（基线 ${base ? base.high_input_latency : '新建'}）`)
}
if (seen === 0) { console.log('  ◐ 三端均无 input-latency.json（未采）——跳过'); }

if (WRITE) {
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n')
  console.log(`\n[check-input-latency] 基线已更新（${Object.keys(next).join('/')}）`)
  process.exit(0)
}
if (failed) { console.error('\n✗ 输入延迟门禁命中（见上）'); process.exit(1) }
console.log('\n✅ 输入延迟门禁通过')
