// scripts/check-script-compile.mjs
// ★#497 全量 script 编译门禁——防「demo 逐个暴露编译器形态缺口」循环：把 examples/pages + subpackages +
//   packages/components（语义组件库）+ examples/components 全部 .vue 一次整包编译（compileVueSfc）+
//   js 产物语法校验（node --check）。任何形态缺口在 CI 红而非用户复测暴露（#494 全量扫描器固化）。
//   用法：node scripts/check-script-compile.mjs（失败 exit 1）；接入 npm run verify + CI verify job
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { compileVueSfc } = await import(path.join(ROOT, 'packages/compiler/dist/index.js'))

// 静默编译器常规提示（[mp-transform] 前缀——MVP 能力提示非失败），保留其它 console.warn/error
let suppressed = 0
const origWarn = console.warn
console.warn = (...a) => {
  const first = String(a[0] ?? '')
  if (first.startsWith('[mp-transform]')) suppressed++
  else origWarn(...a)
}

/** 收集扫描目录下全部 .vue */
function collect(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
}

const files = []
collect(path.join(ROOT, 'examples/pages'), files)
collect(path.join(ROOT, 'examples/subpackages'), files)
collect(path.join(ROOT, 'examples/components'), files)
collect(path.join(ROOT, 'packages/components'), files) // ★语义组件库（2026-09-14 拆包）

/**
 * ★★★**生成器语法护栏**（2026-10-03）——防"夹具注释里的反引号 / 美元花括号破坏 JS 模板串"。
 *
 * 【为什么必须机器化（本仓实测踩了 **5 次**）】生成器（hosts 下的 gen-*.mjs）把 SFC 夹具写成
 *   JS 模板字符串；夹具里的注释若含**未转义**反引号或美元花括号，会把宿主模板串提前闭合/插值
 *   ⇒ 生成器抛 SyntaxError，而症状（"夹具生成失败"）离根因（注释里一个字符）很远。
 *   ★规则写在注释里拦不住（同 sleep 盲等的教训）。
 *
 * 【判据 = **`node --check`**（本仓实测的口径演进）】
 *   · 首版自己写词法扫描（跳字符串/注释/模板串）——**漏报**：文件里含引号的**正则字面量**
 *     （如 /^(['"])([^'"]*)\1$/）会让扫描器把正则里的引号当字符串开始 ⇒ 后续全部错位 ⇒
 *     注入了未转义反引号也扫不出来（本仓实测：注入后仍报 0 违规）。
 *   · 正解：**直接用 Node 的语法检查**——它正是"这个字符会不会破坏模板串"的权威判据
 *     （同上：注入未转义反引号 ⇒ node --check **exit 1 并给出精确行列**；转义写法则合法通过）。
 *   ★顺带补上了一个真实覆盖盲区：**这些生成器此前从未被任何门禁编译过**
 *     （check:script-compile 只编译 .vue 产物；generator 只有跑构建时才被执行）。
 */
function checkGeneratorSyntax() {
  const targets = []
  for (const d of ['android', 'ios', 'harmony']) {
    const dir = path.join(ROOT, 'hosts', d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (/^gen-.*\.mjs$/.test(f)) targets.push(path.join(dir, f))
    }
  }
  const bad = []
  for (const file of targets) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (e) {
      const msg = String(e.stderr ?? e.message ?? '').split('\n').slice(0, 4).join(' ').slice(0, 300)
      bad.push(`${path.relative(ROOT, file)} 语法检查失败：${msg}` +
        '  ⇒ 常见根因：夹具注释里的**未转义**反引号 / 美元花括号破坏了 JS 模板串（本仓已踩五次）')
    }
  }
  return bad
}

let pass = 0
const failures = []
/** ★#503 ES5 tripwire：产物中出现 ?? / ?.（ES2020）→ 微信预览上传期 SyntaxError（node --check 认识该语法抓不到）。
 *  简化扫描（跳过字符串/模板/注释/正则），报告首处行号 */
