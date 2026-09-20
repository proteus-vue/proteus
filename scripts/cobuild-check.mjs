#!/usr/bin/env node
// scripts/cobuild-check.mjs —— ★AI 共建三方一致性门禁（报告 ↔ 台账 ↔ 回执）
//
// 定位：`ledger-check.mjs` 校验台账**自身**是否合格（schema/自洽）；本脚本校验**三个工件之间**是否对齐。
//
// 为什么需要它（2026-09-20 实测挖出的两个真实缺口）：
//   ① **报了没立项**：报告第九节（第三次复测）报了 fluid 缺件堵整包入口（阻断级），
//      但台账里**没有对应条目**——没有机器判据能发现「报告写了、台账没记」，靠人工回溯才查出来。
//   ② **口径漂移**：报告正文按「第 N 轮 · 版本 X」叙述，台账按条目记 `reported_in`；
//      第 1~3 轮处「14 种版本号」时代，两边版本口径天然不同，靠人读会误判「对不上」。
//
// 本脚本把「AI 共建」的三份产物变成**可机器交叉核对**的闭环：
//
//   ┌─────────────────┐   报告：问题（第 N 轮 · 版本 X）
//   │ 实战报告 (md)   │──┐
//   └─────────────────┘  │
//   ┌─────────────────┐  ├──► cobuild-check：轮次 / 版本 / 条目 / 回执 四向对齐
//   │ 台账 (json)     │──┤
//   └─────────────────┘  │
//   ┌─────────────────┐  │
//   │ 处理回执 (md)   │──┘
//   └─────────────────┘
//
// 检查项（全部为 error 级——任一不过即 exit 1）：
//   A. **报了必须立项**：报告每个「第 N 轮复测」小节 → 台账该轮必须 ≥1 条
//   B. **立项必须有出处**：台账每条 → 必须有对应的报告轮次小节
//   C. **版本口径一致**：报告轮次标题里的版本号 ↔ 台账 `rounds[].version`
//   D. **修复必须有回执**：已收口轮次（该轮条目全部 resolved 或已发布）→ 报告须有「处理回执（第 N 轮）」
//   E. **回执必须有轮次**：报告的回执小节 → 该轮次必须在台账 rounds 里
//
// 用法：
//   node scripts/cobuild-check.mjs            # 报告（默认）
//   node scripts/cobuild-check.mjs --check    # 有问题 → exit 1（CI / verify 用）
//   node scripts/cobuild-check.mjs --json
// 退出码：0 通过 / 1 有缺口 / 2 环境错误（文件缺失/不可解析）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const REPORT = path.join(ROOT, 'docs', '实战报告_proteus接入.md')
const LEDGER = path.join(ROOT, 'docs', '外部报告台账.json')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
/** 「第六轮」→ 6（支持 十一~二十 的简单组合） */
function cnNum(s) {
  if (!s) return null
  if (s.length === 1) return CN[s] ?? null
  // 十X / X十 / X十Y
  const m = /^(十)?([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s)
  if (!m) return null
  let n = 0
  if (m[1]) n += 10
  if (m[2]) n += CN[m[2]]
  if (m[3]) n += 10
  if (m[4]) n += CN[m[4]]
  return n || null
}

if (!fs.existsSync(REPORT)) {
  console.error(`✗ 找不到报告：${REPORT}`)
  process.exit(2)
}
if (!fs.existsSync(LEDGER)) {
  console.error(`✗ 找不到台账：${LEDGER}`)
  process.exit(2)
}

const report = fs.readFileSync(REPORT, 'utf8')
let ledger
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
} catch (e) {
  console.error(`✗ 台账 JSON 解析失败：${e.message}`)
  process.exit(2)
}

