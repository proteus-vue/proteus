#!/usr/bin/env node
// scripts/check-contract-index.mjs —— ★★★决策 #1137：**跨端契约索引的自检门禁**
//
// 【为什么索引本身需要判据（这是本仓第 9 次同族教训）】
//   本仓已经踩过 8 次「判据/文档腐化后静默失效」：
//     生成器源集合过期（#1123）· 抽取器贪婪正则（#1129）· 门禁路径指向已搬迁文件（#1131）·
//     探针登记三处漏改（#1134）· hook 判据覆盖面（#1132）……
//   索引比这些**更危险**：它是"我该跑什么门禁"的唯一入口，
//   一旦它过期，AI 会**以为查过了**然后漏跑关键门禁 —— **比没有索引更糟**。
//   ⇒ 索引必须有机器判据，且必须是**白名单制**（新增跨端门禁不登记 ⇒ 红）。
//
// 【判据三条】
//   ① 索引里引用的每个**文件路径**真实存在（防改名/删除后索引静默过期）；
//   ② 索引里引用的每条 `check:*` / 测试文件真实存在（防命令名写错）；
//   ③ **每条"跨端一致性类"门禁都必须在索引里出现**（白名单，见 CONTRACT_GATES）。
//
// 【用法】
//   node scripts/check-contract-index.mjs              # 全量校验（CI / verify）
//   node scripts/check-contract-index.mjs --for <path> # 给定改动路径 ⇒ 打印命中的契约节
// 退出码：0 通过 / 1 有缺口 / 2 环境错误
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = path.join(ROOT, 'docs', 'contract-index.md')

/**
 * **跨端一致性门禁白名单**（每条都必须在索引里出现）。
 * ★新增此类门禁时，加进本清单 —— 漏加 ⇒ 门禁红（而不是"索引悄悄少一节"）。
 * ★判定口径：改动一处即要求"同步 N 端"的门禁（parity / sync / three-end / golden / contract）。
 */
const CONTRACT_GATES = [
  'check:invoke-wire-parity', // 线格式五端
  'check:host-invoke-contract', // Invoke 方法契约
  'check:vapor-three-end', // Vapor 三端
  'check:bridge-sync', // 桥源真源 ⇄ 副本
  'check:harmony-runtime-prebuilt', // 鸿蒙 runtime 副本
  'check:cross-end-golden', // 布局 golden
  'check:capability-golden', // 能力 golden
  'check:anim-color-golden', // 动画颜色 golden
  'check:style-ir-golden', // StyleIR golden
  'check:glass-pixel-parity', // 玻璃像素
  'check:glass-parity-harmony', // 玻璃鸿蒙对齐
  'check:content', // 文档生成器（源集合）
  'check:docs-stats', // 文档数字
  'check:reference', // 参考页
  'check:file-size', // 文件大小棘轮
  'check:repo-hygiene', // 构建产物不得入库
  'check:vapor-capability', // Vapor 能力面
]

/** 索引里也会引用这些**测试文件**（不是 package script）。 */
const TEST_SCRIPTS = [
  'tests/fetch-wire-fields.test.ts',
  'tests/host-probe-registry.test.ts',
]

const argv = process.argv.slice(2)
const forArg = argv.indexOf('--for')

if (!fs.existsSync(INDEX)) {
  console.error(`✗ 索引不存在：${INDEX}`)
  process.exit(2)
}
const text = fs.readFileSync(INDEX, 'utf8')

// ── ① 索引里引用的文件路径必须存在 ─────────────────────────────────────────────
/** 从 markdown 里抽反引号包裹的"像路径"的 token。 */
function pathsIn(md) {
  const out = new Set()
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim()
    // 只认"仓库内路径"形态：不以 http/命令开头、含 / 或以已知扩展名结尾
    if (/^(https?:|pnpm |npx |node |bash |git |brew )/.test(t)) continue
    if (!/^[A-Za-z0-9_.\-/]+$/.test(t)) continue
    if (!(t.includes('/') || /\.(ts|mjs|java|swift|rs|h|cpp|json|md)$/.test(t))) continue
    out.add(t)
  }
  return [...out]
}

