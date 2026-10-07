#!/usr/bin/env node
// website/scripts/check-doc-links.mjs —— ★★★文档内部链接门禁（可判定的链接完整性）
//
// 【为什么必须有（用户 2026-10-08「最下面的下一步导航很多链接都是无效的」）】
//   文档 md 里手写的站内链接（尤其篇末「## 下一步」列表）没有任何机器判据——
//   改 slug / 挪分区 / 删页都会**静默**留下死链，直到读者点到 404。与 sleep 盲等、提交不推送同源：
//   **这类遗漏只有工具层能兜住**。本门禁把"站内链接可解析"变成 CI 红/绿。
//
// 【判据】扫描全部分区内容 md 的 markdown 链接 `](...)`：
//   · 站内绝对路径（以 `/` 起、非 `//`）→ 必须是 **已知路由**：
//       静态路由（白名单）∪ 某分区的 `<base>/<slug>`（slug ∈ 该分区实际 md 文件）
//   · 外链（http/https/mailto）· 锚点（#…）· 相对路径 → 跳过（不判）
//   已知路由 = 分区 base（`website/src/docs-registry.ts` 的 sections 同源）+ 静态页路由。
//
// 【产物勿手改】分区 slug 直接读目录（唯一事实源 = 文件系统），不维护第二份清单。
//
// 用法：node website/scripts/check-doc-links.mjs [--json]
// 退出码：0 通过 / 1 有死链
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE = path.resolve(HERE, '..')

/** 内容分区：base（路由前缀）→ 内容目录（相对 website/）——与 docs-registry 的 sections 同源 */
const SECTIONS = [
  ['/docs', 'guides'],
  ['/docs/framework', 'framework'],
  ['/docs/component', 'content/components'],
  ['/docs/capability', 'content/capabilities'],
  ['/docs/system', 'content/system'],
  ['/docs/plugin', 'content/plugins'],
  ['/docs/reference', 'content/reference'],
  ['/docs/primitives', 'content/primitives'],
  ['/docs/animation', 'animation'],
  // en 变体目录不单独路由（共用 zh 的 slug），不列入
]

/** 静态页路由（website/src/router.ts 中非 `/docs/:slug` 的具名页） */
const STATIC_ROUTES = new Set([
  '/',
  '/playground',
  '/multi-device',
  '/ecosystem',
  '/animation',
  '/consistency',
  '/themis',
  '/changelog',
  '/docs',
])

/** 某目录下的 md slug 集合 */
function slugsOf(dir) {
  const full = path.join(WEBSITE, dir)
  if (!fs.existsSync(full)) return new Set()
  return new Set(
    fs.readdirSync(full).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
  )
}

const valid = new Map()
for (const [base, dir] of SECTIONS) valid.set(base, slugsOf(dir))
// base 按长度降序，最长前缀优先匹配（/docs/framework 先于 /docs）
const BASES = [...valid.keys()].sort((a, b) => b.length - a.length)

/** 站内绝对路径是否可解析 */
function resolves(url) {
  const clean = url.split('#')[0].split('?')[0]
  if (!clean) return true // 纯锚点
  if (STATIC_ROUTES.has(clean)) return true
  for (const base of BASES) {
    if (clean === base) return true
    if (clean.startsWith(base + '/')) {
      const slug = clean.slice(base.length + 1)
      return slug !== '' && !slug.includes('/') && valid.get(base).has(slug)
    }
  }
  return false
}

/** 收集所有内容 md（zh 分区 + en 变体；en 变体 slug 与 zh 同，路由由 zh slug 决定） */
function collectMd() {
  const out = []
  const dirs = [...SECTIONS.map(([, dir]) => dir), ...SECTIONS.map(([, dir]) => `en/${dir}`)]
  for (const dir of dirs) {
    const full = path.join(WEBSITE, dir)
    if (!fs.existsSync(full)) continue
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith('.md')) out.push(path.join(full, f))
    }
  }
  return out
}

const broken = []
let scanned = 0
for (const file of collectMd()) {
  scanned++
  const src = fs.readFileSync(file, 'utf-8')
  const rel = path.relative(WEBSITE, file)
  // markdown 链接 [text](url)；url 不含空白（允许 # 锚点）
  const re = /\]\((\/[^)\s]+)\)/g
  let m
  while ((m = re.exec(src))) {
    const url = m[1]
    if (url.startsWith('//')) continue // 协议相对外链
    if (!resolves(url)) {
      const line = src.slice(0, m.index).split('\n').length
      broken.push({ file: rel, line, url })
    }
  }
}

const json = process.argv.includes('--json')
if (json) {
  console.log(JSON.stringify({ scanned, broken }, null, 2))
} else {
  console.log('文档链接门禁（站内 md 链接可解析）')
  console.log(`  扫描 ${scanned} 个内容 md · 分区 ${SECTIONS.length} 个`)
  if (broken.length) {
    console.error(`\n❌ ${broken.length} 条站内死链：\n`)
    for (const b of broken) console.error(`  ${b.file}:${b.line}  ->  ${b.url}`)
    console.error('\n  修法：改指向真实 slug（分区目录下的 .md 文件名），或修正分区前缀（/docs/framework/… 等）。')
  } else {
    console.log('  ✅ 全部站内链接可解析')
  }
}
process.exit(broken.length ? 1 : 0)
