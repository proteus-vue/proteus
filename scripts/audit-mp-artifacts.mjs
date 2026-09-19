// scripts/audit-mp-artifacts.mjs —— ★小程序产物「引用闭环完整性」门禁
//
// 背景（2026-09-19 真机暴露的缺陷）：MP 产物「按需输出框架组件」的扫描器硬编码 `tag.startsWith('p-')`，
//   而组件库有 `pg-` 前缀（pg-glass，G-07 液态玻璃）→ 被判「非框架组件」静默剔除：
//   页面 `pages/system-glass.json` 声明了 `usingComponents["pg-glass"]`，但产物里
//   `proteus/pg-glass/` 只有 index.json、缺 js/wxml/wxss → 微信报
//   「未找到组件」且**整个小程序启动失败**。该缺陷此前无任何门禁覆盖（真机才暴露）。
//
// 本门禁把该类缺陷**机器化**：产物里凡是「被声明引用」的东西，四件套必须真实存在——
//   ① app.json 声明的页面（主包 + 分包）：.js/.wxml/.wxss/.json
//   ② 每个页面/组件 json 的 `usingComponents`（递归：组件也可引用组件）：同上四件套
//   ③ usingComponents 指向的路径可解析（相对路径与绝对路径两种写法）
//
// 用法：
//   node scripts/audit-mp-artifacts.mjs [--dir <产物目录>] [--json]
//   默认目录 examples/dist/mp-weixin（`pnpm build:mp` 的产出）；需先构建（产物缺失即 FAIL，不静默跳过）。
// 退出码：0 通过 / 1 有问题（含产物缺失）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const dirArg = argv.indexOf('--dir')
const MP_DIR = path.resolve(ROOT, dirArg >= 0 && argv[dirArg + 1] ? argv[dirArg + 1] : 'examples/dist/mp-weixin')

/** 小程序四件套扩展名（缺任一 = 产物不完整） */
const QUARTET = ['.js', '.wxml', '.wxss', '.json']

const issues = []
let checkedPages = 0
let checkedRefs = 0

/**
 * 解析 usingComponents 的引用路径 → 产物内绝对路径（无扩展名）。
 * ★小程序语义（官方文档：「组件路径，相对于小程序根目录或绝对路径」）：
 *   相对路径以**小程序根目录**为基准，而非引用文件所在目录——按「相对文件」解析会指向产物外
 *   （实测：`pages/a.json` 里 `../../proteus/p-x/index` 会解析到 `<产物根>/../proteus/...`）→ 假红。
 *   本仓产物实际都用绝对路径（`/proteus/<tag>/index`），但兼容写法必须按规范解析。
 */
function resolveRef(ref) {
  if (ref.startsWith('/')) return path.join(MP_DIR, ref.slice(1))
  return path.join(MP_DIR, ref)
}

/** 检查一个「被引用目标」的四件套是否齐全 */
function checkQuartet(target, via) {
  const missing = QUARTET.filter((ext) => !fs.existsSync(target + ext))
  if (missing.length) {
    issues.push({ kind: 'missing-quartet', via, target: path.relative(MP_DIR, target), missing: missing.map((e) => e.replace('.', '')) })
  }
}

/** 递归检查一个 json 的 usingComponents（visited 防环） */
function checkJson(jsonPath, visited) {
  if (visited.has(jsonPath)) return
  visited.add(jsonPath)
  if (!fs.existsSync(jsonPath)) return
  let json
  try {
    json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  } catch (e) {
    issues.push({ kind: 'invalid-json', via: path.relative(MP_DIR, jsonPath), detail: String(e).slice(0, 120) })
    return
  }
  const uc = json.usingComponents
  if (!uc || typeof uc !== 'object') return
  for (const [tag, ref] of Object.entries(uc)) {
    checkedRefs++
    const target = resolveRef(String(ref))
    // ref 自带扩展名时按原样检查单文件；否则查四件套
    if (/\.[a-z]+$/.test(String(ref))) {
      if (!fs.existsSync(target)) issues.push({ kind: 'missing-file', via: path.relative(MP_DIR, jsonPath), tag, target: path.relative(MP_DIR, target) })
      continue
    }
    checkQuartet(target, `${path.relative(MP_DIR, jsonPath)} → ${tag}`)
    checkJson(target + '.json', visited) // 组件自身也可能引用组件
  }
}

const APP_JSON = path.join(MP_DIR, 'app.json')
if (!fs.existsSync(APP_JSON)) {
  issues.push({ kind: 'no-artifacts', via: 'app.json', detail: `产物不存在或未构建：${path.relative(ROOT, MP_DIR)}（先跑 pnpm build:mp）` })
} else {
  const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf-8'))
  const visited = new Set()
  // ① 页面（主包 + 分包）
  const pages = [...(app.pages ?? [])]
  for (const sp of [...(app.subPackages ?? []), ...(app.subpackages ?? [])]) {
    for (const p of sp.pages ?? []) pages.push(`${sp.root}/${p}`)
  }
  for (const p of pages) {
    checkedPages++
    const base = path.join(MP_DIR, p)
    const missing = QUARTET.filter((ext) => !fs.existsSync(base + ext))
    if (missing.length) {
      issues.push({ kind: 'missing-page', via: p, missing: missing.map((e) => e.replace('.', '')) })
    }
    checkJson(base + '.json', visited)
  }
  // ② app.json / app.js 自身声明（顶层 usingComponents——全局组件）
  checkJson(APP_JSON, visited)
}

const ok = issues.length === 0
if (asJson) {
  console.log(JSON.stringify({ dir: path.relative(ROOT, MP_DIR), pages: checkedPages, refs: checkedRefs, issues, ok }, null, 2))
} else {
  console.log('小程序产物完整性审计（引用闭环：声明 ⇒ 四件套存在）')
  console.log(`  产物目录：${path.relative(ROOT, MP_DIR)}`)
  console.log(`  页面 ${checkedPages} 个 · 组件引用 ${checkedRefs} 处`)
  if (ok) {
    console.log('  ✅ 全部声明引用均有完整产物（页面四件套 + usingComponents 递归）')
  } else {
    console.log(`  ❌ ${issues.length} 项问题：`)
    for (const i of issues.slice(0, 30)) {
      if (i.kind === 'no-artifacts') console.log(`    - [${i.kind}] ${i.detail}`)
      else if (i.kind === 'missing-quartet') console.log(`    - [缺文件] ${i.via} → ${i.target}（缺 ${i.missing.join('/')}）`)
      else if (i.kind === 'missing-page') console.log(`    - [页面缺四件套] ${i.via}（缺 ${i.missing.join('/')}）`)
      else if (i.kind === 'missing-file') console.log(`    - [引用缺文件] ${i.via} → ${i.tag}（${i.target}）`)
      else console.log(`    - [${i.kind}] ${i.via}：${i.detail}`)
    }
    if (issues.length > 30) console.log(`    …另有 ${issues.length - 30} 项`)
    console.log('  → 此类缺陷会致微信「未找到组件」并**整个小程序启动失败**——必须修（勿只改声明）')
  }
}
process.exit(ok ? 0 : 1)
