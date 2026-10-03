#!/usr/bin/env node
// scripts/safe-edit.mjs —— ★★★安全编辑工具（2026-10-04 立 · 用户明示纪律）
//
// 【为什么必须有这个工具（用户原话 + 本轮真实代价）】
//   用户原话：「**修改文件不能直接修改源文件，必须先在临时文件修改然后做 diff**，
//     这样才能提前知道有没有把文件改坏」。
//   本轮实测代价（AI 用正则批量改 superapp 四个页面）：
//     · `class="sa-card"` → `class="card"`（**类名被剥前缀**，页面样式全丢）
//     · `function readVal(...)` 整块被吞（后面引用全报 undefined）
//     · `function webBridge(...)` 被正则误删（verify 页 8 处调用全断）
//     · `(s as {...}).data` 表达式被替换成语法残片（TS1005/TS1128）
//   每一次都是"直接改源文件 → 编译/构建报错 → 再花更多时间修回来"。
//   ⇒ **纪律**：任何**程序化编辑**（正则/批量/脚本）必须走本工具——
//     过程 = 写入临时文件 → **输出 diff 供人/AI 审阅** → 语法与结构校验 → 通过才落盘。
//     校验不过 ⇒ **源文件保持原样**（改坏的东西根本进不去）。
//
// 【用法】
//   # ① 用 sed 风格替换（最常用；支持正则，g 后缀全局）
//   node scripts/safe-edit.mjs <file> --replace 's/旧/新/g' [--apply]
//
//   # ② 用一段 JS 变换函数（复杂改写；脚本导出 (src, ctx) => string）
//   node scripts/safe-edit.mjs <file> --script /tmp/transform.mjs [--apply]
//
//   # ③ 检查模式（不给 --apply）：只做"假想编辑 + diff + 校验"，**不落盘**（默认行为）
//   node scripts/safe-edit.mjs <file> --replace 's/a/b/g'
//
//   ★默认（无 --apply）= 预演：写临时文件、打 diff、跑校验，然后**报告会改什么**。
//     加 --apply 才真正落盘（且仅在**校验全过**时）。
//
// 【校验项（落盘前的机器门禁）】
//   ① 语法检查（按扩展名分派）：.mjs/.js → `node --check`；.json → JSON.parse；
//      .py → py_compile；.sh/.bash → `bash -n`；.vue → 结构检查（template/script/style 块齐全 + 花括号平衡）
//   ② 结构完整性：文件非空、体积变化在合理范围（默认 ±60%，可用 --max-shrink 调）
//   ③ 括号/引号平衡（粗粒度：对 .vue/.ts/.js 统计 (){}[] 计数——能抓住"正则吃掉函数块"这类破坏）
//   ④ ★Vue SFC 专项：`<script setup>` 里**被引用但未声明**的顶层标识符粗检（本轮 webBridge/readVal
//      被吞就是这类）——只报可疑，不阻断（避免误伤；人/AI 看 diff 时重点关注）
//
// 【退出码】0 = 校验通过（预演成功 / 已落盘）；1 = 校验失败（源文件未动）；2 = 用法错误
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'

// ★2026-10-04：.ts/.vue 的真实语法校验（TypeScript 解析器）用——从本工具文件位置解析仓库依赖
const requireFromRepo = createRequire(import.meta.url)

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith('--'))
const hasFlag = (f) => argv.includes(f)
const flagVal = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

if (!file || hasFlag('--help') || hasFlag('-h')) {
  console.log(`用法：
  node scripts/safe-edit.mjs <file> --replace 's/旧/新/g' [--apply]
  node scripts/safe-edit.mjs <file> --script /tmp/transform.mjs [--apply]
  （不带 --apply 为预演：临时文件 + diff + 校验，不改源文件）`)
  process.exit(argv.length === 0 ? 0 : 2)
}
if (!fs.existsSync(file)) {
  console.error(`✗ 文件不存在：${file}`)
  process.exit(2)
}

const src = fs.readFileSync(file, 'utf-8')
let next

