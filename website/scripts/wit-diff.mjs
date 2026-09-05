// wit-diff.mjs —— 两版 WIT 的 SPEC_DIFF CLI（★ INV-W7：破坏性变更必须被拦截）
// 用法：node scripts/wit-diff.mjs <old.wit> <new.wit> [--breaking-exit-0]
//   默认：breaking 非空 → exit 1（CI 阻断）；--breaking-exit-0 仅报告不阻断
import fs from 'node:fs'
import path from 'node:path'
import { parseWit, diffSpecs } from './lib/wit.mjs'

const args = process.argv.slice(2)
const relax = args.includes('--breaking-exit-0')
const files = args.filter((a) => !a.startsWith('--'))

if (files.length !== 2) {
  console.error('用法: node scripts/wit-diff.mjs <old.wit> <new.wit> [--breaking-exit-0]')
  process.exit(1)
}
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`WIT 文件不存在: ${f}`); process.exit(1) }
}

const oldSpec = parseWit(fs.readFileSync(files[0], 'utf8'))
const newSpec = parseWit(fs.readFileSync(files[1], 'utf8'))
const d = diffSpecs(oldSpec, newSpec)

console.log(`SPEC_DIFF: ${path.basename(files[0])} → ${path.basename(files[1])}`)
console.log(`  added:   ${d.added.length ? d.added.join(', ') : '（无）'}`)
console.log(`  removed: ${d.removed.length ? d.removed.join(', ') : '（无）'}`)
console.log(`  changed: ${d.changed.length}`)
for (const c of d.changed) console.log(`    ${c.breaking ? '🔴' : '🟢'} ${c.name}: ${c.detail}`)
console.log(`  breaking: ${d.breaking.length} 项`)

if (d.breaking.length > 0 && !relax) {
  console.error('\nSPEC_BREAKING: 存在破坏性变更——已稳定版本冻结（G-58.4），破坏性变更仅限提案阶段')
  process.exit(1)
}
console.log('\n无阻断级破坏（或 --breaking-exit-0 仅报告）')
