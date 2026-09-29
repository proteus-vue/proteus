#!/usr/bin/env node
// scripts/check-shell-i18n-vars.mjs —— ★★门禁：shell 脚本里禁止 `$VAR<全角字符>` 写法
//
// 【为什么需要（本会话实测踩到 3 次）】bash 的变量名**允许非 ASCII 字符**（多字节标识符），
//   而本仓注释/报错信息是**中文** ⇒ `say "… ${'$'}name：（说明）"` 这种写法里，
//   紧跟变量的全角标点（`：` `）` `（`）会被 bash 当作**变量名的一部分**
//   ⇒ `set -u` 下报 `unbound variable`（在**运行时**才炸，静态看不出）。
//
// 【实测踩点】① `scripts/setup-android-js-engine.sh`（首次，修 3 处）
//   ② `hosts/android/check-16kb-align.sh`（同一坑，新代码又犯）
//   ③ `hosts/android/build-and-run.sh`（第三次）⇒ 全仓扫描**另外发现 13 处**（跨 9 个脚本，
//     含 acceptance.sh / run-selfdraw.sh / publish-all.sh 等**既有脚本**——长期潜伏）。
//   ★与"固定 sleep 盲等"同源：**规则写在 markdown 里拦不住，只有工具层门禁是结构性的**。
//
// 【判据】扫描全部 `*.sh`：出现 `$VAR` 紧跟**非 ASCII 字符**即红（应写 `${VAR}<全角>`）。
//   ★白名单：`${VAR}` 形式不受影响（花括号已界定边界）；注释行也扫（注释里的示例照样会被抄）。
//
// 用法：node scripts/check-shell-i18n-vars.mjs
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.sh')) out.push(p)
  }
  return out
}

const files = [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'hosts')), ...walk(path.join(ROOT, '.agents'))]
// ★正则：`$NAME` 后紧跟非 ASCII（不含 `${...}` 形式）
const RISKY = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/

const hits = []
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    const m = RISKY.exec(line)
    if (m) hits.push({ file: path.relative(ROOT, f), line: i + 1, text: m[0], src: line.trim().slice(0, 100) })
  })
}

console.log(`shell 变量边界检查（扫 ${files.length} 个 .sh）`)
if (hits.length) {
  console.error(`\n❌ 发现 ${hits.length} 处 \`$VAR<全角字符>\`（bash 会把全角标点当变量名的一部分 ⇒ set -u 下 unbound variable）：\n`)
  for (const h of hits) console.error(`  ${h.file}:${h.line}  「${h.text}」\n      ${h.src}`)
  console.error('\n  修法：写成 `${VAR}<全角>`（花括号界定变量边界，与语言无关）')
  process.exit(1)
}
console.log('✅ 无 `$VAR<全角>` 写法（全部脚本的变量边界都明确）')
