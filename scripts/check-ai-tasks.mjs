#!/usr/bin/env node
// scripts/check-ai-tasks.mjs —— ★多 AI 协作开发 · 任务板自洽门禁（零依赖，Node ≥ 18）
//
// 定位：本规范（docs/ai-development-spec.md）把「多个 AI 同时开发框架」的四个断点
//   —— ① 没人认领 ② 撞车（改同一文件） ③ 断在半路（WIP 无交接） ④ 不可追溯（说不清哪条决策）——
//   变成机器判据。SSOT = docs/ai-tasks.json；规范全文见 docs/ai-development-spec.md 第 4 / 6 节。
//
// 检查项（--check 下任一不过即 exit 1）：
//   1. 任务板不存在 ⇒ 打印引导 + 退出 0（干净克隆友好——与 check-hook-wiring 同策略）
//   2. schema：id 唯一且格式合法（T-<kebab>）· type/status 枚举合法 · scope 非空数组
//   3. status=in_progress ⇒ owner 非空
//   4. status=done ⇒ decision 是整数 + verification 非空
//   5. ★status=done ⇒ decision 号必须在 decisions.md 真实存在（追溯闭合）
//   6. ★任意两个 in_progress 任务 scope 不重叠（防撞车）
//   7. scope 引用的顶级路径存在（防 typo / 指向已删目录）· related 指向存在的 id
//
// 用法：
//   node scripts/check-ai-tasks.mjs            # 报告（恒退出 0）
//   node scripts/check-ai-tasks.mjs --check    # 有缺口 → exit 1（CI / verify 用）
//   node scripts/check-ai-tasks.mjs --json     # 机器可读
//   node scripts/check-ai-tasks.mjs --board <path>  # 指定任务板（默认 docs/ai-tasks.json；自测用）
// 退出码：0 通过（或无任务板） / 1 有缺口（仅 --check） / 2 环境错误（JSON 不可解析）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')
const boardArg = argv.indexOf('--board')
const BOARD = boardArg >= 0 && argv[boardArg + 1] ? path.resolve(argv[boardArg + 1]) : path.join(ROOT, 'docs', 'ai-tasks.json')
const DECISIONS = path.join(ROOT, 'docs', 'project-memory-archive', 'decisions.md')

