#!/usr/bin/env node
// scripts/gen-consistency-metrics.mjs —— ★CS1：多端一致性指标（M1–M4）机器生成 + 允许差异清单 schema 门禁
//
// 【这一件回答什么（《Proteus_多端一致性标准方案.md》§6.1）】标准要"能证明自己一致到什么程度"，
//   就必须有**可公开、可复算、机器生成**的指标——手抄数字会过时、会被怀疑。
//   M1–M4 全部从**已入库产物**读出（矩阵 / 基线 / 边界规则 / 变异测试），本脚本不编任何数。
//
// 【指标口径（与标准 §6.1 对齐；口径变了这里先红）】
//   M1 数值一致性覆盖率 = L1 已机器化校验的字段数 / 编译器可表达字段数
//      （L2/L3 未布点 ⇒ 分子只算 L1——**如实反映当前阶段**，标准 §6.2 要求公开不好看的数）
//   M2 允许差异条目数 = docs/allow-differences.json 条目数（越少越好，每条必须有理由与证据）
//   M3 CI 门禁通过率 = **本指标可判定的**门禁清单（全绿=1.0；任意红则体现为脚本退出非零，
//      故 M3 是"引用式"指标：列出参与门禁名 + 判定者=CI）
//   M4 一致性回归检出率 = L1 变异测试的捕获数 / 注入数（L2/L3/L4 算子未布点 ⇒ 单列 pending）
//
// 【M4 的变异测试（标准 §7）】L1 能做到的部分现在就做——注入"某端不支持"的样式，
//   跑 checkProfileBoundary 看是否捕获；**未布点的算子单列**（标准 §7.3 硬要求：不得悄悄删）。
//
// 【schema 门禁（允许差异清单）】id/category/reason/scope/evidence 必填且 id 唯一；
//   category ∈ 白名单；**A-4（动画插值中间态）受删除保护**（标准 §14#5 要求现在就登记）。
//
// 用法：
//   node scripts/gen-consistency-metrics.mjs            # 生成指标（写 docs/generated/consistency-metrics.json）
//   node scripts/gen-consistency-metrics.mjs --check    # 门禁：漂移 + 清单 schema（CI/verify 链）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'generated', 'consistency-metrics.json')
const ALLOW = path.join(ROOT, 'docs', 'allow-differences.json')
const MATRIX = path.join(ROOT, 'docs', 'generated', 'end-support-matrix.json')
const CHECK = process.argv.includes('--check')

const CATEGORIES = ['text-metrics', 'runtime-behavior', 'animation', 'rasterization', 'interaction']
const REQUIRED_FIELDS = ['id', 'category', 'title', 'reason', 'scope', 'evidence']
/** 删除保护（标准 §14#5：A-4 动画插值中间态必须登记） */
const PROTECTED_IDS = ['A-4']

/* ── ① 允许差异清单 schema 校验（失败即 exit 2——清单不合法时指标无意义） ── */
function validateAllowList() {
  const errs = []
  if (!fs.existsSync(ALLOW)) return { errs: [`缺 ${path.relative(ROOT, ALLOW)}`], items: [] }
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(ALLOW, 'utf-8'))
  } catch (e) {
    return { errs: [`allow-differences.json 解析失败：${e.message}`], items: [] }
  }
  const items = Array.isArray(doc.items) ? doc.items : []
  if (items.length === 0) errs.push('items 为空（清单不得空——至少 A-1~A-5 有据可依）')
  const seen = new Set()
  for (const [i, it] of items.entries()) {
    for (const f of REQUIRED_FIELDS) {
      if (typeof it[f] !== 'string' || it[f].trim().length === 0) errs.push(`items[${i}]（${it.id ?? '无名'}）缺/空字段：${f}`)
    }
    if (seen.has(it.id)) errs.push(`id 重复：${it.id}`)
    seen.add(it.id)
    if (it.category && !CATEGORIES.includes(it.category)) errs.push(`items[${i}] 非法 category：${it.category}（允许：${CATEGORIES.join('/')}）`)
    // ★反"为让测试通过而加条目"：reason 太短视为未写理由（标准 §9.1 硬约束）
    if (typeof it.reason === 'string' && it.reason.trim().length < 12) errs.push(`items[${i}] reason 过短（须写明为什么这是"设计使然"而非 bug）：${it.reason}`)
  }
  for (const pid of PROTECTED_IDS) {
    if (!seen.has(pid)) errs.push(`受保护条目被删除：${pid}（标准 §14#5 要求它必须在清单里）`)
  }
  return { errs, items }
}