// ── 从报告抽取：轮次小节（第 N 轮复测：`版本`）+ 回执小节（处理回执（第 N 轮））──
const reportRounds = new Map() // round → { version, heading }
for (const m of report.matchAll(/^## ([^\n]+)$/gm)) {
  const h = m[1]
  const r = /第([一二三四五六七八九十]+)轮/.exec(h)
  if (!r) continue
  const n = cnNum(r[1])
  if (n === null) continue
  // 只认「复测」性质的轮次小节（回执是另一类，见下）
  if (!/复测|轮/.test(h)) continue
  if (/回执/.test(h)) continue
  const v = /(0\.\d+\.\d+-beta\.\d+|0\.\d+\.\d+)/.exec(h)
  if (!reportRounds.has(n)) reportRounds.set(n, { version: v ? v[1] : null, heading: h })
}
const reportReceipts = new Set()
/**
 * 解析「处理回执（第 N 轮）」与「处理回执（第 A~B 轮）」（历史各轮可合并成一份回执）。
 * ★轮次数字**同时接受中文与阿拉伯数字**——合并回执常写成「第 1~3 轮」（阿拉伯），
 *   而单轮回执写成「第六轮」（中文）；两种都出现过，正则必须都认（否则会误报「无回执」）。
 */
for (const m of report.matchAll(/^## [^\n]*处理回执[^\n]*（第\s*([0-9一二三四五六七八九十]+)\s*(?:~\s*第?\s*([0-9一二三四五六七八九十]+)\s*)?轮）[^\n]*$/gm)) {
  const parse = (x) => (/^\d+$/.test(x) ? Number(x) : cnNum(x))
  const from = parse(m[1])
  const to = m[2] ? parse(m[2]) : from
  if (from === null || to === null) continue
  for (let n = from; n <= to; n++) reportReceipts.add(n)
}
/** 报告里全部二级标题（标题文本，已去 `## ` 前缀）——供 report_section 出处核对 */
const reportHeadings = new Set([...report.matchAll(/^## ([^\n]+)$/gm)].map((m) => m[1]))
/** 报告小节的**序号**（一、二、三…）——用于 report_section 出处核对 */
const reportSectionNums = new Set()
for (const h of reportHeadings) {
  // ★标题文本本身不含 `## ` 前缀（matchAll 的捕获组 1 已剥离）——此处不可再匹配 `^## `
  const m = /^([一二三四五六七八九十]+)、/.exec(h)
  if (m) reportSectionNums.add(m[1])
}

// ── 从台账抽取：轮次索引 + 每条归属轮次 ──
const ledgerRounds = new Map()
for (const r of ledger.rounds ?? []) ledgerRounds.set(Number(r.round), r)
const entriesByRound = new Map()
for (const e of ledger.entries ?? []) {
  const n = Number(e.round)
  if (!entriesByRound.has(n)) entriesByRound.set(n, [])
  entriesByRound.get(n).push(e)
}

const issues = []
const warnings = []

// A. 报了必须立项
for (const [n, info] of reportRounds) {
  if (!entriesByRound.has(n)) {
    issues.push({ rule: 'A 报了必须立项', detail: `报告有「第 ${n} 轮复测」小节（${info.heading.slice(0, 40)}…）但台账无该轮条目` })
  }
}
// B. 立项必须有出处：报告有该轮「复测」小节，**或**台账该轮声明了 report_section（且那些小节真实存在）
//    —— 早期轮次的报告小节标题不是「第N轮复测」形态（如「一、修复复测：三处阻断项」），
//       故允许台账用 rounds[].report_section 显式声明出处；声明了就要能在报告里找到对应序号小节。
for (const [n, list] of entriesByRound) {
  if (reportRounds.has(n) || reportReceipts.has(n)) continue
  const lr = ledgerRounds.get(n)
  const declared = lr?.report_section
  if (declared) {
    const nums = String(declared)
      .split(/[/、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const missing = nums.filter((x) => !reportSectionNums.has(x))
    if (missing.length) {
      issues.push({ rule: 'B 立项必须有出处', detail: `台账第 ${n} 轮 report_section 声明的小节 ${missing.join('/')} 在报告里不存在` })
    }
    continue
  }
  issues.push({ rule: 'B 立项必须有出处', detail: `台账有第 ${n} 轮的 ${list.length} 条（${list.map((e) => e.id).join(', ')}）但报告无对应轮次小节、也未声明 report_section` })
}
// C. 版本口径一致（只比对两边都有版本的轮次；第 1~3 轮属多版本时代，台账用 version_scheme_note 说明，跳过硬比对）
for (const [n, info] of reportRounds) {
  const lr = ledgerRounds.get(n)
  if (!lr || !info.version || !lr.version) continue
  if (info.version !== lr.version) {
    if (n <= 3) warnings.push({ rule: 'C 版本口径', detail: `第 ${n} 轮：报告 ${info.version} ≠ 台账 ${lr.version}（多版本时代，见 version_scheme_note——非缺陷）` })
    else issues.push({ rule: 'C 版本口径一致', detail: `第 ${n} 轮：报告写 ${info.version}，台账写 ${lr.version}` })
  }
}
// D. 修复必须有回执：该轮**已全部收口**（无 open/partial/worktree）却无回执
for (const [n, list] of entriesByRound) {
  const unfinished = list.filter((e) => e.status === 'open' || e.status === 'partial' || (e.status === 'fixed' && e.fix_state === 'worktree'))
  if (unfinished.length === 0 && !reportReceipts.has(n)) {
    issues.push({ rule: 'D 修复必须有回执', detail: `第 ${n} 轮 ${list.length} 条已全部收口，但报告无「处理回执（第 ${n} 轮）」小节` })
  }
}
// E. 回执必须有轮次
for (const n of reportReceipts) {
  if (!ledgerRounds.has(n)) {
    issues.push({ rule: 'E 回执必须有轮次', detail: `报告有「处理回执（第 ${n} 轮）」但台账 rounds 里无第 ${n} 轮` })
  }
}

// F. 台账必须保留**框架侧元数据**（2026-09-20 实例：外部把台账整份复制过来，
//    覆盖掉本仓版本 → rounds / verification_breakdown / 8 条框架自查条目全丢，靠人工回溯才发现）。
//    判据：框架侧元数据键必须在位；且 found_by=framework 的条目数不得为 0（框架自查是台账的一部分）。
const FRAMEWORK_META_KEYS = ['rounds', 'verification_breakdown']
const missingMeta = FRAMEWORK_META_KEYS.filter((k) => !(k in ledger))
if (missingMeta.length) {
  issues.push({
    rule: 'F 台账框架侧元数据完整',
    detail: `台账缺框架侧键：${missingMeta.join(', ')}——**多为「外部副本整份覆盖」所致**（同步请走 pnpm sync:cobuild，不要复制文件）`,
  })
}
const frameworkFound = (ledger.entries ?? []).filter((e) => e.found_by === 'framework').length
if (frameworkFound === 0) {
  issues.push({
    rule: 'F 台账框架侧元数据完整',
    detail: '台账无 found_by=framework 的条目——框架自查发现（如发布物缺陷、同族漏网路径）也是台账的一部分，被整份覆盖会静默丢失',
  })
}

const stats = {
  report_rounds: [...reportRounds.keys()].sort((a, b) => a - b),
  ledger_rounds: [...ledgerRounds.keys()].sort((a, b) => a - b),
  receipts: [...reportReceipts].sort((a, b) => a - b),
  entries: (ledger.entries ?? []).length,
  issues: issues.length,
  warnings: warnings.length,
}

if (JSON_OUT) {
  console.log(JSON.stringify({ ...stats, issues, warnings }, null, 2))
} else {
  console.log('AI 共建三方一致性检查（报告 ↔ 台账 ↔ 回执）')
  console.log(`  报告轮次：${stats.report_rounds.map((n) => '第' + n + '轮').join(' · ') || '（无）'}`)
  console.log(`  台账轮次：${stats.ledger_rounds.map((n) => '第' + n + '轮').join(' · ') || '（无）'}（${stats.entries} 条）`)
  console.log(`  处理回执：${stats.receipts.map((n) => '第' + n + '轮').join(' · ') || '（无）'}`)
  if (warnings.length) {
    console.log(`\n  ⚠ ${warnings.length} 条提示（不阻断）：`)
    for (const w of warnings) console.log(`    · [${w.rule}] ${w.detail}`)
  }
  if (issues.length) {
    console.log(`\n  ✗ ${issues.length} 处缺口：`)
    for (const i of issues) console.log(`    · [${i.rule}] ${i.detail}`)
    console.log('\n  → 三者必须互相对齐：报告报了就要立项（台账）、修完了要有回执（报告）。')
    console.log('     补台账条目：docs/外部报告台账.json；补回执：报告末尾追加「## 处理回执（第 N 轮）」。')
  } else {
    console.log('\n  ✅ 三方一致：报告每轮都有台账条目、台账每条都有出处、版本口径一致、已收口轮次都有回执')
  }
}

process.exitCode = issues.length ? 1 : 0
