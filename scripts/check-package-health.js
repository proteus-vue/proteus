// scripts/check-package-health.js
// ★npm 发布前包健康检查（决策 #214）：逐 @proteus-vue/* 包验证可发布形态
// 覆盖：必填字段 / exports 子路径→dist / main+types / 已构建 / files 完整性 / 依赖版本对齐（#102 坑）/ 源码跨包相对引入
// 用法：node scripts/check-package-health.js [--verbose]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKGS = path.join(ROOT, 'packages')
const VERBOSE = process.argv.includes('--verbose')

let errors = 0
let warns = 0
const err = (msg) => {
  errors++
  console.log(`  ✗ ${msg}`)
}
const warn = (msg) => {
  warns++
  console.log(`  ⚠ ${msg}`)
}
const ok = (msg) => VERBOSE && console.log(`  ✓ ${msg}`)

/** workspace 实际包版本表（决策 #102：声明版本必须对齐实际，否则 npm 404） */
const actualVersions = {}
for (const entry of fs.readdirSync(PKGS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKGS, entry.name, 'package.json'), 'utf8'))
    actualVersions[pkg.name] = pkg.version
  } catch {
    /* 非包目录 */
  }
}

/** 依赖版本对齐：@proteus-vue/* 声明版本（去 ^/~）必须精确等于 workspace 实际版本 */
function checkVersionAlignment(pkgFile, deps, label) {
  if (!deps) return
  for (const [dep, range] of Object.entries(deps)) {
    if (!dep.startsWith('@proteus-vue/')) continue
    const actual = actualVersions[dep]
    if (!actual) {
      warn(`${label} 依赖 ${dep}@${range}——workspace 无此包（${pkgFile}）`)
      continue
    }
    const declared = range.replace(/^[~^]/, '')
    if (declared !== actual) {
      err(`${label} 依赖版本漂移：${dep} 声明 ${range} 但 workspace 实际 ${actual}（决策 #102：npm 404）——${pkgFile}`)
    } else {
      ok(`${label} ${dep}@${actual} ✓`)
    }
  }
}

/** 递归扫描目录内所有 import/require 的裸/相对源码（跨包相对引入检测） */
function scanImports(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|js|mjs|vue)$/.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}

console.log('[packages] ★npm 发布前包健康检查')
const pkgDirs = fs.readdirSync(PKGS, { withFileTypes: true }).filter((e) => e.isDirectory())
for (const entry of pkgDirs) {
  const pkgDir = path.join(PKGS, entry.name)
  const pkgFile = path.join(pkgDir, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  } catch {
    err(`${entry.name}/package.json 解析失败`)
    continue
  }
  console.log(`\n[${pkg.name || entry.name}]`)
  const name = pkg.name ?? ''
  /** bin 工具包（cli/@proteus-vue/create-proteus）：无库入口，豁免 main/types/exports 必填 */
  const isBinTool = Boolean(pkg.bin)

  // ① 必填字段
  if (!name.startsWith('@proteus-vue/')) err('name 必须以 @proteus-vue/ 开头（全部产物收口到组织 scope）')
  if (!pkg.version) err('缺 version')
  if (!pkg.license) err('缺 license')
  if (!pkg.description) warn('缺 description')
  if (!pkg.type || pkg.type !== 'module') warn('缺 type: module（ESM 包一致性）')
  if (isBinTool) {
    // bin 工具包：bin 目标必须存在
    if (typeof pkg.bin === 'object') {
      for (const binTarget of Object.values(pkg.bin)) {
        if (typeof binTarget === 'string' && !fs.existsSync(path.join(pkgDir, binTarget))) err(`bin → ${binTarget} 不存在（未构建）`)
      }
    }
  } else {
    if (!pkg.main) err('缺 main')
    if (!pkg.types) err('缺 types')
    if (!pkg.exports) err('缺 exports（子路径不可达）')
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) err('files 缺 dist（发布物不完整）')

  // ② main/types/exports → dist 文件存在
  const dist = path.join(pkgDir, 'dist')
  if (!isBinTool) {
    if (pkg.main && !fs.existsSync(path.join(pkgDir, pkg.main))) err(`main ${pkg.main} 不存在（未构建？npm run build -w ${name}）`)
    if (pkg.types && !fs.existsSync(path.join(pkgDir, pkg.types))) err(`types ${pkg.types} 不存在`)
    if (pkg.exports && typeof pkg.exports === 'object') {
      for (const [sub, target] of Object.entries(pkg.exports)) {
        if (sub === './package.json') continue
        const t = target && typeof target === 'object' ? target : {}
        for (const field of ['import', 'types']) {
          const p = t[field]
          if (typeof p === 'string' && !fs.existsSync(path.join(pkgDir, p))) err(`exports "${sub}" ${field} → ${p} 不存在`)
        }
      }
    }
  }
  if (!isBinTool && !fs.existsSync(path.join(dist, 'index.js'))) err('dist/index.js 不存在（未构建）')

  // ③ files 完整性（README/skills 若存在应发布）
  if (fs.existsSync(path.join(pkgDir, 'README.md')) && (!pkg.files || !pkg.files.includes('README.md'))) warn('files 缺 README.md（README 存在但未发布）')
  if (fs.existsSync(path.join(pkgDir, 'skills')) && (!pkg.files || !pkg.files.includes('skills'))) err('files 缺 skills（test-core 随包 skill 未发布）')

  // ④ 依赖版本对齐（#102 坑）
  checkVersionAlignment(entry.name, pkg.dependencies, 'dependencies')
  checkVersionAlignment(entry.name, pkg.peerDependencies, 'peerDependencies')
  checkVersionAlignment(entry.name, pkg.devDependencies, 'devDependencies')

  // ⑤ 源码跨包相对引入（包间依赖必须包名——发布后相对路径断）
  const srcDir = path.join(pkgDir, 'src')
  if (fs.existsSync(srcDir)) {
    for (const f of scanImports(srcDir)) {
      const src = fs.readFileSync(f, 'utf8')
      const m = src.match(/from\s+['"]((?:\.\.\/)+packages\/[^'"]+)['"]|require\(['"]((?:\.\.\/)+packages\/[^'"]+)['"]\)/)
      if (m) err(`源码跨包相对引入：${path.relative(ROOT, f)} → ${m[1] || m[2]}（应走 @proteus-vue/ 包名）`)
    }
  }

  if (!isBinTool && pkg.main === undefined) warn('main 缺失（工具包可豁免，检查未计入）')
}

// ⑥ 发布清单（docs/packages.md）与 workspace 一致性
console.log('\n[packages] 汇总')
console.log(`  ${pkgDirs.length} 个包 · ${errors} error / ${warns} warn`)
if (errors) {
  console.log('[packages] ✗ 存在发布阻断项——修复后重跑（npm run build --workspaces 可重建全部 dist）')
  process.exit(1)
}
console.log('[packages] ✓ 包健康通过（可进入 npm 发布流程）')
