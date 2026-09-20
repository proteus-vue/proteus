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
/** 提示级（不判失败，但值得看）——如「有组件声明却无本体、且无人引用」（F-30 的早期信号） */
const warnings = []
let checkedPages = 0
let checkedRefs = 0
/** 产物 js 文件数（③ 语法/改写扫描——见 auditJsOutputs） */
let checkedJs = 0
/** 框架组件产物数（F-30 完整性对账） */
let checkedFrameworkComponents = 0

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

  // ③ ★★2026-09-20（外部实战报告 F-30，真机阻断级）：**产物完整性对账**——
  //    上述 ① ② 是「声明 ⇒ 产物存在」；F-30 的形态是**声明本身就没生成**：
  //    页面经应用组件中转引用框架组件 → 按需输出把 76 个组件全判「未引用」→ 只产出 index.json
  //    → 真机报 `usingComponents["p-drawer"] 未找到组件`、模拟器启动失败。
  //    而「按需输出 0 个」当时被当作合法结果、无告警 → 四道门禁全放行。
  //    ▲教训（报告原文）：「产物验收必须对着**应有清单**数，不能对着现有清单数」。
  //    故此处与**框架组件源目录**对账：产物里出现 index.json 的框架组件，必须四件套齐全；
  //    且若源目录存在但产物一个都没输出 → 提示（可能是按需过滤误判）。
  auditFrameworkComponentCompleteness()
}

/**
 * 框架组件产物完整性（F-30 的直接判据）：**凡在产物里出现了 `index.json` 的目录**，
 * 就必须四件套齐全——只有声明没有本体 = 真机 `usingComponents` 未找到组件、启动失败。
 *
 * ★判据收紧（避免两类误报，实测于本仓 examples 产物）：
 *   ① 只认「有 index.json」的目录为**组件**——`proteus/runtime/` 之类是 runtime/*.ts 的同名输出目录
 *      （里面是 capability.js 等），无 index.*，不是组件，不该按组件校验；
 *   ② 未被任何 json `usingComponents` 引用的**孤立** index.json：不判失败（小程序不会加载它），
 *      但作为「产出了未使用的组件声明」提示——它正是「按需输出过滤」出问题的早期信号（F-30 形态）。
 */
function auditFrameworkComponentCompleteness() {
  const proteusDir = path.join(MP_DIR, 'proteus')
  if (!fs.existsSync(proteusDir)) return
  // 收集产物里所有 usingComponents 的目标（判断一个组件声明是否真会被加载）
  const referenced = new Set()
  const collectRefs = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) collectRefs(p)
      else if (e.name.endsWith('.json')) {
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
          for (const t of Object.values(j.usingComponents ?? {})) referenced.add(String(t))
        } catch {
          /* 非组件 json / 解析失败 */
        }
      }
    }
  }
  collectRefs(MP_DIR)

  let dirs
  try {
    dirs = fs.readdirSync(proteusDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return
  }
  // ★只把「有 index.json」的当作组件目录（排除 runtime/ 之类的同名输出目录）
  const componentDirs = dirs.filter((name) => fs.existsSync(path.join(proteusDir, name, 'index.json')))
  checkedFrameworkComponents = componentDirs.length
  for (const name of componentDirs) {
    const base = path.join(proteusDir, name, 'index')
    const missing = QUARTET.filter((ext) => !fs.existsSync(base + ext))
    if (!missing.length) continue
    const isReferenced = referenced.has(`/proteus/${name}/index`)
    if (isReferenced) {
      // 被引用却缺本体 → 真机会崩（F-30 的致命形态）
      issues.push({
        kind: 'framework-component-incomplete',
        via: `proteus/${name}`,
        missing: missing.map((e) => e.replace('.', '')),
        detail:
          '框架组件产物不完整（有声明、有引用，但无组件本体）——真机会报 usingComponents 未找到组件、**模拟器启动失败**。' +
          '若这是「按需输出」过滤的结果，说明过滤误判了引用（见 tag-scan.ts collectUsedFrameworkComponents）',
      })
    } else {
      // 未被引用的孤立声明 → 不崩，但提示（F-30 的早期信号：过滤逻辑出问题的形态）
      warnings.push({
        kind: 'orphan-component-json',
        via: `proteus/${name}`,
        missing: missing.map((e) => e.replace('.', '')),
        detail: '产物里有组件声明（index.json）但无本体、且无任何 usingComponents 引用它——不致命，但属「按需输出」异常信号',
      })
    }
  }
  // ④ ★2026-09-20（外部实战报告第十三节两个编译器 bug 的产物侧兜底）：
  //    「产物能不能真正跑起来」不只取决于引用闭环，还取决于**每份 js 是不是合法且未被改坏的 JS**：
  //      · Bug A：setter 参数带 TS 类型注解原样进产物 → `Unexpected token ':'`（阻断构建）；
  //      · Bug B：方法体正则字面量被当作变量改写 → `/\s/g` 变 `/\this.s/g`（**语法合法、静默改行为**）。
  //    报告建议「编译产物输出前跑语法校验」——编译器内 `assertValidResult` 已有（故 Bug A 表现为编译失败
  //    而非崩在真机），但那是**单页编译**时做的，且 Bug B 那种「合法但错」的产物语法校验抓不到。
  //    故在此对**整包产物**补两道扫描：语法可解析性 + 改写特征（真机才暴露的形态）。
  auditJsOutputs()
}

