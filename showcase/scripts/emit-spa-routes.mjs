#!/usr/bin/env node
// showcase/scripts/emit-spa-routes.mjs —— SPA 深链落盘（GitHub Pages 部署配套）
// 背景：showcase 是 history 路由 SPA，构建只产一个 index.html；GitHub Pages 只有根级
//   404.html 兜底（且那属于官网 SPA）→ /showcase/subpackages/... 深链会 404。
//   官网组件详情页以 iframe 嵌演示页（deep link）→ 每条路由必须是真实目录。
// 做法：把 dist/web/index.html 复制到每条路由目录 <route>/index.html——
//   资源引用是绝对路径（base=/showcase/）→ 任意深度均可用。
// 路由清单与 gen-routes 同源：pagesDir（pages/）+ 各分包的 pages/ 子树下的 *.vue
//   （排除 *.mp.vue 平台孪生——gen-routes 同款规则）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist', 'web')
const indexHtml = path.join(DIST, 'index.html')
if (!fs.existsSync(indexHtml)) {
  console.error('emit-spa-routes: dist/web/index.html 缺失——先构建（proteus build --target web）')
  process.exit(1)
}
const html = fs.readFileSync(indexHtml, 'utf-8')

/** 收集目录子树下全部 .vue 页面文件（排除 .mp.vue 平台孪生） */
function collectPageVues(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.vue') && !entry.name.endsWith('.mp.vue')) out.push(full)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}

const pageFiles = [
  ...collectPageVues(path.join(ROOT, 'pages')),
  ...collectPageVues(path.join(ROOT, 'subpackages')),
].filter((f) => f.includes(`${path.sep}pages${path.sep}`)) // 分包内只认 pages 子树

const routes = pageFiles.map((f) => path.relative(ROOT, f).split(path.sep).join('/').replace(/\.vue$/, ''))

let written = 0
for (const route of routes) {
  const dir = path.join(DIST, route)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), html)
  written++
}
console.log(`emit-spa-routes: ${written} 条路由已落盘（dist/web/<route>/index.html）`)
