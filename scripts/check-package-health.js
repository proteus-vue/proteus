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

/**
 * ★模板依赖版本对齐（2026-09-19 事故）：`packages/create-proteus/templates/package.json` 是
 *   **用户脚手架工程的依赖声明**——它此前不在任何门禁扫描范围内（本函数只扫 packages/*），
 *   于是成为发布链上唯一无人看守的一环。实测事故：模板写 `^0.2.1-beta.0`（cli）、`^0.1.0`
 *   （devtools-runtime），而 prerelease 的 caret 范围**够不到换元组后的新版本**
 *   （`^0.1.0` 永不匹配 `0.1.1-beta.1`）→ 用户 `npm create` 出来的是旧 `cli@0.2.1-beta.0`，
 *   旧 cli 又 **exact pin** 旧 `shared@0.2.0-beta.0`，与顶层新版冲突 → npm 无法提升 →
 *   **嵌套第二份 @proteus-vue/shared** → 模块级单例被拆散（URL 变了视图不更新，无报错）。
 *
 * ★规则比包内依赖更严：模板必须用**精确版本**，不许带 `^`/`~`。
 *   理由：caret 在 prerelease 下「同 (major,minor,patch) 元组才匹配预发布版」，元组一换
 *   （0.2.x → 0.3.0）范围就静默封顶在旧版本上——这是**无报错的**降级。精确 pin 让
 *   「模板声明的版本」与「本仓/已发布的版本」可逐字比对，也让用户装到的依赖树与我们实测过的一致。
 */
function checkTemplateAlignment() {
  const tplDir = path.join(PKGS, 'create-proteus', 'templates')
  if (!fs.existsSync(tplDir)) return
  const tplFile = path.join(tplDir, 'package.json')
  if (!fs.existsSync(tplFile)) return
  let tpl
  try {
    tpl = JSON.parse(fs.readFileSync(tplFile, 'utf8'))
  } catch (e) {
    err(`模板 package.json 解析失败：${e.message}`)
    return
  }
  const rel = path.relative(ROOT, tplFile)
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [dep, range] of Object.entries(tpl[field] ?? {})) {
      if (!dep.startsWith('@proteus-vue/')) continue
      const actual = actualVersions[dep]
      if (!actual) {
        err(`模板依赖 ${dep}@${range}——workspace 无此包（${rel}）`)
        continue
      }
      if (/^[\^~]/.test(range)) {
        err(
          `模板依赖用了范围 ${dep}@${range}（须为精确版本 ${actual}）——prerelease 的 caret 换元组后会静默封顶在旧版本，链式引发重复副本/单例拆散（${rel}）`,
        )
        continue
      }
      if (range !== actual) {
        err(`模板依赖版本漂移：${dep} 声明 ${range} 但 workspace 实际 ${actual}——用户脚手架会装到旧包（${rel}）`)
      } else {
        ok(`模板 ${dep}@${actual} ✓`)
      }
    }
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
  /** ★源码包（publishSource: true——如 @proteus-vue/components）：发布 TS/SFC 源码，不产 dist。
   *  为何需要：① MP 编译器需在磁盘上扫 .vue 源码（gen-routes/plugin-vite 按 <dir>/<tag>/index.vue 定位）；
   *  ② 与「一份源码双端」一致（Web 由消费方 @vitejs/plugin-vue 编译）。
   *  校验改为：main/types/exports 指向**存在的源码文件**、files 含入口源文件，跳过 dist 检查。 */
  const isSourcePkg = pkg.publishSource === true

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
  if (isSourcePkg) {
    // ②s 源码包：files 须含入口源文件（而非 dist）
    if (!Array.isArray(pkg.files) || !pkg.files.includes('index.ts')) err('源码包 files 缺 index.ts（发布物不完整）')
  } else if (pkg.bin && !pkg.main && !pkg.exports) {
    // ②b ★纯 bin 工具包（如 compiler-backend-rust：npm 侧只有 bin 壳 + crate 源码，
    //    编译核心由 cargo 产出 target/release 二进制，**无 dist**）——
    //    此前这里一律要求 files 含 "dist"，该包为过门禁写了 `"dist"` 却从未产出 dist →
    //    门禁只查磁盘不查「实际发布物」，于是「声明了什么」与「发出去了什么」长期不一致
    //    （2026-09-20 发布物内容门禁上线后暴露）。改为按**实际发布物**校验：
    //    bin 目标存在 + files 命中非空（具体内容由 check-publish-contents 逐条核对）。
    if (!Array.isArray(pkg.files) || !pkg.files.length) err('bin 工具包 files 为空（发布物不完整）')
  } else if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) err('files 缺 dist（发布物不完整）')

  // ② main/types/exports → 文件存在（源码包校验源码；常规包校验 dist）
  const dist = path.join(pkgDir, 'dist')
  if (!isBinTool) {
    if (pkg.main && !fs.existsSync(path.join(pkgDir, pkg.main))) {
      err(isSourcePkg ? `main ${pkg.main} 不存在（源码包入口缺失）` : `main ${pkg.main} 不存在（未构建？npm run build -w ${name}）`)
    }
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
  if (!isBinTool && !isSourcePkg && !fs.existsSync(path.join(dist, 'index.js'))) err('dist/index.js 不存在（未构建）')

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

// ⑥ 模板依赖对齐（用户脚手架工程的依赖声明——此前不在任何门禁覆盖内，见函数注释）
console.log('\n[templates] create-proteus 模板依赖对齐')
checkTemplateAlignment()

// ⑦ 发布清单（docs/packages.md）与 workspace 一致性
console.log('\n[packages] 汇总')
console.log(`  ${pkgDirs.length} 个包 · ${errors} error / ${warns} warn`)
if (errors) {
  console.log('[packages] ✗ 存在发布阻断项——修复后重跑（npm run build --workspaces 可重建全部 dist）')
  process.exit(1)
}
console.log('[packages] ✓ 包健康通过（可进入 npm 发布流程）')
