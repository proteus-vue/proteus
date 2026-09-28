#!/usr/bin/env node
// scripts/check-vapor-perf.mjs —— ★★Vapor IR / 排版核心的**性能棘轮门禁**（只降不升）
//
// 【为什么必须有（本仓教训）】性能项没有门禁会**静默回退**——一次"顺手"的重构就能把
//   平移传播、二进制返回通道这些优化删掉，而所有功能测试仍然全绿。
//   本仓已有一例：`hosts/ios/bench.mjs` 的注释原话「性能项没有门禁会静默回退」。
//   而 Vapor IR 这一段的收益（平移传播 8.29×、返回通道 54→0.89ms）此前**没有任何门禁**。
//
// 【★两层判据（缺一不可——本仓实测的教训）】
//   ① **性能上限**：relayout 耗时不得超过 RATCHET（余量已含机器差异）
//   ② **优化路径真的生效**：断言 `translation_delta != 0` 且 `translation_shifted > 0`
//      ——否则可能出现"因为什么都没做所以很快"的**假通过**
//      （本仓实测过这类假象：探针只发同一 ops ⇒ delta=0 ⇒ 读数 0.0055ms 看起来像 700× 收益）
//
// 用法：node scripts/check-vapor-perf.mjs [--update]
// 退出码：0 通过 / 1 超阈值或路径未生效 / 2 环境错误

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CRATE = path.join(ROOT, 'packages/layout-core-rust')
const EXAMPLE = path.join(CRATE, 'target', 'release', 'examples', 'relayout_phases')
const OPS_MAGIC = 0x504f5650