const TYPES = new Set(['framework-feature', 'component-api', 'capability', 'end-alignment', 'bugfix', 'docs', 'governance', 'verification'])
const STATUS = new Set(['planned', 'in_progress', 'blocked', 'done', 'abandoned'])
const ID_RE = /^T-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** glob → 静态前缀（首个 * ? [ 之前的部分）。用于重叠/存在性判定。 */
function staticPrefix(glob) {
  const i = glob.search(/[*?[]/)
  return i < 0 ? glob : glob.slice(0, i)
}
/** 把路径拆成组件（忽略空段） */
function parts(p) {
  return p.split('/').filter(Boolean)
}
/** a 是否为 b 的路径组件前缀（含相等） */
function isPrefix(aParts, bParts) {
  if (aParts.length > bParts.length) return false
  for (let i = 0; i < aParts.length; i++) if (aParts[i] !== bParts[i]) return false
  return true
}
/** 两个 glob 是否可能命中同一路径（静态前缀互为前缀/相等） */
function globsOverlap(g1, g2) {
  const a = parts(staticPrefix(g1))
  const b = parts(staticPrefix(g2))
  if (a.length === 0 || b.length === 0) return true // 前缀为空（如 "**"）→ 与一切重叠
  return isPrefix(a, b) || isPrefix(b, a)
}

// ── 任务板缺失：引导（不判红） ──
if (!fs.existsSync(BOARD)) {
  console.log('[check-ai-tasks] 未找到任务板 docs/ai-tasks.json（干净克隆 / 未启用协作层的正常状态）')
  console.log('  多 AI 协作开发建议启用：见 docs/ai-development-spec.md 第 4 节（任务板 schema + 认领 + 边界）。')
  process.exit(0)
}

let board
try {
  board = JSON.parse(fs.readFileSync(BOARD, 'utf8'))
} catch (e) {
  console.error(`✗ 任务板 JSON 不可解析：${BOARD}\n  ${e.message}`)
  process.exit(2)
}

// ── 决策号集合（追溯闭合用）──
const decisionSet = new Set()
if (fs.existsSync(DECISIONS)) {
  for (const m of fs.readFileSync(DECISIONS, 'utf8').matchAll(/^(\d+)\.\s/gm)) decisionSet.add(Number(m[1]))
}

const tasks = Array.isArray(board.tasks) ? board.tasks : []
const failures = []
const notes = []

// ── 逐条 schema + 语义检查 ──
const ids = new Set()
for (const t of tasks) {
  const at = `任务 ${t.id ?? '(缺 id)'}`
  if (!t.id || !ID_RE.test(t.id)) failures.push(`${at}: id 缺失或格式非法（应 T-<kebab>）`)
  if (t.id && ids.has(t.id)) failures.push(`${at}: id 重复`)
  if (t.id) ids.add(t.id)
  if (!t.title) failures.push(`${at}: 缺 title`)
  if (!TYPES.has(t.type)) failures.push(`${at}: type 非法（${t.type}）—— 见 schema.type 枚举`)
  if (!STATUS.has(t.status)) failures.push(`${at}: status 非法（${t.status}）—— 见 schema.status 枚举`)
  if (!Array.isArray(t.scope) || t.scope.length === 0) failures.push(`${at}: scope 必须是非空数组（边界）`)
}

// related 指向存在的 id（两遍：先收全 id）
for (const t of tasks) {
  for (const r of t.related ?? []) {
    if (!ids.has(r)) failures.push(`任务 ${t.id}: related 指向不存在的 id「${r}」`)
  }
}

// 状态相关必填 + 决策号存在性
for (const t of tasks) {
  const at = `任务 ${t.id}`
  if (t.status === 'in_progress' && !t.owner) failures.push(`${at}: status=in_progress 必须填 owner（认领 = 登记）`)
  if (t.status === 'done') {
    if (!Number.isInteger(t.decision)) failures.push(`${at}: status=done 必须填整数 decision（决策号）`)
    else if (decisionSet.size && !decisionSet.has(t.decision)) {
      failures.push(`${at}: decision #${t.decision} 在 docs/project-memory-archive/decisions.md 里不存在（追溯断链）`)
    }
    if (!t.verification) failures.push(`${at}: status=done 必须填 verification（可执行判据）`)
  }
  if (t.status === 'blocked' && !(t.note && t.note.includes('【Handoff】'))) {
    notes.push(`${at}: status=blocked 建议在 note 写【Handoff】块（做到哪/已改/未做/下一步/坑/判据）`)
  }
}

// scope 顶级路径存在（★仅对 in_progress/done——planned/blocked 可指向**尚待新建**的路径，
//   否则"新建组件目录"类任务永远无法立项；typo 防呆在认领时（in_progress）才生效）
for (const t of tasks) {
  if (t.status !== 'in_progress' && t.status !== 'done') continue
  for (const g of t.scope ?? []) {
    const pre = staticPrefix(g).replace(/\/+$/, '')
    if (!pre) continue // 纯通配（"**"）不判存在
    if (!fs.existsSync(path.join(ROOT, pre))) {
      failures.push(`任务 ${t.id}: scope「${g}」→ 静态前缀「${pre}」在磁盘不存在（typo 或指向已删目录？）`)
    }
  }
}

// ★防撞车：两两 in_progress 任务 scope 不重叠
const active = tasks.filter((t) => t.status === 'in_progress')
for (let i = 0; i < active.length; i++) {
  for (let j = i + 1; j < active.length; j++) {
    const a = active[i]
    const b = active[j]
    if (a.owner && b.owner && a.owner === b.owner) continue // 同一 owner 的多个任务不算撞车
    for (const ga of a.scope ?? []) {
      for (const gb of b.scope ?? []) {
        if (globsOverlap(ga, gb)) {
          failures.push(`★撞车：in_progress 任务 ${a.id} 与 ${b.id} 的 scope 重叠（${ga} ⟷ ${gb}）—— 请拆边界或串行`)
        }
      }
    }
  }
}

// ── 输出 ──
const stats = {
  total: tasks.length,
  byStatus: tasks.reduce((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {}),
}
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failures.length === 0, failures, notes, stats }, null, 2))
} else {
  console.log('[check-ai-tasks] ★多 AI 协作 · 任务板自洽门禁')
  console.log(`  任务 ${stats.total} 个 · 状态分布 ${JSON.stringify(stats.byStatus)}`)
  if (notes.length) for (const n of notes) console.log(`  ⚠ ${n}`)
  if (failures.length === 0) {
    console.log('  ✅ 通过（认领/边界/追溯/防撞车 均自洽）')
  } else {
    console.log(`  ✗ ${failures.length} 项不合规：`)
    for (const f of failures) console.log(`    - ${f}`)
  }
}

if (CHECK && failures.length) process.exit(1)
process.exit(0)
