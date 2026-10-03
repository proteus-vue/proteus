#!/usr/bin/env node
// scripts/hooks/deny-blind-tests.mjs —— ★PreToolUse 拦截：全量测试不得"无目的重复跑"（2026-09-28）
//
// 背景（用户反馈）：AI 把 `npx vitest run`（全量）跑了三遍、每遍几百秒——而第一遍的输出
//   已足够定位问题。根因与 sleep 盲等同类：**"跑一下看看"是无条件的动作**，规则写在
//   markdown 里拦不住，只有工具调用层的门禁才是结构性的（见 deny-sleep.mjs 的同源说明）。
//
// 判据（两条同时满足才拦）：
//   ① 命令是**全量**测试（`npx vitest run` 无文件/名称过滤；`pnpm test` 无参数）；
//   ② **代码状态自上次全量跑以来没变**（git HEAD + 工作区 diff + 未跟踪文件指纹相同）
//      ⇒ 同一状态重跑，结果不可能不同 ⇒ 拒绝，并告诉调用方怎么走。
//
// 放行（任一）：
//   · 定向跑：带测试文件路径（`npx vitest run tests/foo.test.ts`）或
//     `-t/--testNamePattern`、`--changed`、`--related`、`--project`、`--shard` 过滤；
//   · 显式目的：命令里带 `PROTEUS_ALLOW_FULL_SUITE=1`（或 `--allow-full-suite`）
//     —— 强制调用方**表态**这是有意的全量跑（发布前门禁等）；
//   · 代码变了（指纹不同）⇒ 自动放行一次并记账（改了代码要回归，是正当目的）。
//   · 非 git 仓库 / 解析不了 → 放行（不因 hook 自身问题阻断会话）。
//
// 【本 hook 不做的事】不判断"测试是否必要"（那需要语义理解）——只掐掉
//   **同状态重复**这一最明确的浪费形态；短平快的定向跑一律放行。
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

/* ── ① 是否"全量测试"命令 ── */

const cmd = command.replace(/\s+/g, ' ').trim()

/** 显式目的标记（命令里写 = 调用方表态"我知道这是全量，有目的"） */
const hasIntent = /PROTEUS_ALLOW_FULL_SUITE\s*=\s*1/.test(cmd) || /--allow-full-suite\b/.test(cmd)

/** 路径类参数（出现即视为定向跑） */
const looksLikePath = (tok) =>
  tok.includes('/') || /\.(test|spec)\.\w+$/.test(tok) || /\.(ts|tsx|js|jsx|mts|cts)$/.test(tok) ||
  /^(tests|packages|apps|src|website|showcase)(\/|$)/.test(tok)

/** 过滤类参数（出现即视为定向跑——它们把范围限在子集上） */
const isFilterFlag = (tok) =>
  /^(-t|--testNamePattern|--changed|--related|--project|--shard|--dir|--bail)\b/.test(tok) ||
  tok === '-t'

/** vitest 调用：`[npx|pnpm exec|pnpm dlx|yarn|bunx|node_modules/.bin/] vitest ...`
 *
 * ★★2026-10-02 修**误报**（hook 真生效后的第一类噪音——两轮实测）：
 *   第一轮：`sed -n '1,5p' vitest.config.ts` 被拦（把**文件名**当调用）；
 *   第二轮：`grep -rn vitest run README.md` 被拦（把**搜索词**当调用）。
 *   ⇒ 根因同一条：原判据**认字符出现**，不认命令形态。
 *   正解 = **按命令段分析**：vitest 必须是**段首命令**（可带 env 前缀 / runner 前缀），
 *   出现在 `grep`/`sed`/`echo` 等命令的**参数位**一律不算。
 *   ——与 deny-sleep 的 commit 文本误报同族：**判据要认"命令形态"，不是认字符出现**。 */
function vitestFullSuite(s) {
  // 命令分段（; && || | ( ) 换行）——每段独立判定
  const segments = s.split(/[;&|()\n]+/)
  /** runner 前缀（可连续出现：`pnpm exec vitest`） */
  const RUNNER = /^(npx|npm|pnpm|yarn|bun|dlx|exec|run|node_modules\/\.bin\/[\w.-]+|[\w./-]+\/)$/
  for (const seg of segments) {
    const toks = seg.trim().split(/\s+/).filter(Boolean)
    // 剥掉 env 前缀（`PROTEUS_ALLOW_FULL_SUITE=1 …`）
    let i = 0
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(toks[i])) i++
    // 剥掉 runner 前缀（npx / pnpm exec / node_modules/.bin/ …）——最多 3 层防死循环
    for (let n = 0; n < 3 && i < toks.length; n++) {
      const t = toks[i]
      if (RUNNER.test(t)) { i++; continue }
      break
    }
    const head = toks[i]
    if (!head) continue
    // 段首必须是 vitest 本体（可带路径前缀与 @version；后接空格/串尾才算）
    if (!/(^|\/)vitest(@[\w.-]+)?$/.test(head)) continue
    const rest = toks.slice(i + 1)
    // 非"跑"的子命令 / 帮助 → 不拦
    if (rest.some((t) => /^(list|bench|typecheck|--version|-v|--help|-h)$/.test(t))) continue
    if (rest.some((t) => isFilterFlag(t))) continue
    if (rest.some((t) => !t.startsWith('-') && looksLikePath(t))) continue
    // 段首是 vitest 且无定向参数 ⇒ 该段是全量跑
    return true
  }
  return false
}