// ── 变换实现 ────────────────────────────────────────────────────────────────
if (flagVal('--replace')) {
  const spec = flagVal('--replace')
  // ★手写扫描（不用正则）：必须尊重 \/ 转义——旧正则版在 `s/<\/style>//g` 这类模式上错位
  //   （实测：把 `<\` 当成 from ⇒ Invalid regular expression）。
  const parseS = (spec) => {
    if (!spec.startsWith('s')) return null
    let i = 1
    const seg = []
    let cur = ''
    const delim = spec[i]
    if (!delim) return null
    i++
    for (; i < spec.length; i++) {
      const ch = spec[i]
      if (ch === '\\' && i + 1 < spec.length) {
        const nx = spec[i + 1]
        if (nx === delim) { cur += delim; i++; continue }  // \/ → 字面 /
        cur += ch + nx; i++; continue
      }
      if (ch === delim) { seg.push(cur); cur = ''; if (seg.length === 2) { i++; break } continue }
      cur += ch
    }
    if (seg.length < 2) return null
    const flags = spec.slice(i)
    return { from: seg[0], to: seg[1], flags: /^[gimsuy]*$/.test(flags) ? flags : null }
  }
  const parsed = parseS(spec)
  if (!parsed || parsed.flags === null) {
    console.error(`✗ --replace 格式应为 s/旧/新/g（收到：${spec}）`)
    process.exit(2)
  }
  const { from, to, flags } = parsed
  const re = new RegExp(from, flags.includes('g') ? flags : flags + 'g')
  const count = (src.match(re) ?? []).length
  next = src.replace(re, to)
  console.log(`替换：命中 ${count} 处`)
  if (count === 0) {
    console.error('✗ 0 命中——正则没匹配上（源文件未动）。请先核对模式。')
    process.exit(1)
  }
} else if (flagVal('--script')) {
  const sp = flagVal('--script')
  if (!fs.existsSync(sp)) {
    console.error(`✗ --script 文件不存在：${sp}`)
    process.exit(2)
  }
  const mod = await import(path.isAbsolute(sp) ? sp : path.resolve(sp))
  const fn = mod.default ?? mod.transform
  if (typeof fn !== 'function') {
    console.error('✗ 变换脚本必须 default 导出 (src: string) => string')
    process.exit(2)
  }
  next = fn(src, { file })
  if (typeof next !== 'string') {
    console.error('✗ 变换函数必须返回字符串')
    process.exit(2)
  }
} else {
  console.error('✗ 需指定 --replace 或 --script（见 --help）')
  process.exit(2)
}

// ── ① 写入临时文件（源文件此刻未动） ────────────────────────────────────────
const tmp = path.join(os.tmpdir(), `safe-edit-${path.basename(file)}-${Date.now()}${path.extname(file)}`)
fs.writeFileSync(tmp, next, 'utf-8')

// ── ② diff（先行取证） ──────────────────────────────────────────────────────
const diffOut = (() => {
  try {
    return execFileSync('diff', ['-u', file, tmp], { encoding: 'utf-8' })
  } catch (e) {
    return String(e.stdout ?? '')  // diff 退出码 1 = 有差异（正常）
  }
})()
const diffLines = diffOut.split('\n')
const MAX_DIFF = 120
console.log(`\n═══ DIFF（${diffLines.length} 行）═══`)
console.log(diffLines.slice(0, MAX_DIFF).join('\n'))
if (diffLines.length > MAX_DIFF) console.log(`…（截断，完整 diff 可 diff -u ${file} ${tmp}）`)
console.log('═══ /DIFF ═══\n')

// ── ③ 校验（不过 ⇒ 源文件不动） ─────────────────────────────────────────────
const failures = []
const warns = []
const ext = path.extname(file).toLowerCase()

// 3.1 空文件
if (next.trim().length === 0) failures.push('产物为空文件')

// 3.2 体积突变
const maxShrink = Number(flagVal('--max-shrink') ?? 0.6)
const shrink = 1 - next.length / Math.max(1, src.length)
if (shrink > maxShrink) {
  failures.push(`体积缩减 ${(shrink * 100).toFixed(0)}%（> ${(maxShrink * 100).toFixed(0)}% 阈值）——疑似误删大段内容`)
}

