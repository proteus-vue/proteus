// scripts/check-script-compile.mjs
// ★#497 全量 script 编译门禁——防「demo 逐个暴露编译器形态缺口」循环：把 examples/pages + subpackages +
//   src/components（proteus 内置组件）+ examples/components 全部 .vue 一次整包编译（compileVueSfc）+
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
collect(path.join(ROOT, 'src/components'), files) // proteus 内置组件（frameworkComponentsDir 指向）

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

console.log(`[script-compile] ${pass} 个 script 通过 / ${failures.length} 失败（${files.length} 文件；静默 MVP 提示 ${suppressed} 条）`)
if (failures.length) {
  console.error('[script-compile] ❌ 编译形态缺口（修复根因或登记豁免——禁止靠改 demo 规避）:')
  for (const x of failures.slice(0, 15)) console.error(`  - ${x}`)
  process.exit(1)
}
console.log('[script-compile] ✅ 全量 script 编译通过')
