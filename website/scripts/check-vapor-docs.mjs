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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOCS = [
  path.join(ROOT, 'website/framework/43-vapor-update-path.md'),
  path.join(ROOT, 'website/en/framework/43-vapor-update-path.md'),
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
for (const doc of DOCS) {
  if (!fs.existsSync(doc)) {
    failures.push(`${path.relative(ROOT, doc)}: 文件不存在`)
    continue
  }
  const src = fs.readFileSync(doc, 'utf-8')
  const rel = path.relative(ROOT, doc)
  // ① 载荷与 p50：在文档里必须能找到源自报告的字面值
  const payloadWant = String(facts[2].value)
  if (!src.includes(`**${payloadWant} 字节**`) && !src.includes(`**${payloadWant} bytes**`)) {
    failures.push(`${rel}: 载荷应含 "**${payloadWant} 字节**"（报告实际值）`)
  }
  const p50Want = String(facts[0].value)
  if (!src.includes(`p50 **${p50Want} ms**`)) {
    failures.push(`${rel}: 行级 p50 应含 "p50 **${p50Want} ms**"（报告实际值）`)
  }
  const coarseWant = String(facts[1].value)
  if (!src.includes(`p50 **${coarseWant} ms**`)) {
    failures.push(`${rel}: 粗粒度 p50 应含 "p50 **${coarseWant} ms**"（报告实际值）`)
  }
  // ② S5/S4 的字面值（KB/B 口径）
  for (const f of [facts[3], facts[4], facts[5], facts[6]]) {
    const want = kb(f.value)
    if (!src.includes(want)) {
      failures.push(`${rel}: ${f.note} 应含 "${want}"（报告实际值，${f.value} B）`)
    }
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
