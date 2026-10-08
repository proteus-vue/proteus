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
  process.exit(0)
}
fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.writeFileSync(DEST, HEADER + srcText)
console.log(`✅ 已同步：${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`)
