// website/scripts/check-stats.ts —— ★官网数字门禁：stats.ts 声明的数字必须与源码实际值一致
//
// 背景（2026-09-20 实测）：官网 `website/src/stats.ts` 自称「数字单一来源，禁止散落硬编码」，
//   但**从未有任何门禁校验它** —— 实测 8 项里 7 项长期过时：
//     包数 40/41 两处并存（同页 Hero 与数字区各说一个数）、单测 2966→3441、原语 176→183、
//     组件 66→76、规则 106→111、plan 81→85、conformance 8→10。
//   根因与 2026-09-20 的发布物事故同形：**只检查「我声明的」，不核对「实际是什么」**。
//
// ★判据：凡**可机器重算**的项，逐项重算并与 stats.ts 的 value 比对（不符 → exit 1）。
//   唯一豁免：`tests`（单测数需跑全量套件，代价高）——由发布前手动核对，门禁只提示。
//
// 用法：tsx website/scripts/check-stats.ts
// 退出码：0 一致 / 1 有漂移
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEBSITE = path.join(ROOT, 'website')

/** 从 stats.ts 源码提取 { id → value }（不 import——避免把 .vue 依赖链拖进来；结构稳定，正则可靠） */
function declaredStats(): Map<string, string> {
  const src = fs.readFileSync(path.join(WEBSITE, 'src', 'stats.ts'), 'utf8')
  const out = new Map<string, string>()
  const re = /id:\s*'([^']+)'\s*,\s*value:\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) out.set(m[1], m[2])
  return out
}

/** 实际值（可机器重算的部分） */
async function actualStats(): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  // 包数：packages/*/package.json 且 name 为 @proteus-vue/*
  let packages = 0
  for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', e.name, 'package.json'), 'utf8'))
      if (j.name?.startsWith('@proteus-vue/')) packages++
    } catch {
      /* 非包目录 */
    }
  }
  out.set('packages', String(packages))

  // 语义原语 SSOT / implemented 语义
  const cir = await import(pathToFileURL(path.join(ROOT, 'packages', 'component-ir', 'src', 'index.ts')).href)
  out.set('primitives', String(cir.PRIMITIVE_CATALOG.length))
  out.set('implemented', String(cir.implementedPrimitives().length))

  // 编译规则
  const comp = await import(pathToFileURL(path.join(ROOT, 'packages', 'compiler', 'src', 'transforms', 'registry.ts')).href)
  out.set('rules', String(comp.listTransformRules().length))

  // 语义组件：与 `proteus components:audit packages/components` 同一计数规则（有 index.vue 的目录）
  let components = 0
  const compDir = path.join(ROOT, 'packages', 'components')
  for (const e of fs.readdirSync(compDir, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(compDir, e.name, 'index.vue'))) components++
  }
  out.set('components', String(components))

  // conformance 套件入口：packages/*/src/*conformance*.ts 文件数（stats.ts 已写明该计数规则）
  let conformance = 0
  for (const p of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    const srcDir = path.join(ROOT, 'packages', p.name, 'src')
    if (!p.isDirectory() || !fs.existsSync(srcDir)) continue
    for (const f of fs.readdirSync(srcDir)) if (/conformance.*\.ts$/.test(f)) conformance++
  }
  out.set('conformance', String(conformance))

  // plan 文档：docs/*-plan 目录
  let plans = 0
  for (const e of fs.readdirSync(path.join(ROOT, 'docs'), { withFileTypes: true })) {
    if (e.isDirectory() && /-plan$/.test(e.name)) plans++
  }
  out.set('plans', String(plans))

  return out
}

const declared = declaredStats()
if (!declared.size) {
  console.error('[check-stats] ✗ 未能从 website/src/stats.ts 解析出任何 stat（结构变了？正则需同步）')
  process.exit(1)
}
const actual = await actualStats()

/** 声明里有、但门禁重算不了的（须在 stats.ts 注释里说明为何豁免） */
const MANUAL = new Map([['tests', '单测数需跑全量套件（pnpm test）——代价高，由发布前手动核对']])

let bad = 0
console.log('[check-stats] ★官网数字 vs 源码实际值')
for (const [id, want] of declared) {
  if (MANUAL.has(id)) {
    console.log(`  ⚠ ${id}: 声明 ${want}（人工维护——${MANUAL.get(id)}）`)
    continue
  }
  const got = actual.get(id)
  if (got === undefined) {
    console.log(`  ⚠ ${id}: 声明 ${want} —— 门禁无对应重算规则（新增 id 时请同步本脚本）`)
    continue
  }
  if (got === want) {
    console.log(`  ✓ ${id}: ${want}`)
  } else {
    console.log(`  ✗ ${id}: 声明 ${want} 但实际 ${got}`)
    bad++
  }
}

if (bad) {
  console.log(`\n✗ ${bad} 项数字与实际不符——请更新 website/src/stats.ts（数字与证据同源）`)
  process.exit(1)
}
console.log('\n✅ 官网数字与源码实际值一致')