function scanEs5Unsafe(js) {
  let i = 0
  let line = 1
  let prevSig = ''
  while (i < js.length) {
    const c = js[i]
    const next = js[i + 1]
    if (c === '\n') { line++; i++; continue }
    if (c === '/' && next === '/') { const e = js.indexOf('\n', i); i = e < 0 ? js.length : e; continue }
    if (c === '/' && next === '*') { const e = js.indexOf('*/', i + 2); i = e < 0 ? js.length : e + 2; continue }
    if (c === '\'' || c === '"') { let j = i + 1; while (j < js.length) { if (js[j] === '\\') { j += 2; continue } if (js[j] === c) break; j++ } i = j + 1; continue }
    if (c === '`') {
      let depth = 0
      let j = i + 1
      while (j < js.length) {
        const cc = js[j]
        if (cc === '\\') { j += 2; continue }
        if (depth === 0 && cc === '`') break
        if (cc === '$' && js[j + 1] === '{') depth++
        else if (depth > 0 && cc === '}') depth--
        else if (depth === 0 && (cc === '\'' || cc === '"')) { let k = j + 1; while (k < js.length) { if (js[k] === '\\') { k += 2; continue } if (js[k] === cc) break; k++ } j = k }
        else if (depth === 0 && cc === '`') { j-- }
        j++
      }
      i = j + 1
      continue
    }
    if (c === '?' && next === '?') return { kind: '??', line, col: i }
    if (c === '?' && next === '.' && !/[0-9]/.test(js[i + 2] ?? '')) return { kind: '?.', line, col: i }
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return null
}
for (const f of files.sort()) {
  const src = fs.readFileSync(f, 'utf8')
  const hasScript = /<script[^>]*>/.test(src)
  if (!hasScript) continue
  const isComponent = /defineProps|defineEmits|defineExpose/.test(src)
  const tmp = path.join(ROOT, 'node_modules', '.cache', 'proteus-check', path.basename(f).replace(/\.vue$/, '') + '-tmp.js')
  try {
    const r = compileVueSfc(src, { file: path.relative(ROOT, f), isComponent, fluidLayout: { designWidth: 375 } })
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, r.js ?? '')
    execFileSync('node', ['--check', tmp], { stdio: 'pipe' })
    const bad = scanEs5Unsafe(r.js ?? '')
    if (bad) {
      failures.push(`${path.relative(ROOT, f)}:${bad.line}  ES5-unsafe 「${bad.kind}」残留（微信预览编译不解析）`)
      continue
    }
    pass++
  } catch (e) {
    const msg = String(e.stderr || e.message || e)
    const line = (msg.match(/proteus-check[\w-]*\.js:(\d+)/) || [])[1]
    failures.push(`${path.relative(ROOT, f)}${line ? ':' + line : ''}  ${msg.split('\n').find((l) => /SyntaxError|Error/.test(l)) ?? msg.slice(0, 120)}`)
  }
}
fs.rmSync(path.join(ROOT, 'node_modules', '.cache', 'proteus-check'), { recursive: true, force: true })

// ★生成器模板串护栏（见 checkGeneratorTemplateGuards 头注；本仓踩过五次）
const tplViolations = checkGeneratorSyntax()
if (tplViolations.length) {
  console.error('[script-compile] ❌ 生成器语法护栏（node --check 失败）:')
  for (const x of tplViolations.slice(0, 15)) console.error(`  - ${x}`)
  process.exit(1)
}

console.log(`[script-compile] ${pass} 个 script 通过 / ${failures.length} 失败（${files.length} 文件；静默 MVP 提示 ${suppressed} 条）`)
if (failures.length) {
  console.error('[script-compile] ❌ 编译形态缺口（修复根因或登记豁免——禁止靠改 demo 规避）:')
  for (const x of failures.slice(0, 15)) console.error(`  - ${x}`)
  process.exit(1)
}
console.log(`[script-compile] ✅ 全量 script 编译通过（含生成器语法护栏：node --check 全过）`)
