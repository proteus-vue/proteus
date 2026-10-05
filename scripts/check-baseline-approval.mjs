#!/usr/bin/env node
// scripts/check-baseline-approval.mjs —— ★★★G-61 B5：**基准变更审批门禁**（plan §6 第 2 行 · D2/D3）
//
// 【它守什么】「基准快照 diff 一旦非空 ⇒ 必须**显式 bump**，提交信息带**批准人与原因**；
//   **匿名变更即门禁红**」。
//
// 【为什么需要（引入基准 = 引入新的可腐败资产）】基准是 `expected` 的唯一来源——若它能被**静静改掉**，
//   那"一致性"就退化成"谁改基准谁赢"：改基准 ⇒ 各端立刻"保持一致"（对着一份被篡改的锚）。
//   ⇒ 基准的**任何字节变化**都必须是一次**可见、可追责**的行为：提交信息里写明：
//     · `[baseline-bump]` 标记（机器可判）
//     · `批准人: <name>`（人工审批留痕）
//     · `原因: <why>`（为什么基准必须变——D3 里"环境变化"或真实设计变更）
//
// 【判据（三段）】
//   ① 变更检测：与 `origin/main` 比，`docs/generated/style-baseline/**` 是否有 diff
//   ② 审批判定：有 diff ⇒ 本轮（HEAD 或工作区）提交信息必须含 `[baseline-bump]` + `批准人:` + `原因:`
//   ③ 记账检测（反向）：无 diff 但提交信息含 `[baseline-bump]` ⇒ 提示（标记滥用/或 diff 被吞）
//   ★CI 侧（detached HEAD）自动跳过（无 origin/main 比对基准 ⇒ 视为"不判定"，打印说明）——**不假绿**。
//
// 【与 `check:baseline-manifest` 的分工】后者查**清单 schema/寻址/指纹**（静态自洽）；
//   本门禁查**变更的合法性**（动态、需 git 历史）。两者互补。
//
// 用法：node scripts/check-baseline-approval.mjs [--require]（--require = 收尾严格模式，无 diff 也判）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_REL = 'docs/generated/style-baseline'
const REQUIRE = process.argv.includes('--require')

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim()
  } catch {
    return null
  }
}

/* 0. CI/无比对基准 ⇒ 不判定（诚实：不假装通过也不误红） */
const hasOrigin = git(['rev-parse', '--verify', 'origin/main']) !== null
if (!hasOrigin) {
  console.log('基准变更审批门禁（G-61 B5 · D2/D3）')
  console.log('  ⓘ 无 origin/main（CI detached HEAD 或浅克隆）——本门禁**不判定**（需 git 历史比对）')
  console.log('    CI 侧由 check:gates-sync 保证本脚本已接线；合法性判定在开发机收尾执行')
  process.exit(0)
}

/* ① 变更检测（工作区 + 相对 origin/main 的已提交变更） */
const committedDiff = git(['diff', '--name-only', 'origin/main...HEAD', '--', BASELINE_REL]) ?? ''
const worktreeDiff = git(['status', '--porcelain', '--', BASELINE_REL]) ?? ''
const changed = [...new Set([...committedDiff.split('\n'), ...worktreeDiff.split('\n')].map((s) => s.replace(/^\s*[A-Z?!]{1,2}\s+/, '').trim()).filter(Boolean))]

/* ② 审批留痕（本轮提交信息：HEAD + 上一提交以覆盖"提交后再改"的情形） */
const logs = [git(['log', '-1', '--format=%B']) ?? '', git(['log', '-1', '--format=%B', 'HEAD~1']) ?? ''].join('\n')
const hasMarker = /\[baseline-bump\]/.test(logs)
const hasApprover = /批准人[:：]\s*\S+/.test(logs)
const hasReason = /原因[:：]\s*\S+/.test(logs)

console.log('基准变更审批门禁（G-61 B5 · D2 冻结 / D3 可复现 + 审批）')
console.log(`  基准目录变更：${changed.length} 个文件${changed.length ? '（' + changed.slice(0, 5).map((f) => path.basename(f)).join(', ') + (changed.length > 5 ? ' …' : '') + '）' : ''}`)

const problems = []
if (changed.length > 0) {
  console.log(`  提交信息标记：[baseline-bump] ${hasMarker ? '✅' : '❌'} · 批准人 ${hasApprover ? '✅' : '❌'} · 原因 ${hasReason ? '✅' : '❌'}`)
  if (!hasMarker) problems.push('基准有变更但提交信息缺 `[baseline-bump]` 标记——**匿名变更即门禁红**（plan §6）')
  if (!hasApprover) problems.push('基准有变更但提交信息缺 `批准人: <name>`（谁批准了这次基准变更）')
  if (!hasReason) problems.push('基准有变更但提交信息缺 `原因: <why>`（环境变化 / 真实设计变更——D3 要求可归因）')
} else if (REQUIRE) {
  console.log('  （无变更——--require 模式下仅提示）')
} else if (hasMarker) {
  console.log('  ⓘ 提交信息含 [baseline-bump] 但基准目录无 diff——标记滥用或 diff 被吞（检查是否漏提交）')
}

if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  console.log('')
  console.log('  正确做法：提交信息形如')
  console.log('    chore(baseline): 重采 superapp 基准（Chromium 升级 151→152） [baseline-bump]')
  console.log('    批准人: <name>')
  console.log('    原因: 浏览器版本升级导致阴影渲染差异（环境指纹同步变更）')
  process.exit(1)
}
console.log('')
console.log(changed.length > 0 ? '✅ 基准变更已审批（标记 + 批准人 + 原因齐备）' : '✅ 基准无变更（D2 冻结成立）')
