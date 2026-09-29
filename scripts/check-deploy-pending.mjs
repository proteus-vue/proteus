#!/usr/bin/env node
// scripts/check-deploy-pending.mjs —— ★「含官网改动 ≠ 官网已上线」门禁（2026-09-29 用户指出）
//
// 【背景（用户原话：「我注意到官网没有做发布推送，发布推送用deploy标记才能触发Github Pages部署」）】
//   .github/workflows/pages.yml 的**触发门**规定：push 到 main 时，
//   **只有 HEAD 提交消息含 `[deploy]` 才真部署**；否则整条 run 只显示 success、
//   所有 step 全 skipped（极易被误读为"已部署"）。
//   实测：上次真部署 e6c5c565（2026-09-27）之后累计 **199 个提交**
//   （含 Vapor 更新路径 / Rust 排版核心 / Vue 兼容性三页官网内容）**全部无标记**
//   ⇒ 线上依旧是旧版。与「提交 ≠ 交付」（check:pushed）**同源**：
//   本地门禁全绿、git status 也不报错——**没有任何机制会提醒"官网还没上线"**。
//
// 【两种模式（与 check-pushed 刻意对齐，避免误伤）】
//   · 默认（**提醒**）：列出「上次 [deploy] 之后改动了 website/ 的提交」，**退出码恒 0**
//     —— 接进 `pnpm verify`，因为 verify 通常跑在收尾之前，那时有未上线内容属**正常状态**。
//   · `--require`（**判据**）：存在未上线内容 ⇒ **退出码 1** —— 供发布收尾显式调用。
//
// 【边界（诚实）】本门禁只看**本地 git 历史**，不知道远端 run 是否成功
//   （部署失败 / 被后续 push 取消都看不见）⇒ 它是"**该触发部署**"的提醒，
//   **不是"已上线"的证明**。真上线证据 = pages.yml 的「部署后核验」（verify-live 产物 hash）
//   + 本机 `pnpm check:live`。
//
// 用法：
//   node scripts/check-deploy-pending.mjs            # 提醒（exit 0）
//   node scripts/check-deploy-pending.mjs --require  # 强制（未上线则 exit 1）
//   pnpm check:deploy-pending / pnpm check:deploy-pending:strict

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

// ── 前置：是否在 git 仓库 ──
const inside = git(['rev-parse', '--is-inside-work-tree'])
if (inside === null || inside.trim() !== 'true') {
  console.log('[check-deploy-pending] 非 git 仓库 —— 跳过')
  process.exit(0)
}

// ── 找最近一次真部署的触发提交（HEAD 祖先中消息含 [deploy] 的那条）──
//   ★--fixed-strings：`[deploy]` 按字面匹配（否则 [deploy] 是字符类正则）
const marker = git(['log', '--format=%H', '-1', '--fixed-strings', '--grep=[deploy]', 'HEAD'])
const markerHash = marker ? marker.trim() : ''
// 范围：marker 之后……没有 marker 时看全部历史（从未部署过）。★据本地 HEAD 历史，不 fetch。
const range = markerHash ? `${markerHash}..HEAD` : 'HEAD'

/** 该范围内改动了官网构建输入（website/**）的提交 */
const pending = git(['log', '--oneline', range, '--', 'website/'])
const pendingCommits = pending ? pending.trim().split('\n').filter(Boolean) : []

if (pendingCommits.length === 0) {
  const at = markerHash
    ? `最后 [deploy] 提交 ${markerHash.slice(0, 8)}（${(git(['log', '-1', '--format=%cs', markerHash]) ?? '').trim()}）之后`
    : '（HEAD 历史里未找到 [deploy] 标记，且）全部历史中'
  console.log(`[check-deploy-pending] ✅ website/ 无待上线改动：${at} website/** 零提交`)
  console.log('  ★上线与否以现场证据为准：pages.yml 的「部署后核验」或本机 `pnpm check:live`')
  process.exit(0)
}

// ── 有未上线内容：统计 + 报告 ──
const filesOut = git(['diff', '--name-only', '--no-renames', range, '--', 'website/'])
const files = filesOut ? filesOut.trim().split('\n').filter(Boolean) : []
const markerDesc = markerHash
  ? `${markerHash.slice(0, 8)} ${(git(['log', '-1', '--format=%s', markerHash]) ?? '').trim()}（${(git(['log', '-1', '--format=%cs', markerHash]) ?? '').trim()}）`
  : '（无——本仓库 HEAD 历史里从未出现过 [deploy] 提交）'

const lines = [
  `[check-deploy-pending] ${REQUIRE ? '✗' : '⚠'} 官网**可能尚未上线**——[deploy] 之后 website/ 有改动：`,
  `  · 最后 [deploy] 提交：${markerDesc}`,
  `  · 之后改动 website/ 的提交：**${pendingCommits.length}** 个（涉及文件 ${files.length} 个）`,
]
for (const l of pendingCommits.slice(0, 5)) lines.push(`      ${l}`)
if (pendingCommits.length > 5) lines.push(`      …（共 ${pendingCommits.length} 条）`)
lines.push('  ⇒ 触发部署（三选一）：')
lines.push('    1) 收尾推一个带标记的空提交：git commit --allow-empty -m "chore(deploy): 触发官网部署 [deploy]"')
lines.push('    2) 或把 [deploy] 写进本轮**最后一个**提交的消息里')
lines.push('    3) 或在 GitHub Actions 手动 workflow_dispatch（等效）')
lines.push('  ★部署提交推上去后**不要再 push**：同 concurrency group 的 run 会被后续 push 取消')
lines.push('    （判别真假看 job steps 是否真 ran，不看 run conclusion）。')
lines.push('  ★上线证据：pages.yml 的「部署后核验」（verify-live 产物 hash）或本机 `pnpm check:live`。')
console.log(lines.join('\n'))

// ★默认模式**不判红**：verify 跑在收尾之前，那时 website/ 有未上线改动属正常状态。
process.exit(REQUIRE ? 1 : 0)
