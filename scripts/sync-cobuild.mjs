#!/usr/bin/env node
// scripts/sync-cobuild.mjs —— ★外部项目 ↔ 框架仓库的共建工件同步（报告 + 台账）
//
// 为什么需要它（2026-09-20 实测）：两边的台账**已经漂移**——
//   外部 18 条 / 框架 26 条、`last_verified_published` 差一个版本（beta.9 vs beta.10）、
//   同一条目（F-16）的 status/verification 两边不同。根因是**靠人工复制粘贴同步**。
//   同步必须机器做，且要按「谁拥有哪些字段」合并，而不是整份覆盖。
//
// ★字段归属（避免互相覆盖，见 docs/external-cobuild-kit/PROTEUS-COBUILD.md §1）：
//   外部主导（问题的定义）：id / title / kind / severity / round / reported_in / found_by / evidence / repro
//   框架主导（修复的状态）：status / fix_state / fixed_in / verification_note（框架侧补充）
//   外部优先（验证结论）：verification / verified_by
//   双方共有：related
//
// 用法：
//   node scripts/sync-cobuild.mjs --from <外部项目 web 目录>            # 同步（写入框架仓库）
//   node scripts/sync-cobuild.mjs --from <外部项目 web 目录> --check    # 只报告差异，不写入
//   node scripts/sync-cobuild.mjs --from … --json                       # 机器可读
// 退出码：0 无冲突 / 1 有冲突或差异（--check 时）/ 2 环境错误
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeBreakdown } from './lib/cobuild-stats.mjs'
import { mergeNote } from './lib/cobuild-note.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')
const fromIdx = argv.indexOf('--from')
const FROM = fromIdx >= 0 ? path.resolve(argv[fromIdx + 1] ?? '') : null

const REPORT_NAME = '实战报告_proteus接入.md'
const LEDGER_NAME = '框架问题台账.json'
const OUR_LEDGER = path.join(ROOT, 'docs', '外部报告台账.json')

/** 外部主导的字段（同步时以外部为准） */
const EXTERNAL_OWNED = ['title', 'kind', 'severity', 'round', 'reported_in', 'found_by', 'evidence', 'repro']
/** 框架主导的字段（同步时保留框架值） */
const FRAMEWORK_OWNED = ['status', 'fix_state', 'fixed_in']
/** 外部优先的字段（外部有值则以外部为准；用于「使用方复测结论」回写） */
const EXTERNAL_PRIORITY = ['verification', 'verified_by']

if (!FROM) {
  console.error('用法：node scripts/sync-cobuild.mjs --from <外部项目 web 目录> [--check] [--json]')
  process.exit(2)
}
const extReport = path.join(FROM, REPORT_NAME)
const extLedger = path.join(FROM, LEDGER_NAME)
if (!fs.existsSync(extReport) || !fs.existsSync(extLedger)) {
  console.error(`✗ 外部工件不存在：期望 ${extReport} 与 ${extLedger}`)
  process.exit(2)
}

const ourLedger = JSON.parse(fs.readFileSync(OUR_LEDGER, 'utf8'))
const ext = JSON.parse(fs.readFileSync(extLedger, 'utf8'))
const ourReportPath = path.join(ROOT, 'docs', REPORT_NAME)
const ourReport = fs.readFileSync(ourReportPath, 'utf8')
const extReportSrc = fs.readFileSync(extReport, 'utf8')

const changes = []
const conflicts = []

