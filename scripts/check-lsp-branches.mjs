#!/usr/bin/env node
/**
 * check-lsp-branches.mjs —— 检查「脚本回包类型」与「Rust 分发分支」是否对齐（决策 #1447）
 *
 * 【为什么需要】
 *   `diag-lsp.mjs` 用 `out({ t: 'xxx', ... })` 回包，Rust 读线程里逐个 `Some("xxx")` 分发。
 *   两边靠**字符串**配对，漏一个没有编译错误 —— 表现为那边 `recv_timeout` 等满超时才返回，
 *   用户看到的是「一直显示正在分析符号…」（rename 就这么漏过：30s 后才报超时）。
 *
 *   这已经是同类问题的第二次（第一次是 `read_text_external` 漏进 `generate_handler!`），
 *   都是"两边靠字符串配对、编译器管不到"。
 *
 * 规则：脚本里出现的每个 `t`，除**主动推送**（diag/log/ready）外，都必须在 diag.rs 的
 *       `Some("…")` 分支里出现。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const studioDir = join(here, '..', 'packages', 'studio')
const scriptPath = join(studioDir, 'diag-lsp.mjs')
const rustDir = join(studioDir, 'src')

const script = readFileSync(scriptPath, 'utf8')

/* 脚本 → Rust 的回包类型（只认 out({ t: '…' })；`m.t === '…'` 是入站协议，不参与） */
const outTypes = new Set(
  [...script.matchAll(/out\(\s*\{\s*t:\s*'([\w-]+)'/g)].map((m) => m[1]),
)

/* 主动推送：由 Rust 转成 Tauri 事件，不走 id 配对 */
const PUSH = new Set(['diag', 'log', 'ready'])

/* Rust 分发分支里认到的类型 */
const rust = readdirSync(rustDir)
  .filter((f) => f.endsWith('.rs'))
  .map((f) => readFileSync(join(rustDir, f), 'utf8'))
  .join('\n')
const handled = new Set([...rust.matchAll(/Some\("([\w-]+)"\)/g)].map((m) => m[1]))

const missing = [...outTypes].filter((t) => !PUSH.has(t) && !handled.has(t))

if (missing.length) {
  console.error(`✗ 这些回包类型没有任何 Rust 分发分支：${missing.join(', ')}`)
  console.error('  症状：对应命令会一直等到超时才返回（前端表现为"一直显示正在分析…"）。')
  console.error('  修：在 diag.rs 的读线程 match 里加上 `| Some("…")`。')
  process.exit(1)
}

console.log(
  `✓ 回包类型对齐：脚本 ${outTypes.size} 种（其中 ${PUSH.size} 种为主动推送），Rust 分发 ${handled.size} 种`,
)
