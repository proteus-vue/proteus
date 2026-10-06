#!/usr/bin/env node
// scripts/check-host-separation-ledger.mjs —— ★★★「宿主关注点分离」完成度台账门禁
//
// 【为什么需要（用户点名「先把宿主关注点分离完全打通，不留任务遗留项，别又是做一半留一半」）】
//   该功能的完成度此前散落在 6+ 处（`Proteus_HostABI…` §9 复选框全空的文档、`hosts/README-LAYERS.md` §4、
//   四个规划目录、两处记忆档案）——**没有单一事实源** ⇒ "看起来做了一半"无法机器判定，且文档漂移无人发现。
//   ⇒ 立台账 `docs/proteus-host-separation-ledger.md`（唯一事实源）+ 本门禁保证它**自洽且不腐化**。
//
// 【判据（违反即红）】
//   ① 台账表可解析（每行 5 列：ID | 项 | 状态 | 判据 | 范围）；
//   ② `状态` ∈ {已落地, 进行, 未做, 范围外}；
//   ③ 生命周期分类（★用户核心诉求「不留做一半」）：
//      · `已落地` ⇒ `判据` 必须是 `cmd:<命令>` / `file:<相对路径>` / `doc:<相对路径>` 之一，
//        且所指**真实存在**（脚本/文件在仓内；`cmd:pnpm check:X` 的 X 必须在 package.json scripts 里）；
//      · `进行` / `未做` ⇒ **必须写清落在哪批**（`范围` 非空）——不许静默空白；
//      · `范围外` ⇒ **必须给理由**（`范围` 非空且不是占位符）——防"用范围外逃避"。
//   ④ `REQUIRED_IDS`（本文件内的清单）**必须全部出现在台账里**——防"删掉一行让门禁变绿"。
//
// 用法：node scripts/check-host-separation-ledger.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'docs/proteus-host-separation-ledger.md')

/** ★必须出现的行 ID（"新增一个宿主只实现平台原语"的全部子项；删行即红） */
const REQUIRED_IDS = [
  // 一、统一 App 运行期
  'R1', 'R2', 'R3', 'R4', 'R5', 'R6',
  // 二、三端宿主胶水收敛
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6',
  // 三、runtime 抽包 / CLI 生成宿主
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6',
  // 四、Host ABI 技术债
  'HA0', 'HA0.5', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6',
  // 五、相邻规划线（范围外）
  'X1', 'X2', 'X3', 'X4', 'X5',
]

const STATUSES = new Set(['已落地', '进行', '未做', '范围外'])
/** `范围` 列的占位符（= 没写）——这些不算"写清落在哪批/理由" */
const PLACEHOLDERS = new Set(['—', '-', '--', '', '无', 'TODO', 'todo'])

const problems = []

if (!fs.existsSync(LEDGER)) {
  console.error(`✗ 缺台账 ${path.relative(ROOT, LEDGER)}——「宿主关注点分离」唯一事实源不存在`)
  process.exit(1)
}
const src = fs.readFileSync(LEDGER, 'utf-8')

/* ── package.json scripts（校验 cmd:pnpm check:X 的 X 真实接线）── */
let scripts = {}
try {
  scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).scripts ?? {}
} catch { /* 解析失败下面按"不存在"处理 */ }

/* ── 解析表行：只认「| ID | ... | ... | ... | ... |」五列数据行 ── */
const rows = []
for (const line of src.split('\n')) {
  const m = /^\s*\|\s*([A-Za-z0-9.]+)\s*\|/.exec(line)
  if (!m) continue
  // 去 markdown 反引号（判据列常写 `cmd:pnpm check:x`）——cells 再 trim
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/`/g, '').trim())
  if (cells.length !== 5) { problems.push(`表行列数 ≠ 5（${cells.length}）：${line.trim().slice(0, 60)}`); continue }
  const [id, item, status, crit, scope] = cells
  if (id === 'ID' || /^-+$/.test(item)) continue // 表头 / 分隔行
  rows.push({ id, item, status, crit, scope })
}

const seen = new Set()
for (const r of rows) {
  if (seen.has(r.id)) problems.push(`ID 重复：${r.id}`)
  seen.add(r.id)

  if (!STATUSES.has(r.status)) { problems.push(`${r.id}: 非法状态「${r.status}」（应 ∈ 已落地/进行/未做/范围外）`); continue }

  if (r.status === '已落地') {
    // 判据必须指向真实存在的脚本/文件/文档
    const c = r.crit
    if (c.startsWith('cmd:')) {
      const cmd = c.slice(4).trim()
      // 支持 `pnpm check:x`（校验 script 存在）或可执行 bare 命令
      const mm = /pnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/.exec(cmd)
      if (mm) {
        if (!(mm[1] in scripts)) problems.push(`${r.id}: 判据命令「${cmd}」的 script「${mm[1]}」不在 package.json`)
      } else if (!/^(node|bash|npx)\s/.test(cmd)) {
        problems.push(`${r.id}: 判据命令形态不可识别：「${cmd}」（应为 pnpm check:x / node … / bash …）`)
      }
    } else if (c.startsWith('file:') || c.startsWith('doc:')) {
      const rel = c.slice(c.indexOf(':') + 1).trim()
      if (!fs.existsSync(path.join(ROOT, rel))) problems.push(`${r.id}: 判据指向的路径不存在：${rel}`)
    } else {
      problems.push(`${r.id}: 已落地项的判据必须以 cmd:/file:/doc: 开头（当前「${c}」）`)
    }
  } else {
    // 进行 / 未做 / 范围外 ⇒ 范围列必须写清（不许占位/空白）
    if (PLACEHOLDERS.has(r.scope) || r.scope.length < 2) {
      problems.push(`${r.id}: 状态「${r.status}」必须写清范围（落在哪批 / 范围外理由），当前「${r.scope}」`)
    }
  }
}

/* ── REQUIRED_IDS 必须在场 ── */
for (const id of REQUIRED_IDS) {
  if (!seen.has(id)) problems.push(`台账缺必需行 ${id}（不得删行规避门禁）`)
}

/* ── 汇总 ── */
const byStatus = { 已落地: 0, 进行: 0, 未做: 0, 范围外: 0 }
for (const r of rows) if (r.status in byStatus) byStatus[r.status]++

if (problems.length) {
  console.error(`✗ 宿主关注点分离台账不自洽（${problems.length} 项）——见 docs/proteus-host-separation-ledger.md`)
  for (const p of problems) console.error(`    - ${p}`)
  process.exit(1)
}
console.log(
  `✅ 宿主关注点分离台账自洽（${rows.length} 项 · 已落地 ${byStatus['已落地']} / 进行 ${byStatus['进行']} / 未做 ${byStatus['未做']} / 范围外 ${byStatus['范围外']}）`,
)
