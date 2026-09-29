// scripts/bench-list-update.mjs —— ★★列表更新的**本地基准**（零设备 · 秒级迭代）
//
// 【为什么需要（2026-09-29 实测教训）】真机上测得「1000 行列表改 1 行 ⇒ 11ms」，
//   其中 **7ms 在"源触发 + 全行扫描 + diff + 编码"**。而定位它需要反复试改动 ——
//   用真机做这件事的代价是每轮 ~3 分钟（编译 Rust + 签名 + 装机 + 跑）。
//   ★纪律（本仓已在验收脚本上吃过亏）：**改代码不要拿真机当调试器**。
//   ⇒ 本脚本在 Node 里跑**同一条通路**（同一份 SFC → 同一份订阅表 → 同一份实例化 +
//     list-item 扫描），**不涉及宿主**（那 4ms 是 JSON 编组 + JNI + 核心应用，本地测不了也不该测）。
//
// 【测什么】`writeListItems` 一条更新周期的 JS 成本，并**分段**：
//   ① rowsOfList（按 sourceExpr 展开行集 + 建 RowRef）
//   ② 逐槽位逐行：求值 + 值 diff
//   ③ emit（编码进 buffer）
//
// 用法：npx tsx scripts/bench-list-update.mjs [行数] [迭代数]
import { buildVaporSubscriptions, buildLayoutTemplate } from '../packages/compiler/src/index.ts'
import {
  SlotRuntime, VaporRuntime, PropKeyTable, StringPool, ListRegistry, instantiateTemplate,
} from '../packages/slot-runtime/src/index.ts'

const ROWS = Number(process.argv[2] ?? 1000)
const ITERS = Number(process.argv[3] ?? 200)

// ★与 `hosts/ios/bridge/gen-vapor-table.mjs` **同一份 SFC**（可比性：真机读数来自它）
const SFC = `<template>
  <p-view style="flex-direction: column; padding-top: 60px; padding-left: 16px; background-color: #101020">
    <p-text style="font-size: 24px; color: #ffffff; margin-bottom: 12px">Vapor 全量 SFC</p-text>
    <p-view v-for="item in list" :key="item.id" style="flex-direction: row; align-items: center; height: 56px; flex-shrink: 0; margin-bottom: 8px; background-color: #1b1b21; border-radius: 12px">
      <p-view :width="item.dotW" style="height: 36px; flex-shrink: 0; background-color: #6f4ae8; border-radius: 18px" />
      <p-text :width="item.textW" style="font-size: 16px; color: #ffffff">{{ item.title }}</p-text>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, dotW: 36, textW: 120, title: 'a' }])
</script>
`

const tpl = buildLayoutTemplate(SFC, 'bench.vue').template
const { table } = buildVaporSubscriptions(SFC, 'bench.vue')

const rows = Array.from({ length: ROWS }, (_, i) => ({ id: i + 1, dotW: 36, textW: 120, title: `行 ${i + 1}` }))
const data = { list: rows }
const registry = new ListRegistry()
const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table, registry })

const keys = new PropKeyTable()
const strings = new StringPool()
const sink = []
const rt = new SlotRuntime(keys, strings, (b) => sink.push(b))
const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), registry)
const triggers = new Map()
const loadRes = vapor.load({ read: (n) => data[n] }, (name, cb) => triggers.set(name, cb))
vapor.relink({ read: (n) => data[n] })
rt.flush()

console.log(`[bench] 行 ${ROWS} · 节点 ${inst.nodes.length} · L1 槽位 ${loadRes.l1Slots} · L0 ${loadRes.l0Slots}`)
console.log(`[bench] 订阅表 list-item 槽位：${table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item').length} 个`)

// ── 测量：每轮改第 500 行的一格，触发源，flush ──
const flushBefore = rt.getStats().flushes
const opsBefore = rt.getStats().opsEmitted   // ★relink 首帧已发全量槽位 ⇒ 用**增量**判定
// ★三段分离（与真机同一口径）：① 造数据 ② **扫描+diff**（trigger 调用）③ 编码（flush）
const samples = []
const setTotal = []
const scanTotal = []
const flushTotal = []
let bytesTotal = 0
const T0 = process.hrtime.bigint()
for (let i = 0; i < ITERS; i++) {
  const t0 = process.hrtime.bigint()
  const next = rows.map((r, idx) => (idx === 499 ? { ...r, dotW: i % 2 ? 60 : 36 } : r))
  rows.length = 0
  rows.push(...next)
  data.list = next
  const t1 = process.hrtime.bigint()
  triggers.get('list')?.()
  const t2 = process.hrtime.bigint()
  rt.flush()
  const b = sink.pop()
  if (b) bytesTotal += b.length
  const t3 = process.hrtime.bigint()
  setTotal.push(Number(t1 - t0) / 1e6)
  scanTotal.push(Number(t2 - t1) / 1e6)
  flushTotal.push(Number(t3 - t2) / 1e6)
  samples.push(Number(t3 - t0) / 1e6)
}
const sum = (a) => a.reduce((x, y) => x + y, 0)
const mean = (a) => sum(a) / a.length
const totalMs = Number(process.hrtime.bigint() - T0) / 1e6
samples.sort((a, b) => a - b)
const pct = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]

