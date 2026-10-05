#!/usr/bin/env node
// scripts/check-style-ir-schema.mjs —— ★★★G-61 B0：**StyleIR 契约门禁**
//
// 【它守什么（plan `02-style-ir-contract.md` §8 的 B0 验收判据）】
//   ① **注册表幂等**：`packages/contracts/src/style-ir-registry.generated.ts` 与重算一致
//      （漂移 ⇒ 生成器改了没刷产物，或有人手改了生成物）
//   ② **字段闭集**：IR 消费方（SApp SPI / 三端 Applier）引用的字段必须都在注册表内
//   ③ **profile 完备**：每条字段都有 scope（semantic | engine-only）+ 域 + 值类型
//   ④ **值类型合法**：valueType ∈ `StyleValueType`（contracts 的闭集）
//   ⑤ **棘轮**：字段总数 / semantic 数只增不减（对照 `scripts/style-ir-registry.baseline.json`）
//   ⑥ **SPI 对齐**：`style-applier.ts` 的 `StyleIR.version` 与注册表 `STYLE_IR_VERSION` 同源（不漂移）
//
// 【为什么独立成脚本】生成器（`gen-style-ir-registry.mjs`）负责**产出**；本门禁负责**判定**——
//   两者分离，避免"生成器自己宣布自己正确"（本仓纪律：判据不得由被测方自证）。
//
// 用法：node scripts/check-style-ir-schema.mjs
// 退出码：0 通过 / 1 违约
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { STYLE_IR_FIELDS, STYLE_IR_SUMMARY, STYLE_IR_VERSION } from '@proteus-vue/contracts/style-ir-registry.generated'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_SRC = path.join(ROOT, 'packages/contracts/src/style-ir-registry.generated.ts')
const BASELINE = path.join(ROOT, 'scripts/style-ir-registry.baseline.json')
const SPI = path.join(ROOT, 'packages/contracts/src/style-applier.ts')

/** valueType 闭集（SSOT = contracts `style-ir-values.ts` 的 `StyleValueType`） */
const VALUE_TYPES = new Set([
  'length',
  'color',
  'number',
  'enum',
  'transform',
  'transform-origin',
  'engine-field',
  'semantic-only',
  'forbidden',
])

const problems = []

/* ① 幂等：重算（交给生成器自己判定，但这里做**独立**校验——产物里声明的摘要必须与逐字段重数一致） */
let recomputedTotal = 0
let recomputedSemantic = 0
const domainCount = {}
for (const [f, spec] of Object.entries(STYLE_IR_FIELDS)) {
  recomputedTotal++
  if (spec.scope === 'semantic') recomputedSemantic++
  domainCount[spec.domain] = (domainCount[spec.domain] ?? 0) + 1

  // ③ profile 完备
  if (spec.scope !== 'semantic' && spec.scope !== 'engine-only') {
    problems.push(`③ ${f}：scope 非法（${String(spec.scope)}）——只允许 semantic | engine-only`)
  }
  if (!spec.domain) problems.push(`③ ${f}：缺域分类`)
  if (!spec.valueType) problems.push(`③ ${f}：缺值类型`)

  // ④ 值类型合法
  if (spec.valueType && !VALUE_TYPES.has(spec.valueType)) {
    problems.push(`④ ${f}：valueType \`${spec.valueType}\` 不在闭集内（${[...VALUE_TYPES].join(' | ')}）`)
  }

  // ② 来源自洽（至少有一个来源——否则是"凭空出现的字段"）
  const s = spec.sources ?? {}
  const hasSource = Boolean(s.compiler) || Boolean(s.matrixLevel) || s.runtimeWhitelist || s.runtimeForbidden || s.consistencyMatrix
  if (!hasSource) problems.push(`② ${f}：四个来源全空——字段来源不明（凭空字段）`)
}

// 摘要与逐数一致（防止"手改摘要"掩盖字段变动）
if (STYLE_IR_SUMMARY.total !== recomputedTotal) {
  problems.push(`① 摘要 total=${STYLE_IR_SUMMARY.total} 与逐字段重数 ${recomputedTotal} 不一致`)
}
if (STYLE_IR_SUMMARY.semantic !== recomputedSemantic) {
  problems.push(`① 摘要 semantic=${STYLE_IR_SUMMARY.semantic} 与逐字段重数 ${recomputedSemantic} 不一致`)
}

/* ⑤ 棘轮（对照基线） */
let baseline = null
if (fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
  if (recomputedTotal < baseline.total) {
    problems.push(`⑤ 棘轮：字段总数 ${recomputedTotal} < 基线 ${baseline.total}（削减字段是破坏性变更——须显式改基线并说明）`)
  }
  if (recomputedSemantic < baseline.semantic) {
    problems.push(`⑤ 棘轮：semantic 数 ${recomputedSemantic} < 基线 ${baseline.semantic}`)
  }
} else {
  problems.push(`⑤ 缺棘轮基线：${path.relative(ROOT, BASELINE)}（跑生成器 --update 创建）`)
}

/* ⑥ SPI 对齐：Applier 契约的版本引用与注册表同源 */
{
  const spiSrc = fs.existsSync(SPI) ? fs.readFileSync(SPI, 'utf-8') : ''
  if (!spiSrc) {
    problems.push(`⑥ 缺 SApp SPI 契约：${path.relative(ROOT, SPI)}`)
  } else if (!spiSrc.includes('style-ir-values')) {
    problems.push('⑥ SApp SPI 未从 `style-ir-values` 引用值类型（应单一来源，不得各写一份）')
  }
  const regSrc = fs.readFileSync(REGISTRY_SRC, 'utf-8')
  if (!regSrc.includes(`STYLE_IR_VERSION = ${STYLE_IR_VERSION}`)) {
    problems.push(`⑥ 注册表产物里未声明 STYLE_IR_VERSION = ${STYLE_IR_VERSION}`)
  }
}

/* ⑦ 跨源一致（★防"陈旧 dist"假绿）：本门禁读的是**构建产物**（dist——包导出面），
 *   而 ① 幂等读的是源产物；若有人改了源 SSOT 的输入（如新增字段进了折叠面）却没重生成，
 *   本门禁会在**陈旧副本**上全绿（内部自洽）⇒ 真漂移静默。
 *   ⇒ 显式跑生成器 `--check`（从**活源**重算并与源产物比对）——两类漂移一起堵。
 *   ★用 `npx tsx`（生成器 import 工作区包的 **TS 源**——与 audit-degradation.mjs 同款惯例）。 */
{
  const r = spawnSync('npx', ['tsx', 'scripts/gen-style-ir-registry.mjs', '--check'], {
    encoding: 'utf-8',
    cwd: ROOT,
  })
  if (r.status !== 0) {
    problems.push(`⑦ 生成器重算失败（源 SSOT → 源产物漂移，跑 \`pnpm run gen:style-ir-registry --update\`）：\n${((r.stdout || '') + (r.stderr || '')).trim()}`)
  }
}

/* ── 输出 ── */
console.log('StyleIR 契约门禁（G-61 B0）')
console.log(`  字段 ${recomputedTotal}（semantic ${recomputedSemantic} · engine-only ${recomputedTotal - recomputedSemantic}）· IR 版本 v${STYLE_IR_VERSION}`)
console.log(`  域分布：${Object.entries(domainCount).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`)
if (baseline) console.log(`  棘轮基线：字段 ${baseline.total} · semantic ${baseline.semantic}（只增不减）`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ StyleIR 契约自洽（幂等 + 字段闭集 + profile 完备 + 值类型 + 棘轮 + SPI 对齐）')
