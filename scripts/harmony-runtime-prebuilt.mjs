#!/usr/bin/env node
// scripts/harmony-runtime-prebuilt.mjs —— ★★★鸿蒙 runtime HAR「随包副本」同步 + 新鲜度门禁（决策 #725）
//
// 【为什么需要（与 #666 android AAR / #721 AAR 新鲜度 同源同形）】
//   鸿蒙 runtime 抽为 **HAR 目录**（`hosts/harmony/host-app/proteus_render`）。CLI 生成的宿主经
//   `host-scaffold.resolveRuntimeDirs('harmony')` 复制它——**无框架 checkout** 时回退
//   `packages/cli/templates-host/prebuilt/harmony/proteus_render`（随 CLI 发布，含 arm64 Rust 核 .a）。
//   ★两份漂移的后果：框架自测走真源、外部用户走副本 ⇒ 改了真源没同步副本 ⇒ **外部用户跑旧运行时**
//     （本地全绿、外部错——正是 #663/#664/#666 的"两条通路"病）。⇒ 机器门禁钉住，不靠记忆。
//
// 【口径】prebuilt = 真源用**与 createHost 相同的 exclude 集**过滤后的逐文件副本（**逐字节**相等）。
//   比对：两边按同一 exclude 走树，逐文件 sha256 比对（内容哈希，非 mtime——git 克隆下 mtime 不可靠）。
//
// 用法：
//   node scripts/harmony-runtime-prebuilt.mjs          # 真源 → prebuilt（写）
//   node scripts/harmony-runtime-prebuilt.mjs --check  # 门禁：不一致即 exit 1（CI/verify 用）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'hosts/harmony/host-app/proteus_render')
const DEST = path.join(ROOT, 'packages/cli/templates-host/prebuilt/harmony/proteus_render')
const CHECK = process.argv.includes('--check')

// ★与 host-scaffold.ts 的 PLATFORM_SPECS.harmony 基本一致（改一处要改两处——此处加自检注释防漂移）。
//   ★★额外排除 `.gitignore`（决策 #725）：框架 `thirdparty/.gitignore` 写的是"Rust 核是生成物、不入库"，
//     而 **prebuilt 副本恰恰相反**——它是**随 CLI 发布的自持产物**，**必须**含 `libproteus_layout_core.a`。
//     若把该 .gitignore 一起拷进 prebuilt，`git` 会把 .a 当作被忽略文件 ⇒ 副本**不含 Rust 核** ⇒ 自持失败。
//     （host-scaffold 的 createHost 用**物理复制**、不经 git，故其 exclude 集**不含** .gitignore 无妨。）
const EXCLUDE_DIRS = new Set(['build', 'oh_modules', 'node_modules', '.hvigor', '.cxx', '.idea', '.preview'])
const EXCLUDE_FILES = new Set(['BuildProfile.ets', 'oh-package-lock.json5', '.gitignore'])

/** 走树，返回 rel → {abs, hash}（按 exclude 过滤） */
function walk(base) {
  const out = new Map()
  const rec = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (EXCLUDE_DIRS.has(e.name)) continue; rec(path.join(dir, e.name), r) }
      else { if (EXCLUDE_FILES.has(e.name)) continue; const abs = path.join(dir, e.name); out.set(r, { abs, hash: crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') }) }
    }
  }
  if (fs.existsSync(base)) rec(base, '')
  return out
}

function main() {
  if (!fs.existsSync(SRC)) {
    // 纯 npm 环境（无框架）⇒ 无从比对；不判红（副本自持，CI/外部用户正常态）
    console.log('ℹ 无框架 runtime 源（纯 npm 环境）——跳过新鲜度比对（prebuilt 自持）')
    return
  }
  const src = walk(SRC)
  const dst = walk(DEST)
  const diffs = []
  for (const [rel, a] of src) {
    const b = dst.get(rel)
    if (!b) diffs.push(`缺：${rel}`)
    else if (a.hash !== b.hash) diffs.push(`改：${rel}`)
  }
  for (const rel of dst.keys()) if (!src.has(rel)) diffs.push(`多：${rel}`)

  if (CHECK) {
    if (diffs.length) {
      console.error('')
      console.error('✗ 鸿蒙 runtime HAR 随包副本已陈旧（prebuilt ≠ 真源）')
      for (const d of diffs.slice(0, 30)) console.error(`    ${d}`)
      if (diffs.length > 30) console.error(`    …（共 ${diffs.length} 处）`)
      console.error('    修复：node scripts/harmony-runtime-prebuilt.mjs   （真源 → prebuilt）')
      console.error('    ★后果：外部用户（无框架 checkout）用旧运行时 ⇒ 本地全绿、外部错')
      process.exit(1)
    }
    console.log('✅ 鸿蒙 runtime HAR 随包副本新鲜（prebuilt ⇄ 真源 逐字节一致）')
    return
  }

  // 写模式：清空 dest 后逐文件复制（保持与 createHost 同 exclude）
  fs.rmSync(DEST, { recursive: true, force: true })
  for (const [rel, a] of src) {
    const to = path.join(DEST, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(a.abs, to)
  }
  console.log(`✅ 已同步：${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}（${src.size} 个文件）`)
}

main()
