// scripts/gen-icons.mjs —— ★★★Keryx 图标数据生成器（图标库方案 §5 构建管线）
//
// 【它做什么】读词汇表清单 `packages/icons/icon-manifest.mjs` → 从 Material Symbols（Apache-2.0）取
//   **outline（default）+ filled（fill1）** 两态 path → **缩放 960→24 网格**（内核/宿主不读 viewBox，
//   必须在数据侧归一）→ 写 `packages/icons/src/generated/icons.generated.ts`（入库、幂等）。
//
// 【三态（与 gen-css-capability-alignment.mjs 同范式）】
//   · `--collect`：联网拉取 → 落**源工件缓存** `packages/icons/icons.source.json`（入库；已缓存即跳过，
//     `--force` 重拉）。有界重试（2 次，**无 sleep/盲等**），失败项如实记录、不阻塞其余。
//   · 无参：读缓存 → 变换 → 写生成物（**排序、无时间戳 ⇒ 幂等**）。
//   · `--check`：内存重生成 vs 磁盘比对，漂移 → exit 1（接 `verify` 链）。
//
// 【禁盲等纪律】不使用 sleep；重试为立即重试（有上限）。网络拉取有缓存（源工件入库），不重复拉。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import manifest from '../packages/icons/icon-manifest.mjs'
import { normalizePath } from '../packages/icons/src/normalize.ts'
import { scalePath } from '../packages/icons/src/transform.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_ARTIFACT = path.join(ROOT, 'packages/icons/icons.source.json')
const OUT_FILE = path.join(ROOT, 'packages/icons/src/generated/icons.generated.ts')
const MS_BASE = 'https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined'

/** 960 网格 → 24 网格：x' = 0.025·x；viewBox 是 `0 -960 960 960` ⇒ y' = 0.025·(y+960) = 0.025·y + 24。 */
const GRID_SCALE = 24 / 960
const GRID_TY = 24

const args = process.argv.slice(2)
const has = (f) => args.includes(f)

/** 从 Material Symbols SVG 文本取 `<path d="…">`。 */
function extractD(svg) {
  const m = /<path[^>]*\sd="([^"]+)"/.exec(svg)
  return m ? m[1] : null
}

/** 拉单个符号的一态（`default` outline / `fill1` filled）；有界重试（2 次，无 sleep）。 */
async function fetchSymbol(ms, variant) {
  const url = `${MS_BASE}/${ms}/${variant}/24px.svg`
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
      const d = extractD(await res.text())
      if (!d) { lastErr = '无 path d'; continue }
      return d
    } catch (e) {
      lastErr = String(e?.message ?? e)
    }
  }
  return { error: lastErr }
}

/** --collect：拉全部清单 → 源工件缓存。 */
async function collect() {
  const force = has('--force')
  const cache = !force && fs.existsSync(SRC_ARTIFACT) ? JSON.parse(fs.readFileSync(SRC_ARTIFACT, 'utf-8')) : { symbols: {} }
  cache.symbols ??= {}
  const todo = manifest.filter(([ms]) => force || !cache.symbols[ms] || cache.symbols[ms].outline == null)
  console.log(`清单 ${manifest.length} 枚 · 待拉 ${todo.length} 枚（已缓存 ${manifest.length - todo.length}）`)

  const CONCURRENCY = 8
  let done = 0
  const misses = []
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async ([ms, cat, filledFlag]) => {
        const outline = await fetchSymbol(ms, 'default')
        const wantFilled = filledFlag !== false
        const filled = wantFilled ? await fetchSymbol(ms, 'fill1') : null
        return { ms, cat, outline, filled, wantFilled }
      }),
    )
    for (const r of results) {
      if (typeof r.outline === 'object' && r.outline?.error) {
        misses.push(`${r.ms} (outline: ${r.outline.error})`)
        continue
      }
      cache.symbols[r.ms] = {
        category: r.cat,
        outline: r.outline,
        // filled：字符串 = 有；null = 该图标无 filled 变体（源 404）或不产（filled:false）
        filled: r.wantFilled && typeof r.filled === 'string' ? r.filled : null,
      }
      done++
    }
    console.log(`  … ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}`)
  }
  // 稳定排序（键按字典序）⇒ 幂等
  const sorted = {}
  for (const k of Object.keys(cache.symbols).sort()) sorted[k] = cache.symbols[k]
  fs.writeFileSync(SRC_ARTIFACT, JSON.stringify({ source: 'Material Symbols (Apache-2.0)', symbols: sorted }, null, 2) + '\n')
  console.log(`✅ 源工件 ${SRC_ARTIFACT}（${Object.keys(sorted).length} 枚）`)
  if (misses.length) console.log(`⚠ 未取到 ${misses.length} 项（如实记录，不阻塞）：${misses.slice(0, 20).join('；')}${misses.length > 20 ? ' …' : ''}`)
}

