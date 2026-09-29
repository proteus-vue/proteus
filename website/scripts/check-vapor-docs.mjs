#!/usr/bin/env node
// website/scripts/check-vapor-docs.mjs —— ★★Vapor 文档数字门禁（卡 I1 配套 + 官网数字纪律）
//
// 【为什么需要（本仓实测的漂移）】
//   `website/framework/43-vapor-update-path.md` 与 en 版引用了 7 个性能数字
//   （p50 / 载荷 / 结构变更 / 文本变更 / relayout / culling）。而 `check:stats` **只覆盖
//   `stats.ts` 的 8 项静态计数**（包数/原语/组件…），**不覆盖性能数字**。
//   ⇒ 一旦重跑真机/基准，报告数字会变而文档不变——**写的时候对、半年后错**。
//   本仓已吃过同类亏：`绘制 0.667`（子项冒充整体）在 4 份文档里躺了很久才被发现。
//
// 【判据设计】对每个"文档声明的数字"，从**其声称的数据源**重新读出并比对：
//     · 真机报告类：读 `hosts/ios/results/bench-filtered-*.json` 的字段（值 == 文档值）
//     · 基准脚本类：跑脚本拿读数——★**代价高**，故选**可复算的静态部分**
//       （如 culling 直接用 `emitRenderCmds` 求值，不起 Node 子进程跑完整基准）
//   ★不比对"比值"（如 ↓90.1%）——比值对分母敏感（本仓纪律 #34），只锁定**原始读数**。
//
// 用法：node website/scripts/check-vapor-docs.mjs
// 退出码：0 通过 / 1 漂移
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
/**
 * ★★分组断言（2026-09-29 修正）：**"扫描面"与"断言集"是两件事**
 *
 * 【为什么必须分开（本仓实测的假阳性）】首版把几个页面放进同一个 DOCS 列表，
 *   然后对**每个文件**断言"应包含载荷 45 字节 / p50 0.121ms / S5 的 67KB…"——
 *   而那些数字**只属于 Vapor 页**；Rust 排版核心页与 FAQ 讲的是别的东西
 *   ⇒ 一次跑出 **28 处假阳性**，门禁立刻变成噪音源（会被关掉，见《实战采集埋点清单》§2.1 同源教训）。
 *   ⇒ 正解：每个文件声明**它自己**应当出现的数字名（从 `facts` 里按 key 取），
 *     而不是"全表套用到所有文件"。
 */
const VAPOR_NUMBERS = [
  'single_node_update_row_p50_ms', 'single_node_update_coarse_p50_ms', 'payload_bytes',
  's5_grow', 's5_shrink', 's5_head', 's4_patch',
]
const DOCS = [
  { file: 'website/framework/43-vapor-update-path.md', numbers: VAPOR_NUMBERS },
  { file: 'website/en/framework/43-vapor-update-path.md', numbers: VAPOR_NUMBERS },
  // Rust 排版核心页：引用 culling 的指令条数（**可确定性重算**）
  // ★只锁**指令条数**、不锁耗时（14→2ms 是墙钟，跨机不可比——与本仓纪律
  //   「比值可信、绝对值不跨轮比」同源；耗时在页面里标注为"本机读数"）
  {
    file: 'website/framework/28-rust-layout-and-render-cmd.md',
    numbers: ['cull_full_cmds', 'cull_kept_cmds'],
  },
  {
    file: 'website/en/framework/28-rust-layout-and-render-cmd.md',
    numbers: ['cull_full_cmds', 'cull_kept_cmds'],
  },
  // FAQ：机制描述（当前无实测数字）
  { file: 'website/guides/36-faq.md', numbers: [] },
  { file: 'website/en/guides/36-faq.md', numbers: [] },
]

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'))
const caseOf = (rel, name) => {
  const d = readJson(rel)
  const c = (d.js_report?.cases ?? []).find((x) => x.case === name)
  if (!c) throw new Error(`${rel} 里没有用例 ${name}（报告被重跑覆盖了？）`)
  return c
}

