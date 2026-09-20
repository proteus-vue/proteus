#!/usr/bin/env node
// scripts/ledger-check.mjs —— 外部报告台账 · 对账与校验（零依赖，Node ≥ 18）
//
// 背景：外部实战报告（OPERATOR/web）提出的问题，修复与验证状态此前散落在
//   PROJECT_MEMORY 与回执段落里，是**散文**——无法机器核对「报 N 修 M」。
//   最直接的教训：某轮报告指出「一个 bug 有三条路径」，修了其中一条，
//   没有任何机制能发现「报 3 修 1」，靠下一轮外部复测才撞出来。
//
// 本脚本回答一个问题：**报了 N 条，真正收口了几条？**
//
// 收口（resolved）判据 —— 三件事同时成立：
//   status=fixed 且 fix_state=published 且 verification=passed
//   · 只改对了（fixed）但仅在工作树（worktree）→ npm 用户拿不到，不算收口
//   · 已发布但没人独立复测（verification≠passed）→ 不知道真的好了没有，不算收口
//
// 用法：
//   node scripts/ledger-check.mjs              # 对账（报告模式，恒退出 0）
//   node scripts/ledger-check.mjs --check      # 有未收口项 → 退出 1（可挂发布前 / CI）
//   node scripts/ledger-check.mjs --json       # 机器可读输出
//   node scripts/ledger-check.mjs --file <path>  # 指定台账（默认 docs/外部报告台账.json）
//
// 退出码：0 通过 / 1 存在未收口项（仅 --check）/ 2 台账本身不合格（schema 错）
//
// 台账 schema 见 docs/外部报告台账.json 的 schema 字段（自描述）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_LEDGER = path.join(HERE, '..', 'docs', '外部报告台账.json')

const ALLOWED = {
  kind: new Set(['packaging', 'cli', 'compiler', 'runtime', 'router', 'release', 'process', 'docs']),
  severity: new Set(['blocker', 'major', 'minor']),
  status: new Set(['open', 'fixed', 'partial', 'by_design']),
  fix_state: new Set(['published', 'worktree']),
  verification: new Set(['passed', 'partial', 'unverified', 'failed', 'n_a']),
  found_by: new Set(['external', 'framework']),
}
const REQUIRED = ['id', 'title', 'kind', 'severity', 'round', 'reported_in', 'found_by', 'status', 'verification', 'evidence', 'repro']