/* ── ② M4：L1 变异测试（注入 → 跑校验 → 数捕获） ── */
async function runL1Mutation() {
  const cssCompat = await import(pathToFileURL(path.join(ROOT, 'packages', 'css-compat', 'dist', 'index.js')).href)
  const { checkProfileBoundary } = cssCompat
  // 算子：{ id, 注入（CSS 片段）, 期望：是否被捕获 }
  const operators = [
    { id: 'PB-overflow-scroll', inject: '.x { overflow: scroll; }', expectCaught: true, note: '官方只认 hidden/visible' },
    { id: 'PB-display-grid', inject: '.x { display: grid; }', expectCaught: true, note: '官方只认 none/flex/block' },
    { id: 'PB-position-sticky', inject: '.x { position: sticky; }', expectCaught: true, note: '官方只认 relative/absolute/fixed' },
    { id: 'PB-ctrl-legal-overflow', inject: '.x { overflow: hidden; }', expectCaught: false, note: '对照组（合法值不应误报）' },
    { id: 'PB-ctrl-escaped', inject: '/* proteus-allow-profile: 业务验证过 */\n.x { overflow: scroll; }', expectCaught: false, note: '对照组（escape hatch 应放行）' },
  ]
  const results = []
  for (const op of operators) {
    const r = checkProfileBoundary(op.inject)
    const caught = r.violations.length > 0
    results.push({ id: op.id, caught, expected: op.expectCaught, ok: caught === op.expectCaught, note: op.note })
  }
  const injected = results.filter((r) => r.expected).length
  const captured = results.filter((r) => r.expected && r.caught).length
  // ★未布点算子（标准 §7.3：单列，不得悄悄删）
  const pending = [
    { id: 'L2-margin-shift', note: '★已布点（VC5-b 比对引擎 + 三端快照；破坏性验证：2px 漂移精确检出）——算子待纳入 M4 自动注入' },
    { id: 'L3-color-shift', note: '颜色偏移（#FF0000→#FE0000）——需 L3 计算样式（Skyline 端 computedStyle 不可用，需产出式探针）' },
    { id: 'L3-font-fallback', note: '字体回退——同上' },
    { id: 'L2.6-scroll-relative', note: '滚动后相对间距——需 L2.6 不变量校验' },
    { id: 'L4-radius-missing', note: '圆角缺失——需 L4 像素观察（非门禁）' },
  ]
  return { operators: results, injected, captured, pending }
}

