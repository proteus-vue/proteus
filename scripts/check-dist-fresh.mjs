#!/usr/bin/env node
// scripts/check-dist-fresh.mjs —— ★发布前硬门禁：dist/ 不得比 src/ 旧
//
// 为什么需要它（2026-11-12 真实事故，**代价是一次坏发布**）：
//   我修完 F-38/F-39/F-40（compiler）与 F-37（plugin-vite）后直接跑 `pnpm release` 发布 beta.34。
//   发布成功、版本号正确、`check:publish-contents` 全绿、dry-run 49 包全 dry-ok——
//   **但 `npm pack` 解包后 grep 发现 `fluidDecl` / `minRaw` / `NUMERIC_ARG` 全部 0 次，
//   `parseFluidExpr` 还是两周前的纯数字正则**。即：**发出去的是 10-29 的 dist**。
//
//   根因不是"忘了跑 build"这么简单，而是**发布链里没有任何一步会检查这件事**：
//     · `release.mjs` 不构建（它假定 dist 是新的）
//     · `publish-all.sh` 不构建
//     · `check:publish-contents` 只校验「files 声明的文件都在包内且 import 闭包可解析」——
//       **旧 dist 完全满足这些条件**（它是合法、完整、可解析的旧代码）
//     · `--dry-run` 全绿同理：它验的是"能不能发出去"，不是"发的内容对不对"
//   ⇒ 所有判据都在看"形状"，没有一条在看"内容是否比源码旧"。这就是这类错误能溜出去的机制。
//
// 判据（保守、只看事实）：
//   对每个「发布物取自 dist/」的包，求 `max(src/** mtime)` 与 `min(dist/** mtime)`：
//   `src 最新 > dist 最旧` ⇒ dist 已陈旧（源码改过但没重建）⇒ 硬失败。
//
//   为什么用「dist 最旧」而不是 dist/index.js：多 chunk / 多入口的包，
//   只重建了其中一部分时 index.js 可能是新的，而某个 chunk 还是旧的。
//   取最旧是保守下界（宁可多报，不可漏报）。
//
// 不适用（明确跳过，不静默）：
//   · 发布物是 **源码** 的包（如 @proteus-vue/components 发 `p/*.vue`，exports 指向 ./index.ts）
//     —— 这类包没有 dist，天然不受此问题影响；
//   · 无 dist 目录的包（纯类型 / 纯资源）。
//
// 用法：
//   node scripts/check-dist-fresh.mjs            # 报告模式
//   node scripts/check-dist-fresh.mjs --check    # 陈旧 → exit 1（发布链调用）
export default null

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

/** 递归求目录下所有文件的最值与计数（跳过 node_modules / .cache） */
function scanDir (dir) {
  let newest = 0
  let newestFile = ''
  let oldest = Infinity
  let oldestFile = ''
  let count = 0
  const walk = (d) => {
    let ents
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.cache') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      let st
      try {
        st = fs.statSync(p)
      } catch {
        continue
      }
      count++
      if (st.mtimeMs > newest) {
        newest = st.mtimeMs
        newestFile = p
      }
      if (st.mtimeMs < oldest) {
        oldest = st.mtimeMs
        oldestFile = p
      }
    }
  }
  walk(dir)
  return { newest, newestFile, oldest, oldestFile, count }
}

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—')

/** 遍历 packages/* 与根级 css-conformance 等 workspace 包 */
const pkgDirs = []
for (const base of ['packages']) {
  const abs = path.join(ROOT, base)
  if (!fs.existsSync(abs)) continue
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = path.join(abs, e.name)
    if (fs.existsSync(path.join(dir, 'package.json'))) pkgDirs.push(dir)
  }
}
for (const extra of ['css-conformance']) {
  const dir = path.join(ROOT, extra)
  if (fs.existsSync(path.join(dir, 'package.json'))) pkgDirs.push(dir)
}

const stale = []
const skipped = []
const ok = []

for (const dir of pkgDirs) {
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  // ★只检查「发布物取自 dist」的包：exports/main/module/types 指向 dist，
  //   或 files 里含 dist。发布源码的包（components 等）跳过并**明确记录**。
  const entry = JSON.stringify(pkg.exports ?? {}) + String(pkg.main ?? '') + String(pkg.module ?? '') + String(pkg.types ?? '')
  const filesHasDist = Array.isArray(pkg.files) && pkg.files.some((f) => String(f).startsWith('dist'))
  const usesDist = /\.\/dist\/|"dist\//.test(entry) || filesHasDist
  if (!usesDist) {
    skipped.push({ name: pkg.name, why: '发布物非 dist（源码/纯资源）' })
    continue
  }
  const distDir = path.join(dir, 'dist')
  if (!fs.existsSync(distDir)) {
    skipped.push({ name: pkg.name, why: '声明用 dist 但 dist 目录不存在（应由 check:publish-contents 报）' })
    continue
  }
  const srcDir = path.join(dir, 'src')
  const src = fs.existsSync(srcDir) ? scanDir(srcDir) : { newest: 0, newestFile: '' }
  const dist = scanDir(distDir)
  if (!dist.count) {
    skipped.push({ name: pkg.name, why: 'dist 为空目录' })
    continue
  }
  if (src.newest > dist.oldest) {
    stale.push({
      name: pkg.name,
      version: pkg.version,
      srcNewest: src.newest,
      srcFile: path.relative(ROOT, src.newestFile),
      distOldest: dist.oldest,
      distFile: path.relative(ROOT, dist.oldestFile),
    })
  } else {
    ok.push(pkg.name)
  }
}

console.log('[dist-fresh] ★发布前硬门禁：dist/ 不得比 src/ 旧')
console.log(`  扫描 ${pkgDirs.length} 个包 · dist 新鲜 ${ok.length} · 陈旧 ${stale.length} · 跳过 ${skipped.length}`)

if (skipped.length) {
  console.log('\n  跳过（发布物非 dist，不受此问题影响）：')
  for (const s of skipped) console.log(`    · ${s.name} —— ${s.why}`)
}

if (stale.length) {
  console.log('\n❌ dist 已陈旧（源码比构建产物新）——**发出去的就是旧代码**：')
  for (const s of stale) {
    console.log(`    · ${s.name}@${s.version}`)
    console.log(`        src 最新：${fmt(s.srcNewest)}  ${s.srcFile}`)
    console.log(`        dist 最旧：${fmt(s.distOldest)}  ${s.distFile}`)
  }
  console.log('\n  修复：node scripts/build-packages.mjs   （或 pnpm build:packages）')
  console.log('  ★不要用 `npm run build` 之类可能不存在的脚本——本仓全包构建入口是 build:packages。')
  if (CHECK) process.exitCode = 1
} else {
  console.log('\n✅ 所有「发布物取自 dist」的包，dist 都不比 src 旧')
}
