#!/usr/bin/env node
// scripts/dactyl-ceiling.mjs —— ★★★Dactyl D3：**天花板刻度尺**（ceiling scale）生产者 + 门禁
//
// 【它是什么（15-dactyl-demo.md §5）】把"能扛多少"变成一个**确定的档位号**：
//   负载向量 `L = (N节点数, M触点数, f数据更新频率, K动画通道数, D嵌套深度)`，按**升档序**
//   （先 N，再 f，再 M，再 K；§5.1 标量化规则）逐档加码，取满足全部预算的**最大可行档**：
//     · `input_latency_p95 ≤ 8.33ms`（1 帧 @120Hz）
//     · `jank_rate ≤ 0.2%`
//     · `gc_pause ≈ 0`
//   ⇒ 首次违约的档 = **崩裂点**（rupture）；上确界 = **天花板**（ceiling）。
//
// 【为什么是脚本不是宿主代码】这是**跨端同一把尺**（同判据、同档位序、同输出契约）——
//   落在 `scripts/`（工具层）而不是任何宿主里（决策 #789/#796：宿主不认应用身份）。
//   各端只提供**原始读数**（`dactyl-metrics.json` / Perfetto / gfxinfo），本脚本做**口径统一与判定**。
//
// 【输入】`hosts/<end>/results/dactyl-ceiling-input.json`（可选；缺 ⇒ 如实记 ◐ 未实测）：
//   `{ end, device, ladder: [ {档位, load:{n,m,f,k,d}, metrics:{input_latency_p95_ms, jank_rate, gc_pause_count}} … ] }`
// 【输出】`hosts/<end>/results/dactyl-ceiling.json`：
//   `{ end, device, ladder_size, ceiling_level, rupture_level, ceiling_load, notes[] }`
//   ★`ceiling_level` 以**档位号**对外（§5.1：容量数而非耗时数——"我们在第 7 档，对手在第 2 档"）。
//
// 【诚实边界】① 输入须**真机实测**（模拟器口径不作数——15 §12）；② 无输入 ⇒ 输出 ◐ 占位并**exit 0**
//   （不判红——"未实测"不是"不达标"，如实记录，同 check-dactyl-budget 的口径）；
//   ③ 本脚本**不发明数据**（缺读数 ⇒ 该档记 null，不假定 0）。
//
// 用法：node scripts/dactyl-ceiling.mjs [--end android|ios|harmony]（缺省=三端都算，有输入才算）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENDS = ['android', 'ios', 'harmony']

/** 预算（§5.1 / 15 §9——唯一口径，与 dactyl-metrics.schema.json 同源） */
const BUDGET = {
  input_latency_p95_ms: 8.33,   // 1 帧 @120Hz
  jank_rate: 0.2,               // %
  gc_pause_count: 0,            // ≈0（严格 0；弹簧/GC 抖动可由调用方放宽——见 notes）
}

/** 单档是否**全预算达标**（缺读数 ⇒ 视为不达标，并记 note——不假定 0）。 */
function levelOk(metrics) {
  const miss = []
  for (const [k, lim] of Object.entries(BUDGET)) {
    const v = metrics?.[k]
    if (v === null || v === undefined) { miss.push(`${k}=◐无读数`); continue }
    if (typeof v !== 'number' || !Number.isFinite(v)) { miss.push(`${k}=非法(${String(v)})`); continue }
    if (k === 'gc_pause_count' ? v > lim : v > lim) miss.push(`${k}=${v}>${lim}`)
  }
  return { ok: miss.length === 0, miss }
}