// ── ① 台账：按 id 合并 ──
const byId = new Map(ourLedger.entries.map((e) => [e.id, e]))
for (const ee of ext.entries ?? []) {
  const mine = byId.get(ee.id)
  if (!mine) {
    // 外部新报的条目 → 整条并入。
    // ★但 `verification_note` 必须先过 mergeNote 归一化（2026-11-12 修）：
    //   直接 push 原文会导致**首次同步写入非规范形态、第二次同步再被规范化** ⇒ 不幂等
    //   （实测 F-44：第一次写进 `[我方处置] …`，第二次才变成 `[external] …`，
    //    使 `--check` 在同步后仍报 1 项变更）。
    const added = { ...ee }
    if (added.verification_note !== undefined) {
      const normalized = mergeNote(undefined, added.verification_note)
      if (normalized !== undefined) added.verification_note = normalized
    }
    ourLedger.entries.push(added)
    changes.push({ kind: 'ledger-add', id: ee.id, detail: `新增外部条目：${ee.title}` })
    continue
  }
  // 已存在 → 按字段归属合并
  for (const f of EXTERNAL_OWNED) {
    if (ee[f] === undefined) continue
    if (JSON.stringify(mine[f]) !== JSON.stringify(ee[f])) {
      // 外部主导：以外部为准（但记差异，便于人工复核）
      changes.push({ kind: 'ledger-update', id: ee.id, field: f, from: mine[f], to: ee[f] })
      mine[f] = ee[f]
    }
  }
  for (const f of EXTERNAL_PRIORITY) {
    if (ee[f] === undefined) continue
    if (mine[f] === undefined) {
      mine[f] = ee[f]
      changes.push({ kind: 'ledger-update', id: ee.id, field: f, from: '(空)', to: ee[f] })
      continue
    }
    if (JSON.stringify(mine[f]) === JSON.stringify(ee[f])) continue
    // 外部验证结论回写（外部 passed/failed 覆盖框架的 unverified/partial）
    const extVerified = ee.verification === 'passed' || ee.verification === 'failed'
    const mineUnverified = mine.verification !== 'passed' && mine.verification !== 'failed'
    if (extVerified && mineUnverified) {
      changes.push({ kind: 'ledger-update', id: ee.id, field: f, from: mine[f], to: ee[f] })
      mine[f] = ee[f]
    } else if (f === 'verification' && mine.verification === 'n_a' && ee.verification) {
      // ★n_a 是**框架侧占位**（修复未发布时「不适用」），不是经过考虑的结论 ——
      //   规范里 verification 属「外部优先」，故外部的实质结论（如 unverified/partial）覆盖它，不算冲突。
      //   2026-09-20 实例：F-34 框架填 n_a（未发布故不适用），外部用工作树源码复测 6/6 后填 unverified
      //   （诚实：修复有效但未发布故不能称 passed）——按外部优先采纳，脚本不应误报冲突。
      changes.push({ kind: 'ledger-update', id: ee.id, field: f, from: mine[f], to: ee[f] })
      mine[f] = ee[f]
    } else if (f === 'verification' && mine.verification === 'passed' && ee.verification !== 'passed') {
      // 框架已验通过、外部还没验 → 不算冲突，只是外部落后（记提示）
      changes.push({ kind: 'note', id: ee.id, detail: `外部 verification=${ee.verification}，框架已=${mine.verification}（外部尚未复测新版）` })
    } else {
      conflicts.push({ id: ee.id, field: f, external: ee[f], framework: mine[f] })
    }
  }
  // verification_note：不是冲突字段——合并双方视角（[external] / [framework]）。
  // 外部有该字段时优先采用「已带归属的合并结果」（外部侧也会记录双方视角）。
  if (ee.verification_note) {
    const merged = mergeNote(mine.verification_note, ee.verification_note)
    if (merged !== mine.verification_note) {
      mine.verification_note = merged
      changes.push({ kind: 'ledger-merge', id: ee.id, field: 'verification_note', detail: '合并双方验证说明（[external] + [framework]）' })
    }
  }
  for (const f of FRAMEWORK_OWNED) {
    if (ee[f] !== undefined && mine[f] === undefined) {
      // 外部带上了框架字段（通常为空）——不覆盖框架已填的
      mine[f] = ee[f]
    }
  }
}
// 框架新增的条目（外部没有）：保留，并标注
for (const mine of ourLedger.entries) {
  if (!(ext.entries ?? []).some((e) => e.id === mine.id)) {
    changes.push({ kind: 'note', id: mine.id, detail: `框架自查条目（外部台账无）：${mine.title?.slice(0, 40)}` })
  }
}
// 版本对齐
// ★`last_verified_published` / `last_verified_at` 的语义是「**使用方最后完整跑过的版本**」，
//   与 `verification` 同属「外部优先」字段 ⇒ 外部给了值就采纳（2026-11-12 修）。
//   原先只报 version-drift 不同步，导致框架侧永远停在外部第一次同步时的版本
//   （实测停在 beta.17/09-20，而外部早已跑到 beta.31/11-12）——那个 drift 提示因此**每次同步都出现**，
//   既不是「正常」也不是「待办」，纯噪声。
if (ext.last_verified_published && ext.last_verified_published !== ourLedger.last_verified_published) {
  changes.push({
    kind: 'version-sync',
    detail: `采纳外部最后已验版本：${ourLedger.last_verified_published} → ${ext.last_verified_published}`,
  })
  ourLedger.last_verified_published = ext.last_verified_published
  if (ext.last_verified_at) ourLedger.last_verified_at = ext.last_verified_at
}
ourLedger.last_external_sync_at = new Date().toISOString().slice(0, 10)

// ── ② 报告：合并外部新增的轮次小节（按 `## 第N轮复测` / `## 第N轮` 标题去重）──
/**
 * ★`复测` 必须**可选**（2026-11-12 修）：外部报告实测混用两种写法——
 *   `## 第13轮复测：…`（有）与 `## 第14轮：…` / `## 第15轮：…`（无）。
 *   原先强制 `轮复测` ⇒ 第 14/15 轮**静默漏掉**（脚本只报缺第 13 轮），报告正文根本没被提示合并。
 *   与 `cobuild-check.mjs` 的 ROUND_RE 保持同一口径：中文/阿拉伯数字都认，空格可有。
 */
