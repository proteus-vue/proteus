// scripts/check-deps.mjs
// ★#422 依赖声明完整性审计（pnpm 严格解析治理——npm hoisting 侥幸时代遗留）：
//   逐 workspace（packages/* + examples + website）扫描源码 import/require 的裸模块，
//   对照 dependencies/devDependencies/peerDependencies 声明——缺失即报（pnpm 严格下运行时断链）。
// 用法：node scripts/check-deps.mjs [--fix-list]（--fix-list 输出可直接粘贴补声明的格式）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TARGETS = []
for (const e of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
  if (e.isDirectory() && fs.existsSync(path.join(ROOT, 'packages', e.name, 'package.json'))) TARGETS.push(`packages/${e.name}`)
}
for (const app of ['examples', 'website']) {
  if (fs.existsSync(path.join(ROOT, app, 'package.json'))) TARGETS.push(app)
}

// ★#423 模板子目标：packages/<pkg>/templates 自带 package.json（生成给用户的骨架）——
//   以模板自身 package.json 为声明集，扫描 templates/**（npm files 会打进发布包）
const TPL_TARGETS = []
for (const t of TARGETS) {
  const tplPkg = path.join(ROOT, t, 'templates', 'package.json')
  if (fs.existsSync(tplPkg)) TPL_TARGETS.push({ tpl: path.join(ROOT, t, 'templates'), pkgFile: tplPkg, label: `${t}/templates` })
}

const SCAN_DIRS = ['src', 'scripts']
const EXCLUDE = new Set(['node_modules', 'dist', '.proteus'])

function scanFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name) || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) scanFiles(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs|vue)$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** 提取裸模块名：import/export ... from 'x' | import('x') | require('x')（注释行跳过） */
function extractBare(spec) {
  if (!spec) return null
  if (spec.startsWith('.') || spec.startsWith('/')) return null
  if (spec.startsWith('node:')) return null
  // 子路径剥离：@scope/pkg/sub → @scope/pkg；pkg/sub → pkg
  if (spec.startsWith('@')) {
    const m = spec.match(/^(@[^/]+\/[^/]+)/)
    return m ? m[1] : null
  }
  return spec.split('/')[0]
}

const BARE_RE = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g
// 去除注释行后的裸模块提取（import/from 一般不在注释；URL 字符串内出现 'from' 的极少——以注释行剔除为主）

