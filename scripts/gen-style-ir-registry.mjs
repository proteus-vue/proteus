#!/usr/bin/env node
// scripts/gen-style-ir-registry.mjs —— ★★★G-61 B0：**StyleIR 字段注册表**（三表合一的机器推导）
//
// 【它解决什么（立项勘察 G4）】仓库里存在**三张样式属性表**，此前互不引用、无门禁对照：
//   ① App 编译期折叠面（`packages/compiler` 的 APP_*_FIELDS）——真正上端的
//   ② CSS 矩阵级别（`packages/contracts` 的 STYLE_PROP_LEVELS，G-21）
//   ③ runtime Validator 白名单（`packages/style-safety`）
//   ⇒ 三者对 App 端不一致 ⇒「同一属性一个路径允许、另一个路径拒绝」的**半开状态**（违反铁律 #9）。
//   本脚本把它们**机器推导**为一份注册表（`packages/contracts/src/style-ir-registry.generated.ts`），
//   每个字段带 `scope`（semantic | engine-only）+ 三表来源 + 域 + 值类型。**不新增第四张手写表**。
//
// 【判据（--check）】
//   ① 幂等：重算 vs 已提交产物一致（不一致 ⇒ 红，提示 `--update`——更新是一次**可见提交**）
//   ② schema 自洽：每字段 scope ∈ {semantic, engine-only}；域/值类型非空
//   ③ 覆盖完整：三张表的每个字段都在注册表里（无遗漏）；一致性矩阵可表达字段必须 `semantic`
//   ④ 棘轮：字段总数与 semantic 数**只增不减**（对照 `scripts/style-ir-registry.baseline.json`）
//
// 【用法】
//   node scripts/gen-style-ir-registry.mjs            # 生成 + 打印摘要 + 跑判据
//   node scripts/gen-style-ir-registry.mjs --check    # 只校验（CI / pnpm verify 用）
//   node scripts/gen-style-ir-registry.mjs --update   # 写回产物 + 刷新棘轮基线
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_LAYOUT_FIELDS,
  APP_PAINT_FIELDS,
  APP_EDGE_FIELDS,
  APP_DERIVED_FIELDS,
  APP_SPECIAL_FIELDS,
  APP_INHERITABLE_FIELDS,
} from '@proteus-vue/compiler'
import { STYLE_PROP_LEVELS } from '@proteus-vue/contracts/style'
import {
  LENGTH_PROPS,
  COLOR_PROPS,
  NUMERIC_PROPS,
  TRANSFORM_PROPS,
  FORBIDDEN_PROPS,
} from '@proteus-vue/style-safety'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'packages/contracts/src/style-ir-registry.generated.ts')
const BASELINE = path.join(ROOT, 'scripts/style-ir-registry.baseline.json')
const MATRIX = path.join(ROOT, 'docs/generated/css-capability-alignment.json')
/** 一致性矩阵「可表达字段」来源（与 gen-consistency-metrics.mjs 同源——M1 分母同一口径） */
const consistencyFields = (() => {
  const m = JSON.parse(fs.readFileSync(MATRIX, 'utf-8'))
  const rows = (m.rows ?? []).filter((r) => Array.isArray(r.compilerFields) && r.compilerFields.length > 0)
  return new Set(rows.flatMap((r) => r.compilerFields))
})()

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const UPDATE = argv.includes('--update')

/* ── 推导输入 ── */
const APP_FIELDS = [
  ...new Set([
    ...APP_LAYOUT_FIELDS,
    ...APP_PAINT_FIELDS,
    ...APP_EDGE_FIELDS,
    ...APP_DERIVED_FIELDS,
    ...APP_SPECIAL_FIELDS,
  ]),
].sort()
const RUNTIME_ALLOW = new Set([...LENGTH_PROPS, ...COLOR_PROPS, ...NUMERIC_PROPS, ...TRANSFORM_PROPS])
const FORBIDDEN = new Set(FORBIDDEN_PROPS)
const MATRIX_KEYS = new Set(Object.keys(STYLE_PROP_LEVELS))
const INHERITABLE = new Set(APP_INHERITABLE_FIELDS)

