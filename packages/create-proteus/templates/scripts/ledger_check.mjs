#!/usr/bin/env node
// scripts/ledger_check.mjs —— 框架问题台账 · 对账与校验（零依赖，Node >= 18）
// 由 \`proteus cobuild init\` 生成（规范源：@proteus-vue/cli 的 cobuild-assets）。
// 收口判据：status=fixed 且 fix_state=published 且 verification=passed——三者缺一不算收口。
// 用法：node scripts/ledger_check.mjs [--check] [--json] [--file <path>]
// 退出码：0 通过 / 1 存在未收口项（仅 --check）/ 2 台账本身不合格
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_LEDGER = path.join(HERE, '..', 'docs', '框架问题台账.json')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')
const fi = argv.indexOf('--file')
const LEDGER = fi >= 0 && argv[fi + 1] ? path.resolve(argv[fi + 1]) : DEFAULT_LEDGER

const ALLOWED = {
  kind: new Set(['packaging', 'cli', 'compiler', 'runtime', 'router', 'release', 'process', 'docs']),
  severity: new Set(['blocker', 'major', 'minor']),
  status: new Set(['open', 'fixed', 'partial', 'by_design']),
  fix_state: new Set(['published', 'worktree']),
  verification: new Set(['passed', 'partial', 'unverified', 'failed', 'n_a']),
  found_by: new Set(['external', 'framework']),
}
const REQUIRED = ['id', 'title', 'kind', 'severity', 'round', 'reported_in', 'found_by', 'status', 'verification', 'evidence', 'repro']

if (!fs.existsSync(LEDGER)) {
  console.error('✗ 找不到台账：' + LEDGER + '（先跑 proteus cobuild init）')
  process.exit(2)
}
let data
try {
  data = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
} catch (e) {
  console.error('✗ 台账 JSON 解析失败：' + e.message)
  process.exit(2)
}
const entries = data.entries ?? []

const errs = []
const seen = new Set()
for (const e of entries) {
  const id = e.id ?? '(无 id)'
  for (const k of REQUIRED) if (e[k] === undefined || e[k] === null || e[k] === '') errs.push(id + ': 缺必填字段 ' + k)
  if (seen.has(id)) errs.push(id + ': id 重复（对账锚点必须唯一）')
  seen.add(id)
  for (const [k, allowed] of Object.entries(ALLOWED)) {
    if (e[k] !== undefined && e[k] !== null && !allowed.has(e[k])) errs.push(id + ': ' + k + '=' + JSON.stringify(e[k]) + ' 不在允许集合')
  }
  if (e.severity === 'blocker' && !e.repro) errs.push(id + ': blocker 必须带最小复现')
  if (e.status === 'fixed' && !['published', 'worktree'].includes(e.fix_state)) errs.push(id + ': status=fixed 必须给 fix_state')
  if (e.status === 'partial' && !(e.related && e.related.length)) errs.push(id + ': status=partial 必须带 related 指向跟踪条目')
}

const b = { resolved: [], unreleased: [], unverified: [], partial: [], open: [] }
for (const e of entries) {
  if (e.status === 'by_design') continue
  else if (e.status === 'open') b.open.push(e)
  else if (e.status === 'partial') b.partial.push(e)
  else if (e.status === 'fixed' && e.fix_state === 'worktree') b.unreleased.push(e)
  else if (e.status === 'fixed' && e.verification !== 'passed') b.unverified.push(e)
  else b.resolved.push(e)
}
const total = entries.length
const nRes = b.resolved.length

if (JSON_OUT) {
  console.log(JSON.stringify({ ledger: LEDGER, total, resolved: nRes, schema_errors: errs, unreleased: b.unreleased.map((e) => e.id), unverified: b.unverified.map((e) => e.id), partial: b.partial.map((e) => e.id), open: b.open.map((e) => e.id) }, null, 2))
} else {
  console.log('框架问题台账对账 · ' + (data.project ?? ''))
  console.log('  报 ' + total + ' 条')
  console.log('  ✅ 收口（fixed + published + 独立复测通过）：' + nRes)
  if (b.unreleased.length) console.log('  🟡 已修未发布（仅工作树）：' + b.unreleased.length + '  → ' + b.unreleased.map((e) => e.id).join(', '))
  if (b.unverified.length) console.log('  🟡 已修但验证不充分：' + b.unverified.length + '  → ' + b.unverified.map((e) => e.id).join(', '))
  if (b.partial.length) console.log('  🟠 部分修复：' + b.partial.length + '  → ' + b.partial.map((e) => e.id).join(', '))
  if (b.open.length) console.log('  🔴 未修：' + b.open.length + '  → ' + b.open.map((e) => e.id).join(', '))
  console.log('  ★ 真实收口率：' + nRes + '/' + total + '（只算"用户拿得到且被独立验证过"的）')
  if (errs.length) {
    console.log('')
    console.log('⚠️ 台账 schema 问题：')
    for (const x of errs) console.log('   · ' + x)
  }
}
if (errs.length) process.exit(2)
if (CHECK && (b.open.length || b.unreleased.length || b.partial.length || b.unverified.length)) {
  if (!JSON_OUT) console.log('\n--check：存在未收口项 → 退出 1')
  process.exit(1)
}
process.exit(0)
