// gen-plugin-docs.mjs —— WIT SSOT → 插件 API 参考页生成器 + 漂移门禁（G-60 B1）
// 用法：
//   node scripts/gen-plugin-docs.mjs           # 生成（覆盖 content/plugins/*.md）
//   node scripts/gen-plugin-docs.mjs --check   # 漂移检测：生成物与提交版不一致 → exit 1（CI 阻断）
// lint（SPEC_LINT）：任一 interface / func 缺 /// 文档 → exit 1。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWit, lintSpec, renderSpecMd, sourceHash, checkDrift } from './lib/wit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const witDir = path.join(root, 'api', 'wit')
const outDir = path.join(root, 'content', 'plugins')
const check = process.argv.includes('--check')

const witFiles = fs.readdirSync(witDir).filter((f) => f.startsWith('since_v') && f.endsWith('.wit')).sort()
if (witFiles.length === 0) { console.error('NO_WIT: api/wit/ 下没有 since_v*.wit 文件'); process.exit(1) }

let drifts = 0
let generated = 0
const problems = []

for (const file of witFiles) {
  const witPath = path.join(witDir, file)
  const text = fs.readFileSync(witPath, 'utf8')
  const version = file.match(/^since_v([\d_]+)\.wit$/)?.[1]?.replaceAll('_', '.')
  const spec = parseWit(text, { version })

  // lint：缺文档即 SPEC_LINT（G-60.1：机器不知道的部分才手写，doc 必须在 WIT 里）
  const lint = lintSpec(spec)
  problems.push(...lint)

  const hash = sourceHash(text)
  let order = 90
  for (const iface of spec.interfaces) {
    const md = renderSpecMd(spec, iface.name, { sourceHash: hash, order: order++ })
    const outPath = path.join(outDir, `${iface.name}.md`)
    const committed = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null

    if (check) {
      const d = checkDrift(committed, md)
      if (d.status === 'stale') { drifts++; console.error(`DRIFT: ${path.relative(root, outPath)} — ${d.message}`) }
      else if (committed === null) { drifts++; console.error(`DRIFT: ${path.relative(root, outPath)} — 生成物缺失`) }
    } else {
      fs.writeFileSync(outPath, md)
      generated++
      console.log(`generated: content/plugins/${iface.name}.md (v${spec.version}, hash ${hash})`)
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
if (check) {
  if (drifts > 0) { console.error(`\nCHECK FAILED: ${drifts} 个生成物漂移/缺失`); process.exit(1) }
  console.log(`\nCHECK OK: ${witFiles.length} 个 WIT 版本，全部生成物与源一致`)
} else {
  console.log(`\nOK: ${generated} 个参考页已生成（--check 可做漂移门禁）`)
}
