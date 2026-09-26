#!/usr/bin/env node
// scripts/hooks/deny-sleep.mjs —— ★PreToolUse 拦截：禁止用固定 sleep 盲等（2026-09-27）
//
// 背景（用户三次反馈）：AI 每次说「已总结规则」，但实际执行时**照样敲 sleep 30/100/150 秒**等部署。
// 根因：规则写在 markdown 里是「文档」，拦不住当下的动作——只有工具调用层的拦截才是结构性的。
// 本 hook 把 .agents/skills/ai-efficiency-rules 的「等待必须有条件」变成**可执行的门禁**。
//
// 判据：Bash 命令里出现 `sleep <N>` 且 N ≥ 5 秒 → 拒绝（exit 2 + 原因）。
//   · N < 5（如 sleep 1/2）放行：短等待容忍（避免误伤合理的最小间隔）
//   · 命令里出现 sleep 但目标不是盲等部署（如脚本调试）→ 同样拒绝并给出替代方案
// 替代方案（拒绝原因里给出）：
//   ① 部署核验 → `pnpm check:live`（仓库自带，带 CDN 重试）**一次**，不要自行轮询
//   ② 等条件就绪 → bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --http ...
//   ③ 都无法判定 → 直接告诉用户「已部署，请刷新查看」，由用户目视验收
import { stdin } from 'node:process'

const raw = await new Promise((resolve) => {
  let buf = ''
  stdin.setEncoding('utf8')
  stdin.on('data', (c) => (buf += c))
  stdin.on('end', () => resolve(buf))
})

let payload = {}
try {
  payload = JSON.parse(raw || '{}')
} catch {
  process.exit(0) // 输入异常 → 放行（不因 hook 自身问题阻断会话）
}

const toolName = payload.tool_name ?? payload.toolName ?? ''
if (toolName !== 'Bash') process.exit(0)

const input = payload.tool_input ?? payload.toolInput ?? {}
const command = typeof input.command === 'string' ? input.command : ''
if (!command) process.exit(0)

/** 匹配 `sleep <秒数>`：含小数（sleep 0.5）、含单位后缀（sleep 30s） */
const SLEEP_RE = /(?:^|[;&|(]|\s)sleep\s+(\d+(?:\.\d+)?)s?\b/g
const hits = []
for (const m of command.matchAll(SLEEP_RE)) {
  const secs = Number.parseFloat(m[1])
  if (Number.isFinite(secs) && secs >= 5) hits.push(secs)
}

if (hits.length === 0) process.exit(0)

const reason = [
  `⛔ 固定 sleep 盲等被拦截（检测到 sleep ${hits.join('s / ')}s ≥ 5s）。`,
  '项目规范《AI 执行效率规范》第 2 条：等待必须有条件、获取必须有缓存、重复必须有上限。',
  '替代做法（按场景选一）：',
  '  ① 部署/线上核验 → 跑一次 `pnpm check:live`（仓库自带 verify-live.mjs，带 CDN 传播重试），不要自行 for+sleep 轮询；',
  '  ② 等端口/服务/文件就绪 → `bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --http <url> --timeout 90`；',
  '  ③ 两者都不适用（如等 CI 队列）→ **直接告诉用户「已触发，请刷新查看」**，由用户目视验收 —— 用户检查比 AI 轮询快。',
  '若确需短等待（<5s，如让 shell 输出刷完），可重试；本拦截只针对 ≥5s 的盲等。',
].join('\n')

// PreToolUse 的 deny 决策（严格 schema：只带已识别键）
process.stdout.write(
  JSON.stringify({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  }),
)
process.exit(0)