console.log()
console.log(`[bench] 迭代 ${ITERS} 次（每次改 1 行）`)
console.log(`  总耗时      ${totalMs.toFixed(1)} ms`)
console.log(`  摊还/次     ${(totalMs / ITERS).toFixed(3)} ms   ← 与真机 JS 段（6.8~7.0ms）对比的对象`)
console.log(`  p50 / p95   ${pct(0.5).toFixed(3)} / ${pct(0.95).toFixed(3)} ms`)
console.log(`  flush 增量  ${rt.getStats().flushes - flushBefore}（期望 ${ITERS}）`)
const opsDelta = rt.getStats().opsEmitted - opsBefore
console.log(`  指令增量    ${opsDelta}（期望 ≈ ${ITERS - 1}：改 1 行只发 1 条；首轮可能短路）`)
console.log(`  载荷累计    ${bytesTotal} B`)
console.log()
console.log('  三段分离（与真机 V11 同口径）：')
console.log(`    ① 造数据（map 1000 行）  ${mean(setTotal).toFixed(3)} ms/次`)
console.log(`    ② **扫描 + diff**        ${mean(scanTotal).toFixed(3)} ms/次   ← 真机 7ms 的主要来源`)
console.log(`    ③ 编码（flush → 字节）   ${mean(flushTotal).toFixed(3)} ms/次`)

// ★判据（与真机 V11 同语义）：flush 增量 = N 且每次只发 ~1 条
const ok = (rt.getStats().flushes - flushBefore) >= ITERS - 1 && opsDelta <= ITERS + 2
console.log(ok ? '  ✅ 通路正确（每次更新发 1 条）' : '  ❌ 通路异常（flush 或指令数与预期不符）')

// ── ★★关键对照：**粗粒度触发 vs 行级失效**（2026-09-29）────────────────────────
//
// 【为什么要测这个】上面 2.3ms（真机 7ms）的**来源是"粗粒度触发"**：`triggers.get('list')`
//   只知道"源变了"，不知道"哪一行变了" ⇒ 只能**全表重扫**（O(行数 × 槽位数)）。
//   而 Vapor 的设计本意是 **O(1) 槽位直写**（改 1 行 ⇒ 只算 1 行）。
//   ⇒ 本对照量化"如果调用方能提供**行级失效**，成本能降到多少"——这决定了优化值不值得做。
const fineSamples = []
const fineFlushBefore = rt.getStats().flushes
// 取第 500 行的 key（由表声明 itemKeyField 决定）
const itemSpec = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')
const keyField = itemSpec?.itemKeyField ?? 'id'
const listId = itemSpec?.listId ?? 0
if (typeof vapor.relinkRow === 'function') {
  for (let i = 0; i < ITERS; i++) {
    const t0 = process.hrtime.bigint()
    const target = rows[499]
    target.dotW = i % 2 ? 60 : 36
    const next = [...rows]
    data.list = next
    vapor.relinkRow(listId, String(target[keyField]), target, { read: (n) => data[n] })
    rt.flush()
    sink.pop()
    fineSamples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  const fineMean = fineSamples.reduce((a, b) => a + b, 0) / fineSamples.length
  console.log()
  console.log('  ★对照 · 行级失效（relinkRow：只算改的那一行）')
  console.log(`    摊还/次     ${fineMean.toFixed(3)} ms   ← 对比粗粒度 ${(totalMs / ITERS).toFixed(3)} ms`)
  console.log(`    提速        ${((totalMs / ITERS) / fineMean).toFixed(1)}×`)
  console.log(`    flush 增量  ${rt.getStats().flushes - fineFlushBefore}（期望 ${ITERS}）`)
} else {
  console.log()
  console.log('  ⚠ 宿主未提供 relinkRow（行级失效未实现）——本对照跳过')
}
