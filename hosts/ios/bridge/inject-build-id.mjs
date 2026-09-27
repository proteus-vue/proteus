// 把本次构建标识注入 bench 入口（供「报告是否就绪」的内容判定）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const id = process.argv[2]
if (!id) { console.error('用法：node inject-build-id.mjs <buildId>'); process.exit(2) }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const p = path.join(HERE, 'entry-bench.ts')
const s = fs.readFileSync(p, 'utf8')
const out = s.replace(/const BUILD_ID = '[^']*'/, `const BUILD_ID = '${id}'`)
if (out === s && !s.includes('BUILD_ID')) { console.error('未找到 BUILD_ID 占位'); process.exit(3) }
fs.writeFileSync(p, out)
console.log(`  BUILD_ID → ${id}`)
