// 把本次构建标识注入 JS 入口（供「报告是否就绪」的内容判定 + 「跑的是哪份代码」的证据）
//
// ★2026-09-30 扩面：原先只注入 entry-bench.ts —— 而 `run-selfdraw.sh` 的**自绘模式**
//   等待判据正是 `js_report.build_id`，selfdraw 入口却从不产出该字段
//   ⇒ 该模式下判据**永远不可能满足**（实测：每次白等满 600 秒，占了一轮 11 分钟里的 10 分钟）。
//   ⇒ 两个入口都注入（同一机制，不留第二种形态）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const id = process.argv[2]
if (!id) { console.error('用法：node inject-build-id.mjs <buildId>'); process.exit(2) }
const HERE = path.dirname(fileURLToPath(import.meta.url))
for (const name of ['entry-bench.ts', 'entry-selfdraw.ts', '../../shared/bridge/entry-host-runtime.ts', '../../shared/bridge/entry-showcase.ts']) {
  const p = path.join(HERE, name)
  if (!fs.existsSync(p)) { console.error(`缺少 ${name}`); process.exit(3) }
  const s = fs.readFileSync(p, 'utf8')
  const out = s.replace(/const BUILD_ID = '[^']*'/, `const BUILD_ID = '${id}'`)
  if (out === s && !s.includes('BUILD_ID')) { console.error(`${name}: 未找到 BUILD_ID 占位`); process.exit(3) }
  fs.writeFileSync(p, out)
  console.log(`  BUILD_ID → ${name}`)
}