/** CSS 矩阵级别 → 值类型（推导，不手写字段清单） */
const VALUE_TYPE_BY_LEVEL = {
  Length: 'length',
  Color: 'color',
  Opacity: 'number',
  Integer: 'number',
  FlexNumber: 'number',
  FlexAlign: 'enum',
  FlexJustify: 'enum',
  TextAlign: 'enum',
  TextWrap: 'enum',
  BorderStyle: 'enum',
  Transform: 'transform',
  TransformOrigin: 'transform-origin',
  SEMANTIC_ONLY: 'semantic-only',
  FORBIDDEN: 'forbidden',
}

/**
 * 域推导（机器来源，非手写字段清单）：
 *   ① 优先按它来自哪张 App 折叠面表；
 *   ② 不在折叠面的（如矩阵/runtime 表里的单边 `marginTop`、`zIndex`）⇒ 按**正则模式**归域
 *      （`*Top/Right/Bottom/Left` 与 `margin/padding/border*` → edges；`zIndex/verticalAlign` → matrix-only）。
 *      ★这是"推导规则"而非"手写清单"——新增同类字段自动落域，无需改本文件。
 */
function domainOf(f) {
  if (APP_LAYOUT_FIELDS.includes(f)) return 'layout'
  if (APP_PAINT_FIELDS.includes(f)) return 'paint'
  if (APP_EDGE_FIELDS.includes(f)) return 'edges'
  if (APP_DERIVED_FIELDS.includes(f)) return 'derived'
  if (APP_SPECIAL_FIELDS.includes(f)) return 'special'
  // ② 不在 App 折叠面的字段（矩阵 / runtime 表独有）——按模式归域
  if (/^(margin|padding|border(Top|Right|Bottom|Left)(Width|Color|Radius)?|border(Radius|Width|Color))/.test(f)) return 'edges'
  if (/^(display|position|top|right|bottom|left|overflow|aspectRatio|pointerEvents|zIndex|verticalAlign)$/.test(f)) return 'layout'
  if (/(Color|Shadow|opacity|transform|visibility)/i.test(f)) return 'paint'
  if (/(font|text|lineHeight|letterSpacing|whiteSpace)/i.test(f)) return 'text'
  if (/^(grid|flex|align|justify|gap|rowGap|columnGap)/i.test(f)) return 'layout'
  return 'matrix-only'
}

function compilerSourceOf(f) {
  if (APP_LAYOUT_FIELDS.includes(f)) return 'APP_LAYOUT_FIELDS'
  if (APP_PAINT_FIELDS.includes(f)) return 'APP_PAINT_FIELDS'
  if (APP_EDGE_FIELDS.includes(f)) return 'APP_EDGE_FIELDS'
  if (APP_DERIVED_FIELDS.includes(f)) return 'APP_DERIVED_FIELDS'
  if (APP_SPECIAL_FIELDS.includes(f)) return 'APP_SPECIAL_FIELDS'
  return null
}

/** 全字段并集（三表 ∪ 一致性矩阵） */
const ALL = [...new Set([...APP_FIELDS, ...MATRIX_KEYS, ...RUNTIME_ALLOW, ...FORBIDDEN, ...consistencyFields])].sort()

const fields = {}
for (const f of ALL) {
  const matrixLevel = MATRIX_KEYS.has(f) ? STYLE_PROP_LEVELS[f] : null
  const inConsistency = consistencyFields.has(f)
  // ★scope：一致性矩阵「可表达字段」= semantic（对外承诺跨端一致的范围）；其余 = engine-only
  //   （App 引擎自用超集，如 widthRatio/marginAuto——不参与跨端承诺，但必须在注册表登记）
  const scope = inConsistency ? 'semantic' : 'engine-only'
  fields[f] = {
    scope,
    domain: domainOf(f),
    valueType: matrixLevel ? (VALUE_TYPE_BY_LEVEL[matrixLevel] ?? 'unknown') : 'engine-field',
    sources: {
      compiler: compilerSourceOf(f),
      matrixLevel,
      runtimeWhitelist: RUNTIME_ALLOW.has(f),
      runtimeForbidden: FORBIDDEN.has(f),
      consistencyMatrix: inConsistency,
      inheritable: INHERITABLE.has(f),
    },
  }
}