/** 包管理器全量脚本：`pnpm test` / `pnpm run test` / `npm test`（**带额外参数则放行**——视为定向） */
function pkgManagerFullSuite(s) {
  const m = s.match(/(?:^|[\s;&|(])(pnpm|npm|yarn|bun)\s+(?:run\s+)?test(?:\s+(.*))?$/)
  if (!m) return false
  const extra = (m[2] ?? '').trim()
  if (extra) return false // 有参数 ⇒ 交给 vitest 规则或视为定向
  return true
}

const isFullSuite = vitestFullSuite(cmd) || pkgManagerFullSuite(cmd)
if (!isFullSuite) process.exit(0)

/* ── ② 代码状态指纹（HEAD + 工作区 diff + 未跟踪文件内容签名）── */

const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

function git(args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
}

let fingerprint = ''
try {
  const head = git(['rev-parse', 'HEAD'])
  const porcelain = git(['status', '--porcelain'])
  const diff = git(['diff', 'HEAD']) // 含已暂存与未暂存（内容级）
  const h = createHash('sha256')
  h.update(head); h.update('\0'); h.update(porcelain); h.update('\0'); h.update(diff)
  // 未跟踪文件：porcelain 只给名字 ⇒ 补上 (路径,大小,mtime) 签名（新建/改内容都变）
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('?? ')) continue
    const p = line.slice(3).trim()
    const abs = join(cwd, p)
    try {
      if (statSync(abs).isFile()) {
        const st = statSync(abs)
        h.update(`\0${p}:${st.size}:${st.mtimeMs}`)
      } else if (statSync(abs).isDirectory()) {
        // 目录（如新建测试目录）：取一层文件清单（够用且便宜）
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

/** 状态文件（可用环境变量覆盖——供 hook 自测用） */
const stateFile = process.env.PROTEUS_TEST_HOOK_STATE || join(cwd, '.zcode', 'last-full-suite.json')

let prev = null
try { prev = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* 无记录 */ }

const record = () => {
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ fingerprint, at: new Date().toISOString(), cmd }, null, 0))
  } catch { /* 记账失败不阻断 */ }
}

// 显式目的 → 放行并刷新记账
if (hasIntent) { record(); process.exit(0) }

// 代码变了（或首次）→ 放行一次并记账（改代码后跑全量是正当目的）
if (!prev || prev.fingerprint !== fingerprint) { record(); process.exit(0) }

/* ── ③ 同状态重复 ⇒ 拒绝 ── */

const mins = Math.max(0, Math.round((Date.now() - Date.parse(prev.at || 0)) / 60000))
const reason = [
  '⛔ 全量测试被拦截：**同一代码状态**刚跑过（' + mins + ' 分钟前），重跑结果不会变。',
  '《AI 执行效率规范》：等待有条件、获取有缓存、**重复有上限**——全量套件一次几百秒，属最贵的重复动作。',
  '按目的选一条（三条都比"再跑一遍全量"快）：',
  '  ① 只想回归本次改动的模块 → 定向跑：`npx vitest run tests/<相关>.test.ts`（几秒级）；',
  '  ①-b ★改了编译内核（packages/{compiler,runtime,plugin-vite}/src/**）→ `pnpm test:coupled`',
  '        （按 diff 推导**配套断言**并真跑；~10 秒——漏同步的断言债务若留到全量，要连爆两轮才被发现）；',
  '  ② 想只跑受影响用例 → `npx vitest run --changed`；',
  '  ③ 确实需要全量（发布前门禁 / 用户点名）→ 在命令里显式表态：',
  '     `PROTEUS_ALLOW_FULL_SUITE=1 pnpm test`（或 `npx vitest run` 前加同款环境变量）。',
  '说明：本拦截靠"git 指纹"判定——**改了代码会自动放行一次**，无需任何标记。',
  '对照：上一轮 AI 把全量跑了三遍（每遍 ~400s），而第一遍输出已足够定位。',
].join('\n')

// ★★输出契约（2026-10-02 修复——与本目录另两条 hook 同因）：
//   原用扁平 stdout JSON（`hookEventName`/`permissionDecision` 在顶层）——与 ZCode 客户端的
//   **嵌套严格 schema**（`hookSpecificOutput.hookEventName`）不匹配 ⇒ 每次运行都
//   `hook.run.failed`（schema 校验失败）⇒ deny 被丢弃。改用**代码路径**：
//   `exit 2` + stderr（客户端 `createExitCodeBlockOutput` 直接转成 deny；不经 JSON schema）。
process.stderr.write(reason + '\n')
process.exit(2)
