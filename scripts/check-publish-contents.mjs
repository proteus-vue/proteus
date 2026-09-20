#!/usr/bin/env node
// scripts/check-publish-contents.mjs —— ★门禁：核对**实际打出去的包里有什么**
//
// 背景（2026-09-20 真实事故，外部实战报告第十二节）：
//   `@proteus-vue/components@0.3.0-beta.7` 全量发布时丢了**全部 74 个 `p-*` 组件**
//   （registry tarball 只有 17 个文件；本地 `pnpm pack` 是 94 个）。任何工程 import 组件库
//   ——聚合入口或按具体路径都一样——构建立即失败：
//     `Could not resolve "./p-view/index.vue" from "node_modules/@proteus-vue/components/index.ts"`
//   四道既有门禁全部放行，根因是一句话：**它们都在检查「我声明的」，没有一道在检查「实际打出去的包里有什么」**——
//     · check-publish-drift：两侧都出自同一个打包器 → 同样缺件反而被判「内容一致」；
//     · verify-publish-smoke：包清单只有 cli / shared / devtools-runtime / plugin-vite / create-proteus，从不装 components；
//     · check-package-health：只查磁盘上的文件在不在，不查「files 通配符是否命中 0 个文件」；
//     · release --dry-run：只证明「命令跑得通」，不看 tarball 内容。
//
// ★本门禁补的就是这一环（逐包，用**发布时同一个打包器** pnpm 真打一次）：
//   ① `files` 每一项必须**命中 ≥1 个文件**——本次事故若加此断言，`"p-*"` 命中 0 项当场报警；
//   ② 入口（main/types/exports）必须在发布物内；
//   ③ 从入口出发的**相对 import 闭包**必须在发布物内可解析——这条直接覆盖
//      「index.ts 顶层 import 全部组件，组件没打进去 → 用户 import 即崩」这一事故形态。
//
// 用法：node scripts/check-publish-contents.mjs [--json] [--no-cache] [--only <short>] [--verbose]
// 退出码：0 通过 / 1 有缺件 / 2 环境错误（如未构建 dist）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { packPackage, cleanupPack } from './lib/pack-package.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'publish-contents'
const asJson = process.argv.includes('--json')
const verbose = process.argv.includes('--verbose')
const noCache = process.argv.includes('--no-cache')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

const CACHE_FILE = path.join(ROOT, '.cache', 'publish-contents.json')
const CACHE_VERSION = 1

// ─────────────────────────────────────────────────────────────────────────────
// 缓存：目录指纹不变 ⇒ 打包结果必然相同（pnpm pack 字节确定）→ 复用文件清单，跳过 pack 进程。
// 指纹走查**宁多勿少**（只排除 node_modules/.git），多包含只会造成无害的未命中，绝不漏检。
// ─────────────────────────────────────────────────────────────────────────────
let cache = { version: CACHE_VERSION, packs: {} }
if (!noCache) {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (j.version === CACHE_VERSION) cache = j
  } catch {
    /* 无缓存 / 旧版本 / 损坏 → 从空开始 */
  }
}
function saveCache() {
  if (noCache) return
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
    /* 缓存写失败不影响判定 */
  }
}

function dirFingerprint(dir) {
  const parts = []
  const walk = (d, rel0) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const rel = rel0 ? rel0 + '/' + e.name : e.name
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, rel)
      else {
        let st
        try {
          st = fs.statSync(abs)
        } catch {
          continue
        }
        parts.push(`${rel}:${st.size}:${Math.round(st.mtimeMs)}`)
      }
    }
  }
  walk(dir, '')
  parts.sort()
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex')
}

