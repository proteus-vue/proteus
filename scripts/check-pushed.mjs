#!/usr/bin/env node
// scripts/check-pushed.mjs —— ★★「提交 ≠ 交付」门禁（2026-09-28 用户指出后新增）
//
// 【为什么有这个门禁（一天 111 个提交没推送）】
//   用户原话：「我刚才看了下发现今天的改动都没推送啊，全都是提交了没推送」。
//   复盘：AI 每轮都跑了 §2 的本地门禁、写了详细 commit message，**唯独漏了 push**
//   ⇒ 从用户视角，一整天的产出**不存在**（远端一条都没有）。
//
// 【为什么本地门禁拦不住】`pnpm test` / `check:*` / `verify` 全是**本地**检查，
//   `git status -sb` 的 `ahead N` 也不报错 ⇒ 没有任何机制会提醒"还没推"。
//   与「sleep 盲等」「全量重复跑」同源：**这类遗漏只有工具/流程层能兜住**
//   （本仓已实测：规则写在 markdown 里拦不住当下的动作）。
//
// 【两种模式（刻意区分，避免误伤）】
//   · 默认（**提醒**）：打印 `ahead/behind`，**退出码恒 0** —— 接进 `pnpm verify`，
//     因为 verify 通常跑在「提交之前」，那时 ahead>0 是**正常状态**，不该判红。
//   · `--require`（**判据**）：ahead>0 或 behind>0 ⇒ **退出码 1** —— 供收尾/CI 强制。
//     ★behind>0 也算失败：落后时推送会被拒或产生意外的合并，必须先显式处理。
//
// 用法：
//   node scripts/check-pushed.mjs            # 提醒（exit 0）
//   node scripts/check-pushed.mjs --require   # 强制（未推则 exit 1）
//   pnpm check:pushed / pnpm check:pushed:strict

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRE = process.argv.includes('--require')

/** 跑一条 git 命令并返回 stdout（失败返回 null——不因门禁自身问题中断流程） */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// ── 前置：是否在 git 仓库 / 有没有远端 ──
const inside = git(['rev-parse', '--is-inside-work-tree'])
if (inside === null || inside.trim() !== 'true') {
  console.log('[check-pushed] 非 git 仓库 —— 跳过')
  process.exit(0)
}
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
if (upstream === null) {
  // 没有上游（新分支）⇒ 提示但不判红（首次推送属显式动作）
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim()
  console.log(`[check-pushed] ⚠ 分支 ${branch} 未设置上游 ⇒ 无法判断是否已推送（首次推送：git push -u origin ${branch}）`)
  process.exit(REQUIRE ? 1 : 0)
}
const up = upstream.trim()

// ── 抓取远端状态 ──
// ★不 fetch（避免门禁引入网络等待——本仓纪律：等待必须有条件/有上限）；
//   用本地记录的远端引用计算，**可能落后于真实远端**，故措辞用"据本地记录"。
const counts = git(['rev-list', '--left-right', '--count', `${up}...HEAD`])
if (counts === null) {
  console.log(`[check-pushed] ⚠ 无法计算与 ${up} 的差异 —— 跳过`)
  process.exit(0)
}
const [behindStr, aheadStr] = counts.trim().split(/\s+/)
const behind = Number.parseInt(behindStr ?? '0', 10) || 0
const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0

/** `ahead 3`（分支行右半部分） */
const branchLine = git(['status', '-sb'])
const curBranch = branchLine ? branchLine.split('\n')[0] : ''

if (ahead === 0 && behind === 0) {
  console.log(`[check-pushed] ✅ 已推送（${up}）—— 本地与远端一致`)
  process.exit(0)
}

const lines = [`[check-pushed] ${REQUIRE ? '✗' : '⚠'} 本地有**未推送**的提交（据本地记录，未 fetch）：`]
if (ahead > 0) {
  lines.push(`  · 领先 origin 方向 **${ahead}** 个提交 —— 这些成果**远端不存在**`)
  // 列出最近几条（帮读者立刻确认"是不是我以为已推的那些"）
  const recent = git(['log', '--oneline', '-5', `${up}..HEAD`])
  if (recent) for (const l of recent.trim().split('\n')) lines.push(`      ${l}`)
  if (ahead > 5) lines.push(`      …（共 ${ahead} 条）`)
}
if (behind > 0) {
  lines.push(`  · 落后 ${up} **${behind}** 个提交 ⇒ 直接推会被拒/或产生意外合并，**先 fetch 再显式处理**`)
}
lines.push(`  当前分支行：${curBranch}`)
lines.push('  收尾（三段缺一不可）：')
lines.push('    1) git status -sb           # 看 ahead N（N>0 即未交付）')
lines.push('    2) git fetch && git push origin <branch>')
lines.push('    3) git status -sb           # 再确认无 ahead（"我推了"≠"推上去了"）')
console.log(lines.join('\n'))

// ★默认模式**不判红**：verify 跑在提交之前，那时 ahead>0 是正常状态。
process.exit(REQUIRE ? 1 : 0)
