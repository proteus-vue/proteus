#!/usr/bin/env node
// scripts/check-dactyl-budget.mjs —— ★★Dactyl 预算门禁（D0 骨架 · 15-dactyl-demo.md §9）
//
// 【判据（对齐 §9 check:dactyl-budget）】
//   ① 契约：每份 `hosts/<end>/results/dactyl-metrics.json` 必含 `end` / `source` / `generated_at` / `metrics`；
//   ② 预算（**仅对非 null 的指标判**——无采样时如实 ◐，不因缺数据假绿/假红）：
//      · `work_time_p95_ms ≤ 8.0`（沿用 `FRAME_WORK_BUDGET_MS`）；
//      · `jank_rate ≤ 0.2`（%）；
//      · `input_latency_p95_ms ≤ 8.33`（1 帧@120Hz，若已采）。
//   ◐ 某端无 dactyl-metrics.json ⇒ 如实跳过。
//
// 【诚实边界 · 数据可信度】本门禁**不能**分辨"work_time_p95 是 Perfetto 真值还是 gfxinfo 代理"
//   ——那是**生产者**（宿主/量具）的诚实边界（`notes` 里注明来源）。门禁只判"给定数据是否超预算"。
//   「对外宣称」另受 15 §12 约束（真机 + 外部取证前不宣称）。
//
// 用法：node scripts/check-dactyl-budget.mjs
// 退出码：0 通过 / 1 命中 / 2 环境错
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENDS = ['android', 'ios', 'harmony', 'skyline', 'web', 'native', 'flutter', 'rn']
const WORK_TIME_P95_BUDGET = 8.0
const JANK_RATE_BUDGET = 0.2
const INPUT_LATENCY_P95_BUDGET = 8.33

let failed = false
const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }

console.log('═══ Dactyl 预算门禁（D0 骨架 · 15 §9）═══')
let seen = 0
for (const end of ENDS) {
  const f = path.join(ROOT, `hosts/${end}/results/dactyl-metrics.json`)
  if (!fs.existsSync(f)) continue
  seen++
  let rep
  try { rep = JSON.parse(fs.readFileSync(f, 'utf-8')) } catch (e) { fail(`${end}：JSON 解析失败（${e.message}）`); continue }
  // ① 契约
  for (const k of ['end', 'source', 'generated_at', 'metrics']) {
    if (!(k in rep)) { fail(`${end}：缺契约字段 \`${k}\``); }
  }
  const m = rep.metrics || {}
  const notes = (rep.notes || []).join('；')
  // ② 预算（仅判非 null）
  const checks = []
  if (typeof m.work_time_p95_ms === 'number') {
    if (m.work_time_p95_ms > WORK_TIME_P95_BUDGET) fail(`${end}：work_time_p95 ${m.work_time_p95_ms}ms > ${WORK_TIME_P95_BUDGET}ms`)
    else checks.push(`work_time_p95 ${m.work_time_p95_ms}ms`)
  }
  if (typeof m.jank_rate === 'number') {
    if (m.jank_rate > JANK_RATE_BUDGET) fail(`${end}：jank_rate ${m.jank_rate}% > ${JANK_RATE_BUDGET}%`)
    else checks.push(`jank ${m.jank_rate}%`)
  }
  if (typeof m.input_latency_p95_ms === 'number') {
    if (m.input_latency_p95_ms > INPUT_LATENCY_P95_BUDGET) fail(`${end}：input_latency_p95 ${m.input_latency_p95_ms}ms > ${INPUT_LATENCY_P95_BUDGET}ms`)
    else checks.push(`lat_p95 ${m.input_latency_p95_ms}ms`)
  }
  const skipNote = typeof m.input_latency_p95_ms !== 'number' ? '（无触摸采样 ⇒ 端到端延迟 ◐）' : ''
  console.log(`  ${failed ? '·' : '✓'} ${end}：${checks.join(' · ') || '无预算字段'}${skipNote}${notes ? `  [来源：${notes.slice(0, 60)}…]` : ''}`)
}
if (seen === 0) console.log('  ◐ 无任何 dactyl-metrics.json（Dactyl 生产者未接）——跳过')

if (failed) { console.error('\n✗ Dactyl 预算门禁命中（见上）'); process.exit(1) }
console.log('\n✅ Dactyl 预算门禁通过（诚实边界：work_time 真值需 Perfetto，gfxinfo 为代理——见 notes）')