/** 打包（带指纹缓存）：返回 { files: string[], integrity } —— pack 失败返回 null */
function packedFiles(pkgDir, pkgRel) {
  let fp = null
  try {
    fp = dirFingerprint(pkgDir)
  } catch {
    /* 走查失败 → 不缓存 */
  }
  const hit = fp && cache.packs[pkgRel]
  if (hit && hit.fp === fp) return { files: hit.files, integrity: hit.integrity, cached: true }
  let p
  try {
    p = packPackage(pkgDir)
  } catch (e) {
    return { error: String(e.stderr ?? e.message ?? e).slice(0, 200) }
  }
  const out = { files: p.files, integrity: p.integrity, cached: false }
  cleanupPack(p)
  if (fp) cache.packs[pkgRel] = { fp, files: out.files, integrity: out.integrity }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// glob 匹配（`files` 项的命中判定）——对齐 npm/pnpm 的语义：字面项按「该路径及其子树」命中；
// `*` 不跨 `/`，`**` 跨层级。本仓 files 项形态有限（字面目录 / 文件名 / `p-*/**`），此实现覆盖之。
// ─────────────────────────────────────────────────────────────────────────────
function globToRegExp(glob) {
  const segs = glob.split('/').filter((s) => s !== '' && s !== '.')
  let re = '^'
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const last = i === segs.length - 1
    if (s === '**') {
      re += last ? '.*' : '(?:[^/]+/)*'
      continue
    }
    re += s
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    if (!last) re += '/'
  }
  re += '$'
  return new RegExp(re)
}

/** `files` 项命中的发布物文件（字面目录项 → 命中其子树；空数组 = 命中 0 个 = 缺件） */
function matchesOf(entry, files) {
  const norm = entry.replace(/\/+$/, '')
  const res = [globToRegExp(norm), globToRegExp(norm + '/**')]
  return files.filter((f) => res.some((r) => r.test(f)))
}

/** 该 `files` 项在**磁盘上**能匹配到什么（用于区分「静默丢件」与「悬空声明」） */
function matchesOnDisk(entry, pkgDir) {
  const all = []
  const walk = (d, rel0) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const rel = rel0 ? rel0 + '/' + e.name : e.name
      all.push(rel)
      if (e.isDirectory()) walk(path.join(d, e.name), rel)
    }
  }
  try {
    walk(pkgDir, '')
  } catch {
    return 0
  }
  return matchesOf(entry, all).length
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口 → 相对 import 闭包（在发布物内可解析性）
// ─────────────────────────────────────────────────────────────────────────────
const EXT_CANDIDATES = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.vue', '.json', '.css', '.d.ts', '.d.mts', '.d.cts']
const INDEX_CANDIDATES = ['/index.ts', '/index.tsx', '/index.js', '/index.mjs', '/index.cjs', '/index.vue', '/index.d.ts']
/** 可读源码后缀（决定要不要继续向下追 import） */
const SOURCE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|vue)$/
const MAX_FILE_BYTES = 512 * 1024

/** 从 package.json 收集入口路径（main/types/exports 的字符串叶子，去重；忽略 ./package.json）
 *  ★含 `*` 的 exports 子路径是**模式**（`"./*": "./*"`）而非具体文件——不参与「入口是否在包内」判定。 */
function entryPaths(pkg) {
  const out = new Set()
  const push = (v) => {
    if (typeof v !== 'string' || !v.startsWith('.')) return
    if (v.includes('*')) return
    const rel = v.replace(/^\.\//, '')
    if (rel !== 'package.json') out.add(rel)
  }
  push(pkg.main)
  push(pkg.types)
  const walkExports = (v) => {
    if (typeof v === 'string') push(v)
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walkExports(x)
  }
  walkExports(pkg.exports)
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') push(pkg.bin)
    else for (const v of Object.values(pkg.bin)) push(v)
  }
  return [...out]
}

/** 在发布物内解析相对说明符（spec 相对 importer） */
function resolveInPack(spec, importer, fileSet) {
  const clean = spec.split('?')[0].split('#')[0]
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), clean))
  for (const ext of EXT_CANDIDATES) if (fileSet.has(base + ext)) return base + ext
  for (const idx of INDEX_CANDIDATES) if (fileSet.has(base + idx)) return base + idx
  return null
}

