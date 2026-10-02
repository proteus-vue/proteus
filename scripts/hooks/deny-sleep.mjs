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

/**
 * ★★文本剥离（2026-10-02 修复**误报**——hook 修好后第一次真拦，拦到的却是 `git commit`）：
 *
 * 【误报形态（本仓几乎每轮提交都命中）】commit message 里必然大量出现 "sleep" 字样
 *   （「零轮询/零 sleep」「禁止 sleep」…是这套纪律的日常表述）⇒ 原判据在**命令字面量**里
 *   裸匹配 ` sleep` ⇒ 把「讨论 sleep 的文本」当成「执行 sleep 的命令」拒掉。
 *   自测命令（`printf '…"sleep 1"…' | node deny-sleep.mjs`）同理。
 *
 * 【修法】区分「文本」与「命令」：
 *   ① `git commit`：整个消息是文本（永不执行）⇒ **整条命令豁免**（引号+heredoc 都是消息体）；
 *   ② 其余命令：剥掉单/双引号内的文本与 heredoc 内容后，在**裸命令**上匹配；
 *   ③ 补一条**镜像检查**：`sh -c "…"` / `bash -c '…'` 的引号串是**要执行的命令**
 *      ⇒ 对 `-c` 引号串内容单独跑一遍 SLEEP_RE（防止"剥文本"把真正的执行形态一起剥掉）。
 *
 * 【边界（如实）】heredoc **非 commit** 场景（`cat > x.sh <<EOF … sleep … EOF`）剥离后放行——
 *   该形态由静态门禁 `check:no-blind-wait` 管（写进脚本文件的 sleep 正是它扫描面）；
 *   hook 与它分工：hook 拦**直接命令**，静态门禁拦**脚本内容**（AGENTS.md 已写明）。
 */
function stripQuotedText(s) {
  return s
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}
function stripHeredocBodies(s) {
  const lines = s.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    out.push(line)
    const m = /<<-?\s*(?:['"]([A-Za-z_][A-Za-z0-9_]*)['"]|([A-Za-z_][A-Za-z0-9_]*))/.exec(line)
    if (!m) continue
    const word = m[1] ?? m[2]
    // 跳过内容直到终止行（终止行保留——它可能带分隔符，如 `EOF)`）
    i++
    while (i < lines.length && (lines[i] ?? '').trim() !== word) { out.push(''); i++ }
    if (i < lines.length) out.push(lines[i] ?? '')
  }
  return out.join('\n')
}

/** `git commit …`：整条豁免（消息体是文本） */
const IS_COMMIT_RE = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*git\s+commit\b/

let sleepHits = []
let timeoutHits = []
if (!IS_COMMIT_RE.test(command)) {
  const bare = stripHeredocBodies(stripQuotedText(command))
  sleepHits = [...bare.matchAll(SLEEP_RE)].map((m) => m[0].trim())
  timeoutHits = [...bare.matchAll(TIMEOUT_RE)].map((m) => m[0].trim())
  // ③ 镜像检查：`-c "…"` 引号串内容是**要执行的命令**（不因剥文本而漏网）
  for (const m of command.matchAll(/-c\s*(['"])([\s\S]*?)\1/g)) {
    const inner = m[2] ?? ''
    if (SLEEP_RE.test(inner)) sleepHits.push('sh -c 内嵌 sleep')
    if (TIMEOUT_RE.test(inner)) timeoutHits.push('sh -c 内嵌 timeout')
    SLEEP_RE.lastIndex = 0
    TIMEOUT_RE.lastIndex = 0
  }
}

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

// ★★输出契约（2026-10-02 修复——**5 天静默失效的根因**）：
//
// 【为什么放弃 stdout JSON】本脚本原用 Claude 式**扁平** JSON：
//   `{hookEventName:"PreToolUse", permissionDecision:"deny", …}`。
//   而 ZCode 客户端的输出 schema（zcode.cjs 的 `uyr`/`grs`）是**嵌套**的
//   （`hookSpecificOutput.hookEventName` / `.permissionDecision`）且为**严格校验**
//   ——实测证据：本仓三个 hook 自 2026-09-27 立起，**每一次运行都是 `hook.run.failed`**
//   （"Hook stdout failed HookJSONOutput schema validation"），deny 被丢弃 ⇒ sleep 照跑
//   （2026-10-02 会话实测 270 次尝试全部失败、历史零成功；用户点名"钩子就是拦不住"）。
//   ★教训：**自测通过 ≠ 契约成立**——旧自测只看自己 stdout 有 `deny` 就宣布"拦住了"，
//     而消费方（客户端）读的是另一套格式；自测必须对准**消费方的契约**。
//
// 【现契约】`exit 2` + stderr 文本 = 阻止（客户端 `createExitCodeBlockOutput` 直接把
//   stderr 转成 deny 输出——**代码路径、不经 JSON schema** ⇒ 抗格式漂移；官方协议明示
//   "0 passes, 2 blocks"）。0 = 放行；仅在拦截时写 stderr + 退出码 2。
process.stderr.write(reason + '\n')
process.exit(2)
