// scripts/gen-docs.ts
// ★G-32 B6（proteus-semantic-primitives-plus-plan batches.md §1 B6）：对照矩阵自动化——文档与 registry 自动同步
//   生成三份机器事实文档（读 SSOT 源码而非 dist——保证永远与 catalog 实时一致）：
//   ① docs/generated/catalog.md               —— PRIMITIVE_CATALOG 128 原语完整清单（按 kind 分组 + status）
//   ② docs/generated/miniprogram-mapping.md    —— MP_MAPPING_MATRIX 对照矩阵（组件表 + API 表）
//   ③ docs/generated/implemented-semantics.md  —— implemented 语义 × 7 后端映射（SEMANTIC_BACKEND_MAP）
//   幂等：重复运行输出一致（排序稳定 + 无时间戳）
//   用法：npm run gen:docs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIMITIVE_CATALOG, MP_MAPPING_MATRIX, SEMANTIC_BACKEND_MAP, implementedPrimitives, checkPrimitiveCatalog } from '../packages/component-ir/src/index'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'docs', 'generated')

// —— ① catalog.md ——

const KIND_ORDER = ['layout', 'ui', 'shell', 'gesture', 'capability', 'engineering']
const KIND_LABEL: Record<string, string> = {
  layout: '布局（12）',
  ui: 'UI（18）',
  shell: 'Shell（10）',
  gesture: '手势（10）',
  capability: '能力（50）',
  engineering: '工程（28）',
}
const STATUS_LABEL: Record<string, string> = { planned: 'planned', implemented: 'implemented' }

