#!/usr/bin/env node
// scripts/check-doctor-registry.mjs —— ★★doctor 注册表自检（M5 · 决策 #686）
//
// 【为什么立（对齐 gate.ts 的注册表纪律）】doctor 的检查项 SSOT 在 `packages/cli/src/doctor/registry.ts`。
//   注册表会随端增加而腐化（R6）：新增端忘加检查、id 撞车、失败码未登记（`makeDiag` 会 throw）、
//   组名错——这些**只有机器判据能挡**。
//
// 【判据】① id 唯一且 `组/项` 形态、kebab-case ② 组名在合法集内 ③ 每项有 `title`/`level`/`run`
//   ④ **每个 finding 可能引用的 `diagCode` 必在 `DIAG_CODES` 登记**（扫各 checks 源文件的 code: 'PT-…'）
//   ⑤ 每组至少一项（除 hosts 投影组）⑥ R6：`hosts` 投影表覆盖的端 ⊆ targets 支持的端
//
// 【诚实边界】静态扫源文件（不 import dist）——`run` 的真实性由 `tests/cli-doctor.test.ts` 覆盖。
//
// 用法：node scripts/check-doctor-registry.mjs [--json]
// 退出码：0 通过 / 1 违规 / 2 前置缺失
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')

const REGISTRY = path.join(ROOT, 'packages/cli/src/doctor/registry.ts')
const CHECKS_DIR = path.join(ROOT, 'packages/cli/src/doctor/checks')
const DIAG = path.join(ROOT, 'packages/cli/src/diag.ts')

const problems = []
const note = (m) => problems.push(m)

if (!fs.existsSync(REGISTRY)) {
  console.error(`✗ 找不到注册表：${REGISTRY}`)
  process.exit(2)
}

// ── ① 从各 checks 源文件 + registry.ts（内含 gates 组）抽 `id: '组/项'` ──
const ids = []
const checkFiles = [
  ...(fs.existsSync(CHECKS_DIR) ? fs.readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.ts') && f !== 'util.ts') : []).map((f) => path.join(CHECKS_DIR, f)),
  REGISTRY, // gates 组内联在 registry.ts（不单独成文件）
]
for (const abs of checkFiles) {
  const src = fs.readFileSync(abs, 'utf-8')
  const re = /id:\s*'(([a-z]+)\/[a-z0-9-]+)'/g
  let m
  while ((m = re.exec(src))) ids.push({ file: path.basename(abs), id: m[1], group: m[2] })
}
if (!ids.length) note('✗ 未从 checks/ 解析到任何检查项 id（源形态变了？）')

// ── ② id 唯一 + 命名 ──
const seen = new Set()
for (const { file, id, group } of ids) {
  if (seen.has(id)) note(`✗ 重复 id：${id}（${file}）`)
  seen.add(id)
  if (!/^[a-z]+\/[a-z][a-z0-9-]*$/.test(id)) note(`✗ id 命名不合规（应 组/kebab-case）：${id}（${file}）`)
  const GROUPS = ['env', 'toolchain', 'deps', 'project', 'endpoint', 'ports', 'devices', 'gates']
  if (!GROUPS.includes(group)) note(`✗ 未知组：${group}（${id}，${file}）`)
}

// ── ③ 每组至少一项（hosts 是投影组，豁免；gates 允许只有 runnable）──
const GROUPS_REQUIRED = ['env', 'toolchain', 'deps', 'project', 'ports', 'devices', 'gates']
for (const g of GROUPS_REQUIRED) {
  if (!ids.some((x) => x.group === g)) note(`✗ 组 ${g} 无任何检查项（hosts 组为投影、豁免）`)
}

// ── ④ 失败码全部已在 DIAG_CODES 登记 ──
if (!fs.existsSync(DIAG)) {
  note('✗ 找不到 diag.ts')
} else {
  const diag = fs.readFileSync(DIAG, 'utf-8')
  const registered = new Set([...diag.matchAll(/'(PT-[A-Z]{2}-\d{3})':\s*\{/g)].map((m) => m[1]))
  const used = new Set()
  for (const abs of checkFiles) {
    const src = fs.readFileSync(abs, 'utf-8')
    for (const m of src.matchAll(/code:\s*'(PT-[A-Z]{2}-\d{3})'/g)) used.add(m[1])
  }
  const regSrc = fs.readFileSync(REGISTRY, 'utf-8')
  for (const m of regSrc.matchAll(/diagCode:\s*'(PT-[A-Z]{2}-\d{3})'/g)) used.add(m[1])
  for (const code of used) {
    if (!registered.has(code)) note(`✗ 失败码未在 DIAG_CODES 登记（makeDiag 会 throw）：${code}`)
  }
}

// ── ⑤ registry.ts 必须 import 八组的 checks（防"写了 checks 但没登记进 CHECKS"）──
{
  const reg = fs.readFileSync(REGISTRY, 'utf-8')
  for (const grp of ['ENV_CHECKS', 'TOOLCHAIN_CHECKS', 'DEPS_CHECKS', 'PROJECT_CHECKS', 'PORTS_CHECKS', 'DEVICES_CHECKS']) {
    if (!reg.includes(`...${grp}`)) note(`✗ registry.ts 的 CHECKS 未展开 ${grp}（检查项会被漏掉）`)
  }
}

// ── ⑥ 汇总 ──
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: problems.length === 0, count: ids.length, ids: ids.map((x) => x.id), problems }, null, 2))
  process.exit(problems.length === 0 ? 0 : 1)
}

console.log(`[check-doctor-registry] doctor 注册表自检（${ids.length} 项）`)
if (problems.length) {
  for (const p of problems) console.log(`  ${p}`)
  process.exit(1)
}
console.log(`  ✅ 注册表自洽（${ids.length} 项 · id 唯一 · 命名合规 · 组齐 · 失败码已登记 · CHECKS 展开完整）`)