const findings = {}
// ★#422 豁免已移除（2026-09-14 拆包）：@proteus-vue/components 现为真实 workspace 依赖（node_modules 软链），
//   不再是 alias 虚拟模块——故不再豁免（其缺失应被本门禁如实报出）。
const ALIAS_VIRTUAL = new Set()
// 模板目标：扫描 templates/**（无 src/scripts 约定）——声明集 = 模板自带 package.json
const TPL_FILES = []
for (const tt of TPL_TARGETS) {
  const dir = tt.tpl
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'dist'].includes(e.name)) continue
    if (e.isDirectory()) scanFiles(path.join(dir, e.name), TPL_FILES)
    else if (/package\.json$/.test(e.name)) continue
    else if (/\.(ts|tsx|mjs|vue)$/.test(e.name)) TPL_FILES.push(path.join(dir, e.name))
  }
}
for (const rel of TARGETS) {
  const dir = path.join(ROOT, rel)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    // ★optionalDependencies 也是**已声明**——语义是"可缺省"，代码须能优雅降级（如 mcp 的 happy-dom）
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])
  const used = new Map() // mod → [files]
  const files = []
  for (const sd of SCAN_DIRS) {
    const sdir = path.join(dir, sd)
    if (fs.existsSync(sdir)) scanFiles(sdir, files)
  }
  // 包根可能还有非 src/scripts 的深层（examples/components/stores/pages 等应用特有目录）
  if (rel === 'examples' || rel === 'website') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !EXCLUDE.has(e.name) && !SCAN_DIRS.includes(e.name) && !['node_modules', 'dist', 'docs', 'subpackages', 'locales'].includes(e.name)) {
        if (e.name === 'pages' || e.name === 'components' || e.name === 'stores' || e.name === 'router' || e.name === 'shims' || e.name === 'capabilities' || e.name === 'utils' || e.name === 'ssr' || e.name === 'migration-from-vue' || e.name === 'subpackages') {
          scanFiles(path.join(dir, e.name), files)
        }
      }
    }
    // 入口 ts（main.ts 等在根）
    for (const f of fs.readdirSync(dir)) {
      if (/\.(ts|mts|vue)$/.test(f)) files.push(path.join(dir, f))
    }
  }
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const line of src.split('\n')) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
      if (t.includes('${')) continue // 模板插值行（动态 require 路径——非静态依赖）
      if (/["'`]import \{|\\nimport/.test(t)) continue // 字符串内嵌产物代码（codegen 生成文本/规则示例）
      // ★2026-09-30 补：**模板字符串开头的文档示例**（`example: \`import … from '@proteus-vue/animation'\``）
      //   首行没有 `\n` 前缀也不带引号包裹 ⇒ 上面那条漏网（实测：animation 的 rules.ts 两处误报）。
      //   ★纪律：跳过规则要对着"实际形态"，不是对着"我想象的写法"——与门禁覆盖面必须跟着形态走同源。
      if (/^[A-Za-z_$][\w$]*:\s*`/.test(t) || t.startsWith('`')) continue // 模板字符串起始行（文档示例）
      if (t.includes('@proteus/container') || t.includes('@proteus/core') || t.includes('<相对产物路径>')) continue // 文档/断言示例文本
      for (const m of line.matchAll(BARE_RE)) {
        // ★★2026-10-01 修复（实测误报）：**文档文本里的 `"from"`** 会被正则当成"import from 后跟模块名"
        //   捕获（形态：`` `num(a, "from")?` `` ⇒ 正则从 `from"` 起吃到下一个引号，
        //   报出一个含 CJK/括号/空格的"依赖"）。规则对着**实际形态**看住引号内容——
        //   合法模块名只含 `[@A-Za-z0-9/._~:-]`；含其它字符（空格/中文/括号/问号/反引号）即文档文本，跳过。
        //   （同源纪律：跳过规则要跟着"实际形态"走，不是跟着想象——见上方 2026-09-30 注释。）
        if (!/^[@A-Za-z0-9/._~:-]+$/.test(m[1])) continue
        const mod = extractBare(m[1])
        if (!mod || mod.length <= 1 || /^[\s|:;,.'"]+$/.test(mod) || ALIAS_VIRTUAL.has(mod)) continue
        if (mod.startsWith('@types/')) continue
        if (!used.has(mod)) used.set(mod, [])
        used.get(mod).push(path.relative(ROOT, f))
      }
    }
  }
  const missing = []
  for (const [mod, usages] of used) {
    if (!declared.has(mod)) {
      missing.push({ mod, usages: usages.slice(0, 3) })
    }
  }
  if (missing.length) findings[rel] = missing
}

// 模板目标检查（声明集 = 模板 package.json）
for (const tt of TPL_TARGETS) {
  const pkg = JSON.parse(fs.readFileSync(tt.pkgFile, 'utf8'))
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])
  const used = new Map()
  for (const f of TPL_FILES) {
    const src = fs.readFileSync(f, 'utf8')
    for (const line of src.split('\n')) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
      if (t.includes('${')) continue
      if (/["']import \{|\\nimport/.test(t)) continue
      if (t.includes('@proteus/container') || t.includes('@proteus/core') || t.includes('<相对产物路径>')) continue
      for (const m of line.matchAll(BARE_RE)) {
        if (!/^[@A-Za-z0-9/._~:-]+$/.test(m[1])) continue // 模板目标同款守卫（见上：文档文本 ≠ 依赖）
        const mod = extractBare(m[1])
        if (!mod || mod.length <= 1 || /^[\s|:;,.'"]+$/.test(mod) || ALIAS_VIRTUAL.has(mod)) continue
        if (mod.startsWith('@types/')) continue
        if (!used.has(mod)) used.set(mod, [])
        used.get(mod).push(path.relative(ROOT, f))
      }
    }
  }
  const missing = []
  for (const [mod, usages] of used) {
    if (!declared.has(mod)) missing.push({ mod, usages: usages.slice(0, 3) })
  }
  if (missing.length) findings[tt.label] = missing
}

const FIX_LIST = process.argv.includes('--fix-list')
let total = 0
for (const [rel, missing] of Object.entries(findings)) {
  console.log(`\n[${rel}] 缺失依赖 ${missing.length} 个：`)
  for (const { mod, usages } of missing) {
    total++
    console.log(`  ✗ ${mod}   （如 ${usages[0] ?? ''}）`)
  }
  if (FIX_LIST) {
    const isTpl = rel.endsWith('/templates')
    const base = isTpl ? rel.replace('/templates', '') : rel
    const pkgFile = isTpl
      ? path.join(ROOT, base, 'templates', 'package.json')
      : path.join(ROOT, rel, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    const dd = (pkg.devDependencies ??= {})
    for (const { mod } of missing) dd[mod] = 'workspace:*'
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  → 已补入 ${path.relative(ROOT, pkgFile)} devDependencies（workspace:*，发布版请按实际版本）`)
  }
}
console.log(`\n[check-deps] ${TARGETS.length} 个目标 · 缺失依赖 ${total} 个${total ? '（--fix-list 可自动补 devDeps）' : '——零缺失，pnpm 严格解析安全'}`)
if (total && !FIX_LIST) process.exit(1)