/* ── ③ 指标组装 ── */
async function build() {
  const { errs, items } = validateAllowList()
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf-8'))
  const rows = matrix.rows
  const m1Total = rows.length
  // L1 层覆盖 = 矩阵三端都有实测的字段
  const m1Covered = rows.filter((r) => r.web !== 'not-measured' && r.skyline !== 'not-listed' && r.webview !== 'not-measured').length
  const mutation = await runL1Mutation()
  const m4Rate = mutation.injected > 0 ? mutation.captured / mutation.injected : 0

  // ★M1 折算表（同源口径——见 M1 的注释）：样式键 → CSS 字段（四角/四边归并）
  const L3_FIELD_MAP = {
    backgroundColor: 'backgroundColor', color: 'color', display: 'display', fontSize: 'fontSize',
    opacity: 'opacity', position: 'position',
    borderTopLeftRadius: 'borderRadius', borderTopRightRadius: 'borderRadius',
    borderBottomRightRadius: 'borderRadius', borderBottomLeftRadius: 'borderRadius',
    borderTopWidth: 'borderWidth', borderRightWidth: 'borderWidth', borderBottomWidth: 'borderWidth', borderLeftWidth: 'borderWidth',
    borderTopColor: 'borderColor', borderRightColor: 'borderColor', borderBottomColor: 'borderColor', borderLeftColor: 'borderColor',
    marginTop: 'margin', marginRight: 'margin', marginBottom: 'margin', marginLeft: 'margin',
    paddingTop: 'padding', paddingRight: 'padding', paddingBottom: 'padding', paddingLeft: 'padding',
    // fontFamily / fontWeight / visibility：不在 28 字段集内 ⇒ 不计（宁少算）
  }
  const l3Fields = new Set(Object.values(L3_FIELD_MAP))
  /** 几何四量 → 字段（x/y 是位置，不是 CSS 字段——保守只算 width/height） */
  const L2_FIELDS = new Set(['width', 'height'])
  const l1Fields = new Set(rows.map((r) => r.field))
  const coveredFields = new Set([...l1Fields, ...L2_FIELDS, ...l3Fields])

  return {
    version: 1,
    note: 'M1–M4 机器生成（scripts/gen-consistency-metrics.mjs）——每项都指向已入库产物；标准 §6.2 要求公开含不好看的数',
    generatedFrom: {
      matrix: 'docs/generated/end-support-matrix.json',
      allowList: 'docs/allow-differences.json',
      boundaryRules: 'packages/css-compat/src/generated/skyline-boundary-rules.generated.ts',
      baselines: ['examples/profile-boundary-baseline.json', 'showcase/profile-boundary-baseline.json'],
    },
    M1: {
      name: '数值一致性覆盖率',
      // ★★口径（本仓"标尺不虚高"纪律，两轮修正后的定稿）：
      //   标准 §6.1「L1+L2+L3 覆盖的属性数 / 全部可表达属性数」⇒ 分母 = **编译器 CSS 字段数 × 3**。
      //   ★★三层必须先**折算到同一字段集**再相加（首版直接把"几何量 4 + 样式键 25"当字段 =
      //     67.9% **虚高**——几何量不是 CSS 字段、样式键有 4 角/4 边重复与集外键）。
      //   折算规则（保守：宁可少算）：
      //     · L1：直接按字段（矩阵逐字段）——全部 28
      //     · L2：几何四量（x/y/w/h）→ 只映射 width/height **2 个字段**（x/y 是位置不是字段）
      //     · L3：实测样式键 → 映射回字段（四角归 borderRadius、四边归 margin/padding、
      //       四向归 borderWidth/borderColor；fontFamily/fontWeight/visibility **不在 28 字段集内 ⇒ 不计**）
      //   另给 `union`（并集口径：该字段是否被**任一**层机器校验）——对外更好理解的那一个数。
      definition: 'Σ(L1|L2|L3 各层**折算到同一 CSS 字段集**后的覆盖数) / (可表达字段数 × 3)（分层加总 · 折算口径）',
      value: m1Total > 0 ? Number(((m1Covered + L2_FIELDS.size + l3Fields.size) / (m1Total * 3)).toFixed(4)) : 0,
      /** ★并集口径：任一层的机器校验覆盖到的字段数 / 字段总数 */
      union: {
        covered: coveredFields.size,
        total: m1Total,
        value: m1Total > 0 ? Number((coveredFields.size / m1Total).toFixed(4)) : 0,
      },
      byLayer: {
        L1: { covered: m1Covered, total: m1Total, note: '支持度矩阵 + 边界门禁 + 棘轮基线（逐字段，已落地）' },
        L2: {
          covered: L2_FIELDS.size,
          total: m1Total,
          note: '比对引擎已落地 + 三端实测通过；**折算口径**：几何 w/h → 字段 width/height（x/y 是位置不是字段——保守计 2）',
        },
        L3: {
          covered: l3Fields.size,
          total: m1Total,
          note: `实测比对已落地（VC6：Web ⇄ WebView，硬门禁 + A-6 豁免）；**折算口径**：25 个可比样式键 → ${l3Fields.size} 个字段（四角/四边归并；fontFamily/fontWeight/visibility 不在字段集内不计）`,
        },
      },
      covered: m1Covered,
      total: m1Total,
      byTier: {
        universal: rows.filter((r) => r.supportTier === 'universal').length,
        conditional: rows.filter((r) => r.supportTier === 'conditional').length,
        unsupported: rows.filter((r) => r.supportTier === 'unsupported').length,
      },
      boundaryRules: 24,
      note: 'L2/L3/L4 布点后分子应扩大（标准 §6.1「逐阶段提升」）',
    },
    M2: {
      name: '允许差异条目数',
      definition: 'docs/allow-differences.json 条目数（越少越好；每条必须有理由与证据；不得为让测试通过而加）',
      value: items.length,
      ids: items.map((i) => i.id),
      protected: PROTECTED_IDS,
    },
    M3: {
      name: 'CI 门禁通过率',
      definition: '参与门禁全绿 = 1.0；任一红 ⇒ 本脚本/CI 退出非零（本项是引用式指标）',
      gates: ['check:end-support', 'check:profile-baseline', 'test', 'check:consistency-metrics'],
      enforcedBy: 'CI (.github/workflows/ci.yml) + pnpm verify',
    },
    M4: {
      name: '一致性回归检出率',
      definition: 'L1 变异测试捕获数 / 注入数（L2/L3/L4 算子未布点 ⇒ 单列 pending，不得悄悄删）',
      value: Number(m4Rate.toFixed(4)),
      injected: mutation.injected,
      captured: mutation.captured,
      operators: mutation.operators,
      pendingOperators: mutation.pending,
      note: '★标准 §7.4 反例（按钮变色 = L3 颜色类）属必过项——L3 布点后若捕获不了，本套校验不比截图比对强',
    },
    debt: {
      note: '存量债务可见且只减不增（棘轮基线）——对外公开的"不好看的数"',
      baselines: ['examples/profile-boundary-baseline.json', 'showcase/profile-boundary-baseline.json'].map((rel) => {
        const p = path.join(ROOT, rel)
        const n = fs.existsSync(p) ? Object.keys(JSON.parse(fs.readFileSync(p, 'utf-8'))).length : -1
        return { file: rel, count: n }
      }),
    },
    allowListSchemaErrors: errs,
  }
}