const byDomain = {}
for (const f of Object.keys(fields)) {
  const d = fields[f].domain
  byDomain[d] = (byDomain[d] ?? 0) + 1
}
const semanticCount = Object.values(fields).filter((x) => x.scope === 'semantic').length
const summary = { total: Object.keys(fields).length, semantic: semanticCount, engineOnly: Object.keys(fields).length - semanticCount, byDomain }

/* ── 渲染产物（确定性：字段名排序 + 2 空格缩进） ── */
function render() {
  const L = []
  L.push('// packages/contracts/src/style-ir-registry.generated.ts')
  L.push('// ★★★AUTO-GENERATED by scripts/gen-style-ir-registry.mjs —— 勿手改')
  L.push('//')
  L.push('// G-61 B0 · **StyleIR 字段注册表**（三表合一的机器推导产物）')
  L.push('//   来源：① App 编译期折叠面（packages/compiler APP_*_FIELDS）')
  L.push('//         ② CSS 矩阵级别（本包 STYLE_PROP_LEVELS，G-21）')
  L.push('//         ③ runtime Validator 白名单（packages/style-safety）')
  L.push('//         ∪ 一致性矩阵「可表达字段」（docs/generated/css-capability-alignment.json）')
  L.push('//   门禁：pnpm check:style-ir-schema（幂等 + schema 自洽 + 覆盖完整 + 棘轮只增不减）')
  L.push('')
  L.push('/** StyleIR 契约版本（字段增删 / 值类型变更 ⇒ major+1；与 host-abi 的 ABI_VERSION 独立编号） */')
  L.push('export const STYLE_IR_VERSION = 1 as const')
  L.push('')
  L.push("/** 字段 scope：`semantic` = 参与跨端一致性承诺（必须被三层判据覆盖）；`engine-only` = 仅 App 引擎消费 */")
  L.push("export type StyleFieldScope = 'semantic' | 'engine-only'")
  L.push('')
  L.push('/** 该字段在各表的来源（机器推导——判据「覆盖完整」读它） */')
  L.push('export interface StyleFieldSources {')
  L.push('  /** ① App 编译期折叠面：所在常量名（null = 不在折叠面） */')
  L.push('  compiler: string | null')
  L.push('  /** ② CSS 矩阵级别（null = 矩阵未列——层级差异，正常） */')
  L.push('  matrixLevel: string | null')
  L.push('  /** ③ runtime Validator 白名单 */')
  L.push('  runtimeWhitelist: boolean')
  L.push('  /** ③ runtime Validator 禁止类（语义层） */')
  L.push('  runtimeForbidden: boolean')
  L.push('  /** 一致性矩阵可表达字段（scope=semantic 的判据来源） */')
  L.push('  consistencyMatrix: boolean')
  L.push('  /** 可继承属性（CSS 继承传播——CSE Step5） */')
  L.push('  inheritable: boolean')
  L.push('}')
  L.push('')
  L.push('/** 注册表条目 */')
  L.push('export interface StyleFieldSpec {')
  L.push('  scope: StyleFieldScope')
  L.push('  domain: string')
  L.push('  valueType: string')
  L.push('  sources: StyleFieldSources')
  L.push('}')
  L.push('')
  L.push('/** 全字段注册表（键 = StyleIR 字段名；排序确定） */')
  L.push('export const STYLE_IR_FIELDS: Record<string, StyleFieldSpec> = {')
  for (const f of Object.keys(fields)) {
    const x = fields[f]
    const s = x.sources
    L.push(`  ${JSON.stringify(f)}: {`)
    L.push(`    scope: ${JSON.stringify(x.scope)},`)
    L.push(`    domain: ${JSON.stringify(x.domain)},`)
    L.push(`    valueType: ${JSON.stringify(x.valueType)},`)
    L.push('    sources: {')
    L.push(`      compiler: ${s.compiler === null ? 'null' : JSON.stringify(s.compiler)},`)
    L.push(`      matrixLevel: ${s.matrixLevel === null ? 'null' : JSON.stringify(s.matrixLevel)},`)
    L.push(`      runtimeWhitelist: ${s.runtimeWhitelist},`)
    L.push(`      runtimeForbidden: ${s.runtimeForbidden},`)
    L.push(`      consistencyMatrix: ${s.consistencyMatrix},`)
    L.push(`      inheritable: ${s.inheritable},`)
    L.push('    },')
    L.push('  },')
  }
  L.push('}')
  L.push('')
  L.push('/** 摘要（判据与官网数字读它——机器推导，非手写） */')
  L.push('export const STYLE_IR_SUMMARY = {')
  L.push(`  total: ${summary.total},`)
  L.push(`  semantic: ${summary.semantic},`)
  L.push(`  engineOnly: ${summary.engineOnly},`)
  L.push('  byDomain: {')
  for (const d of Object.keys(byDomain).sort()) L.push(`    ${JSON.stringify(d)}: ${byDomain[d]},`)
  L.push('  },')
  L.push('} as const')
  L.push('')
  return L.join('\n')
}

