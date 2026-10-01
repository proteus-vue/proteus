#!/usr/bin/env node
// scripts/check-cross-end-golden.mjs —— ★双端 golden 单一来源门禁（2026-10-01）
//
// 【为什么需要（本轮实测抓到的真缺陷）】
//   iOS 腿从 canonical 读 golden（`packages/layout-core-rust/tests/golden/browser-layout.json`），
//   而 Android 腿从 **assets 里的静态副本**读（`hosts/android/app/src/main/assets/browser-layout.json`）。
//   两份**从不同步**：实测 assets 停在 09-27（17 case / 68 节点），canonical 已是 09-30
//   （25 case / 97 节点）⇒ 双端 conformance 覆盖面不同（iOS 96 vs Android 67 节点），
//   收"双端几何一致性"判据时**当场判红**（而且红的原因与几何无关，是装置漂移）。
//
// 【判据】两份文件必须**逐字节相同**（`Buffer.equals`）。
//   ⇒ 漂移即红，并在输出里给出修法（`build-and-run.sh` 已自动同步；本门禁守"忘了构建就提交"的路径）。
//
// 用法：node scripts/check-cross-end-golden.mjs
// 退出码：0 一致 / 1 漂移 / 2 文件缺失
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CANON = path.join(ROOT, 'packages/layout-core-rust/tests/golden/browser-layout.json')
const ANDROID = path.join(ROOT, 'hosts/android/app/src/main/assets/browser-layout.json')

const missing = [CANON, ANDROID].filter((p) => !fs.existsSync(p))
if (missing.length) {
  console.error(`❌ golden 文件缺失：${missing.map((p) => path.relative(ROOT, p)).join(' / ')}`)
  process.exit(2)
}

const a = fs.readFileSync(CANON)
const b = fs.readFileSync(ANDROID)
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

if (a.equals(b)) {
  const cases = JSON.parse(a.toString('utf8')).cases?.length ?? '?'
  console.log(`✅ 双端 golden 单一来源一致（${cases} case · sha ${sha(a)}）`)
  process.exit(0)
}

// 漂移：给出两侧规模 + 修法（让"正确的做法"变顺手）
const summarize = (buf) => {
  try {
    const d = JSON.parse(buf.toString('utf8'))
    const nodes = (d.cases ?? []).reduce((n, c) => n + (c.nodes?.length ?? 0), 0)
    return `${d.cases?.length ?? '?'} case / ${nodes} 节点`
  } catch {
    return '(无法解析)'
  }
}
console.error('❌ 双端 golden 漂移（Android assets 副本 ≠ canonical）——双端 conformance 覆盖面会不一致：')
console.error(`    canonical : ${path.relative(ROOT, CANON)} → ${summarize(a)} · sha ${sha(a)}`)
console.error(`    android   : ${path.relative(ROOT, ANDROID)} → ${summarize(b)} · sha ${sha(b)}`)
console.error('  ⇒ 修法：重跑构建（`bash hosts/android/build-and-run.sh --no-install` 已自动同步），')
console.error('     或直接 `cp` canonical 覆盖 android 副本后重跑本门禁。')
process.exit(1)