/**
 * 收集一行里的相对 import/require 说明符。
 * ★必须排除「字符串字面量里提到的 import」——本仓踩到过真实误报：`plugin-vite` 的
 *   dist 里有一行 `const t = cond ? "... require('./_proteus/runtime.js') ..." : "..."`，
 *   那是**要注入到小程序产物里的代码文本**（`_proteus/*.js` 是构建期生成物，不属于本包），
 *   正则裸扫会把它当成真实相对 import，报出并不存在的缺件。
 *   判据：按引号奇偶判断匹配位置是否在字符串内（处理 `\\` 转义）。
 */
function relativeSpecifiers(line) {
  const out = []
  const re = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g
  let m
  while ((m = re.exec(line))) {
    if (insideStringLiteral(line, m.index)) continue
    out.push(m[1])
  }
  return out
}

/** 位置 idx 是否落在（双/单/反）引号字符串内部——逐字符扫描并跟踪转义 */
function insideStringLiteral(line, idx) {
  let quote = null
  let escaped = false
  for (let i = 0; i < idx; i++) {
    const c = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
  }
  return quote !== null
}

/** BFS：入口 → 相对 import 闭包；返回发布物内缺失的说明符清单 */
function missingRelativeImports(pkgDir, entries, fileSet) {
  const missing = []
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel) || !SOURCE_RE.test(rel)) continue
    seen.add(rel)
    const abs = path.join(pkgDir, rel)
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      missing.push(`${rel}（打包器声称在包内，磁盘上却不存在）`)
      continue
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
    const src = fs.readFileSync(abs, 'utf8')
    if (src.includes('\u0000')) continue
    for (const line of src.split('\n')) {
      for (const spec of relativeSpecifiers(line)) {
        const resolved = resolveInPack(spec, rel, fileSet)
        if (resolved) queue.push(resolved)
        else missing.push(`${rel} → ${spec}`)
      }
    }
  }
  return { missing: [...new Set(missing)], scanned: seen.size }
}

// ─────────────────────────────────────────────────────────────────────────────
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
    out.push({ dir: path.join(dir, d), short: j.name.replace('@proteus-vue/', ''), full: j.name, version: j.version, pkg: j })
  }
  return out.sort((a, b) => a.short.localeCompare(b.short))
}

const pkgs = only ? listPackages().filter((p) => p.short === only) : listPackages()
if (!pkgs.length) {
  console.error(`[${TAG}] 未找到匹配的包${only ? `（--only ${only}）` : ''}`)
  process.exit(2)
}

