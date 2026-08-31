// scripts/backfill-route-path.mjs —— 批量补 <route> 缺 path（从文件路径推导）
// 用法：node scripts/backfill-route-path.mjs examples
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ?? 'examples'
let fixed = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.vue')) fixFile(full)
  }
}

function fixFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  const routeRe = /<route>([\s\S]*?)<\/route>/
  const m = routeRe.exec(source)
  if (!m) return
  const block = m[1]
  if (block.includes('"path"') || block.includes("'path'")) return
  // 推导路径：examples/pages/xxx.vue → /pages/xxx；examples/subpackages/order/pages/list.vue → /subpackages/order/pages/list
  const rel = file.replace(/\.vue$/, '').replace(/\\/g, '/')
  const pagesIdx = rel.indexOf('/pages/')
  const spIdx = rel.indexOf('/subpackages/')
  let routePath = null
  if (spIdx >= 0) {
    routePath = rel.slice(spIdx) // /subpackages/order/pages/list
  } else if (pagesIdx >= 0) {
    routePath = rel.slice(pagesIdx) // /pages/xxx
  }
  if (!routePath) return
  // 在 JSON 块首部插入 path（保持缩进风格）
  const firstLine = block.split('\n').find((l) => l.trim() === '{')
  const indent = firstLine ? firstLine.match(/^\s*/)[0] + '  ' : '  '
  const newBlock = block.replace(/^(\s*)\{\s*$/m, `$1{\n${indent}"path": "${routePath}",`)
  fs.writeFileSync(file, source.replace(block, newBlock))
  fixed++
  console.log(`  ✓ ${rel} → ${routePath}`)
}

walk(root)
console.log(`\n已补 ${fixed} 个 <route> path`)
