#!/usr/bin/env node
// scripts/lib/edit-script.mjs —— ★安全增删 `package.json` 的 npm script（含 verify 链接线）
//
// 【为什么需要（本仓实测，同一坑连踩三次）】
//   AI 用「文本替换」往 `package.json` 的 verify 链里塞 `"pnpm run check:xxx"` 时，
//   **引号会被带进去** ⇒ `... && "pnpm run x" && ...` 是**非法 JSON** ⇒ 全场门禁崩，
//   报错是 `JSONDecodeError: Expecting ',' delimiter`（指向无关位置，极难归因）。
//   三次都是同一原因（check:docs-stats / check:instr-spec / check:vapor-docs）。
//   ⇒ 根因不是"不小心"，而是**缺一个安全的编辑入口**：把"改 JSON"从"文本替换"变成"结构操作"。
//
// 用法：
//   node scripts/lib/edit-script.mjs add check:foo "node scripts/foo.mjs"          # 新增脚本
//   node scripts/lib/edit-script.mjs wire check:foo --after check:bar              # 接进 verify 链
//   node scripts/lib/edit-script.mjs verify                                        # 打印 verify 链（自检）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PKG = path.join(ROOT, 'package.json')
const [cmd, ...rest] = process.argv.slice(2)

const load = () => JSON.parse(fs.readFileSync(PKG, 'utf-8'))
const save = (j) => fs.writeFileSync(PKG, JSON.stringify(j, null, 2) + '\n')

/** verify 链拆成 token 数组（**结构操作**，不做字符串拼接） */
function verifyTokens(verify) {
  return verify.split(' && ').map((s) => s.trim()).filter(Boolean)
}

if (cmd === 'add') {
  const [name, command] = rest
  if (!name || !command) { console.error('用法：add <name> <command>'); process.exit(2) }
  const j = load()
  if (j.scripts[name]) { console.error(`✗ ${name} 已存在（请用 wire 接线，或先删）`); process.exit(1) }
  j.scripts[name] = command
  save(j)
  console.log(`✅ 已加脚本 ${name}`)
  console.log(`   ★别忘了接线：node scripts/lib/edit-script.mjs wire ${name} --after <某个已在 verify 里的 check:*>`)
} else if (cmd === 'wire') {
  const [name] = rest
  const afterIdx = rest.indexOf('--after')
  const after = afterIdx >= 0 ? rest[afterIdx + 1] : null
  const j = load()
  if (!j.scripts[name]) { console.error(`✗ ${name} 不存在（先 add）`); process.exit(1) }
  const tokens = verifyTokens(j.scripts.verify)
  if (tokens.includes(`pnpm run ${name}`)) { console.error(`✗ ${name} 已在 verify 链`); process.exit(1) }
  const item = `pnpm run ${name}`
  if (after) {
    const at = tokens.indexOf(`pnpm run ${after}`)
    if (at < 0) { console.error(`✗ ${after} 不在 verify 链里（换个锚点）`); process.exit(1) }
    tokens.splice(at + 1, 0, item)
  } else {
    tokens.push(item)
  }
  j.scripts.verify = tokens.join(' && ')   // ★结构重组：不会带引号
  save(j)
  console.log(`✅ 已把 ${name} 接进 verify 链${after ? `（在 ${after} 之后）` : '（末尾）'}`)
} else if (cmd === 'verify') {
  const j = load()
  verifyTokens(j.scripts.verify).forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t}`))
} else {
  console.error('用法：add | wire | verify')
  process.exit(2)
}