const roundHeadings = (src) => [...src.matchAll(/^## [^\n]*第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮(?:复测)?[^\n]*$/gm)].map((m) => m[1])
const ourRounds = new Set(roundHeadings(ourReport))
const extRounds = roundHeadings(extReportSrc)
const missingRounds = extRounds.filter((r) => !ourRounds.has(r))
if (missingRounds.length) {
  changes.push({ kind: 'report-missing-rounds', detail: `框架报告缺少外部报告的轮次：${missingRounds.map((r) => '第' + r + '轮').join(', ')}（需人工合并该节）` })
}
for (const r of ourRounds) {
  if (!extRounds.includes(r)) changes.push({ kind: 'note', detail: `框架报告有第${r}轮但外部报告没有（多为框架侧回执节）` })
}

// ── ③ 台账 rounds[]：按 entries 补齐缺失轮次（2026-11-12 加）──
// 为什么脚本要管这个：`rounds[]` 是规则 B/E 判据的锚点（每条必需有出处、回执必需有轮次），
// 但 sync 原先**只合并 entries**、不补 rounds ⇒ 同步进 F-36~F-43 之后
// cobuild-check 规则 B 会因「第 13/14/15 轮无 rounds 条目也无 report_section」直接报红。
// 口径：轮次与版本取自**外部报告的小节标题**（`## 第N轮复测：`0.3.0-beta.31``），
//       标题里没有版本号时留 null（不猜）。
const headingByRound = new Map() // round → { version, summary }
for (const m of extReportSrc.matchAll(/^## ([^\n]+)$/gm)) {
  const h = m[1]
  const r = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮/.exec(h)
  if (!r || /回执/.test(h)) continue
  const n = /^\d+$/.test(r[1]) ? Number(r[1]) : null
  if (n === null) continue
  if (headingByRound.has(n)) continue
  const v = /(0\.\d+\.\d+-beta\.\d+|0\.\d+\.\d+)/.exec(h)
  // summary = 标题里 `——` 之后的结论句（去掉版本号与日期片段）
  const after = /——\s*([\s\S]*)$/.exec(h)
  headingByRound.set(n, { version: v ? v[1] : null, summary: after ? after[1].trim() : h })
}
ourLedger.rounds ??= []
const knownRounds = new Set(ourLedger.rounds.map((r) => Number(r.round)))
for (const [n, info] of headingByRound) {
  if (knownRounds.has(n)) continue
  if (!(ourLedger.entries ?? []).some((e) => Number(e.round) === n)) continue // 只补「真的有条目」的轮次
  ourLedger.rounds.push({ round: n, version: info.version, date: new Date().toISOString().slice(0, 10), summary: info.summary })
  changes.push({ kind: 'rounds-add', detail: `补 rounds[${n}]：version=${info.version ?? '(标题无版本)'}` })
}
ourLedger.rounds.sort((a, b) => Number(a.round) - Number(b.round))

// ── ④ verification_breakdown：从 entries 重算（2026-11-12 加）──
// 为什么：该字段原先是**手写快照**，无任何门禁校验 ⇒ 实测漂移（entries 已 unverified:2/n_a:1，
// 快照仍写 unverified:1/n_a:2）。派生数据必须由唯一实现重算，不能手填。
const before = JSON.stringify({ ...ourLedger.verification_breakdown, 统计时间: 0 })
ourLedger.verification_breakdown = computeBreakdown(ourLedger)
if (before !== JSON.stringify({ ...ourLedger.verification_breakdown, 统计时间: 0 })) {
  changes.push({ kind: 'breakdown-recompute', detail: `verification_breakdown 已按 entries 重算（收口率 ${ourLedger.verification_breakdown.真实收口率}%）` })
}

// ── 输出 / 写入 ──
if (JSON_OUT) {
  console.log(JSON.stringify({ changes, conflicts }, null, 2))
} else {
  console.log(`共建工件同步（外部 ← ${path.relative(process.cwd(), FROM)}）`)
  console.log(`  外部条目 ${(ext.entries ?? []).length} · 框架条目 ${ourLedger.entries.length} · 报告轮次 外部 ${extRounds.length} / 框架 ${ourRounds.size}`)
  const byKind = {}
  for (const c of changes) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
  if (changes.length) {
    console.log(`\n  同步变更 ${changes.length} 项：`)
    for (const [k, n] of Object.entries(byKind)) console.log(`    · ${k}：${n}`)
    for (const c of changes.filter((x) => x.kind !== 'note').slice(0, 12)) {
      console.log(`      - [${c.kind}] ${c.id ?? ''} ${c.field ? c.field + ': ' : ''}${c.detail ?? `${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`}`)
    }
  }
  if (conflicts.length) {
    console.log(`\n  ⚠ ${conflicts.length} 处冲突（两边对同一字段给了不同值，需人工裁决）：`)
    for (const c of conflicts) console.log(`    · ${c.id}.${c.field}：外部=${JSON.stringify(c.external)} / 框架=${JSON.stringify(c.framework)}`)
  } else {
    console.log('\n  ✅ 无字段冲突')
  }
}

if (!CHECK) {
  fs.writeFileSync(OUR_LEDGER, JSON.stringify(ourLedger, null, 2) + '\n')
  console.log('\n  ✓ 已写入框架台账 docs/外部报告台账.json')
  if (missingRounds.length) console.log('  ⚠ 报告小节需人工合并（脚本不自动拼接报告正文，避免破坏你的追加历史）')
}

process.exitCode = conflicts.length || (CHECK && changes.filter((c) => c.kind !== 'note').length) ? 1 : 0