const t0 = Date.now()
const reports = []
let cacheHits = 0
for (const p of pkgs) {
  const pkgRel = path.relative(ROOT, p.dir)
  const pack = packedFiles(p.dir, pkgRel)
  if (pack.cached) cacheHits++
  if (!pack || pack.error) {
    reports.push({
      name: p.full,
      version: p.version,
      errors: [`打包失败：${pack?.error ?? '未知错误'}——先跑 node scripts/build-packages.mjs 构建 dist 后重试`],
    })
    continue
  }
  const fileSet = new Set(pack.files)
  const errors = []
  const dangling = []

  // ① files 每一项必须命中 ≥1 个文件（本次事故的直接判据）
  //    ★区分两种「命中 0」：磁盘上有内容却没进包 = **静默丢件**（本次事故，致命）；
  //      磁盘上本来就没有 = 悬空声明（无害，但发出去的包与声明不符，一并清掉）。
  for (const entry of p.pkg.files ?? []) {
    // ★0 与打包器无关的静态规则（2026-09-20 补，事故根因的**根**）：
    //   `files` 里的**纯目录通配**（`p-*`、`assets/*` 这类「末尾是 *、后面不跟 / 或 **」）是**脆弱的**——
    //   npm 打包器不展开它（=事故），pnpm 恰好展开（=侥幸通过）。**当前验证只覆盖「我用的那个打包器」**，
    //   换打包器/升级版本就可能重演同一事故。故此处**直接禁止该写法**，要求写 `dir/**`（两种打包器都正确）。
    //   —— 判据与打包器解耦：不再依赖「当前打包器恰好支持」。
    const bare = entry.replace(/\/+$/, '')
    const starAt = bare.indexOf('*')
    if (starAt >= 0 && !bare.includes('**') && !bare.slice(starAt).includes('/')) {
      errors.push(
        `files 项 "${entry}" 是**纯目录通配**——npm 打包器不展开它（2026-09-20 组件全量丢件事故的根因），` +
          `仅靠当前打包器（pnpm）恰好支持才通过。请改写为 "${bare}/**"（两种打包器语义一致）。`,
      )
      continue
    }
    if (matchesOf(entry, pack.files).length) continue
    const onDisk = matchesOnDisk(entry, p.dir)
    if (onDisk > 0) {
      errors.push(
        `files 项 "${entry}" 命中 ${onDisk} 个磁盘文件，但**打包器一个都没收进来**——发布物缺件（本次事故形态：纯目录通配不会自动展开，须写 "dir/**"）`,
      )
    } else {
      dangling.push(`files 项 "${entry}" 在磁盘上就不存在（悬空声明，建议清掉）`)
    }
  }

  // ② 入口必须在发布物内
  const entries = entryPaths(p.pkg)
  const entriesInPack = []
  for (const e of entries) {
    if (fileSet.has(e)) entriesInPack.push(e)
    else errors.push(`入口 ${e} 不在发布物内（package.json 的 main/types/exports/bin 指向了不会被打包的文件）`)
  }

  // ③ 入口的相对 import 闭包必须在发布物内可解析
  const { missing, scanned } = missingRelativeImports(p.dir, entriesInPack, fileSet)
  for (const m of missing) errors.push(`相对 import 在发布物内找不到：${m}（用户 import 时即构建失败）`)

  reports.push({ name: p.full, version: p.version, files: pack.files.length, scanned, cached: pack.cached, errors, dangling })
}

saveCache()

const bad = reports.filter((r) => r.errors.length)
const dangles = reports.filter((r) => !r.errors.length && r.dangling.length)
if (asJson) {
  console.log(JSON.stringify({ checked: reports.length, failed: bad.length, dangling: dangles.length, reports }, null, 2))
} else {
  console.log(`[${TAG}] ★核对「实际打出去的包里有什么」（打包器：pnpm；缓存命中 ${cacheHits}/${reports.length}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`)
  for (const r of reports) {
    if (!r.errors.length) {
      if (r.dangling.length) {
        console.log(`  ⚠ ${r.name}@${r.version}（${r.files} 个文件）`)
        for (const d of r.dangling) console.log(`      - ${d}`)
      } else if (verbose) {
        console.log(`  ✓ ${r.name}@${r.version} —— ${r.files} 个文件 · import 闭包 ${r.scanned} 个文件`)
      }
      continue
    }
    console.log(`\n  ✗ ${r.name}@${r.version}（${r.files ?? '?'} 个文件）`)
    for (const e of r.errors) console.log(`      - ${e}`)
  }
  if (bad.length) {
    console.log(`\n[${TAG}] ✗ ${bad.length}/${reports.length} 个包的发布物有问题——修好再发布（npm 版本不可变，发出去只能换版本号重发）`)
    process.exitCode = 1
  } else {
    console.log(
      `[${TAG}] ✓ ${reports.length} 个包：files 声明全部命中、入口与相对 import 闭包均在发布物内` +
        (dangles.length ? `（另有 ${dangles.length} 个悬空声明待清理，不阻断发布）` : ''),
    )
  }
}
process.exitCode = bad.length ? 1 : 0