// ── 从数据源重算「文档应当声明的值」────────────────────────────────────────
const facts = []
try {
  const v11 = caseOf('hosts/ios/results/bench-filtered-V11.json', 'V11_long_list')
  const rowLevel = v11.extra?.single_node_update_row_level ?? {}
  const coarse = v11.extra?.single_node_update ?? {}
  facts.push({ key: 'single_node_update_row_p50_ms', value: rowLevel.p50_ms, note: 'V11 行级失效 p50' })
  facts.push({ key: 'single_node_update_coarse_p50_ms', value: coarse.p50_ms, note: 'V11 粗粒度 p50' })
  facts.push({ key: 'payload_bytes', value: rowLevel.payload_bytes, note: 'V11 单次更新载荷' })

  const s5 = readJson('hosts/ios/results/bench-filtered-S5.json').js_report.cases
  const pick5 = (n) => s5.find((c) => c.case === n)?.request_bytes
  // 文档用 /1000 口径写 KB（与既有文档一致）；526B 为字节原值
  facts.push({ key: 's5_grow', value: pick5('S5_grow_600_splice'), note: 'S5 增 100 行 splice 字节' })
  facts.push({ key: 's5_shrink', value: pick5('S5_shrink_500_splice'), note: 'S5 删 100 行 splice 字节' })
  facts.push({ key: 's5_head', value: pick5('S5_head_insert_splice'), note: 'S5 头部插入 splice 字节' })

  const s4 = readJson('hosts/ios/results/bench-filtered-S4.json').js_report.cases
  facts.push({ key: 's4_patch', value: s4.find((c) => c.case === 'S4_text_churn_patch')?.request_bytes, note: 'S4 文本补丁字节' })
} catch (e) {
  console.error(`✗ 数据源读取失败：${e.message}`)
  console.error('  ⇒ 报告缺失/被重跑改名时，本门禁会失败——这是**有意的**（文档数字失去出处不该静默）')
  process.exit(1)
}

// ★culling 指令条数（**从代码重算**，非抄文档）：400×40 场景、视口 1080×800
//   —— 起一次 tsx 子进程求值（与 `scripts/gen-instruction-spec.mjs` 同法；实测 ~0.7s）
try {
  const probe = `
import { layoutTreeFromPNode, solveLayout, emitRenderCmds, attachParents } from ${JSON.stringify(path.join(ROOT, 'packages/layout-core/src/index.ts'))}
const L = (dp) => ({ kind: 'absolute', dp })
const pn = (o) => ({ kind: 'view', props: { layout: {}, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } }, children: [], flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false }, ...o })
const painted = (o) => pn({ id: o.id, props: { layout: { flexDirection: 'column', width: L(o.w), height: L(o.h), flexShrink: 0 }, paint: { backgroundColor: '#285ac8' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
const V = { viewportWidth: 1080, viewportHeight: 2400, fontSize: 16, rootFontSize: 16 }
const ROWS = 400, COLS = 40, CW = 30, CH = 18, G = 1
const root = pn({ id: 1, props: { layout: { flexDirection: 'column', width: L(COLS * (CW + G)), height: L(ROWS * (CH + G)) }, paint: { backgroundColor: '#000' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
let id = 100
root.children = Array.from({ length: ROWS }, () => { const r = pn({ id: id++, props: { layout: { flexDirection: 'row', height: L(CH + G), flexShrink: 0, width: L(COLS * (CW + G)) }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } }); r.children = Array.from({ length: COLS }, () => painted({ id: id++, w: CW, h: CH })); return r })
const tree = layoutTreeFromPNode([root], { lengthContext: V })
solveLayout(tree[0], { maxWidth: 1080, maxHeight: Infinity })
attachParents(tree[0])
const full = emitRenderCmds(tree)
const culled = emitRenderCmds(tree, { cullToViewport: true, viewportWidth: 1080, viewportHeight: 800 })
process.stdout.write(JSON.stringify({ full: full.stats.cmdCount, kept: culled.stats.cmdCount }))
`
  const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })
  const c = JSON.parse(raw.trim().split('\n').pop())
  facts.push({ key: 'cull_full_cmds', value: c.full, note: 'culling 全量指令数（400×40）' })
  facts.push({ key: 'cull_kept_cmds', value: c.kept, note: 'culling 裁剪后指令数' })
} catch (e) {
  console.error(`✗ culling 数字重算失败：${e.message}`)
  process.exit(1)
}

