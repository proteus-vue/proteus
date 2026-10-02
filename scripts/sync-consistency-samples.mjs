#!/usr/bin/env node
// scripts/sync-consistency-samples.mjs —— 把内核测试落盘的快照工件**同步到入库位置**（CI 可复现的前提）
//
// 【为什么需要（本仓踩到的 CI 坑）】内核测试把快照写到 target/——而 target/ 是 gitignore，
//   CI 上不存在 ⇒ 若门禁直接读 target/，CI 必红（本批自查发现并修）。
//   ⇒ 真源在 target/（内核测试产出），**入库副本**在 docs/generated/consistency-samples/；
//   本脚本负责同步（内核夹具/快照格式变更后跑一次，连同测试一起提交）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATES = [
  path.join(ROOT, 'spike/target/geometry-snapshot-sample.json'),
  path.join(ROOT, 'packages/layout-core-rust/target/geometry-snapshot-sample.json'),
]
const DEST = path.join(ROOT, 'docs/generated/consistency-samples/app-kernel-geometry.json')

const src = CANDIDATES.find((p) => fs.existsSync(p))
if (!src) {
  console.error('[sync-consistency-samples] ✗ 找不到内核快照工件——先跑：')
  console.error('  cd packages/layout-core-rust && CARGO_TARGET_DIR=../../spike/target cargo test --release geometry_snapshot')
  process.exit(2)
}
fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.copyFileSync(src, DEST)
console.log(`[sync-consistency-samples] ✅ ${path.relative(ROOT, src)} → ${path.relative(ROOT, DEST)}`)