function computeEnd(end) {
  const inFile = path.join(ROOT, `hosts/${end}/results/dactyl-ceiling-input.json`)
  const outFile = path.join(ROOT, `hosts/${end}/results/dactyl-ceiling.json`)
  if (!fs.existsSync(inFile)) {
    // ◐ 未实测：写占位（不判红）——"没有输入"与"不达标"是两件事（诚实边界②）
    const placeholder = {
      end, device: null, ladder_size: 0, ceiling_level: null, rupture_level: null,
      ceiling_load: null,
      notes: [
        `◐ 无实测输入（${path.relative(ROOT, inFile)} 不存在）——天花板未标定（如实，不假定）`,
        '标定方法：在真机上按升档序（先 N 再 f 再 M 再 K，§5.1）逐档加码，每档采 input_latency_p95/jank_rate/gc_pause，写入本输入文件后重跑本脚本',
      ],
    }
    fs.writeFileSync(outFile, JSON.stringify(placeholder, null, 2) + '\n')
    return { end, wrote: true, level: null, rupture: null }
  }
  let input
  try { input = JSON.parse(fs.readFileSync(inFile, 'utf-8')) } catch (e) {
    console.error(`✗ ${end}: 输入非法 JSON（${String(e)}）——不发明数据，跳过`)
    return { end, wrote: false, level: null, rupture: null }
  }
  const ladder = Array.isArray(input.ladder) ? input.ladder : []
  if (ladder.length === 0) {
    console.error(`✗ ${end}: ladder 为空——无事可判`)
    return { end, wrote: false, level: null, rupture: null }
  }
  // 逐档判定（升档序由输入给定——本脚本只按数组序走，不重排：档序是生产者的事，§5.1）
  const evaluated = ladder.map((lv, i) => {
    const r = levelOk(lv.metrics)
    return { level: lv.level ?? (i + 1), load: lv.load ?? null, metrics: lv.metrics ?? null, ok: r.ok, miss: r.miss }
  })
  // 崩裂点 = 首次违约档；天花板 = 崩裂点**前一档**（全过档里最大档）
  const ruptureIdx = evaluated.findIndex((e) => !e.ok)
  const ceiling = ruptureIdx < 0 ? evaluated[evaluated.length - 1] : (ruptureIdx > 0 ? evaluated[ruptureIdx - 1] : null)
  const out = {
    end,
    device: input.device ?? null,
    ladder_size: evaluated.length,
    ceiling_level: ceiling?.level ?? null,
    rupture_level: ruptureIdx >= 0 ? evaluated[ruptureIdx].level : null,
    ceiling_load: ceiling?.load ?? null,
    evaluated: evaluated.map((e) => ({ level: e.level, ok: e.ok, miss: e.miss })),
    notes: [
      '判据 = §5.1：input_latency_p95 ≤ 8.33ms ∧ jank_rate ≤ 0.2% ∧ gc_pause ≈ 0（全档全过才是"能扛"）',
      ...(ruptureIdx < 0 ? ['全程未违约（ladder 到顶仍未崩裂）——天花板 ≥ 末档；加大档位序后重测'] : []),
    ],
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n')
  return { end, wrote: true, level: out.ceiling_level, rupture: out.rupture_level }
}

const only = (() => {
  const i = process.argv.indexOf('--end')
  return i >= 0 ? process.argv[i + 1] : null
})()
const ends = only ? [only] : ENDS
console.log('═══ Dactyl 天花板刻度尺（§5：容量数而非耗时数）═══')
let anyInput = false
for (const e of ends) {
  if (!ENDS.includes(e)) { console.error(`✗ 未知端：${e}`); process.exit(2) }
  const hasInput = fs.existsSync(path.join(ROOT, `hosts/${e}/results/dactyl-ceiling-input.json`))
  if (hasInput) anyInput = true
  const r = computeEnd(e)
  if (!r.wrote) continue
  if (r.level === null && !hasInput) console.log(`  ◐ ${e}：未标定（无实测输入——如实，非不达标）`)
  else if (r.level === null) console.log(`  ⚠ ${e}：首档即违约（崩裂点=第 ${r.rupture} 档；无可行档）`)
  else console.log(`  ✓ ${e}：**天花板 = 第 ${r.level} 档**${r.rupture !== null ? `（崩裂点 = 第 ${r.rupture} 档）` : '（未观察到崩裂）'}`)
}
if (!anyInput) console.log('  （三端均无实测输入——见各 dactyl-ceiling.json 的 notes 标定方法）')
console.log('✅ Dactyl 天花板刻度尺产出完成（容量数 = 档位号，可跨框架对齐——§5.1）')