/** 960→24 网格 + 归一化。 */
function toGrid(d960) {
  return scalePath(normalizePath(d960), { scale: GRID_SCALE, tx: 0, ty: GRID_TY })
}

/** 由源工件生成生成物文本（纯函数 ⇒ 幂等、可 `--check`）。 */
function buildGenerated() {
  if (!fs.existsSync(SRC_ARTIFACT)) {
    console.error(`✗ 缺源工件 ${SRC_ARTIFACT} —— 先跑 \`node scripts/gen-icons.mjs --collect\``)
    process.exit(1)
  }
  const src = JSON.parse(fs.readFileSync(SRC_ARTIFACT, 'utf-8'))
  // ★以**清单为准**迭代（而非缓存键）——清单删掉的符号即使残留在缓存里也不进生成物
  const catByMs = new Map(manifest.map(([ms, cat]) => [ms, cat]))
  const names = manifest.map(([ms]) => ms).filter((ms) => src.symbols[ms]?.outline).sort()
  const rows = []
  let filledCount = 0
  const kebab = (s) => s.replace(/_/g, '-')
  for (const ms of names) {
    const sym = src.symbols[ms]
    const cat = catByMs.get(ms) ?? sym.category
    const name = kebab(ms)
    const outline = toGrid(sym.outline)
    const parts = [`d: ${JSON.stringify(outline)}`]
    if (sym.filled) {
      parts.push(`filled: ${JSON.stringify(toGrid(sym.filled))}`)
      filledCount++
    }
    parts.push(`category: ${JSON.stringify(cat)}`)
    rows.push(`  ${JSON.stringify(name)}: { ${parts.join(', ')} },`)
  }
  const header = [
    '// GENERATED by scripts/gen-icons.mjs —— DO NOT EDIT（改清单 packages/icons/icon-manifest.mjs 后重生成）。',
    '//',
    '// Source: Material Symbols (Apache-2.0, https://fonts.google.com/icons) —— 960 网格已由生成器缩放到 24 网格。',
    "import type { IconDef } from '../set'",
    '',
    '/** 生成图标集（outline = `d`；`filled` = 选中态变体路径，缺省表示该图标无 filled 变体）。 */',
    'export const GENERATED_ICONS: Record<string, IconDef> = {',
  ]
  return { text: [...header, ...rows, '}', ''].join('\n'), count: names.length, filledCount }
}

function generate() {
  const { text, count, filledCount } = buildGenerated()
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, text)
  console.log(`✅ 生成 ${OUT_FILE}（${count} 枚 · 含 filled 变体 ${filledCount}）`)
}

function check() {
  const { text } = buildGenerated()
  const cur = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf-8') : ''
  if (cur !== text) {
    console.error('✗ 生成物漂移：icons.generated.ts 与源工件/清单不一致 —— 跑 `node scripts/gen-icons.mjs` 重生成并提交')
    process.exit(1)
  }
  console.log('✅ 图标生成物与源工件一致（幂等）')
}

if (has('--collect')) await collect()
else if (has('--check')) check()
else generate()