/** 版本号 → 可比较元组；解析不了返回 null。正式版排在同号 pre 之后。 */
function parseVer (v) {
  if (!v) return null
  const s = String(v).trim()
  let base = s
  let pre = 1e9
  const dash = s.indexOf('-')
  if (dash >= 0) {
    base = s.slice(0, dash)
    const tail = s.slice(dash + 1).split('.').pop()
    pre = /^\d+$/.test(tail) ? Number(tail) : 1e6
  }
  const parts = base.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : 0))
  while (parts.length < 3) parts.push(0)
  return [parts[0], parts[1], parts[2], pre]
}
function cmpVer (a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** schema 校验：返回问题列表（空 = 合格）。 */
function validate (entries, published) {
  const errs = []
  const seen = new Set()
  const pub = parseVer(published)
  for (const e of entries) {
    const id = e.id ?? '?'
    for (const k of REQUIRED) {
      if (e[k] === undefined || e[k] === null || e[k] === '') errs.push(`${id}: 缺必填字段 ${k}`)
    }
    if (seen.has(id)) errs.push(`${id}: id 重复（对账锚点必须唯一）`)
    seen.add(id)
    for (const [k, allowed] of Object.entries(ALLOWED)) {
      const v = e[k]
      if (v !== undefined && v !== null && !allowed.has(v)) {
        errs.push(`${id}: ${k}=${JSON.stringify(v)} 不在允许集合 [${[...allowed].sort().join(', ')}]`)
      }
    }
    if (e.severity === 'blocker' && !e.repro) errs.push(`${id}: blocker 必须带最小复现（没有复现就无法复核）`)
    if (e.status === 'fixed' && !ALLOWED.fix_state.has(e.fix_state)) {
      errs.push(`${id}: status=fixed 必须给 fix_state（published/worktree）`)
    }
    if (e.fix_state === 'published') {
      if (!e.fixed_in) errs.push(`${id}: fix_state=published 必须给 fixed_in 版本号`)
      else if (pub && parseVer(e.fixed_in) && cmpVer(parseVer(e.fixed_in), pub) > 0) {
        errs.push(`${id}: fixed_in=${e.fixed_in} 比最后已验版本 ${published} 更新——若其实只在工作树，fix_state 应为 worktree`)
      }
    }
    if (e.status === 'partial' && !(e.related && e.related.length)) {
      errs.push(`${id}: status=partial 必须带 related 指向跟踪条目（防「修一半当修完」）`)
    }
  }
  return errs
}

/** 对账：分桶 + 统计。 */
function reconcile (entries) {
  const b = { resolved: [], unreleased: [], unverified: [], partial: [], open: [], by_design: [] }
  for (const e of entries) {
    if (e.status === 'by_design') b.by_design.push(e)
    else if (e.status === 'open') b.open.push(e)
    else if (e.status === 'partial') b.partial.push(e)
    else if (e.status === 'fixed' && e.fix_state === 'worktree') b.unreleased.push(e)
    else if (e.status === 'fixed' && e.verification !== 'passed') b.unverified.push(e)
    else b.resolved.push(e)
  }
  return b
}

function main () {
  const args = process.argv.slice(2)
  const wantCheck = args.includes('--check')
  const wantJson = args.includes('--json')
  const fi = args.indexOf('--file')
  const ledgerPath = fi >= 0 && args[fi + 1] ? args[fi + 1] : DEFAULT_LEDGER

  if (!fs.existsSync(ledgerPath)) {
    console.error(`✗ 找不到台账：${ledgerPath}`)
    return 2
  }
  const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  const entries = data.entries ?? []
  const published = data.last_verified_published

  const errs = validate(entries, published)
  const b = reconcile(entries)
  const total = entries.length
  const nRes = b.resolved.length
  const sev = {}
  for (const e of entries) sev[e.severity] = (sev[e.severity] ?? 0) + 1

  if (wantJson) {
    console.log(JSON.stringify({
      ledger: ledgerPath,
      last_verified_published: published,
      total,
      resolved: nRes,
      unreleased: b.unreleased.length,
      unverified: b.unverified.length,
      partial: b.partial.length,
      open: b.open.length,
      by_design: b.by_design.length,
      schema_errors: errs,
      items: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map((e) => e.id)])),
    }, null, 2))
  } else {
    const ids = (arr) => (arr.length ? '  → ' + arr.map((e) => e.id).join(', ') : '')
    console.log(`外部报告台账对账 · ${data.project ?? ''}`)
    console.log(`  依据报告：${data.report ?? '—'}`)
    console.log(`  最后已验版本：${published}（${data.last_verified_at ?? '?'}）`)
    console.log('')
    console.log(`报 ${total} 条（blocker ${sev.blocker ?? 0} / major ${sev.major ?? 0} / minor ${sev.minor ?? 0}）`)
    console.log(`  ✅ 收口（fixed+published+独立复测通过）：${nRes}`)
    console.log(`  🟡 已修未发布（仅工作树）：${b.unreleased.length}${ids(b.unreleased)}`)
    console.log(`  🟡 已修但验证不充分：${b.unverified.length}${ids(b.unverified)}`)
    console.log(`  🟠 部分修复（未收口）：${b.partial.length}${ids(b.partial)}`)
    console.log(`  🔴 未修：${b.open.length}${ids(b.open)}`)
    if (b.by_design.length) console.log(`  ⚪ 设计如此：${b.by_design.length}`)
    console.log('')
    console.log(`  ★ 真实收口率：${nRes}/${total} = ${total ? Math.round((nRes / total) * 100) : 0}%（分母含未发布与部分修复——只算「用户拿得到且被独立验证过」的）`)
    // ★诚实分层（2026-09-20 加）：把「使用方独立复测」与「框架方自证」分开报——
    //   两者都算收口，但强度不同；混成一个 100% 会变成自欺（规范第 4 节「独立验证的判定」）。
    const resItems = b.resolved
    const ext = resItems.filter((e) => e.verified_by === 'external').length
    const fw = resItems.filter((e) => e.verified_by === 'framework').length
    const other = resItems.length - ext - fw
    if (resItems.length) {
      console.log(`     · 验证强度分层：使用方独立复测（external）${ext} 条 · 框架方自证（framework）${fw} 条${other ? ` · 未标注 ${other} 条` : ''}`)
      if (fw) {
        const pend = resItems.filter((e) => e.verified_by === 'framework').map((e) => e.id).join(', ')
        console.log(`       —— framework 档待使用方复测升级为 external：${pend}`)
      }
      if (other) console.log(`       ⚠ 有 ${other} 条未标 verified_by（规范要求 verification=passed 时必须标明谁验的）`)
    }
    for (const e of b.unreleased) console.log(`     · ${e.id} ${e.title}`)
    for (const e of b.partial) console.log(`     · ${e.id} ${e.title}（related: ${(e.related ?? []).join(', ')}）`)
    for (const e of b.unverified) console.log(`     · ${e.id} ${e.title}（${e.verification_note ?? ''}）`)
    if (errs.length) {
      console.log('')
      console.log('⚠️ 台账 schema 问题：')
      for (const x of errs) console.log(`   · ${x}`)
    }
  }

  if (errs.length) return 2
  if (wantCheck && (b.open.length || b.unreleased.length || b.partial.length || b.unverified.length)) {
    if (!wantJson) console.log('\n--check：存在未收口项 → 退出 1')
    return 1
  }
  return 0
}

process.exitCode = main()
