#!/usr/bin/env node
// scripts/hooks/deny-sleep.mjs —— ★PreToolUse 拦截：禁止**任何** sleep 盲等
//
// 【v1 历史（2026-09-27 立）】用户三次反馈「说了要总结规则，结果照样敲 sleep 30/100/150」⇒
//   把「等待必须有条件」做成工具层拦截。v1 只拦 `sleep ≥ 5s`（<5s 容忍）。
//
// 【v2 收紧（2026-09-30，用户点名）】原话：「禁止任何情况下的 sleep」——当日实测 v1 的**三重盲区**：
//   ① 阈值盲区：`sleep 2/3/4` 全部放行（脚本里最常见的恰是这些）；
//   ② 字面量盲区：hook 只看**命令字面量** —— `bash hosts/ios/run-selfdraw.sh` 这条命令
//      「看起来没有 sleep」，而**脚本内部**的等待循环里 sleep 了 600 秒
//      （当日实测：一次 iOS 测试 11 分钟里有 10 分钟是脚本内部盲等，而且等的是一个
//       **永远不可能满足**的判据）。⇒ 脚本内部的盲等由静态门禁 `pnpm check:no-blind-wait` 管，
//      本 hook 与它是**一个整体**（与 sleep/tests/verify 三条线的接线纪律同源）。
//   ③ 形态盲区：v1 的理念容忍「带超时的轮询」——用户已收紧：**轮询不是首选**。
//
// 【v2 判据】命令字面量里出现**命令位置**的 `sleep`（任意时长，包括 sleep 1）⇒ 拒绝；
//   `timeout <秒> ...`（coreutils 命令形态）⇒ 拒绝。
//
// 【两条合法形态（用户明示）】
//   ① **让 App 主动上报**（首选）：等进程退出 / 读管道 / 读事件流 —— 完成信号由被测对象发出。
//      本仓实例：iOS 宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ `devicectl --console` 的返回即完成。
//   ② **有条件等待**：`bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --cmd/--file/--http`
//      （有界轮询，repo 内**唯一**允许含 sleep 的原语，见 check:no-blind-wait 白名单）。
//   ③ 长任务 ⇒ **后台异步执行**（run_in_background），不得前台阻塞任何人。
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

/** 命令位置的 `sleep`：行首 / 分隔符后 / `do|then|else` 后 / **任意空白后**（任意时长，全覆盖） */
const SLEEP_RE = /(?:^|[;&|(]|\s)\s*sleep\b/g
/** coreutils `timeout <秒> …` 命令形态（不拦 `--timeout` 这类有界等待 flag——那是 wait_for.sh 的合法用法） */
const TIMEOUT_RE = /(?:^|[;&|(]|\s)\s*timeout\s+\d/g

const sleepHits = [...command.matchAll(SLEEP_RE)].map((m) => m[0].trim())
const timeoutHits = [...command.matchAll(TIMEOUT_RE)].map((m) => m[0].trim())

if (sleepHits.length === 0 && timeoutHits.length === 0) process.exit(0)

const what = [
  sleepHits.length ? `sleep（${sleepHits.length} 处，任意时长，含 <5s 不再放行）` : '',
  timeoutHits.length ? `timeout 命令（${timeoutHits.length} 处）` : '',
]
  .filter(Boolean)
  .join(' + ')

const reason = [
  `⛔ 盲等被拦截：检测到 ${what}。`,
  '2026-09-30 用户红线：「禁止任何情况下的 sleep / timeout，要么让 App 主动上报，要么有条件等待」。',
  '替代做法（按场景选一，优先级从高到低）：',
  '  ① **让被测对象主动上报**（首选）：等进程退出（`devicectl --console` + 宿主 `PROTEUS_EXIT_AFTER_REPORT=1`）、读管道/事件流 —— 完成信号由 App 发出，零轮询；',
  '  ② **有条件等待**：`bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --cmd/--file/--http`（有界、可归因；repo 内唯一允许含 sleep 的原语）；',
  '  ③ 长任务 → **后台异步执行**（run_in_background），不要把任何人卡在等待里；',
  '  ④ 无法机器判定（等 CI 队列等）→ 告诉用户「已触发，请刷新查看」，由用户目视验收。',
  '注：本 hook 只看命令字面量；**脚本内部的 sleep** 由 `pnpm check:no-blind-wait` 静态门禁管辖（两道是同一道红线）。',
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
