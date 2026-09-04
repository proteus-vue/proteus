// scripts/build-packages.mjs —— 按「源码 import 依赖图」拓扑排序构建全部 workspace 包
// ★fresh clone 必需：npm workspace 的 run-scripts 是字母序非拓扑序（agent 需要 mcp dist、
//   mcp 需要 render-backend dist……字母序必挂）——本脚本按依赖图排序构建。
// 幂等：dist 已存在且比 src 新 → 跳过（--force 强制重建）。用法：node scripts/build-packages.mjs [--force]
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKGS_DIR = path.join(ROOT, 'packages')
const FORCE = process.argv.includes('--force')

const dirs = fs.readdirSync(PKGS_DIR).filter((d) => fs.existsSync(path.join(PKGS_DIR, d, 'package.json')))

// 每包：name + src 内 import 的兄弟包（@proteus-vue/<name>）
const pkgs = []
for (const d of dirs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(PKGS_DIR, d, 'package.json'), 'utf8'))
  const name = (manifest.name ?? '').replace('@proteus-vue/', '') || d
  const hasBuild = Boolean(manifest.scripts?.build)
  const deps = new Set()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f)
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue }
      if (!/\.tsx?$/.test(f)) continue
      const src = fs.readFileSync(fp, 'utf8')
      for (const m of src.matchAll(/['"]@proteus-vue\/([a-z-]+)['"]/g)) deps.add(m[1])
    }
  }
  walk(path.join(PKGS_DIR, d, 'src'))
  deps.delete(name)
  pkgs.push({ dir: d, name, hasBuild, deps: [...deps] })
}

// 拓扑排序（deps 先于自身）
const done = new Set()
const visiting = new Set()
const order = []
function visit(name, chain) {
  if (done.has(name) || order.includes(name)) return
  if (visiting.has(name)) {
    console.error(`⚠ 依赖环：${[...chain, name].join(' → ')}（按字母序兜底）`)
    return
  }
  const pkg = pkgs.find((p) => p.name === name)
  if (!pkg) return
  visiting.add(name)
  for (const dep of pkg.deps) visit(dep, [...chain, name])
  visiting.delete(name)
  done.add(name)
  order.push(name)
}
for (const p of [...pkgs].sort((a, b) => a.name.localeCompare(b.name))) visit(p.name, [])

const buildOrder = order.map((name) => pkgs.find((p) => p.name === name)).filter((p) => p.hasBuild)
console.log('构建序:', buildOrder.map((p) => p.name).join(' → '))

const newestMtime = (dir) => {
  let latest = 0
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f)
      if (fs.statSync(fp).isDirectory()) walk(fp)
      else latest = Math.max(latest, fs.statSync(fp).mtimeMs)
    }
  }
  walk(dir)
  return latest
}

// ★两遍构建策略：esbuild 打包需要依赖包的 dist 先存在（拓扑序在脚本内难以绝对保证）——
//   第一遍解决无依赖包，第二遍补齐有依赖包；连续两遍无进展则报错退出（真实断链）。
let built = 0
let failed = 0
const failedPkgs = []
for (let round = 1; round <= 3; round++) {
  built = 0
  failed = 0
  failedPkgs.length = 0
  for (const pkg of buildOrder) {
    const distDir = path.join(PKGS_DIR, pkg.dir, 'dist')
    const srcDir = path.join(PKGS_DIR, pkg.dir, 'src')
    if (!FORCE && round === 1 && fs.existsSync(distDir) && newestMtime(srcDir) <= newestMtime(distDir)) continue
    console.log(`▶ build ${pkg.name}`)
    try {
      execSync(`npm run build --prefix ${path.join(PKGS_DIR, pkg.dir)}`, { stdio: 'inherit', cwd: ROOT })
      built++
    } catch {
      failed++
      failedPkgs.push(pkg.name)
    }
  }
  console.log(`round ${round}: built ${built} · failed ${failed}`)
  if (failed === 0) break
  if (built === 0) {
    console.error(`连续无进展——真实断链：${failedPkgs.join(', ')}`)
    process.exit(1)
  }
}
console.log(`\nbuild-packages: built ${built} · failed ${failed}${failedPkgs.length ? '（' + failedPkgs.join(', ') + '）' : ''}`)
if (failed) process.exit(1)
