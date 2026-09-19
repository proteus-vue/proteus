#!/usr/bin/env node
// scripts/check-publish-drift.mjs —— ★npm 发布漂移检测（防「同版本号、内容不同」事故）
//
// 背景（2026-09-19 实战事故）：另一个项目用 npm 上的 `@proteus-vue/cli@0.3.0-beta.2` **启动即崩**——
//   它顶层 import `createFlamegraphCollector`（来自 devtools-runtime），而 npm 上的
//   `devtools-runtime@0.1.0` **只有 8 个导出**（本地源码有 30+）。根因是 `scripts/publish-all.sh`：
//   ```
//   existing=$(npm view "$name@$version" version)
//   if [ -n "$existing" ]; then echo "skip ..."; continue; fi   # ← 静默跳过
//   ```
//   「registry 已有该版本 → 跳过」这条本身是**幂等发布**的合理设计，但它**无法区分两种情况**：
//     ① 内容确实一样（幂等重跑，跳过正确）
//     ② 本地源码改了但**忘了 bump 版本号**（跳过 = 新内容永远发不出去，而依赖方 bump 后拿到的仍是旧内容）
//   ② 就是本次事故：改动的包没 bump → 被跳过；依赖它的 CLI bump 并发版 → 声明 `0.1.0` 拿到旧内容 → 崩。
//
// ★本脚本的判据（精确）：**版本号相同 ⇒ 内容必须相同**（semver/可复现性基本要求）。
//   对比方式：本地 `npm pack` 的 integrity ↔ registry 上同版本的 `dist.integrity`（实测 pack 可复现）。
//   ★与「本地版本领先于 npm」区分开：那是**正常状态**（未发布的工作），不报错。
//
// 用法：
//   node scripts/check-publish-drift.mjs            # 全量报告（含本地领先的包——发布规划用）
//   node scripts/check-publish-drift.mjs --check    # 仅「同版本内容不同」→ exit 1（发布前/发布后核验用）
//   node scripts/check-publish-drift.mjs --json     # 机器可读
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const asJson = process.argv.includes('--json')
const TAG = 'proteus-publish-drift'
const only = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] : null
})()

/** 列出 workspace 内的 @proteus-vue/* 包（跳过无 name 或非目标 scope 的目录） */
function listPackages() {
  const dir = path.join(ROOT, 'packages')
  const out = []
  for (const d of fs.readdirSync(dir)) {
    const pj = path.join(dir, d, 'package.json')
    if (!fs.existsSync(pj)) continue
    let j
    try {
      j = JSON.parse(fs.readFileSync(pj, 'utf8'))
    } catch {
      continue
    }
    if (!j.name || !j.name.startsWith('@proteus-vue/')) continue
    out.push({ dir: path.join(dir, d), short: j.name.replace('@proteus-vue/', ''), full: j.name, version: j.version })
  }
  return out.sort((a, b) => a.short.localeCompare(b.short))
}

/** 本地 pack 的 integrity（排除 npm 警告噪声；失败返回 null） */
function localIntegrity(pkgDir) {
  try {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120_000,
    })
    const j = JSON.parse(raw)
    const entry = Array.isArray(j) ? j[0] : j
    return entry && entry.integrity ? entry.integrity : null
  } catch {
    return null
  }
}

/** registry 上某版本的 { integrity, tarball }；包/版本不存在返回 null */
async function registryInfo(full, version) {
  const url = 'https://registry.npmjs.org/' + encodeURIComponent(full) + '/' + encodeURIComponent(version)
  try {
    const r = await fetch(url, { headers: { 'user-agent': TAG } })
    if (r.status === 404) return null
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    return { integrity: (d.dist && d.dist.integrity) || null, tarball: d.dist && d.dist.tarball }
  } catch (e) {
    return { error: String(e).slice(0, 80) }
  }
}

const pkgs = only ? listPackages().filter((p) => p.short === only) : listPackages()
if (!pkgs.length) {
  console.error(`[${TAG}] 未找到匹配的包${only ? `（--only ${only}）` : ''}`)
  process.exit(2)
}

const report = { checked: 0, drift: [], unpublished: [], same: [], errors: [] }

for (const p of pkgs) {
  report.checked++
  const local = localIntegrity(p.dir)
  const remote = await registryInfo(p.full, p.version)
  if (!remote) {
    // registry 无该版本 = 本地领先（未发布）——正常状态，不算缺陷
    report.unpublished.push({ name: p.short, version: p.version, localIntegrity: local })
    continue
  }
  if (remote.error) {
    report.errors.push({ name: p.short, version: p.version, error: remote.error })
    continue
  }
  if (!local) {
    report.errors.push({ name: p.short, version: p.version, error: '本地 pack 失败（dist 未构建？）' })
    continue
  }
  if (local === remote.integrity) {
    report.same.push({ name: p.short, version: p.version })
  } else {
    // ★核心：同版本号但内容不同 —— 「忘了 bump 就发布/被静默跳过」的确证
    report.drift.push({ name: p.short, version: p.version, localIntegrity: local, remoteIntegrity: remote.integrity, tarball: remote.tarball })
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`[${TAG}] 已核 ${report.checked} 个包`)
  console.log(`  内容与 npm 一致：${report.same.length}`)
  console.log(`  本地领先（未发布，正常）：${report.unpublished.length}`)
  if (report.drift.length) {
    console.log(`\n★同版本号但内容不同（${report.drift.length} 个）——新内容未发布，依赖方拿到的仍是旧包：`)
    for (const d of report.drift) {
      console.log(`  ✗ ${d.name}@${d.version}`)
      console.log(`      本地 ${String(d.localIntegrity).slice(0, 32)}…  ≠ npm ${String(d.remoteIntegrity).slice(0, 32)}…`)
    }
    console.log('\n  → 修复：给这些包 bump 版本（同版本无法覆盖发布），并同步 bump 依赖它们的包。')
  } else {
    console.log('\n✅ 无「同版本不同内容」漂移')
  }
  if (report.errors.length) {
    console.log(`\n⚠ 未能判定 ${report.errors.length} 个：`)
    for (const e of report.errors) console.log(`  - ${e.name}@${e.version}: ${e.error}`)
  }
}

// --check：仅「同版本不同内容」判失败（本地领先/网络错误不判失败——前者正常、后者非代码问题）
process.exitCode = report.drift.length > 0 && checkOnly ? 1 : 0
