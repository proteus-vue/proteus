#!/usr/bin/env node
// scripts/report-gaps.mjs —— ★卡 C4：**编译期漏点报告**（真项目采数 · 零设备）
//
// 【卡要什么】「编译流水线加漏点计数器（记录不阻断）」+ 三条验收：
//   ① 三类（fallback/degraded/unsupported）分别统计 ② degraded 单独高亮 ③ 产出"表达不了"清单
//
// 【采数载体】`showcase/`（真项目 128 SFC）——与 C3 编译基线同一载体（保证可比）。
// 【口径】只统计**编译器自身产出的诊断**（warnings）与**有损映射**（trace 规则 ID）——
//   计数器不新增"什么算漏点"的判断（见 `packages/compiler/src/gap-counter.ts` 文件头）。
//
// 用法：
//   npx tsx scripts/report-gaps.mjs            # 人读报告
//   npx tsx scripts/report-gaps.mjs --json     # JSON（工具消费）
//   npx tsx scripts/report-gaps.mjs --check    # 与 benchmarks/gap-baseline.json 比对（劣化即红）
//   npx tsx scripts/report-gaps.mjs --update   # 写回基线
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc, GapCounter, formatGapReport } from '@proteus-vue/compiler'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'benchmarks', 'gap-baseline.json')
const argv = process.argv.slice(2)
const AS_JSON = argv.includes('--json')
const CHECK = argv.includes('--check')
const UPDATE = argv.includes('--update')

const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.vue')) files.push(p)
  }
})(path.join(ROOT, 'showcase'))

const counters = []
const fatal = []
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (rel === 'showcase/router/RouterView.vue') continue // 已知：产物含 import.meta（与 C3 同口径）
  try {
    const r = compileVueSfc(fs.readFileSync(f, 'utf-8'), { filename: rel })
    const c = new GapCounter()
    for (const g of r.gaps ?? []) c.records.push(g)
    counters.push({ file: rel, counter: c })
  } catch (e) {
    fatal.push({ file: rel, error: String(e.message).slice(0, 120) })
  }
}

const all = counters.flatMap((c) => c.counter.records)
const summary = {
  fallback: all.filter((r) => r.severity === 'fallback').length,
  degraded: all.filter((r) => r.severity === 'degraded').length,
  unsupported: all.filter((r) => r.severity === 'unsupported').length,
  total: all.length,
}
const byCategory = {}
for (const r of all) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
const result = { fileCount: counters.length, summary, byCategory, fatalCount: fatal.length }

if (AS_JSON || CHECK || UPDATE) {
  if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, JSON.stringify({ updatedAt: new Date().toISOString(), result }, null, 2) + '\n')
    console.log(`[gap-report] ✅ 基线已写回 ${path.relative(ROOT, BASELINE)}`)
    process.exit(0)
  }
  if (CHECK) {
    if (!fs.existsSync(BASELINE)) { console.error('[gap-report] ✗ 基线缺失——先 --update'); process.exit(2) }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')).result
    const failures = []
    // ★判据：**degraded/unsupported 只降不升**（棘轮——它们是端对齐问题来源）
    if (result.summary.degraded > base.summary.degraded) failures.push(`degraded ${result.summary.degraded} > 基线 ${base.summary.degraded}（★行为可能不一致的写法增加了）`)
    if (result.summary.unsupported > base.summary.unsupported) failures.push(`unsupported ${result.summary.unsupported} > 基线 ${base.summary.unsupported}`)
    if (result.fatalCount !== base.fatalCount) failures.push(`编译失败文件数 ${result.fatalCount} ≠ 基线 ${base.fatalCount}`)
    if (failures.length) {
      console.error('[gap-report] ✗ 漏点棘轮回归：')
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(1)
    }
    console.log(`[gap-report] ✅ 漏点棘轮通过（degraded ${result.summary.degraded} · unsupported ${result.summary.unsupported} · 总 ${result.summary.total}）`)
    process.exit(0)
  }
  console.log(JSON.stringify({ result, fatal }, null, 2))
  process.exit(0)
}

console.log(`[gap-report] 载体 showcase（${counters.length} 文件）· 编译失败 ${fatal.length}`)
console.log(formatGapReport(counters))
if (fatal.length) {
  console.log('')
  console.log('★ 编译失败文件（**不是漏点，是缺陷**——须单独跟进）：')
  for (const f of fatal.slice(0, 5)) console.log(`  ${f.file}: ${f.error}`)
}
