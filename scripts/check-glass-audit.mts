// scripts/check-glass-audit.mts —— ★液态玻璃引擎治理门禁（G-07 M5 · 决策 #880）
//   把 `proteus audit glass`（GLS001-006）从"手动命令"升为**CI/verify 门禁**：
//   扫描**框架自有源**（examples / showcase / superapp / packages/components），
//   任何**裸 backdrop-filter**（GLS001，error）即红——守住"单入口铁律"（玻璃只走 <pg-glass>）。
//   ★复用 `runGlassAudit`（packages/cli/src/glass-audit.ts）——SSOT 单一实现，不重写扫描逻辑。
//   ★error 才红；warn（嵌套 > 2 / 单页节点 > 10）只报告不拦截（性能预算，非合规红线）。
// 用法：npx tsx scripts/check-glass-audit.mts
// 退出码：0 通过 / 1 存在 error 级违规
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGlassAudit, type GlassFinding } from '../packages/cli/src/glass-audit.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 扫描面：框架自有的 Vue 源（业务/Aether 会走同样入口；pg-glass 实现自身被 audit 豁免） */
const TARGETS = ['examples', 'showcase', 'superapp', 'packages/components']

const all: GlassFinding[] = []
let files = 0
let glassFiles = 0
let glassNodes = 0
for (const t of TARGETS) {
  const r = runGlassAudit(path.join(ROOT, t))
  all.push(...r.findings)
  files += r.stats.files
  glassFiles += r.stats.glassFiles
  glassNodes += r.stats.glassNodes
}

const errors = all.filter((f) => f.severity === 'error')
const warns = all.filter((f) => f.severity === 'warn')

console.log('[check-glass-audit] ★液态玻璃引擎治理门禁（单入口铁律 GLS001）')
console.log(`  扫描 ${files} 个 .vue（${TARGETS.join(' / ')}）· <pg-glass> 文件 ${glassFiles} · 玻璃节点 ${glassNodes}`)
for (const w of warns) console.log(`  ⚠ ${w.file}:${w.line} [${w.rule}] ${w.message}`)

if (errors.length) {
  console.error(`\n❌ ${errors.length} 处**裸 backdrop-filter**（玻璃须走 <pg-glass> 入口，单入口铁律）：\n`)
  for (const e of errors) console.error(`  ${e.file}:${e.line} [${e.rule}] ${e.message}`)
  console.error('\n  修法：把裸 backdrop-filter 改为 <pg-glass>（或经 @proteus-vue/glass 的 resolveGlass/glassStyleFor 产出）；')
  console.error('  确有必要保留（如自身即玻璃入口实现）⇒ 目录名含 pg-glass，或用 `// d2-exempt: 原因` 具名豁免。')
  process.exit(1)
}
console.log(`\n✅ 无裸 backdrop-filter（玻璃单入口铁律成立）${warns.length ? `（${warns.length} 条性能 warn，不拦截）` : ''}`)