const content = render()

/* ── 判据 ── */
const problems = []
// ① 幂等
if (CHECK || !UPDATE) {
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (prev !== content) {
    problems.push('判据①（幂等）：注册表产物与重算不一致——跑 `pnpm run check:style-ir-schema --update` 刷新（更新是一次可见提交）')
  }
}
// ② schema 自洽
for (const [f, x] of Object.entries(fields)) {
  if (x.scope !== 'semantic' && x.scope !== 'engine-only') problems.push(`判据②：${f} 的 scope 非法（${x.scope}）`)
  if (!x.domain) problems.push(`判据②：${f} 缺域分类`)
  if (!x.valueType) problems.push(`判据②：${f} 缺值类型`)
}
// ③ 覆盖完整
const missing = [...new Set([...APP_FIELDS, ...MATRIX_KEYS, ...RUNTIME_ALLOW, ...FORBIDDEN, ...consistencyFields])].filter((f) => !(f in fields))
if (missing.length) problems.push(`判据③（覆盖完整）：以下字段不在注册表：${missing.join(', ')}`)
const semanticMissing = [...consistencyFields].filter((f) => fields[f]?.scope !== 'semantic')
if (semanticMissing.length) problems.push(`判据③：一致性矩阵字段未标 semantic：${semanticMissing.join(', ')}`)
// ④ 棘轮（对照基线文件；首次 --update 时创建）
let base = null
if (fs.existsSync(BASELINE)) base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
if (base) {
  if (summary.total < base.total) problems.push(`判据④（棘轮）：字段总数 ${summary.total} < 基线 ${base.total}（削减须显式说明并改基线）`)
  if (summary.semantic < base.semantic) problems.push(`判据④（棘轮）：semantic 数 ${summary.semantic} < 基线 ${base.semantic}`)
}

if (UPDATE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  fs.writeFileSync(BASELINE, JSON.stringify({ ...summary, note: 'G-61 B0 棘轮基线（只增不减）' }, null, 2) + '\n')
  console.log(`✅ 已写回 ${path.relative(ROOT, OUT)}`)
  console.log(`✅ 已刷新棘轮基线 ${path.relative(ROOT, BASELINE)}`)
}

console.log('StyleIR 字段注册表（G-61 B0 · 三表合一）')
console.log(`  字段 ${summary.total}（semantic ${summary.semantic} · engine-only ${summary.engineOnly}）`)
console.log(`  域分布：${Object.entries(summary.byDomain).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
console.log(`  一致性矩阵可表达字段 ${consistencyFields.size}（全部 semantic）`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ 注册表自洽（幂等 + schema + 覆盖完整 + 棘轮）')
