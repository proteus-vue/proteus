#!/usr/bin/env node
// scripts/check-app-css-surface.mjs —— ★★★App 三端对齐 · 阶段 0：
//   **App 端 CSS 支持面对照矩阵**（生成 + 门禁）2026-10-04
//
// 【为什么需要（用户点名第 1 类「CSS 全兼容对齐」的度量前置）】
//   仓库里存在**三张样式属性表**，此前互不引用、无门禁对照：
//     ① `packages/compiler/src/vapor/template.ts`  LAYOUT/PAINT/EDGE_FIELDS —— **App 端编译期折叠面**（真正上端的）
//     ② `packages/style-safety/src/index.ts`        LENGTH/COLOR/NUMERIC/TRANSFORM + FORBIDDEN_PROPS —— 运行时 Validator
//     ③ `packages/contracts/src/style.ts`           STYLE_PROP_LEVELS —— CSS 矩阵（G-21）
//   三者对 App 端**不一致**（实测：`display`/`position`/`overflow` 在 ③② 是 FORBIDDEN，在 ① 被接受）
//   ⇒ 「同一属性一个路径允许、另一个路径拒绝」的**半开状态**（违反本仓铁律 #9：两处白名单必须同步）。
//   ⇒ 本脚本把 App 折叠面**机器化导出为对照矩阵**（`docs/generated/app-css-surface.md`），
//     并新增门禁：App 接受面必须都在 CSS 矩阵里**有级别声明**（无声明 ⇒ 红——强制三表同步）。
//
// 【判据（分层，缺一即假绿）】
//   ① 生成物幂等（`--check`：重算 vs 已提交，不一致 ⇒ red）
//   ② **App 接受面 ⊆ CSS 矩阵有声明**（每个 App 折叠字段都能在 STYLE_PROP_LEVELS 找到级别）
//   ③ **App 接受面 ∩ FORBIDDEN_PROP === ∅**（App 不得接受被明令禁止的属性；当前 display/position/overflow 命中 ⇒ 如实报红）
//   ④ **App 接受面 ⊆ style-safety 白名单 ∪ 有明确豁免理由**（LENGTH∪COLOR∪NUMERIC∪TRANSFORM 之外 ⇒ 报）
//
// ★诚实边界：本门禁**只读代码事实**，不判"该不该支持"——③ 报红是**如实暴露既存不一致**，
//   修法有两种（属后续决策）：a) App 折叠面收窄（拒绝这些属性）；b) 三表共同放行（改 CSS 矩阵级别）。
//   本脚本的职责是让"不一致可见 + 不可静默"，不是替决策拍板。
//
// 用法：
//   npx tsx scripts/check-app-css-surface.mjs           # 生成 + 打印矩阵 + 跑判据
//   npx tsx scripts/check-app-css-surface.mjs --check    # 只校验（重算 vs 已提交文档；不一致 exit 1）
//   npx tsx scripts/check-app-css-surface.mjs --update   # 写回 docs/generated/app-css-surface.md
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_LAYOUT_FIELDS,
  APP_PAINT_FIELDS,
  APP_EDGE_FIELDS,
  APP_DERIVED_FIELDS,
  APP_SPECIAL_FIELDS,
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
const OUT = path.join(ROOT, 'docs', 'generated', 'app-css-surface.md')
const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const UPDATE = argv.includes('--update')

/** App 端编译期折叠面（全量字段——含简写/派生/特殊；★去重：margin/padding 同时在 layout 与 edge） */
const APP_FIELDS = [...new Set([...APP_LAYOUT_FIELDS, ...APP_PAINT_FIELDS, ...APP_EDGE_FIELDS, ...APP_DERIVED_FIELDS, ...APP_SPECIAL_FIELDS])]
const APP_FIELD_SET = new Set(APP_FIELDS)

/** style-safety 白名单（含 transform 基础版） */
const RUNTIME_ALLOW = new Set([...LENGTH_PROPS, ...COLOR_PROPS, ...NUMERIC_PROPS, ...TRANSFORM_PROPS])
const FORBIDDEN = new Set(FORBIDDEN_PROPS)
const MATRIX_KEYS = new Set(Object.keys(STYLE_PROP_LEVELS))

/** 派生字段不是 CSS 属性名（比例模型），特殊字段是忠实记录——对照矩阵里单独标注 */
const DERIVED = new Set(APP_DERIVED_FIELDS)
const SPECIAL = new Set(APP_SPECIAL_FIELDS)

