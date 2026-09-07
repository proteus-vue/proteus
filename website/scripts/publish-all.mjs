// scripts/publish-all.mjs —— 全 workspace 包发布（并发优化版）
// 替代 publish-all.sh：预检用 registry API 直查（并发 16，零 npm CLI 启动开销），
// 发布阶段并发 4（npm publish 必须 cd 进包目录跑；registry 对并发 PUT 有限流，不宜过高）。
// 用法：node scripts/publish-all.mjs [--beta]
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TAG = process.argv.includes('--beta') ? ['--tag', 'beta'] : []

// 1. 枚举包
const pkgs = []
for (const d of fs.readdirSync(path.join(ROOT, 'packages'))) {
  const dir = path.join(ROOT, 'packages', d)
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (!manifest.name || !manifest.version) continue
  pkgs.push({ name: manifest.name, version: manifest.version, dir })
}

// 2. 并发预检（registry 直查 dist-tags——一次请求拿全部已发布版本）
const REGISTRY = 'https://registry.npmjs.org'
async function mapLimit(items, limit, fn) {
  const ret = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      ret[idx] = await fn(items[idx]).catch((e) => ({ error: e }))
    }
  })
  await Promise.all(workers)
  return ret
}

console.log(`预检 ${pkgs.length} 个包（并发 16）…`)
const checked = await mapLimit(pkgs, 16, async (p) => {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(p.name).replace('%2f', '%2f')}`, { headers: { Accept: 'application/vnd.npm.install-v1+json' } })
  if (res.status === 404) return { ...p, published: false }
  if (!res.ok) return { ...p, error: `registry ${res.status}` }
  const meta = await res.json()
  return { ...p, published: Boolean(meta.versions?.[p.version]) }
})

const todo = []
for (const c of checked) {
  if (c.error) { console.log(`⚠ ${c.name}: 预检失败 ${c.error}（仍尝试发布）`); todo.push(c); continue }
  if (c.published) { console.log(`↷ skip ${c.name}@${c.version}`); continue }
  todo.push(c)
}
console.log(`待发布 ${todo.length} 个，开始发布（并发 4）…\n`)

// 3. 发布：串行 + stdio inherit（npm publish 输出直打终端——管道缓冲会假死；串行可靠性优先，
//    单包 2-3s × 16 个 ≈ 1 分钟；断点续发：已成功的重跑自动跳过）
let pub = 0
let fail = 0
const failures = []
for (const p of todo) {
  console.log(`▶ publish ${p.name}@${p.version}`)
  const r = spawnSync('npm', ['publish', '--access', 'public', ...TAG], { cwd: p.dir, stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status === 0) {
    pub++
    console.log(`✓ ${p.name}@${p.version}\n`)
  } else {
    fail++
    failures.push(p.name)
    console.log(`✗ ${p.name}@${p.version}\n`)
  }
}

console.log(`\nRESULT: published ${pub} · skipped ${pkgs.length - todo.length} · failed ${fail}`)
if (fail) {
  console.log(`失败包：${failures.join(', ')}\n重跑本脚本即可续发（已成功的自动跳过）`)
  process.exit(1)
}