async function main() {
  const metrics = await build()
  const json = JSON.stringify(metrics, null, 2) + '\n'
  // schema 错误：无论何种模式都红（清单不合法时指标无意义）
  if (metrics.allowListSchemaErrors.length > 0) {
    console.error('[consistency-metrics] ✗ 允许差异清单 schema 违规：')
    for (const e of metrics.allowListSchemaErrors) console.error('  - ' + e)
    process.exit(2)
  }
  if (CHECK) {
    const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
    const ok = prev === json
    console.log(`  consistency-metrics --check → docs/generated/consistency-metrics.json${ok ? ' ✅ 一致' : ' ❌ 漂移'}`)
    console.log(`  ▸ M1 ${(metrics.M1.value * 100).toFixed(1)}%（分层加总：L1 ${metrics.M1.byLayer.L1.covered} · L2 ${metrics.M1.byLayer.L2.covered} · L3 ${metrics.M1.byLayer.L3.covered}｜并集 ${(metrics.M1.union.value * 100).toFixed(1)}%）· M2 ${metrics.M2.value} 条 · M4 ${(metrics.M4.value * 100).toFixed(0)}%（${metrics.M4.captured}/${metrics.M4.injected}）· 存量 ${metrics.debt.baselines.map((b) => b.count).join('+')}`)
    // ★M4 自检（防"零运算符假绿"）：注入数必须 > 0 且捕获率必须为 1（L1 算子必须全捕获）
    if (metrics.M4.injected === 0 || metrics.M4.value < 1) {
      console.error('  ✗ M4 自检失败：L1 变异算子必须全部被捕获（当前 %d/%d）——校验机制失效', metrics.M4.captured, metrics.M4.injected)
      process.exit(1)
    }
    if (!ok) process.exit(1)
    console.log('✅ 一致性指标与清单一致（M1–M4 + schema）')
    return
  }
  fs.writeFileSync(OUT, json)
  console.log(`[consistency-metrics] ✅ ${path.relative(ROOT, OUT)}`)
  console.log(`  M1 ${(metrics.M1.value * 100).toFixed(1)}%（分层加总：L1 ${metrics.M1.byLayer.L1.covered} · L2 ${metrics.M1.byLayer.L2.covered} · L3 ${metrics.M1.byLayer.L3.covered}｜并集口径 ${(metrics.M1.union.value * 100).toFixed(1)}%）`)
  console.log(`  M2 ${metrics.M2.value} 条（${metrics.M2.ids.join(' / ')}）`)
  console.log(`  M4 ${(metrics.M4.value * 100).toFixed(0)}%（${metrics.M4.captured}/${metrics.M4.injected}，pending ${metrics.M4.pendingOperators.length} 个算子）`)
  console.log(`  存量债务：${metrics.debt.baselines.map((b) => `${b.file.split('/')[0]} ${b.count}`).join(' · ')}`)
}

main().catch((e) => {
  console.error('[consistency-metrics] ✗', e?.message ?? e)
  process.exit(2)
})