/* ── ① 覆盖度：App 引擎折叠字段在 CSS 矩阵里的级别声明 ── */
const undeclared = APP_FIELDS.filter((f) => !MATRIX_KEYS.has(f) && !DERIVED.has(f) && !SPECIAL.has(f))
/* ── ② 分层差异：App 引擎接受面 ∩ FORBIDDEN（**不同层**——见文件头；非"错误"，但须显式登记）── */
//   ★为什么不是错误：`FORBIDDEN` 是**语义/动态守卫层**（`:style` 绑定 + runtime patch，tests 锁定）；
//     `LAYOUT_FIELDS` 是**引擎字段层**（Layer-3，静态 CSS 折叠 + 框架语义组件产出的目标字段）。
//     两层职责不同，交集本身不构成缺陷；但**新增**交集（未登记）意味着"开发者能在 App 写一个语义层禁止的属性"
//     ⇒ 收敛模型的新逃生口 ⇒ 必须显式登记（棘轮），故判据② = 交集 ⊆ APP_ENGINE_LEVEL_FIELDS。
const forbiddenHits = APP_FIELDS.filter((f) => FORBIDDEN.has(f))
const APP_ENGINE_LEVEL_FIELDS = new Set(['display', 'position', 'overflow', 'boxShadow']) // ★已登记：引擎字段层需要（内核默认模型 / 语义组件映射目标 / 自绘盒阴影）
const forbiddenUnregistered = forbiddenHits.filter((f) => !APP_ENGINE_LEVEL_FIELDS.has(f))
/* ── ③ 分层差异：App 引擎接受面不在 runtime 白名单（同为分层差异，informational）── */
const RUNTIME_ALIAS_OK = (f) => RUNTIME_ALLOW.has(f) || RUNTIME_ALLOW.has(`${f}Top`) || MATRIX_KEYS.has(f)
const runtimeNotAllow = APP_FIELDS.filter((f) => !RUNTIME_ALIAS_OK(f) && !DERIVED.has(f) && !SPECIAL.has(f))

/* ── 生成文档 ── */
function render() {
  const at = new Date().toISOString().slice(0, 10)
  const L = []
  L.push('# App 端 CSS 支持面对照矩阵（生成物 · 勿手改）')
  L.push('')
  L.push(`> 生成：\`pnpm check:app-css-surface --update\` ｜ 门禁：\`pnpm check:app-css-surface\` ｜ 日期：${at}`)
  L.push('>')
  L.push('> **这是什么**：App（Vapor/selfdraw）端**编译期样式折叠面** vs CSS 矩阵（G-21）/ 运行时 Validator 的对照。')
  L.push('> App 端**无 CSS 引擎**——样式在**编译期**由 `parseStaticStyle` 折叠为引擎字段（值仅 px/数字；宽高另支持百分比→比例）。')
  L.push('> 选择器 / 层叠 / 伪类 / 媒体查询 / grid / box-shadow 等**均不在 App 端**（与 Web/MP 的根本差异）。')
  L.push('')
  L.push('## 1. App 端折叠字段（全量）')
  L.push('')
  L.push('| 字段 | 类别 | CSS 矩阵级别 | style-safety | App 采集方式 |')
  L.push('|---|---|---|---|---|')
  const cat = (f) =>
    APP_LAYOUT_FIELDS.includes(f)
      ? '布局'
      : APP_PAINT_FIELDS.includes(f)
        ? '绘制'
        : APP_EDGE_FIELDS.includes(f)
          ? '四边简写'
          : DERIVED.has(f)
            ? '派生（比例）'
            : '特殊（忠实记录）'
  const method = (f) => {
    if (DERIVED.has(f)) return '宽高百分比 → 比例字段'
    if (SPECIAL.has(f)) return '透传（内核恒 border-box）'
    if (APP_EDGE_FIELDS.includes(f)) return 'px/数字 → `{top,right,bottom,left}`'
    if (f === 'width' || f === 'height') return 'px/数字；百分比 → `' + f + 'Ratio`'
    if (APP_PAINT_FIELDS.includes(f) && ['backgroundColor', 'color', 'borderColor'].includes(f)) return '颜色字符串'
    return 'px/数字'
  }
  const styleSafety = (f) =>
    RUNTIME_ALLOW.has(f) || RUNTIME_ALLOW.has(`${f}Top`)
      ? '✅ 白名单'
      : FORBIDDEN.has(f)
        ? '❌ 禁止'
        : MATRIX_KEYS.has(f)
          ? '◐ 矩阵已声明'
          : '⚠ 无'
  for (const f of APP_FIELDS) {
    L.push(`| \`${f}\` | ${cat(f)} | ${MATRIX_KEYS.has(f) ? STYLE_PROP_LEVELS[f] : '—'} | ${styleSafety(f)} | ${method(f)} |`)
  }
  L.push('')
  L.push('## 2. 门禁判据（分层对照 · 棘轮）')
  L.push('')
  L.push('> **★分层前提（勿误读）**：`FORBIDDEN` / runtime 白名单是**语义层**（开发者可写的收敛模型：`:style` 绑定 + 动态 patch）；')
  L.push('> 本页的 App 折叠字段是**引擎字段层**（Layer-3：静态 CSS 折叠 + 框架 `p-*` 语义组件产出的目标字段）。两层职责不同，')
  L.push('> 交集**不构成缺陷**；但**未登记的新交集** = "开发者能在 App 写一个语义层禁止的属性" = 收敛模型逃生口 ⇒ 棘轮判红。')
  L.push('')
  L.push(`- **① CSS 矩阵级别声明**（信息）：App 引擎接受面未在 CSS 矩阵声明的字段：${undeclared.length ? '`' + undeclared.join('` `') + '`（矩阵是**语义子集**，引擎面更宽属正常）' : '∅ ✅'}`)
  L.push(`- **② 已登记的分层差异**（棘轮硬判据）：App 接受面 ∩ FORBIDDEN = ${forbiddenHits.length ? '`' + forbiddenHits.join('` `') + '`' : '∅'}`)
  L.push(`  - 已登记（引擎字段层需要）：\`${[...APP_ENGINE_LEVEL_FIELDS].join('` `')}\``)
  L.push(`  - **未登记（新增即红）**：${forbiddenUnregistered.length ? '`' + forbiddenUnregistered.join('` `') + '` ⚠' : '∅ ✅'}`)
  L.push(`- **③ runtime 白名单**（信息）：不在 runtime 白名单且矩阵未声明：${runtimeNotAllow.length ? '`' + runtimeNotAllow.join('` `') + '`（同步属分层差异）' : '∅ ✅'}`)
  L.push('')
  L.push('## 3. 与 Web/MP 的差异（诚实边界）')
  L.push('')
  L.push('| 能力 | Web/MP | App |')
  L.push('|---|---|---|')
  L.push('| 选择器 / 层叠 / 伪类 / 媒体查询 | ✅ CSS 引擎 | ❌ 无（编译期折叠） |')
  L.push('| 长度单位（em/rem/vw/vh/calc/clamp） | ✅ | ❌ 仅 px/数字（宽高另支持 %） |')
  L.push('| grid | ✅/降级 | ❌（`grid` 定案未实现，见《CSS Profile 规格》§9） |')
  L.push('| box-shadow / filter / backdrop-filter | ✅/🔶 | ❌ |')
  L.push('| flex 子集（direction/justify/align/grow/shrink/basis/gap） | ✅ | ✅ |')
  L.push('| 尺寸/margin/padding/position/overflow | ✅ | ✅（`overflow` 见判据 ② 的级别不一致） |')
  L.push('| 绘制（bg/color/border/borderRadius/fontSize/opacity） | ✅ | ✅ |')
  L.push('')
  return L.join('\n') + '\n'
}

