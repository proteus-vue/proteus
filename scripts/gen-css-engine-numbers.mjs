#!/usr/bin/env node
// scripts/gen-css-engine-numbers.mjs —— ★★★Themis（编译期 CSS 引擎）**对外数字的单一事实源**
//
// 【这一件回答什么】官网 `/themis` 产品页与《Themis 白皮书》§6 的每个数字都必须**可复算、可门禁**——
//   手抄数字会过时、会被怀疑（本仓亲历：白皮书 §6 的 IR 字段 77→108、lint 存量 95→119、
//   M1 68%→65.45% 三处**静默漂移**，且无任何门禁覆盖）。本脚本把数字从**已入库产物**读出，
//   产出 `docs/generated/css-engine-numbers.json`，`--check` 与产物逐字节比对（漂移 exit 1）。
//
// 【为什么单独一份（不并进 check:stats / consistency-metrics）】
//   · check:stats 面向**全站骨架数字**（包/组件/规则…，recompute 在 check-stats.ts 里）；
//   · consistency-metrics 面向**一致性标准的 M1–M4**。
//   本件面向**CSS 引擎产品叙事**的专属数字（IR 字段 / 逐属性对拍 / 能力清单 / lint 棘轮 / 能力对齐），
//   三类口径不同、生命周期不同 ⇒ 分立 SSOT，避免互相牵制。**页面与白皮书都只读这一份**。
//
// 【★诚实边界（不假装）】「113 用例 / 153 项」是**测试夹具静态计数**（`PARITY_CASES` 由
//   `tests/fixtures/cse-parity-cases.ts` 导出），不是 JSON 产物——本脚本**据夹具推导**（与
//   `tests/e2e-cse-parity.test.ts` 的运行时口径同源），并在产物里标注 `source` 形态。
//   ≤0.5dp 是 `packages/consistency/src/tolerance.ts` 的**承诺值**，如实读源码，不编造计数。
//
// 用法：
//   node scripts/gen-css-engine-numbers.mjs            # 生成 docs/generated/css-engine-numbers.json（+ .md）
//   node scripts/gen-css-engine-numbers.mjs --check    # 门禁：与产物逐字节比对（CI/verify 链）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_JSON = path.join(ROOT, 'docs', 'generated', 'css-engine-numbers.json')
const OUT_MD = path.join(ROOT, 'docs', 'generated', 'css-engine-numbers.md')
const CHECK = process.argv.includes('--check')