/** ★上限棘轮（只降不升）——当前值 = 2026-09-28 实测基线 + 余量 */
const RATCHET = {
  /** 类B（1000 行 / 4003 节点）：改行高 ⇒ 平移传播生效时的 relayout 中位（ms） */
  classBTranslationMs: 0.5, // 实测 0.075；全量回退时约 3.87 ⇒ 差 50× 足以区分
  /** 类B 平移传播必须真正搬动的兄弟数下限（证明路径生效，而非"无事可做"） */
  classBMinShifted: 900, // 1000 行里除脏行外约 999
  /** 类A（边界内变化）：重排节点数上限（应止于该行 ⇒ 个位数） */
  classAMaxRelayoutNodes: 8, // 实测 2
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vapor-perf-'))

/* ────────────────────── 输入构造（与真机基准同构） ────────────────────── */

/** 1000 行列表树（每行 4 节点 ⇒ 4003）：`flexShrink:0` 必填，否则行被压缩（本仓实测的基准树缺陷） */
function makeListTree() {
  const W = 390
  const H = 844
  const nodes = [
    { id: 0, parentId: null, flexDirection: 'column', width: W, height: H },
    { id: 2, parentId: 0, flexDirection: 'row', width: W - 32, height: 56, flexShrink: 0 },
    { id: 1, parentId: 2, width: 36, height: 36 },
  ]
  for (let i = 0; i < 1000; i++) {
    const rid = 100 + i * 4
    nodes.push({ id: rid, parentId: 0, flexDirection: 'row', width: W - 32, height: 56, flexShrink: 0 })
    nodes.push({ id: rid + 1, parentId: rid, width: 36, height: 36 })
    nodes.push({ id: rid + 2, parentId: rid, flexGrow: 1, flexDirection: 'column' })
    nodes.push({ id: rid + 3, parentId: rid + 2, width: 120, height: 16 })
  }
  return { viewport: { width: W, height: H }, nodes }
}

/** 单条 SET_STYLE 指令的二进制编码（与 TS 侧 `encodeOps` 同格式） */
function opsBin(nodeId, key, value) {
  const keyBytes = Buffer.from(key, 'utf8')
  const buf = Buffer.alloc(20 + 2 + keyBytes.length + 11)
  let o = 0
  buf.writeUInt32LE(OPS_MAGIC, o); o += 4
  buf.writeUInt32LE(1, o); o += 4 // version
  buf.writeUInt32LE(1, o); o += 4 // opCount
  buf.writeUInt32LE(1, o); o += 4 // keyCount
  buf.writeUInt32LE(0, o); o += 4 // strCount
  buf.writeUInt16LE(keyBytes.length, o); o += 2
  keyBytes.copy(buf, o); o += keyBytes.length
  buf.writeUInt8(0x02, o); o += 1 // SET_STYLE
  buf.writeUInt32LE(nodeId, o); o += 4
  buf.writeUInt16LE(0, o); o += 2 // keyId
  buf.writeFloatLE(value, o)
  return buf
}

/* ────────────────────── 跑探针 ────────────────────── */

function runProbe(treePath, opsA, opsB, iters) {
  const out = execFileSync(EXAMPLE, [treePath, opsA, opsB ?? '', String(iters)], { encoding: 'utf-8' })
  return JSON.parse(out)
}

function main() {
  if (!fs.existsSync(EXAMPLE)) {
    console.error(`✗ 缺少探针 ${path.relative(ROOT, EXAMPLE)}`)
    console.error('  先运行：cargo build --manifest-path packages/layout-core-rust/Cargo.toml --release --example relayout_phases')
    process.exit(2)
  }

  const treePath = path.join(TMP, 'list.json')
  fs.writeFileSync(treePath, JSON.stringify(makeListTree()))
  // ★类B：交替发 56↔80（真实 delta）；只发同一值会让 delta=0（本仓实测的假象）
  const ops56 = path.join(TMP, 'h56.bin')
  const ops80 = path.join(TMP, 'h80.bin')
  fs.writeFileSync(ops56, opsBin(2, 'layout.height', 56))
  fs.writeFileSync(ops80, opsBin(2, 'layout.height', 80))

  const classB = runProbe(treePath, ops80, ops56, 30)
  const eng = classB.phases_of_median_round?.engine_phases ?? {}
  const delta = Math.abs(eng.translation_delta ?? 0)
  const shifted = eng.translation_shifted ?? 0

  // ★类A：改行内圆点宽（边界内变化 ⇒ 范围应止于该行）
  const opsDot = path.join(TMP, 'dot.bin')
  const opsDot2 = path.join(TMP, 'dot2.bin')
  fs.writeFileSync(opsDot, opsBin(1, 'layout.width', 20))
  fs.writeFileSync(opsDot2, opsBin(1, 'layout.width', 44))
  const classA = runProbe(treePath, opsDot, opsDot2, 30)

  const failures = []
  // ① 性能上限
  if (!(classB.median_relayout_ms <= RATCHET.classBTranslationMs)) {
    failures.push(
      `类B relayout ${classB.median_relayout_ms}ms > 上限 ${RATCHET.classBTranslationMs}ms —— **平移传播可能已失效**（全量回退约 3.9ms）`,
    )
  }
  if (!(classA.relayout_count <= RATCHET.classAMaxRelayoutNodes)) {
    failures.push(`类A 重排节点数 ${classA.relayout_count} > 上限 ${RATCHET.classAMaxRelayoutNodes}（边界判定可能退化）`)
  }
  // ② ★优化路径真的生效（防"因为什么都没做所以很快"的假通过）
  if (delta <= 0) {
    failures.push(`类B translation_delta = ${delta} —— 平移**未产生位移** ⇒ 读数无意义（可能只发了同一 ops）`)
  }
  if (!(shifted >= RATCHET.classBMinShifted)) {
    failures.push(`类B 平移兄弟数 ${shifted} < 下限 ${RATCHET.classBMinShifted} —— 传播范围可能被截断`)
  }

  const report = {
    classA: { relayout_ms: classA.median_relayout_ms, nodes: classA.relayout_count },
    classB: { relayout_ms: classB.median_relayout_ms, nodes: classB.relayout_count, delta, shifted },
  }

  if (failures.length === 0) {
    console.log('[vapor-perf] ✅ 性能棘轮通过')
    console.log(`  类A（边界内）：${report.classA.relayout_ms.toFixed(3)}ms · 重排 ${report.classA.nodes} 节点`)
    console.log(
      `  类B（边界自身）：${report.classB.relayout_ms.toFixed(3)}ms · 重排 ${report.classB.nodes} 节点 · ` +
        `平移 delta=${report.classB.delta} 兄弟=${report.classB.shifted}（★生效证据）`,
    )
    fs.rmSync(TMP, { recursive: true, force: true })
    return
  }

  console.error('[vapor-perf] ✗ 棘轮未通过：')
  for (const f of failures) console.error(`  - ${f}`)
  if (process.argv.includes('--update')) {
    console.error('  （--update 只提示新基线，需人工确认后改 RATCHET——性能棘轮不自动放宽）')
  }
  console.error(`  实测：${JSON.stringify(report)}`)
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(1)
}

main()
