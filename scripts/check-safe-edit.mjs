#!/usr/bin/env node
// scripts/check-safe-edit.mjs —— ★★静态门禁：脚本内部的"就地批量改源文件"
//
// 【与 hook 的分工（与 sleep 那条同源）】`scripts/hooks/deny-direct-edit.mjs` 只看**命令字面量**
//   （`sed -i` / 内联 python 写文件 / 重定向）；脚本**内部**的同类行为字面上看不见 ⇒ 本条扫静态。
//   ★本仓已为这类"结构性盲区"付过代价（sleep 那条：hook 拦不住脚本内部盲等 600 秒）。
//
// 【判据】扫 `scripts/**` `.agents/**` `hosts/**` 的 .sh/.mjs/.py/.ts：
//   · `sed -i` / `perl -i`（就地编辑，且行内不含临时路径）
//   · node 的 `writeFileSync(...)` 写到非临时路径（变量名/行内含 tmp|temp|out|result|report|dist|build 视为临时）
//   ★白名单：`scripts/safe-edit.mjs`（唯一合法通道，它写文件是职责本身）。
//
// 【为什么这条必须存在】用户 2026-10-04 纪律：「修改文件不能直接修改源文件，必须先在临时文件修改
//   然后做 diff」。本轮实测代价：正则批量改代码把类名前缀剥掉、把函数整块吞掉、把表达式改成语
//   法残片——每次都"改完才发现 → 再花更多时间修回来"。
//
// 用法：node scripts/check-safe-edit.mjs
// 退出码：0 通过 / 1 有违规
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_DIRS = ['scripts', '.agents', 'hosts']
/** 唯一合法通道（它写文件是职责本身） */
const ALLOW = new Set([
  'scripts/safe-edit.mjs',
  // ★本门禁与它的 hook 孪生兄弟：源码里**以字符串字面量描述**被拦形态（正则/诊断文案），
  //   不是真的在跑 sed——不排除会"自己拦自己"（本仓"注释自污染"的同族：模式字面量自命中）。
  'scripts/check-safe-edit.mjs',
  'scripts/hooks/deny-direct-edit.mjs',
])
/** 临时/构建路径白名单（写这些不受限） */
const TMP_RE = /\/tmp\/|\/var\/folders\/|dist\/|build\/|node_modules\/|\.tmp|mktemp|result|report|assets\//i

const violations = []
let scanned = 0

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(sh|bash|mjs|js|py|ts)$/.test(e.name)) continue
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    if (ALLOW.has(rel)) continue
    scanned++
    const lines = fs.readFileSync(full, 'utf-8').split('\n')
    lines.forEach((line, i) => {
      const t = line.trim()
      // ★先剥注释（本仓"注释自污染"教训：说明文字里的模式会命中自己的检查器）
      if (t.startsWith('#') || t.startsWith('//')) return
      const hits = []
      if (/\bsed\b[^\n]*\s-[a-zA-Z]*i/.test(line) && !TMP_RE.test(line)) hits.push('sed -i')
      if (/\bperl\b[^\n]*\s-[a-zA-Z]*i/.test(line) && !TMP_RE.test(line)) hits.push('perl -i')
      // ★2026-10-04 收窄：**不再拦 writeFileSync**——生成器/构建脚本写产物（夹具、资产、
      //   JSON 报告）是它们的正常职责，与"把已有源文件当字符串批量改"是两件事。
      //   本门禁只盯**就地编辑现有文件**的形态（sed -i / perl -i）——那才是本轮踩坑的形态。
      if (hits.length) violations.push(`${rel}:${i + 1} [${hits.join(' / ')}] ${t.slice(0, 90)}`)
    })
  }
}

for (const d of TARGET_DIRS) {
  const full = path.join(ROOT, d)
  if (fs.existsSync(full)) walk(full)
}

console.log('安全编辑门禁（脚本内部禁止就地批量改源文件）')
console.log(`  扫描 ${scanned} 个脚本（${TARGET_DIRS.join(' / ')}）`)
if (violations.length) {
  console.error(`\n❌ 发现 ${violations.length} 处"脚本内部就地改源文件"：\n`)
  for (const v of violations) console.error(`  ${v}`)
  console.error('\n  修法：改走 `node scripts/safe-edit.mjs <file> --replace ... [--apply]`（临时文件 + diff + 校验）。')
  console.error('  写 /tmp、dist、build 等产物路径不受限。')
  process.exit(1)
}
console.log('  ✅ 无违规（唯一合法通道 = scripts/safe-edit.mjs）')