/** 读 JSON（缺文件即 exit 2——数字无源时不得产出半份 —— 与 gen-consistency-data 同纪律） */
function readJson(rel, label) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) {
    console.error(`✗ 缺产物：${rel}（${label}）——先跑对应生成器`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

/* ── ① IR 字段 + 逐属性对拍：从 TS 源码经 tsx 读出（唯一实现，不抄常量） ── */
function probeTs() {
  const probe = `
import { STYLE_IR_SUMMARY } from ${JSON.stringify(path.join(ROOT, 'packages/contracts/src/style-ir-registry.generated.ts'))}
import { PARITY_CASES } from ${JSON.stringify(path.join(ROOT, 'tests/fixtures/cse-parity-cases.ts'))}
let props = 0
for (const c of PARITY_CASES) for (const pr of c.probes) props += pr.props.length
console.log(JSON.stringify({
  ir: { total: STYLE_IR_SUMMARY.total, semantic: STYLE_IR_SUMMARY.semantic, engineOnly: STYLE_IR_SUMMARY.engineOnly },
  parity: { cases: PARITY_CASES.length, props },
}))
`
  const out = execFileSync('npx', ['tsx', '-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim().split('\n').pop())
}

/* ── ② 承诺值（源码常量）：结构类容差（tolerance.ts `structure` 块）+ 判据②几何阈值（conformance 测试） ── */
function readTolerance() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/consistency/src/tolerance.ts'), 'utf-8')
  // 直接锚定「structure: { absPx: N, relPct: N }」形态（tolerance.ts 里 structure 出现多次：
  // 接口声明 / 类型别名 —— 那些没有数值，故用**带数值的连续形态**精确命中 DEFAULT_TOLERANCE 的 structure 块）
  const m = src.match(/structure:\s*\{\s*absPx:\s*([0-9.]+)\s*,\s*relPct:\s*([0-9.]+)/)
  if (!m) {
    console.error('✗ tolerance.ts 未匹配到 structure { absPx, relPct }——契约变了，本脚本须同步')
    process.exit(2)
  }
  return { structureAbsPx: Number(m[1]), structureRelPct: Number(m[2]) }
}

/** 判据②「各端 ≡ Web 几何 ≤0.5dp」的**实际阈值**来自 conformance 测试（非 tolerance.ts） */
function readConformanceGeomDp() {
  const src = fs.readFileSync(path.join(ROOT, 'tests/appliers-conformance.test.ts'), 'utf-8')
  const m = src.match(/if\s*\(\s*diff\s*>\s*([0-9.]+)\s*\)/)
  if (!m) {
    console.error('✗ appliers-conformance.test.ts 未解析到几何阈值（diff > X）——判据变了，本脚本须同步')
    process.exit(2)
  }
  return Number(m[1])
}

/* ── ③ lint 存量棘轮：各工程 cse-lint-baseline.json 条目数求和 ── */
function readLintBaseline() {
  const projects = ['examples', 'showcase', 'css-conformance', 'website']
  const byProject = {}
  let total = 0
  for (const proj of projects) {
    const rel = `${proj}/cse-lint-baseline.json`
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) {
      console.error(`✗ 缺 lint 基线：${rel}`)
      process.exit(2)
    }
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const n = Array.isArray(d) ? d.length : Object.keys(d).length
    byProject[proj] = n
    total += n
  }
  return { total, byProject }
}

const tsData = probeTs()
const metrics = readJson('docs/generated/consistency-metrics.json', 'M1–M4')
const align = readJson('docs/generated/css-capability-alignment.json', '三端能力对齐')
const inv = readJson('docs/generated/css-feature-inventory.json', 'CSS 能力清单')

const DATA = {
  version: 1,
  note: 'Themis（编译期 CSS 引擎）对外数字单一事实源——由 scripts/gen-css-engine-numbers.mjs 从已入库产物读出；页面与白皮书只读本件',
  generatedFrom: {
    ir: 'packages/contracts/src/style-ir-registry.generated.ts::STYLE_IR_SUMMARY',
    parity: 'tests/fixtures/cse-parity-cases.ts::PARITY_CASES（夹具静态计数，与 e2e-cse-parity 运行时同源）',
    coverage: 'docs/generated/consistency-metrics.json::M1',
    lint: '{examples,showcase,css-conformance,website}/cse-lint-baseline.json',
    alignment: 'docs/generated/css-capability-alignment.json',
    inventory: 'docs/generated/css-feature-inventory.json',
    tolerance: 'packages/consistency/src/tolerance.ts::DEFAULT_TOLERANCE',
  },
  /** StyleIR 字段闭集（版本化） */
  ir: tsData.ir,
  /** 判据①-b：CSE 与真 Chromium 逐属性对拍（用例数 / 比对的属性项数） */
  parity: { ...tsData.parity, source: 'fixture' },
  /** 一致性标准 M1（数值一致性覆盖率）+ 并集 */
  coverage: {
    m1: metrics.M1.value,
    unionCovered: metrics.M1.union.covered,
    unionTotal: metrics.M1.union.total,
    byLayer: metrics.M1.byLayer,
  },
  /** 判据②：几何等价阈值承诺（App DTO/ops ≡ Web，≤0.5dp）+ 结构类容差（tolerance.ts） */
  tolerance: {
    conformanceGeomDp: readConformanceGeomDp(),
    ...readTolerance(),
  },
  /** Profile lint 存量（棘轮基线，只减不增） */
  lint: readLintBaseline(),
  /** 三端能力对齐矩阵规模 */
  alignment: { rows: align.rows.length, ends: align.profile.ends.length, endsList: align.profile.ends },
  /** CSS 能力清单（Web 全量口径） */
  inventory: {
    total: inv.summary.total,
    byKind: inv.summary.byKind,
    implemented: inv.summary.byImpl.implemented,
    notStarted: inv.summary.byImpl['not-started'],
    actionable: inv.summary.actionable,
    actionableP0: inv.summary.actionableP0,
  },
}

const json = JSON.stringify(DATA, null, 2) + '\n'

/* ── Markdown 镜像（人读；由同一 DATA 渲染，不再手写） ── */
function toMd(d) {
  return `# Themis 引擎 · 对外数字（自动生成——勿手改）

> 生成器 \`scripts/gen-css-engine-numbers.mjs\`；漂移门禁 \`pnpm check:css-engine-numbers\`。
> 官网 \`/themis\` 页与《Themis 白皮书》§6 均只读本件（\`docs/generated/css-engine-numbers.json\`）。

| 指标 | 数值 | 来源 |
|---|---|---|
| StyleIR 字段（闭集·版本化） | **${d.ir.total}**（semantic ${d.ir.semantic} · engine-only ${d.ir.engineOnly}） | STYLE_IR_SUMMARY |
| 判据①-b 逐属性对拍 | **${d.parity.cases}** 用例 / **${d.parity.props}** 项 ≡ 真 Chromium | PARITY_CASES（夹具） |
| M1 数值一致性覆盖率 | **${(d.coverage.m1 * 100).toFixed(2)}%**（并集 ${d.coverage.unionCovered}/${d.coverage.unionTotal}） | consistency-metrics.json |
| 判据② 几何等价阈值 | **≤ ${d.tolerance.conformanceGeomDp} dp**（App ≡ Web）· 结构类容差 ≤${d.tolerance.structureAbsPx}px / ≤${d.tolerance.structureRelPct}% | appliers-conformance.test.ts / tolerance.ts |
| Profile lint 存量（棘轮） | **${d.lint.total}**（${Object.entries(d.lint.byProject).map(([k, v]) => `${k} ${v}`).join(' · ')}） | cse-lint-baseline.json |
| 三端能力对齐矩阵 | **${d.alignment.rows}** 行 × **${d.alignment.ends}** 端（${d.alignment.endsList.join(' / ')}） | css-capability-alignment.json |
| CSS 能力清单（Web 全量） | **${d.inventory.total}** 项（implemented ${d.inventory.implemented} · actionable ${d.inventory.actionable} · P0 ${d.inventory.actionableP0}） | css-feature-inventory.json |

> ★「${d.parity.cases} 用例 / ${d.parity.props} 项」为**测试夹具静态计数**（与 \`tests/e2e-cse-parity.test.ts\` 运行时同源）；
> ≤${d.tolerance.structureAbs}dp 为 \`tolerance.ts\` 的**承诺值**，非计数。
`
}

const md = toMd(DATA)

if (CHECK) {
  const prevJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf-8') : ''
  const prevMd = fs.existsSync(OUT_MD) ? fs.readFileSync(OUT_MD, 'utf-8') : ''
  if (prevJson !== json || prevMd !== md) {
    console.error('✗ Themis 数字漂移——产物与源码不一致（IR 字段/对拍项/M1/lint/能力清单变了？）')
    console.error('  重跑：node scripts/gen-css-engine-numbers.mjs  （并在页面/白皮书同步后提交）')
    process.exit(1)
  }
  console.log(`✅ Themis 数字与产物一致（IR ${DATA.ir.total} · 对拍 ${DATA.parity.cases}/${DATA.parity.props} · M1 ${(DATA.coverage.m1 * 100).toFixed(2)}% · lint ${DATA.lint.total}）`)
} else {
  fs.writeFileSync(OUT_JSON, json)
  fs.writeFileSync(OUT_MD, md)
  console.log(`✅ 生成 ${path.relative(ROOT, OUT_JSON)}（+ .md）`)
  console.log(`   IR ${DATA.ir.total} · 对拍 ${DATA.parity.cases}/${DATA.parity.props} · M1 ${(DATA.coverage.m1 * 100).toFixed(2)}% · lint ${DATA.lint.total} · 能力清单 ${DATA.inventory.total}`)
}