// 3.3 括号平衡（代码类文件）
let braceMismatch = ''
if (['.vue', '.ts', '.js', '.mjs'].includes(ext)) {
  // ★2026-10-04：计数**排除字符串/注释**（本仓"扫描面必须排除注释"同款纪律）——
  //   旧朴素计数把字符串字面量里的括号也算进去（实测：新代码含若干 '{' '}' 字面量 ⇒ 误报"平衡突变"，
  //   挡住了完全有效的编辑）。排除后只剩真实代码括号。
  const count = (s, ch) => {
    let n = 0
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (c === "'" || c === '"' || c === '`') {
        const q = c
        i++
        while (i < s.length) {
          if (s[i] === '\\') { i += 2; continue }
          if (s[i] === q) { i++; break }
          i++
        }
        continue
      }
      if (c === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue }
      if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i); i = j < 0 ? s.length : j + 2; continue }
      if (c === ch) n++
      i++
    }
    return n
  }
  for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
    const d = count(next, open) - count(next, close)
    if (Math.abs(d) > 2) {
      warns.push(`括号计数偏差较大：${open}${close} 净差 ${d}（编辑前后应大致守恒；请核对 diff）`)
    }
  }
  // 净差在编辑前后**突变**（+>3）= 强信号。★2026-10-04：**暂存**结论而非直接失败——
  //   本启发式对"模板字面量插值/正则字面量"等复杂形态仍有误报面（实测：改编译器时净差 8→1 但
  //   TS 解析 0 诊断）；权威解析器通过时降级为警告，无权威解析器时仍按失败处理（见下方 synErr 处）。
  const pairDelta = (s) => count(s, '{') - count(s, '}')
  if (Math.abs(pairDelta(next) - pairDelta(src)) > 3) {
    braceMismatch = `花括号平衡突变（编辑前 ${pairDelta(src)} → 编辑后 ${pairDelta(next)}）——正则很可能吃掉了代码块`
  }
}

// 3.4 语法检查（按扩展名）
let authoritativeChecked = false // ★2026-10-04：权威解析器是否实际运行（.js/.mjs/.json/.py/.sh 恒为真；.ts/.vue 取决于 typescript 可用）
const syntaxCheck = () => {
  try {
    if (ext === '.json') {
      JSON.parse(next)
      authoritativeChecked = true
      return null
    }
    if (ext === '.mjs' || ext === '.js') {
      execFileSync('node', ['--check', tmp], { encoding: 'utf-8', stdio: 'pipe' })
      authoritativeChecked = true
      return null
    }
    if (ext === '.py') {
      execFileSync('python3', ['-m', 'py_compile', tmp], { encoding: 'utf-8', stdio: 'pipe' })
      authoritativeChecked = true
      return null
    }
    if (ext === '.sh' || ext === '.bash') {
      execFileSync('bash', ['-n', tmp], { encoding: 'utf-8', stdio: 'pipe' })
      authoritativeChecked = true
      return null
    }
  } catch (e) {
    return String(e.stderr || e.stdout || e.message).slice(0, 600)
  }
  // ★2026-10-04：.ts/.vue 的真实语法校验——TypeScript 解析器（比粗粒度括号计数强得多；
  //   本轮改编译器时用它验证"临时产物 0 诊断"才敢确认括号计数是误报）。typescript 缺失时跳过（不误红）。
  if (ext === '.ts' || ext === '.vue') {
    try {
      const ts = requireFromRepo('typescript')
      let code = next
      if (ext === '.vue') {
        const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(next)
        code = m ? m[1] : ''
      }
      if (code.trim()) {
        const sf = ts.createSourceFile('edit-check.ts', code, ts.ScriptTarget.Latest, true)
        authoritativeChecked = true
        if (sf.parseDiagnostics.length) {
          const d = sf.parseDiagnostics[0]
          const lc = sf.getLineAndCharacterOfPosition(d.start)
          return `TS 解析诊断 ${sf.parseDiagnostics.length} 条（首条 第 ${lc.line + 1} 行：${String(d.messageText).slice(0, 200)}）`
        }
      }
    } catch {
      // typescript 不可用（非本仓环境）：跳过——由人工 diff + 构建门禁兜底
    }
  }
  return null // 无对应检查器（.rs 等）——由人工看 diff + 后续构建门禁兜底
}
const synErr = syntaxCheck()
if (synErr) failures.push(`语法检查失败：\n${synErr}`)
// ★2026-10-04：括号启发式暂存结论的最终裁决——权威解析器**通过**时降为警告（启发式有误报面）；
//   权威解析器未运行/失败时维持失败（启发式是没有解析器时的唯一防线）。
if (braceMismatch) {
  if (authoritativeChecked && !synErr) warns.push(`${braceMismatch}（权威语法解析已通过 ⇒ 按警告）`)
  else failures.push(braceMismatch)
}

