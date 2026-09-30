#!/usr/bin/env node
// scripts/check-no-blind-wait.mjs —— ★静态门禁：脚本里禁止 sleep 盲等（2026-09-30）
//
// 【为什么需要（用户 2026-09-30 点名，带当日实锤）】原 hook `deny-sleep.mjs` 只看 Bash 调用里的
//   **命令字面量**：`bash hosts/ios/run-selfdraw.sh` 这条命令字面上没有 sleep，而**脚本内部**
//   用 `sleep 5` 轮询了 600 秒——而且轮询的判据（js_report.build_id）在 selfdraw 模式下
//   **永远不可能满足** ⇒ 每次白等 10 分钟。这是 hook 的结构性盲区（与「verify 内部再调 vitest
//   导致外层形态漏网」同源：**门禁覆盖面必须跟着实际形态走**）。
//
// 【判据】扫描 `hosts/**` `scripts/**` `.agents/**` 下的全部 `*.sh`：
//   · 命令位置的 `sleep`（行首 / `;` `&` `|` `(` 后 / `do|then|else` 后；任意时长）计入违规；
//   · 跳过 heredoc 内容（那是别的语言/被打印给用户的**说明文本**，不执行）；
//   · 跳过行首 `#` 注释行；
//   · 白名单**唯一**：`wait_for.sh`（本仓「有条件等待」的单一实现——有界轮询必须要有间隔；
//     除它之外的任何 sleep 都应改为「App 主动上报」或调用它）。
//   · 基线机制（棘轮）：存量违规文件在 `scripts/no-blind-wait-baseline.json` 里按**计数**钉住，
//     **只减不增**——新增文件带 sleep ⇒ 红；存量文件计数上升 ⇒ 红；下降 ⇒ 通过（提示 --write 降钉）。
//     ★选择基线而非一次性全清：旧实验脚本（android acceptance / experiments/*）的盲等改造
//     需逐条设计条件，属独立批次；但**新代码从今天起零容忍**，且存量**不可能**再增长。
//
// 用法：node scripts/check-no-blind-wait.mjs [--write|--list]
//   --write  把当前计数写回基线（仅在**减少**后使用，属"显式重生成"）
//   --list   打印全部违规明细（文件:行）
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts', 'no-blind-wait-baseline.json')

const ALLOWED = {
  '.agents/skills/ai-efficiency-rules/scripts/wait_for.sh':
    '「有条件等待」的唯一实现（有界轮询需要间隔；它是替代盲等的**工具本身**）',
}

const HEREDOC_START = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/
const SLEEP_RE = /(?:^|[;&|(]|\b(?:do|then|else)\s)\s*sleep\b/

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) {
      // ★.agents 例外：它整体以点开头，但要扫
      if (e.name !== '.agents' || dir !== ROOT) continue
    }
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.sh')) out.push(p)
  }
  return out
}

/** 逐行标注是否在 heredoc 内（浅解析；与 check-shell-i18n-vars.mjs 同源） */
function heredocLines(lines) {
  const inside = new Array(lines.length).fill(false)
  let end = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (end !== null) {
      inside[i] = true
      if (line.trim() === end) end = null
      continue
    }
    const m = HEREDOC_START.exec(line)
    if (m) {
      const starts = [...line.matchAll(new RegExp(HEREDOC_START.source, 'g'))]
      end = starts[starts.length - 1][3]
    }
  }
  return inside
}

const files = [...walk(path.join(ROOT, 'hosts')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, '.agents'))]

const counts = {} // relpath -> { count, lines: [n] }
for (const f of files) {
  const rel = path.relative(ROOT, f)
  if (rel in ALLOWED) continue
  const lines = fs.readFileSync(f, 'utf-8').split('\n')
  const inHeredoc = heredocLines(lines)
  const hitLines = []
  lines.forEach((line, i) => {
    if (inHeredoc[i]) return
    const t = line.trimStart()
    if (t.startsWith('#')) return // 注释行不执行
    if (SLEEP_RE.test(line)) hitLines.push(i + 1)
  })
  if (hitLines.length) counts[rel] = { count: hitLines.length, lines: hitLines }
}

const args = process.argv.slice(2)
if (args.includes('--write')) {
  const data = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.count]))
  fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n')
  console.log(`✅ 基线已写入 ${path.relative(ROOT, BASELINE)}（${Object.keys(data).length} 个文件 · ${Object.values(data).reduce((a, b) => a + b, 0)} 处 sleep）`)
  process.exit(0)
}

let baseline = {}
if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

const problems = []
const pending = []
for (const [rel, v] of Object.entries(counts)) {
  const base = baseline[rel]
  if (base === undefined) {
    problems.push({ rel, kind: '新增盲等', detail: `${v.count} 处（该文件不在基线里）`, lines: v.lines })
  } else if (v.count > base) {
    problems.push({ rel, kind: '盲等增加', detail: `${base} → ${v.count} 处`, lines: v.lines })
  } else {
    pending.push({ rel, count: v.count, base })
  }
}

console.log(`盲等门禁（扫 ${files.length} 个 .sh；白名单 ${Object.keys(ALLOWED).length} 个：wait_for.sh）`)

if (args.includes('--list')) {
  for (const [rel, v] of Object.entries(counts)) {
    console.log(`  · ${rel}: ${v.lines.join(', ')}`)
  }
}

if (problems.length) {
  console.error(`\n❌ 发现 ${problems.length} 处**盲等回退/新增**（sleep 是禁止的等待方式）：\n`)
  for (const p of problems) {
    console.error(`  ${p.rel}  [${p.kind}] ${p.detail}`)
    if (p.lines) console.error(`      行：${p.lines.join(', ')}`)
  }
  console.error('\n  两条合法形态（用户明示，2026-09-30）：')
  console.error('   ① **让 App/被测对象主动上报**：等进程退出 / 读管道 / 读事件流（例：devicectl --console + PROTEUS_EXIT_AFTER_REPORT=1）')
  console.error('   ② **有条件等待**：`bash .agents/skills/ai-efficiency-rules/scripts/wait_for.sh --cmd/--file/--http`（唯一允许的轮询原语）')
  console.error('  长任务 ⇒ 后台异步执行（run_in_background）。')
  process.exit(1)
}

if (pending.length) {
  const total = pending.reduce((a, p) => a + p.count, 0)
  console.log(`  ⏳ 存量待清理 ${pending.length} 个文件 / ${total} 处（基线钉住，只减不增）：`)
  for (const p of pending) {
    const mark = p.count < p.base ? `（已从 ${p.base} 降到 ${p.count}，建议 --write 降钉）` : ''
    console.log(`     · ${p.rel}: ${p.count} 处${mark}`)
  }
  console.log('  ★新代码零容忍；改到哪个文件就把哪个文件的盲等清掉（清完跑 --write 更新基线）。')
}

console.log('\n✅ 无新增盲等（存量已由基线钉住，只减不增）')