/**
 * 索引里有些是**目录**（以 `/` 结尾）、有些是**通配**（`*`）、有些是 `.md` 页面路径。
 * ⇒ 只校验"看起来是具体文件"的：有扩展名、不含 `*`、不以 `/` 结尾。
 */
function isConcretePath(t) {
  if (t.includes('*')) return false
  if (t.endsWith('/')) return false
  return /\.(ts|mjs|java|swift|rs|h|cpp|json|md)$/.test(t)
}

// ── ③ 白名单：每条跨端门禁都必须在索引里出现 ───────────────────────────────────
const missingGates = CONTRACT_GATES.filter((g) => !text.includes(g))

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}
const badGateNames = CONTRACT_GATES.filter((g) => !(g in scripts))

const referenced = pathsIn(text)
const concrete = referenced.filter(isConcretePath)
const missingPaths = concrete.filter((p) => !fs.existsSync(path.join(ROOT, p)))
const missingTests = TEST_SCRIPTS.filter((t) => !text.includes(t) || !fs.existsSync(path.join(ROOT, t)))

// ── --for：给定改动路径 ⇒ 打印命中的契约节 ────────────────────────────────────
if (forArg >= 0) {
  const target = argv[forArg + 1]
  if (!target) {
    console.error('✗ --for 需要一个路径参数')
    process.exit(2)
  }
  // 按 "## " 切节（跳过前言）
  const sections = text.split(/^## /m).slice(1)
  const hit = sections.filter((sec) => sec.includes(target) || sec.includes(path.basename(target)))
  if (!hit.length) {
    console.log(`[contract-index] 路径 ${target} 未命中任何契约节（可能确实不涉及跨端契约）`)
    console.log('  ★若它属于某条契约但表里没有 ⇒ 补表（这不是"没问题"，是"索引不全"）')
    process.exit(0)
  }
  for (const sec of hit) {
    const title = sec.split('\n')[0].trim()
    console.log(`\n═══ 命中契约：${title} ═══`)
    const mustRun = sec.match(/\*\*必须跑\*\*[：:]\s*([\s\S]*?)(?:\n\n|$)/)
    if (mustRun) console.log(mustRun[1].trim())
    else console.log('（该节没有"必须跑"清单——请补）')
  }
  process.exit(0)
}

// ── 常规校验 ────────────────────────────────────────────────────────────────
console.log(`契约索引自检（${path.relative(ROOT, INDEX)} · 白名单 ${CONTRACT_GATES.length} 条跨端门禁）`)
let bad = 0

if (missingGates.length) {
  bad++
  console.error(`\n❌ 这些跨端门禁**没有**出现在索引里（AI 无从知道该跑它）：`)
  for (const g of missingGates) console.error(`  - ${g}`)
  console.error('  修法：在 docs/contract-index.md 对应小节补上该门禁（并写清触发条件与后果）')
}

if (badGateNames.length) {
  bad++
  console.error(`\n❌ 白名单里有 package.json 中不存在的门禁（判据自身写错）：`)
  for (const g of badGateNames) console.error(`  - ${g}`)
}

if (missingPaths.length) {
  bad++
  console.error(`\n❌ 索引引用的文件/目录**不存在**（改名或删除后索引已过期）：`)
  for (const p of missingPaths.slice(0, 20)) console.error(`  - ${p}`)
  if (missingPaths.length > 20) console.error(`  …另有 ${missingPaths.length - 20} 个`)
  console.error('  修法：更新索引路径（★索引过期比没有索引更糟——AI 会以为查过了）')
}

if (missingTests.length) {
  bad++
  console.error(`\n❌ 索引引用的测试文件缺失或未提及：`)
  for (const t of missingTests) console.error(`  - ${t}`)
}

if (bad) {
  console.error(`\n✗ 契约索引不自洽（${bad} 类问题）`)
  process.exit(1)
}

console.log(`  ✓ ${concrete.length} 个路径引用全部存在`)
console.log(`  ✓ ${CONTRACT_GATES.length} 条跨端门禁全部在表内且命令名有效`)
console.log(`  ✓ ${TEST_SCRIPTS.length} 个判据文件在位`)
console.log('\n✅ 跨端契约索引自洽（AI 可据此一次查到"改这里要跑什么"）')
process.exit(0)