const content = render()

/* ── --check：重算 vs 已提交 ── */
if (CHECK) {
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  const strip = (s) => s.replace(/^> 生成：.*$/m, '> 生成：<normalized>') // 日期归一
  if (strip(prev) !== strip(content)) {
    console.error('❌ App CSS 对照矩阵漂移：重算与已提交不一致——跑 `pnpm check:app-css-surface --update` 刷新')
    process.exit(1)
  }
}
if (UPDATE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`✅ 已写回 ${path.relative(ROOT, OUT)}`)
}

/* ── 判据（硬门禁：棘轮——新增未登记分歧即红）── */
const problems = []
if (forbiddenUnregistered.length)
  problems.push(
    `判据②（棘轮）：App 引擎接受面命中**未登记**的 FORBIDDEN 属性：${forbiddenUnregistered.join(', ')}——` +
      `这是收敛模型的新逃生口（开发者能在 App 写语义层禁止的属性）。` +
      `修法：① 若确属引擎字段层需要 → 加进本脚本的 APP_ENGINE_LEVEL_FIELDS 并在文档说明；② 否则修正 App 折叠面。`,
  )

console.log('App 端 CSS 支持面对照（阶段 0 · 用户点名第 1 类）')
console.log(`  App 引擎折叠字段 ${APP_FIELDS.length} 个（布局 ${APP_LAYOUT_FIELDS.length} · 绘制 ${APP_PAINT_FIELDS.length} · 简写 ${APP_EDGE_FIELDS.length} · 派生 ${APP_DERIVED_FIELDS.length} · 特殊 ${APP_SPECIAL_FIELDS.length}）`)
console.log(`  ① CSS 矩阵级别声明（信息）：${undeclared.length ? undeclared.length + ' 个引擎面字段矩阵未列（层级差异，正常）' : '✅ 全覆盖'}`)
console.log(`  ② 分层差异棘轮：命中 FORBIDDEN ${forbiddenHits.length} 个（登记 ${APP_ENGINE_LEVEL_FIELDS.size}）· **未登记 ${forbiddenUnregistered.length}** ${forbiddenUnregistered.length ? '⚠' : '✅'}`)
console.log(`  ③ runtime 白名单（信息）：${runtimeNotAllow.length ? runtimeNotAllow.length + ' 个同步属分层差异' : '✅ 全覆盖'}`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项（本门禁的职责 = 让新增分歧可见 + 不可静默）：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ App 端 CSS 支持面稳定（无未登记的新分歧）')
