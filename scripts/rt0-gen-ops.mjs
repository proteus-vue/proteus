#!/usr/bin/env node
// scripts/rt0-gen-ops.mjs —— RT0 对照实验：用**真实 TS 编码器**生成「JS 路径」的每帧指令流
//
// 【为什么要这个脚本（本仓纪律：禁止手写协议字节）】`check-vapor-perf.mjs` 的教训——
//   手写 ops 字节并硬编码 version，协议升级时那份副本静默过期，门禁报出的是"看起来像
//   平移传播坏了"的**误导性结论**。⇒ 凡生成 ops 一律**调真实编码器**（此处 `encodeOps`）。
//
// 【它生成什么】RT0 的"路径 B"（JS 每帧计算 + 指令流）在某一帧的指令：
//   N 条 SET_STYLE（key = `paint.translateX`），值 = JS 侧算好的缓动值。
//   ⇒ 这份字节就是"没有动画指令时"宿主每帧要收的东西。
//
// 用法：
//   npx tsx scripts/rt0-gen-ops.mjs [节点数] [帧序号/总帧数] > /tmp/rt0-ops.bin
//   例：npx tsx scripts/rt0-gen-ops.mjs 200 30/120 > /tmp/rt0-ops.bin
import { OpCode, PropKeyTable, StringPool } from '../packages/slot-runtime/src/opcode.ts'
import { encodeOps } from '../packages/slot-runtime/src/buffer.ts'

const n = Number.parseInt(process.argv[2] ?? '200', 10)
const frameArg = process.argv[3] ?? '30/120'
const perNode = Number.parseInt(process.argv[4] ?? '1', 10) // ★对齐场景：route 转场每节点 2 条（translate+scale）
const [fi, ft] = frameArg.split('/').map((x) => Number.parseInt(x, 10))
const progress = Math.min(1, Math.max(0, fi / ft))

/** ★与 Rust 侧 `anim.rs` 的 EASE_OUT_CUBIC 同式（两侧必须同曲线，读数才可比） */
const easeOutCubic = (u) => 1 - (1 - u) ** 3

const keys = new PropKeyTable()
const strings = new StringPool()
const keyId = keys.intern('paint.translateX')
const scaleKeyId = keys.intern('paint.scale')

const ops = []
for (let i = 0; i < n; i++) {
  const nodeId = i + 2 // 与 exp 的 build_tree 对齐（根 = 1，子从 2 起）
  ops.push({
    op: OpCode.SET_STYLE,
    nodeId,
    keyId,
    value: 200 * easeOutCubic(progress),
  })
  if (perNode >= 2) {
    // route 转场：同节点再加一条 scale（对齐 A 路径的双属性）
    ops.push({
      op: OpCode.SET_STYLE,
      nodeId,
      keyId: scaleKeyId,
      value: 0.96 + 0.04 * easeOutCubic(progress),
    })
  }
}

const bytes = encodeOps(ops, keys, strings)
process.stdout.write(bytes)
console.error(
  `[rt0-gen-ops] ${ops.length} 条 SET_STYLE（${n} 节点 × ${perNode} 属性）· 进度 ${fi}/${ft}（u=${progress.toFixed(3)}）· ${bytes.length}B（${(bytes.length / ops.length).toFixed(1)}B/条）`,
)