// 3.5 Vue SFC 结构（块齐全）
if (ext === '.vue') {
  // ★成对检查（开+闭）：只查开标签会漏掉"闭标签被删"（自测用例 3 实测踩到）
  for (const tag of ['template', 'script', 'style']) {
    const openBefore = (src.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length
    const openAfter = (next.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length
    const closeBefore = (src.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
    const closeAfter = (next.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
    if (openBefore > 0 && openAfter !== openBefore) failures.push(`SFC 结构损坏：<${tag}> 开标签数 ${openBefore} → ${openAfter}`)
    if (closeBefore > 0 && closeAfter !== closeBefore) failures.push(`★SFC 结构损坏：</${tag}> 闭标签数 ${closeBefore} → ${closeAfter}`)
    if (openAfter > 0 && closeAfter === 0) failures.push(`★SFC 结构损坏：<${tag}> 无对应闭标签`)
  }
  // ★顶层标识符粗检（本轮 readVal/webBridge 被吞就是这类）：被引用但未声明
  const scriptMatch = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(next)
  if (scriptMatch) {
    const body = scriptMatch[1]
    const declared = new Set()
    for (const m of body.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
    for (const m of body.matchAll(/(?:import\s+[^'"]*?from\s*['"][^'"]+['"]|import\s+['"][^'"]+['"])/g)) {
      for (const n of m[0].matchAll(/([A-Za-z_$][\w$]*)\s*(?:,|})/g)) declared.add(n[1])
    }
    // 只查"形如函数调用且不在内置列表"的标识符（保守）
    const BUILTIN = new Set(['ref', 'computed', 'onMounted', 'onUnmounted', 'watch', 'watchEffect', 'reactive', 'defineProps', 'defineEmits', 'getCurrentPages', 'wx', 'console', 'JSON', 'String', 'Number', 'Boolean', 'Object', 'Array', 'Math', 'Date', 'setInterval', 'clearInterval', 'setTimeout', 'Promise', 'globalThis', 'typeof', 'require', 'if', 'for', 'while', 'return', 'new', 'this'])
    const missing = new Set()
    // ★只扫"我们自己的脚本函数被调用"的形态：更稳的做法是比对**编辑前**的声明集合
    const declaredBefore = new Set()
    const sm0 = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)
    if (sm0) {
      for (const m of sm0[1].matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declaredBefore.add(m[1])
    }
    // ★先剥注释再判（本仓"注释自污染"第五次踩到——本轮把旧名写在**说明注释**里 ⇒ 被自己的
    //   检查器当成"仍在引用" ⇒ 假红。纪律：断言/检查的扫描面必须排除注释。）
    const bodyNoComments = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '')
    for (const name of declaredBefore) {
      // ★2026-10-04：排除**类型/属性位置**（后随 `:` / `?` 的不是变量读取——如类型注解里的参数名
      //   `(t: string, l: string) => void`、对象键 `{ t: 1 }`）。不加这条会把"同名参数出现在类型注解里"
      //   误判成"仍在引用" ⇒ 假红挡住合法编辑（本轮实测：删掉 `const t = setInterval…` 后，
      //   类型声明里的 `t` 参数名让检查失败）。负向先行断言：紧跟 `:`/`?` 的引用不计。
      const usedInNext = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b(?!\\s*[?:])`).test(bodyNoComments)
      if (usedInNext && !declared.has(name)) missing.add(name)
    }
    if (missing.size > 0) {
      failures.push(`★SFC 脚本里这些标识符**编辑前声明、编辑后被引用但已无声明**（疑似整块被吞）：${[...missing].join(', ')}`)
    }
  }
}

// ── ④ 结论 ──────────────────────────────────────────────────────────────────
console.log('═══ 校验 ═══')
if (warns.length) for (const w of warns) console.log(`  ⚠ ${w}`)
if (failures.length) {
  console.error(`\n❌ 校验未过（${failures.length} 项）——**源文件未修改**（临时产物保留供查看）：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(`\n  临时产物：${tmp}`)
  console.error(`  修法：改小编辑范围 / 修正则 / 分步编辑；确认 diff 无误后重跑。`)
  process.exit(1)
}
console.log('  ✅ 校验通过')

if (hasFlag('--apply')) {
  fs.copyFileSync(tmp, file)
  fs.unlinkSync(tmp)
  console.log(`\n✅ 已落盘：${file}`)
} else {
  console.log(`\n（预演模式——源文件**未修改**。确认 diff 无误后加 --apply 落盘；临时产物 ${tmp}）`)
}

