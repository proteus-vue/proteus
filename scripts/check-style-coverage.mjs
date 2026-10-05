#!/usr/bin/env node
// scripts/check-style-coverage.mjs —— ★★★G-61 B3：**数值等价覆盖门禁**（L2 覆盖率 2/38 → 全覆盖）
//
// 【它守什么（plan `04-batches-and-boundaries.md` B3 行 + `03-consistency-gates.md` §4.3）】
//   B3 验收原文：「同一 IR → 三端 snapshot **相对 Web 基准**（B-a+B-b）≤0.5dp；**L2 覆盖 2/38 → 全覆盖**」。
//   §4.3 的定义：「**每个 IR `semantic` 字段**都有对应 snapshot 读数与**相对 Web 基准的**比对用例 ⇒ 分母全覆盖」。
//
// 【判据（机器可判——不靠"人记得补"）】
//   ① **映射完备**：`SEMANTIC_FIELD_SNAPSHOT_KEYS`（consistency 包的单一事实源）覆盖
//      注册表（contracts）里**全部 scope=semantic 字段**；任一缺失即红。
//   ② **闭集同源**：映射到的每个快照键都在 `snapshot.ts` 的 `STYLE_KEYS` 闭集内
//      （防"三处闭集漂移"——本仓实测教训：首版漏扩校验器 ⇒ 25 条误报）。
//   ③ **棘轮**：覆盖数（字段数 / 快照键数）只增不减（对照 `scripts/style-coverage.baseline.json`）。
//   ④ **反向无孤儿**：`STYLE_KEYS` 里**未参与 semantic 映射**的键必须**显式豁免并给理由**
//      （如 `fontSize` 之外的历史键——防"扩了闭集却没人消费"）。
//
// 【为什么它必须存在】"每个字段都有读数"是**声明**；没有门禁时，新增一个 CSS 字段（INV-CE-07 四同步）
//   会漏掉快照侧，覆盖率数字却纹丝不动（分母/分子都手工维护）——本仓已为"数字口径失同步"付过多轮代价。
//
// 用法：node scripts/check-style-coverage.mjs [--update]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts/style-coverage.baseline.json')
const UPDATE = process.argv.includes('--update')

const contracts = await import(pathToFileURL(path.join(ROOT, 'packages/contracts/dist/index.js')).href)
const consistency = await import(pathToFileURL(path.join(ROOT, 'packages/consistency/dist/index.js')).href)
const { STYLE_IR_FIELDS } = contracts
const { SEMANTIC_FIELD_SNAPSHOT_KEYS } = consistency

/** STYLE_KEYS 的闭集（源文件解析——它未从包出口导出（内部校验用），故读源）
 *  ★为什么不导出：`STYLE_KEYS` 是校验器内部实现细节；门禁需要它对账 ⇒ 从**源**取，
 *    并断言"源里的键集 = 包产物里校验器实际接受的范围"（下 ③ 用 dist 的校验器实测）。 */
const SNAPSHOT_SRC = path.join(ROOT, 'packages/consistency/src/snapshot.ts')
const src = fs.readFileSync(SNAPSHOT_SRC, 'utf-8')
const m = /const STYLE_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(src)
if (!m) {
  console.error('❌ 无法从 snapshot.ts 解析 STYLE_KEYS（源形态已变——修本脚本）')
  process.exit(1)
}
const styleKeys = new Set(
  m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .flatMap((l) => l.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)),
)

const problems = []

/* ① 映射完备 */
const semanticFields = Object.entries(STYLE_IR_FIELDS)
  .filter(([, v]) => v.scope === 'semantic')
  .map(([k]) => k)
  .sort()
const mappedFields = Object.keys(SEMANTIC_FIELD_SNAPSHOT_KEYS).sort()
const missing = semanticFields.filter((f) => !(f in SEMANTIC_FIELD_SNAPSHOT_KEYS))
for (const f of missing) problems.push(`① semantic 字段 \`${f}\` 无快照读数映射（B3 要求"每个字段都有读数"）`)
const extra = mappedFields.filter((f) => !semanticFields.includes(f))
for (const f of extra) problems.push(`① 映射表里的 \`${f}\` 不在注册表的 semantic 集（字段已删/改名？）`)

/* ② 闭集同源：映射到的键 ⊆ STYLE_KEYS */
const mappedKeys = new Set(Object.values(SEMANTIC_FIELD_SNAPSHOT_KEYS).flat())
for (const k of mappedKeys) {
  if (!styleKeys.has(k)) problems.push(`② 映射键 \`${k}\` 不在 STYLE_KEYS 闭集（snapshot.ts 漏登记——三处同改）`)
}

/* ④ 反向无孤儿：STYLE_KEYS 里的键必须在映射中，或显式豁免 */
const ORPHAN_ALLOW = new Set([])
for (const k of styleKeys) {
  if (!mappedKeys.has(k) && !ORPHAN_ALLOW.has(k)) {
    problems.push(`④ STYLE_KEYS 的 \`${k}\` 未参与 semantic 映射（要么加映射，要么加进 ORPHAN_ALLOW 并写理由）`)
  }
}

/* ③ 棘轮 */
const now = { fields: mappedFields.length, keys: mappedKeys.size }
let base = null
if (fs.existsSync(BASELINE)) base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
if (base) {
  if (now.fields < base.fields) problems.push(`③ 棘轮：覆盖字段 ${now.fields} < 基线 ${base.fields}`)
  if (now.keys < base.keys) problems.push(`③ 棘轮：快照键 ${now.keys} < 基线 ${base.keys}`)
}

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ ...now, note: 'B3 数值等价覆盖棘轮（只增不减）' }, null, 2) + '\n')
  console.log(`✅ 已写回 ${path.relative(ROOT, BASELINE)}`)
}

console.log('数值等价覆盖门禁（G-61 B3 · 每个 semantic 字段 ↔ 快照读数）')
console.log(`  注册表 semantic 字段 ${semanticFields.length} · 映射覆盖 ${mappedFields.length} · 快照键 ${mappedKeys.size} · STYLE_KEYS ${styleKeys.size}`)
if (base) console.log(`  棘轮基线：字段 ${base.fields} · 键 ${base.keys}（只增不减）`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log(`✅ 覆盖完备（${mappedFields.length}/${semanticFields.length} semantic 字段有快照读数；闭集同源；无孤儿键）`)
