// scripts/audit-component-attrs.mjs —— 组件属性覆盖审计（官方属性级标尺）
//   官方属性清单（miniprogram-component-attrs.json）vs 我们框架组件的 props → 报覆盖缺口。
//   用法：node scripts/audit-component-attrs.mjs [--json] [--all]
//   组件映射：官方 <tag> ↔ 框架 p-<tag>（标签名一致时）；别名见 ALIAS。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ATTRS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json'), 'utf8')).components
const COMPONENTS_DIR = path.join(ROOT, 'src/components')
const asJson = process.argv.includes('--json')
const showAll = process.argv.includes('--all')
// ★棘轮（05-gates-and-ci.md）：--min <covered> 覆盖率或绝对覆盖数低于阈值 → exit 1（只增不减）
const minIdx = process.argv.indexOf('--min')
const minVal = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : null

/** 官方组件 tag → 框架组件目录名（默认 p-<tag>；别名例外） */
const ALIAS = {
  'icon': 'p-icon', 'text': 'p-text', 'image': 'p-image', 'button': 'p-button',
  'input': 'p-input', 'textarea': 'p-textarea', 'switch': 'p-switch', 'slider': 'p-slider',
  'progress': 'p-progress', 'checkbox': 'p-checkbox', 'radio': 'p-radio', 'picker': 'p-picker',
  'picker-view': 'p-picker', 'form': 'p-form', 'label': 'p-label', 'navigator': 'p-nav',
  'scroll-view': 'p-scroll-view', 'swiper': 'p-swipter', 'video': 'p-media', 'canvas': 'p-canvas',
  'map': 'p-map', 'camera': 'p-camera', 'web-view': 'p-webview', 'ad': 'p-ad',
  'rich-text': 'p-rich-text', 'view': 'p-view', 'movable-view': 'p-draggable',
  'movable-area': 'p-draggable', 'virtual-list': 'p-virtual-list', 'page-container': 'p-page-container',
  'share-element': 'p-transition', 'keyboard-accessory': 'p-keyboard-accessory',
  'match-media': 'p-adaptive', 'cover-view': 'p-view', 'cover-image': 'p-image',
}

/** 从框架组件源码抽 props 名（defineProps 块内的 camelCase 键） */
function propsOf(dir) {
  const f = path.join(COMPONENTS_DIR, dir, 'index.vue')
  if (!fs.existsSync(f)) return null
  const src = fs.readFileSync(f, 'utf8')
  const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
  if (!m) return []
  const names = new Set()
  for (const km of m[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)) names.add(km[1])
  return [...names]
}

/** ★语义别名（官方属性名 → 框架等价 props 名）：框架用 Vue 惯例（modelValue/active 等），
 *  官方用原生命名（value/checked）——归一后再比对，避免把「命名差异」误报为「能力缺失」。 */
const SEMANTIC_ALIAS = {
  value: ['modelValue', 'active', 'current', 'selected'],
  checked: ['modelValue'],
  'active-color': ['activeColor'],
  'background-color': ['trackColor', 'backgroundColor'],
  'block-size': ['blockSize'],
  'block-color': ['blockColor'],
  'selected-color': ['activeColor'],
  'show-value': ['showInfo'],
  'stroke-width': ['strokeWidth'],
  'border-radius': ['rounded'],
  'active-mode': ['status'],
  'custom-style': ['customStyle'],
  'auto-focus': ['focus'],
  'password': ['type'],
  'confirm-type': ['confirmType'],
  'max-length': ['maxlength'],
  'scroll-into-view': ['scrollIntoView'],
  'show-location': ['showLocation'],
  'enable-zoom': ['enableZoom'],
  'enable-scroll': ['enableScroll'],
  'scale-min': ['value'],
  'referrer-policy': ['referrerPolicy'],
  'ad-theme': ['adTheme'],
  'header-text': ['headerText'],
  'immediate-change': ['immediateChange'],
  'indicator-style': ['indicatorStyle'],
  'mask-style': ['maskStyle'],
}
const norm = (s) => s.replace(/[-:]/g, '').toLowerCase() // open-type ↔ openType；bind:xxx
/** 官方属性名在框架 props 里是否有等价（含语义别名） */
function hasEquiv(officialName, propSet) {
  if (propSet.has(norm(officialName))) return true
  const alts = SEMANTIC_ALIAS[officialName] ?? []
  return alts.some((a) => propSet.has(norm(a)))
}
const rows = []
for (const [tag, attrs] of Object.entries(ATTRS)) {
  const dir = ALIAS[tag] ?? `p-${tag}`
  const props = propsOf(dir)
  if (props === null) { rows.push({ tag, dir, status: 'no-component', total: attrs.length, covered: 0, missing: attrs.map(a => a.name) }); continue }
  const propSet = new Set(props.map(norm))
  // 事件（bind:/catch:）不计入属性覆盖（框架用 @event 语义）
  const attrOnly = attrs.filter(a => !/^(bind|catch)[:-]/.test(a.name))
  const missing = attrOnly.filter(a => !hasEquiv(a.name, propSet)).map(a => a.name)
  rows.push({ tag, dir, status: 'ok', total: attrOnly.length, covered: attrOnly.length - missing.length, missing })
}

if (asJson) { console.log(JSON.stringify(rows, null, 1)); process.exit(0) }

const withComp = rows.filter(r => r.status === 'ok').sort((a, b) => (b.total - b.covered) - (a.total - a.covered))
const noComp = rows.filter(r => r.status === 'no-component')
const grandTotal = withComp.reduce((n, r) => n + r.total, 0)
const grandCov = withComp.reduce((n, r) => n + r.covered, 0)
console.log(`\n组件属性覆盖审计（官方属性级标尺）`)
console.log(`映射到框架组件的官方组件：${withComp.length} · 无对应组件：${noComp.length}`)
console.log(`属性覆盖：${grandCov}/${grandTotal} = ${(grandCov / grandTotal * 100).toFixed(0)}%\n`)
console.log('组件'.padEnd(22) + '覆盖'.padEnd(12) + '缺失属性')
for (const r of (showAll ? withComp : withComp.filter(r => r.missing.length))) {
  const pct = `${r.covered}/${r.total}`
  const miss = r.missing.length ? r.missing.slice(0, 6).join(',') + (r.missing.length > 6 ? ` …+${r.missing.length - 6}` : '') : '✅ 全覆盖'
  console.log(r.dir.padEnd(22) + pct.padEnd(12) + miss)
}
if (noComp.length) console.log(`\n无对应框架组件（未映射）：${noComp.map(r => r.tag).join(', ')}`)

// ★棘轮门禁：覆盖率不得低于阈值（防已补齐的属性回退）
if (minVal !== null) {
  const pct = grandCov / grandTotal
  const belowPct = minVal <= 1 && pct < minVal
  const belowAbs = minVal > 1 && grandCov < minVal
  if (belowPct || belowAbs) {
    console.error(`\n❌ 属性覆盖未达棘轮阈值：${grandCov}/${grandTotal} = ${(pct * 100).toFixed(0)}%（要求 ${minVal <= 1 ? (minVal * 100) + '%' : minVal}）`)
    process.exit(1)
  }
  console.log(`\n✅ 属性覆盖达棘轮阈值（${grandCov}/${grandTotal}）`)
}