function buildCatalog(): string {
  const lines: string[] = []
  lines.push('# G-32 原语清单（自动生成——SSOT = packages/component-ir/src/primitives.ts）')
  lines.push('')
  lines.push('> ★由 `npm run gen:docs` 生成，勿手改。手工维护的叙述性规划见各 plan 文档。')
  lines.push(`> 总计 **${PRIMITIVE_CATALOG.length}** 原语 · implemented **${implementedPrimitives().length}**。`)
  lines.push('')
  for (const kind of KIND_ORDER) {
    const items = PRIMITIVE_CATALOG.filter((p) => p.kind === kind)
    lines.push(`## ${kind} — ${KIND_LABEL[kind] ?? kind}`)
    lines.push('')
    lines.push('| # | 语义 | 形态 | 标签/API | 小程序等价 | 状态 |')
    lines.push('|---|------|------|----------|-----------|------|')
    for (const p of items) {
      const form = p.tag ? `tag:${p.tag}` : p.api ? `api:${p.api}` : '—'
      const tagApi = p.tag ?? p.api ?? '—'
      lines.push(`| ${p.id} | \`${p.semantic}\` | ${form} | \`${tagApi}\` | ${p.mpEquiv} | ${STATUS_LABEL[p.status] ?? p.status} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// —— ② miniprogram-mapping.md ——

function buildMapping(): string {
  const components = MP_MAPPING_MATRIX.filter((i) => i.group === 'component')
  const apis = MP_MAPPING_MATRIX.filter((i) => i.group !== 'component')
  const lines: string[] = []
  lines.push('# 小程序全量能力对照矩阵（自动生成——SSOT = packages/component-ir/src/audit.ts MP_MAPPING_MATRIX）')
  lines.push('')
  lines.push('> ★由 `npm run gen:docs` 生成，勿手改。这是机器事实（catalog 与矩阵实时同步）；手工规划叙述见 `proteus-semantic-primitives-plus-plan/miniprogram-mapping.md`。')
  lines.push(`> 总计 ${MP_MAPPING_MATRIX.length} 项（组件 ${components.length} + API ${apis.length}）；✅ ${MP_MAPPING_MATRIX.filter((i) => i.status === 'ok').length} · 🔄 ${MP_MAPPING_MATRIX.filter((i) => i.status === 'compat').length} · ⬛ ${MP_MAPPING_MATRIX.filter((i) => i.status === 'private').length} · ❌ ${MP_MAPPING_MATRIX.filter((i) => i.status === 'missing').length}`)
  lines.push('')
  lines.push('## 组件对照表')
  lines.push('')
  lines.push('| 小程序组件 | Proteus 原语 | 状态 |')
  lines.push('|-----------|-------------|------|')
  for (const i of components) lines.push(`| \`${i.mp}\` | ${i.proteus} | ${i.status} |`)
  lines.push('')
  lines.push('## API 对照表')
  lines.push('')
  lines.push('| 小程序 API | Proteus 原语 | 状态 |')
  lines.push('|-----------|-------------|------|')
  for (const i of apis) lines.push(`| \`${i.mp}\` | ${i.proteus} | ${i.status} |`)
  return lines.join('\n')
}

// —— ③ implemented-semantics.md ——

function buildImplemented(): string {
  const impl = implementedPrimitives()
  const lines: string[] = []
  lines.push('# implemented 语义 × 后端映射（自动生成——SSOT = SEMANTIC_BACKEND_MAP + catalog status）')
  lines.push('')
  lines.push('> ★由 `npm run gen:docs` 生成，勿手改。覆盖门禁：每语义 ≥3 端映射（G-31.4）。')
  lines.push(`> implemented 语义 **${impl.length}** 个。`)
  lines.push('')
  lines.push('| 语义 | vue-dom | native-ios | native-android | native-harmony | skyline | flutter | headless |')
  lines.push('|------|---------|-----------|----------------|----------------|---------|---------|----------|')
  for (const p of impl) {
    const row = SEMANTIC_BACKEND_MAP[p.semantic] ?? {}
    const cell = (bid: keyof typeof row) => row[bid] ?? '—'
    lines.push(`| \`${p.semantic}\` | ${cell('vue-dom')} | ${cell('native-ios')} | ${cell('native-android')} | ${cell('native-harmony')} | ${cell('skyline')} | ${cell('flutter')} | ${cell('headless')} |`)
  }
  return lines.join('\n')
}

// —— 写盘 + 幂等校验 ——

// ★2026-09-18：新增 `--check` 漂移门禁模式（此前只有写盘模式，且**从未接入任何门禁** →
//   生成物静默过期多批：catalog.md 长期停在「136 原语 · implemented 45」而实为 181/59）。
const CHECK = process.argv.includes('--check')
let drifted: string[] = []

function write(name: string, content: string): void {
  const file = path.join(OUT_DIR, name)
  const full = content + '\n'
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null
  if (CHECK) {
    if (prev !== full) drifted.push(path.relative(ROOT, file))
    console.log(`gen-docs --check → ${path.relative(ROOT, file)}${prev === full ? ' ✅ 一致' : ' ❌ 漂移'}`)
    return
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(file, full)
  // ★幂等判定：写入带尾部换行（full）——prev 与 full 比较（此前与 content 比较恒不等）
  console.log(`gen-docs → ${path.relative(ROOT, file)}${prev === full ? '（幂等，无变化）' : '（已更新）'}`)
}

write('catalog.md', buildCatalog())
write('miniprogram-mapping.md', buildMapping())
write('implemented-semantics.md', buildImplemented())

// ★2026-09-18 修正：原自检 `length === 136` 是**硬编码常量**，自 #405 起即过期
//   （注释自承「每次 gen:docs 自检红已存在多批」）→ 门禁长期红 = 形同废弃。
//   改为**结构性自检**（与 checkPrimitiveCatalog 同源）：唯一性 + 与 id/语义计数一致 + 非空，
//   使它在「新增原语」时不会误红，只在**真结构错误**（重复 id/重复语义/清单为空）时失败。
const catalogIssues = checkPrimitiveCatalog()
const catalogCheck = catalogIssues.length === 0
const mappingCheck = MP_MAPPING_MATRIX.filter((i) => i.status === 'missing').length === 0
const coverageCheck = implementedPrimitives().every((p) => Object.keys(SEMANTIC_BACKEND_MAP[p.semantic] ?? {}).length >= 3)
if (!catalogCheck || !mappingCheck || !coverageCheck) {
  console.error(
    `gen-docs 自检失败：catalog 结构=${catalogCheck}${catalogIssues.length ? `（${catalogIssues.join('; ')}）` : ''}` +
      ` · mapping 缺失=${MP_MAPPING_MATRIX.filter((i) => i.status === 'missing').length} · 覆盖≥3端=${coverageCheck}`,
  )
  process.exit(1)
}
console.log(`gen-docs 自检 ✅（${PRIMITIVE_CATALOG.length} 原语 · 结构无重复/无空洞 · 矩阵 0 缺失 · implemented 全部 ≥3 端映射）`)

// ★漂移门禁收口：--check 模式下生成物与源不一致 → exit 1（供 CI / verify 链）
if (CHECK && drifted.length) {
  console.error(`\nDRIFT: ${drifted.length} 个生成物与源不一致——运行 npm run gen:docs 并提交：`)
  for (const d of drifted) console.error(`  - ${d}`)
  process.exit(1)
}
if (CHECK) console.log('CHECK OK — 生成物与源一致')