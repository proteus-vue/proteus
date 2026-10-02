#!/usr/bin/env node
// scripts/hooks/deny-blind-verify.mjs —— ★PreToolUse 拦截：**全量门禁链**不得"同状态重复跑"
//
// 【背景（用户原话，2026-09-29）】「我发现我提了很多次的低效率问题一直都没有贯彻下去」。
//
// 【这一小时的真实账（如实记录，这是本 hook 存在的理由）】AI 在**没有任何新改动**的情况下
//   把 `pnpm verify` 整链跑了 **4 次**（每次约 10 分钟 = 40 分钟），其中：
//     · 第 1 次：Node 18 下必然假红（jsdom 27 是 ESM-only，本仓记忆里写着要用 Node ≥22）——纯浪费；
//     · 第 2 次：与真机构建**并行**跑 ⇒ 两者写同一个 APK ⇒ 桩测假红 ⇒ 又要查又要重跑；
//     · 第 4 次：只改了 `acceptance-stub.mjs` 的一句错误提示（影响 1 条门禁、55 秒），却整链重跑。
//   ⇒ 用户看到的是「跑了一个小时还没任何结果」。
//
// 【为什么既有门禁没拦住】`deny-blind-tests.mjs` 只认 `vitest` / `pnpm test` 这两种**字面**形态——
//   而 `pnpm verify` 内部**再调** `pnpm test` ⇒ 从外侧看，那条命令**不在**它的判据里
//   （它看到的是 `pnpm verify`，不是 `pnpm test`）。
//   ★与「sleep 盲等」「全量测试重复跑」同源：**规则写在 markdown 里拦不住，只有工具层门禁是结构性的**；
//     而且**门禁的覆盖面必须跟着"实际形态"走**——形态变了（这里：套了一层壳），旧门禁就失效。
//
// 【判据】命令是**全量门禁链**（`pnpm verify` / `pnpm run verify` 等同族）且
//   **代码状态自上次全链跑以来没变**（git HEAD + 工作区 diff + 未跟踪文件指纹相同）⇒ 拒绝。
//
// 【放行（任一）】
//   · 代码变了（指纹不同）⇒ 自动放行一次并记账（改完代码做全链回归是正当目的）；
//   · 显式表态：命令里带 `PROTEUS_ALLOW_VERIFY=1`（发布前门禁 / 用户点名要全链）；
//   · 非 git 仓库 / 解析失败 ⇒ 放行（不因 hook 自身问题阻断会话）。
//
// 【拒绝时给什么】不只说"别跑"，还要给出**按改动文件推导的定向门禁**——
//   因为"知道该跑哪几条"比"被拦住"更能真正消掉浪费（把正确的做法变得顺手）。
import { stdin } from 'node:process'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

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
  process.exit(0) // 输入异常 → 放行
}

const toolName = payload.tool_name ?? payload.toolName ?? ''
if (toolName !== 'Bash') process.exit(0)

const input = payload.tool_input ?? payload.toolInput ?? {}
const command = typeof input.command === 'string' ? input.command : ''
if (!command) process.exit(0)

const cmd = command.replace(/\s+/g, ' ').trim()

/* ── ① 是否"全量门禁链"命令 ── */

/** 全量门禁链的形态：包管理器 + verify（`pnpm verify` / `pnpm run verify` / `npm run verify` …） */
function isFullVerify(s) {
  // ★必须锚在"命令位置"上（避免把 `echo "pnpm verify"` 之类误判成调用）
  return /(?:^|[\s;&|(])(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?verify(?:\s|$|;|&|\|)/.test(s)
}

const hasIntent = /PROTEUS_ALLOW_VERIFY\s*=\s*1/.test(cmd) || /--allow-full-verify\b/.test(cmd)

if (!isFullVerify(cmd)) process.exit(0)

/* ── ② 代码状态指纹（与 deny-blind-tests 同款口径：HEAD + porcelain + diff + 未跟踪签名）── */

const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

function git(args, timeout = 4000) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] })
}

let fingerprint = ''
let changedFiles = []
try {
  const head = git(['rev-parse', 'HEAD'])
  const porcelain = git(['status', '--porcelain'])
  const diff = git(['diff', 'HEAD']) // 含已暂存与未暂存（内容级）
  const h = createHash('sha256')
  h.update(head); h.update('\0'); h.update(porcelain); h.update('\0'); h.update(diff)
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue
    const p = line.slice(3).trim()
    changedFiles.push(p)
    const abs = join(cwd, p)
    try {
      if (statSync(abs).isFile()) {
        const st = statSync(abs)
        h.update(`\0${p}:${st.size}:${st.mtimeMs}`)
      } else if (statSync(abs).isDirectory()) {
        for (const f of readdirSync(abs).slice(0, 200)) {
          try { const s2 = statSync(join(abs, f)); h.update(`\0${p}/${f}:${s2.size}:${s2.mtimeMs}`) } catch { /* 忽略 */ }
        }
      }
    } catch { /* 条目可能刚被删 */ }
  }
  fingerprint = h.digest('hex')
} catch {
  process.exit(0) // 非 git / git 不可用 → 放行
}