/**
 * 产物 js 自检：① 语法可解析 ② 正则字面量污染特征（`/\this` 形态）③ 参数位残留 TS 注解。
 * 语法用 `new Function`（与编译器 validateJs 同法——产物为 ES5 安全语法，宿主 Node 可解析）。
 */
function auditJsOutputs() {
  const jsFiles = []
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js')) jsFiles.push(p)
    }
  }
  walk(MP_DIR)
  checkedJs = jsFiles.length
  for (const f of jsFiles) {
    let src
    try {
      src = fs.readFileSync(f, 'utf-8')
    } catch {
      continue
    }
    // ① 语法
    try {
      // eslint-disable-next-line no-new-func
      new Function(src)
    } catch (err) {
      const msg = err.message
      const m = /(\d+):(\d+)/.exec(msg)
      let snippet = ''
      if (m) snippet = (src.split('\n')[Number(m[1]) - 1] ?? '').trim().slice(0, 120)
      issues.push({ kind: 'js-syntax', via: path.relative(MP_DIR, f), detail: `${msg}${snippet ? ` ← ${snippet}` : ''}` })
    }
    // ② 正则污染（Bug B 的产物形态）
    const hits = src.match(/\/[^/\n]*\\this[^/\n]*\//g)
    if (hits) issues.push({ kind: 'regex-mangled', via: path.relative(MP_DIR, f), detail: `正则被改写：${hits.slice(0, 3).join(' , ')}` })
    // ③ 参数位残留类型注解（Bug A 的产物形态；语法校验通常先抓到，此处给出更明确归因）
    const anno = /proteusSet\w+\([^)]*:/.exec(src)
    if (anno) issues.push({ kind: 'param-type-annotation', via: path.relative(MP_DIR, f), detail: `参数位残留 TS 注解：${anno[0].slice(0, 80)}` })
  }
}

const ok = issues.length === 0
if (asJson) {
  console.log(JSON.stringify({ dir: path.relative(ROOT, MP_DIR), pages: checkedPages, refs: checkedRefs, issues, warnings, ok }, null, 2))
} else {
  console.log('小程序产物完整性审计（引用闭环：声明 ⇒ 四件套存在）')
  console.log(`  产物目录：${path.relative(ROOT, MP_DIR)}`)
  console.log(`  页面 ${checkedPages} 个 · 组件引用 ${checkedRefs} 处 · js 产物 ${checkedJs} 个 · 框架组件 ${checkedFrameworkComponents} 个`)
  if (ok) {
    console.log('  ✅ 全部声明引用均有完整产物（页面四件套 + usingComponents 递归）')
    console.log('  ✅ 全部 js 产物语法可解析、无正则改写/参数注解残留')
    if (warnings.length) {
      console.log(`  ⚠ ${warnings.length} 项提示（不判失败）：`)
      for (const w of warnings.slice(0, 8)) console.log(`    - [${w.kind}] ${w.via}（缺 ${w.missing.join('/')}）：${w.detail}`)
      if (warnings.length > 8) console.log(`    …另有 ${warnings.length - 8} 项`)
    }
  } else {
    console.log(`  ❌ ${issues.length} 项问题：`)
    for (const i of issues.slice(0, 30)) {
      if (i.kind === 'no-artifacts') console.log(`    - [${i.kind}] ${i.detail}`)
      else if (i.kind === 'missing-quartet') console.log(`    - [缺文件] ${i.via} → ${i.target}（缺 ${i.missing.join('/')}）`)
      else if (i.kind === 'missing-page') console.log(`    - [页面缺四件套] ${i.via}（缺 ${i.missing.join('/')}）`)
      else if (i.kind === 'missing-file') console.log(`    - [引用缺文件] ${i.via} → ${i.tag}（${i.target}）`)
      else if (i.kind === 'js-syntax') console.log(`    - [js 语法错误] ${i.via}：${i.detail}`)
      else if (i.kind === 'regex-mangled') console.log(`    - [正则被改写] ${i.via}：${i.detail}`)
      else if (i.kind === 'framework-component-incomplete') console.log(`    - [框架组件产物不完整] ${i.via}（缺 ${i.missing.join('/')}）：${i.detail}`)
      else if (i.kind === 'param-type-annotation') console.log(`    - [参数残留 TS 注解] ${i.via}：${i.detail}`)
      else console.log(`    - [${i.kind}] ${i.via}：${i.detail}`)
    }
    if (issues.length > 30) console.log(`    …另有 ${issues.length - 30} 项`)
    console.log('  → 此类缺陷会致微信「未找到组件」并**整个小程序启动失败**——必须修（勿只改声明）')
  }
}
process.exit(ok ? 0 : 1)
