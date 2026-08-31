// scripts/strip-route-blocks.mjs —— 删除页面 <route> 块（约定式路由收口，决策 #112/#113）
// 保留名单：params/pageJson 等特殊声明必须页面内（本批仅 user/profile 有 params）
// 用法：node scripts/strip-route-blocks.mjs examples
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ?? 'examples'
const KEEP = ['pages/user/profile.vue'] // params 类型提示必须页面声明
let stripped = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.vue')) strip(full)
  }
}

function strip(file) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/')
  if (KEEP.some((k) => rel.endsWith(k))) {
    console.log(`  保留 ${rel}（params 声明）`)
    return
  }
  const source = fs.readFileSync(file, 'utf8')
  const routeRe = /^\s*<route>[\s\S]*?<\/route>\s*\n?/m
  if (!routeRe.test(source)) return
  fs.writeFileSync(file, source.replace(routeRe, ''))
  stripped++
  console.log(`  ✂ ${rel}`)
}

walk(root)
console.log(`\n已删除 ${stripped} 个 <route> 块（meta 由 proteus.config.ts router.meta 集中注入）`)
