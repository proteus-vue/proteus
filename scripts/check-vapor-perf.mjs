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

/**
 * 单条 SET_STYLE 指令的二进制编码 —— **调真实 TS 编码器**（不手写第二份线格式）
 *
 * 【为什么改成这样（本门禁 2026-09-29 实际踩坑）】此前这里**手写**了字节布局（并硬编码
 *   `version = 1`）。协议 V2（池按需 + ref 重映射）落地时把 `OPS_VERSION` 改成了 2，
 *   而这份手写副本**没人知道要跟着改** ⇒ Rust 解码「版本不符」直接拒绝 ⇒ `apply_ops` 返回错误体
 *   ⇒ 门禁报出**误导性结论**「平移未产生位移」（看起来像平移传播坏了，实际是装置过期）。
 *   这与卡 I2 的「第二份手写副本 = 下一个静默缺陷」是**同一条纪律**：
 *   跨端格式只能有**一个**实现（`packages/slot-runtime` 的 `encodeOps`），任何地方再写一份
 *   都必然在下次协议变更时静默过期。
 *
 * 【做法】起一次 tsx 子进程求值真实 `encodeOps`（与 `check-vapor-docs` 的 culling 重算同法）；
 *   并在主流程断言**版本与代码一致**（见 `assertWireVersion`）——装置过期必须**报装置错**，
 *   而不是伪装成性能回归。
 */
function opsBinBatch(nodeId, key, values) {
  const probe = `
import { OpCode, PropKeyTable, StringPool, encodeOps } from ${JSON.stringify(path.join(ROOT, 'packages/slot-runtime/src/index.ts'))}
const keys = new PropKeyTable()
const pool = new StringPool()
const out = []
for (const v of ${JSON.stringify(values)}) {
  // ★逐条独立编码（每条自带池 ⇒ 与旧手写副本的语义一致：一次 apply 一条指令）
  const ops = [{ op: OpCode.SET_STYLE, nodeId: ${nodeId}, keyId: keys.intern(${JSON.stringify(key)}), value: v }]
  out.push(Array.from(encodeOps(ops, keys, pool)))
}
process.stdout.write(JSON.stringify(out))
`
  const raw = execFileSync('npx', ['tsx', '-e', probe], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })
  return JSON.parse(raw.trim().split('\n').pop()).map((a) => Buffer.from(a))
}

/* ────────────────────── 跑探针 ────────────────────── */

function runProbe(treePath, opsA, opsB, iters) {
  const out = execFileSync(EXAMPLE, [treePath, opsA, opsB ?? '', String(iters)], { encoding: 'utf-8' })
  return JSON.parse(out)
}

/**
 * ★装置自检：探针必须真的应用了指令（`applied`/`relayout_count` 是数，不是 null）。
 *
 * 【为什么必须前置于性能断言（本门禁 2026-09-29 实测的误导）】装置过期时（例如线格式版本
 *   与 `OPS_VERSION` 漂移），`apply_ops` 返回**错误体**——顶层各字段为 null。
 *   此时若直接跑性能断言，会报「translation_delta = 0 ⇒ 平移未产生位移」，
 *   把人**引向性能路径**排查（本次就是这样白查了一轮），而真实原因是**装置**。
 *   ⇒ 纪律：装置错必须报装置错，且要**指名方向**（"先确认线格式版本"）。
 */
function assertProbeApplied(res, label) {
  if (res.applied === null || res.applied === undefined || res.relayout_count === null) {
    console.error(`[vapor-perf] ✗ 装置失效（${label}）：探针返回错误体 ⇒ apply_ops 未应用任何指令。`)
    console.error(`  原始返回：${JSON.stringify(res)}`)
    console.error('  ★先查线格式版本（本门禁曾因**手写第二份编码**硬编码旧 version 而静默过期）：')
    console.error('    · 期望版本 = packages/slot-runtime/src/buffer.ts 的 OPS_VERSION')
    console.error('    · 本脚本改用真实编码器生成 ops（不再手写字节）——若仍失败，查 cargo 侧 ops.rs 的 OPS_VERSION')
    fs.rmSync(TMP, { recursive: true, force: true })
    process.exit(2)
  }
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
  const [b56, b80] = opsBinBatch(2, 'layout.height', [56, 80])
  fs.writeFileSync(ops56, b56)
  fs.writeFileSync(ops80, b80)

  const classB = runProbe(treePath, ops80, ops56, 30)
  // ★装置自检（本仓纪律「测量装置必须先自测」的机器化）：探针必须真的应用了指令。
  //   装置过期（如线格式版本漂移）时 apply_ops 返回**错误体**（applied=null / relayout_count=null）
  //   ⇒ 必须报**装置错**并指名方向，而不是让下面的性能断言给出「平移未产生位移」这种误导结论。
  assertProbeApplied(classB, '类B')
  const eng = classB.phases_of_median_round?.engine_phases ?? {}
  const delta = Math.abs(eng.translation_delta ?? 0)
  const shifted = eng.translation_shifted ?? 0

  // ★类A：改行内圆点宽（边界内变化 ⇒ 范围应止于该行）
  const opsDot = path.join(TMP, 'dot.bin')
  const opsDot2 = path.join(TMP, 'dot2.bin')
  const [bDot, bDot2] = opsBinBatch(1, 'layout.width', [20, 44])
  fs.writeFileSync(opsDot, bDot)
  fs.writeFileSync(opsDot2, bDot2)
  const classA = runProbe(treePath, opsDot, opsDot2, 30)
  assertProbeApplied(classA, '类A')

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