const stateFile = process.env.PROTEUS_VERIFY_HOOK_STATE || join(cwd, '.zcode', 'last-full-verify.json')

let prev = null
try { prev = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* 无记录 */ }

const record = () => {
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ fingerprint, at: new Date().toISOString(), cmd }, null, 0))
  } catch { /* 记账失败不阻断 */ }
}

if (hasIntent) { record(); process.exit(0) }
if (!prev || prev.fingerprint !== fingerprint) { record(); process.exit(0) }

/* ── ③ 同状态重复 ⇒ 拒绝（并给出按改动文件推导的定向门禁）── */

/**
 * 改动路径 → 建议的**定向**门禁。
 *
 * ★为什么要把这张表放进 hook（而不只是文档里）：被拦的人此刻最需要的是"那我该跑什么"。
 *   给出**可直接粘贴**的命令，才能让"正确的做法"变成顺手的事（否则他大概率加个
 *   `PROTEUS_ALLOW_VERIFY=1` 硬跑全链——门禁就被绕过了，等于没做）。
 * ★表不追求完备：命中则给建议，未命中则退回"按改动文件选相关定向测试"。
 */
const TARGETED = [
  [/^packages\/render-backend\//, ['npx vitest run tests/render-backend.test.ts', 'pnpm run check:host-rounding']],
  [/^packages\/layout-core(-rust)?\//, ['npx vitest run tests/layout-core', 'pnpm run check:pixel-snap']],
  [/^packages\/compiler\//, ['npx vitest run tests/compiler', 'pnpm run check:compile-baseline']],
  [/^hosts\/android\//, ['bash hosts/android/check-host-compile.sh', 'node hosts/android/acceptance-stub.mjs', 'node scripts/check-host-rounding.mjs']],
  [/^hosts\/ios\//, ['bash hosts/ios/check-selfdraw-compile.sh']],
  [/^scripts\//, ['node scripts/check-shell-i18n-vars.mjs', 'pnpm run check:gates-sync']],
  [/^docs\//, ['pnpm run check:docs', 'pnpm run check:docs-stats']],
  [/^website\//, ['pnpm run check:content', 'pnpm run check:stats']],
  [/^tests\//, ['npx vitest run <你改的那个 tests/xxx.test.ts>']],
]

const suggestions = new Set()
for (const f of changedFiles) {
  for (const [re, cmds] of TARGETED) {
    if (re.test(f)) { for (const c of cmds) suggestions.add(c); break }
  }
}
if (suggestions.size === 0) suggestions.add('npx vitest run <与改动相关的 tests/xxx.test.ts>')

const mins = Math.max(0, Math.round((Date.now() - Date.parse(prev.at || 0)) / 60000))
const reason = [
  '⛔ 全量门禁链被拦截：**同一代码状态**刚跑过（' + mins + ' 分钟前），重跑结果不会变。',
  '',
  '成本对比（本机实测）：',
  '  · `pnpm verify` 全链 ≈ **10 分钟**（全量测试 + web/mp 构建 + 所有包构建 + 3 遍 vue-tsc + 40+ 门禁 + showcase e2e）；',
  '  · 下述**定向**命令合计通常 **≤ 1 分钟**。',
  '',
  '按当前改动（' + changedFiles.length + ' 个文件）建议的定向门禁：',
  ...Array.from(suggestions).map((c) => '  → ' + c),
  '',
  '确实需要全链（发布前门禁 / 用户点名）→ 显式表态：',
  '  `PROTEUS_ALLOW_VERIFY=1 pnpm verify`',
  '★纪律：**改了哪块就跑哪块的门禁**；全链只在"一轮工作收尾"时跑一次。',
  '★参照：本会话曾把全链连跑 4 次（≈40 分钟），其中 3 次没有任何新改动——用户原话「跑了一个小时还没任何结果」。',
].join('\n')

// ★★输出契约（2026-10-02 修复——与本目录另两条 hook 同因）：
//   原用扁平 stdout JSON（`hookEventName`/`permissionDecision` 在顶层）——与 ZCode 客户端的
//   **嵌套严格 schema**（`hookSpecificOutput.hookEventName`）不匹配 ⇒ 每次运行都
//   `hook.run.failed`（schema 校验失败）⇒ deny 被丢弃。改用**代码路径**：
//   `exit 2` + stderr（客户端 `createExitCodeBlockOutput` 直接转成 deny；不经 JSON schema）。
process.stderr.write(reason + '\n')
process.exit(2)
