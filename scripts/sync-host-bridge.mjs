#!/usr/bin/env node
// scripts/sync-host-bridge.mjs —— ★★★运行时桥源「真源 ⇄ CLI 随包副本」同步（决策 #666）
//
// 【为什么需要（同 #663「陈旧产物」/ #664「两条通路」的同一族缺陷）】
//   `entry-superapp.ts`（superapp 运行期入口）有**两份**：
//     · 真源：`hosts/shared/bridge/entry-superapp.ts`（框架自测/装置用）
//     · 随包副本：`packages/cli/templates-host/shared/bridge/entry-superapp.ts`
//       （随 CLI 发布 ⇒ 外部用户无框架 checkout 也能 `build --package`，见 app-bundle.ts）
//   ★两份漂移的后果：框架测试走真源、外部用户走副本 ⇒ **改了真源没同步副本 ⇒ 外部用户跑旧逻辑**
//     （本地全绿、外部错——正是 #663/#664 的"两条通路"病）。⇒ 机器门禁钉住，不靠记忆。
//
// 用法：
//   node scripts/sync-host-bridge.mjs          # 真源 → 副本（写）
//   node scripts/sync-host-bridge.mjs --check   # 门禁：不一致即 exit 1（CI/verify 用）
//
// 口径：副本 = **固定头**（含唯一 sentinel 行）+ 真源**逐字节正文**；比对只比 sentinel 之后。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'hosts/shared/bridge/entry-superapp.ts')
const DEST = path.join(ROOT, 'packages/cli/templates-host/shared/bridge/entry-superapp.ts')
const CHECK = process.argv.includes('--check')

/** 唯一 sentinel：副本的"头 / 正文"分界。它上面的叫头（本脚本生成），下面的**逐字节**等于真源。 */
const SENTINEL = '// ===== AUTO-SYNCED BODY BELOW — 勿手改（真源 hosts/shared/bridge/entry-superapp.ts；跑 node scripts/sync-host-bridge.mjs 同步） ====='
const HEADER = `// packages/cli/templates-host/shared/bridge/entry-superapp.ts —— ★★★AUTO-SYNCED 运行时桥源（决策 #666）
//
// 本文件是 **hosts/shared/bridge/entry-superapp.ts 的逐字节副本**（sentinel 之下）。
// 随 CLI 包发布 ⇒ 外部用户**无框架 checkout** 也能 \`proteus build --target <app端> --package\`。
// ★改逻辑请改**真源**，再跑 \`node scripts/sync-host-bridge.mjs\`；门禁 \`--check\` 防两副本漂移。
//
// 依赖（esbuild 打包时经 npm 解析，见 app-bundle.ts）：@proteus-vue/render-backend(+app-navigation)、@proteus-vue/router(+types)。
${SENTINEL}
`

function bodyOf(text) {
  const i = text.indexOf(SENTINEL)
  return i < 0 ? null : text.slice(i + SENTINEL.length + 1) // 跳过 sentinel 后的换行
}

const srcText = fs.readFileSync(SRC, 'utf-8')
const destText = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf-8') : null

if (CHECK) {
  if (destText === null) {
    console.error(`❌ 随包副本缺失：${path.relative(ROOT, DEST)}（跑 node scripts/sync-host-bridge.mjs）`)
    process.exit(1)
  }
  if (bodyOf(destText) !== srcText) {
    console.error('❌ 运行时桥源两副本漂移（改真源未同步随包副本 ⇒ 外部用户跑旧逻辑）：')
    console.error(`   真源：${path.relative(ROOT, SRC)}`)
    console.error(`   副本：${path.relative(ROOT, DEST)}`)
    console.error('   修复：node scripts/sync-host-bridge.mjs')
    process.exit(1)
  }
  console.log('✅ 运行时桥源两副本一致（真源 ⇄ CLI 随包副本）')
  process.exit(0)
}

if (destText !== null && bodyOf(destText) === srcText) {
  console.log('✅ 已是最新（真源与随包副本一致）——无需改动')
} else {
  fs.mkdirSync(path.dirname(DEST), { recursive: true })
  fs.writeFileSync(DEST, HEADER + srcText)
  console.log(`✅ 已同步：${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★★★#1336（2026-10-28）：**探针模块也要同步**——此前只同步 entry-superapp.ts。
 *
 * 【为什么必须补（实测出来的真缺陷，不是推测）】
 *   `entry-superapp.ts` 静态 import 了 13 个 `./entry-superapp-probes*` 模块，
 *   而随包目录里**只有 entry-superapp.ts 一个文件** ⇒ 纯 npm 用户（无框架 checkout，
 *   `resolveBridgeDir()` 回退到 `cliBridgeDir()`）在 `proteus build --package` 的
 *   esbuild 阶段**直接失败**：
 *       Could not resolve "./entry-superapp-probes" @ …/templates-host/shared/bridge/entry-superapp.ts
 *   ★这属于「随包副本不完整」——与 #666 防的"两副本漂移"是同一族，只是此前只盯了**主文件**，
 *     没盯**它的相对 import 闭包**。既然 `resolveBridgeDir` 用"有没有 entry-superapp.ts"当判据，
 *     就默认了这个目录是自洽的；缺文件 ⇒ 判据成立而产物炸。
 *
 * 【口径】探针模块是**纯 TS 源码**（不需要 sentinel：它们不被发布方改写），直接逐字节复制。
 *   只同步 `entry-superapp-probes*.ts`（其余共享模块由 app-bundle 的 npm 解析负责）。
 * ══════════════════════════════════════════════════════════════════════════ */
const SRC_DIR = path.dirname(SRC)
const DEST_DIR = path.dirname(DEST)
const probeFiles = fs
  .readdirSync(SRC_DIR)
  .filter((n) => /^entry-superapp-probes.*\.ts$/.test(n))
  .sort()

let probeDrift = 0
for (const name of probeFiles) {
  const s = path.join(SRC_DIR, name)
  const d = path.join(DEST_DIR, name)
  const src = fs.readFileSync(s, 'utf-8')
  const cur = fs.existsSync(d) ? fs.readFileSync(d, 'utf-8') : null
  if (cur === src) continue
  probeDrift++
  if (CHECK) {
    console.error(`❌ 探针模块未同步：${path.relative(ROOT, d)}`)
  } else {
    fs.mkdirSync(DEST_DIR, { recursive: true })
    fs.writeFileSync(d, src)
    console.log(`✅ 已同步：${path.relative(ROOT, s)} → ${path.relative(ROOT, d)}`)
  }
}

if (CHECK && probeDrift > 0) {
  console.error('   ⇒ 纯 npm 用户（无框架 checkout）打包会在 esbuild 阶段「Could not resolve」直接失败。')
  console.error('   修复：node scripts/sync-host-bridge.mjs')
  process.exit(1)
}
if (!CHECK) {
  // ★可验证性：同步完必须能**独立打包**（这才是"随包目录自洽"的真判据，不是"文件数对得上"）
  console.log(`✅ 探针模块 ${probeFiles.length} 个已同步（本次变更 ${probeDrift} 个）`)
}