// ── 文档里「应当出现」的字面串（与上面 facts 派生，避免手写第二份）──────────
const kb = (bytes) => (bytes >= 1000 ? `${Math.round(bytes / 1000)}KB` : `${bytes}B`)
const expected = [
  { label: '单节点更新（行级失效）p50', re: /p50 \*\*([\d.]+) ms\*\*/, want: String(facts[0].value) },
  { label: '单节点更新（粗粒度）p50', re: /p50 \*\*([\d.]+) ms\*\*/, want: String(facts[1].value) },
  { label: '单次更新载荷', re: /\*\*(\d+) bytes\*\*|\*\*(\d+) 字节\*\*/, want: String(facts[2].value) },
  { label: 'S5 增 100 行 splice', re: /→\*\*([\d]+KB)\*\*/g, want: kb(facts[3].value) },
  { label: 'S5 删 100 行 splice', re: /\*\*(\d+B)\*\*/, want: kb(facts[4].value) },
  { label: 'S5 头部插入 splice', re: /→\*\*([\d]+KB)\*\*/g, want: kb(facts[5].value) },
  { label: 'S4 文本补丁', re: /→\*\*([\d]+KB)\*\*/g, want: kb(facts[6].value) },
]

const failures = []
for (const { file, numbers } of DOCS) {
  const doc = path.join(ROOT, file)
  if (!fs.existsSync(doc)) {
    failures.push(`${file}: 文件不存在`)
    continue
  }
  const src = fs.readFileSync(doc, 'utf-8')
  const rel = file
  const want = (key) => numbers.includes(key)
  // ★每条断言都先问「本文件**该**出现这个数字吗」（见 DOCS 分组注释——防假阳性）
  if (want('payload_bytes')) {
    const v = String(facts[2].value)
    if (!src.includes(`**${v} 字节**`) && !src.includes(`**${v} bytes**`)) {
      failures.push(`${rel}: 载荷应含 "**${v} 字节**"（报告实际值）`)
    }
  }
  if (want('single_node_update_row_p50_ms')) {
    const v = String(facts[0].value)
    if (!src.includes(`p50 **${v} ms**`)) failures.push(`${rel}: 行级 p50 应含 "p50 **${v} ms**"（报告实际值）`)
  }
  if (want('single_node_update_coarse_p50_ms')) {
    const v = String(facts[1].value)
    if (!src.includes(`p50 **${v} ms**`)) failures.push(`${rel}: 粗粒度 p50 应含 "p50 **${v} ms**"（报告实际值）`)
  }
  // culling 指令条数（确定性；页面写作 `16001 → 1592`）
  if (want('cull_full_cmds') && want('cull_kept_cmds')) {
    const f = facts.find((x) => x.key === 'cull_full_cmds').value
    const k = facts.find((x) => x.key === 'cull_kept_cmds').value
    if (!src.includes(`**${f} → ${k}`)) {
      failures.push(`${rel}: culling 应含 "**${f} → ${k}（↓${(((f - k) / f) * 100).toFixed(1)}%）**"（代码重算值）`)
    }
  }
  // S5/S4 的字面值（KB/B 口径）——逐项按 numbers 过滤
  const byKey = { s5_grow: facts[3], s5_shrink: facts[4], s5_head: facts[5], s4_patch: facts[6] }
  for (const [key, f] of Object.entries(byKey)) {
    if (!want(key)) continue
    const v = kb(f.value)
    if (!src.includes(v)) failures.push(`${rel}: ${f.note} 应含 "${v}"（报告实际值，${f.value} B）`)
  }
}

if (failures.length) {
  console.error(`✗ Vapor 文档数字漂移（${failures.length} 处）：`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\n  ⇒ 改文档使数字与报告一致；若报告本身被重跑覆盖，需同步更新文档（这是有意的摩擦）')
  process.exit(1)
}
console.log('✅ Vapor 文档数字与真机报告一致')
for (const f of facts) console.log(`   · ${f.note}: ${f.value}`)
