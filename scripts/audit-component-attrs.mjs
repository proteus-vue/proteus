// scripts/audit-component-attrs.mjs —— 组件属性覆盖审计（官方属性级标尺）
//   官方属性清单（miniprogram-component-attrs.json）vs 我们框架组件的 props → 报覆盖缺口。
//   用法：node scripts/audit-component-attrs.mjs [--json] [--all] [--min N] [--update]
//   组件映射：官方 <tag> ↔ 框架 p-<tag>（标签名一致时）；别名见 ALIAS。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ATTRS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json'), 'utf8')).components
// ★组件库已拆包（2026-09-14）：@proteus-vue/components → packages/components（原仓库根 src/components）
const COMPONENTS_DIR = path.join(ROOT, 'packages/components')
const asJson = process.argv.includes('--json')
const showAll = process.argv.includes('--all')
const update = process.argv.includes('--update')
// ★棘轮（05-gates-and-ci.md）：阈值以 alignment-ratchet.json 为**单一事实源**（只增不减）。
//   此前 package.json 硬编码 `--min 128` 而 JSON 记 207 → 文档声称的底线未被真正执行（软门禁）；
//   现改为缺省读 JSON，`--min` 仅在本地试验时显式覆盖，`--update` 回写新水位。
const RATCHET_PATH = path.join(ROOT, 'docs/generated/alignment-ratchet.json')
const ratchet = fs.existsSync(RATCHET_PATH) ? JSON.parse(fs.readFileSync(RATCHET_PATH, 'utf8')) : {}
const minIdx = process.argv.indexOf('--min')
const minVal = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : (typeof ratchet.coveredMin === 'number' ? ratchet.coveredMin : null)

/** 官方组件 tag → 框架组件目录名（默认 p-<tag>；别名例外） */
const ALIAS = {
  'icon': 'p-icon', 'text': 'p-text', 'image': 'p-image', 'button': 'p-button',
  'input': 'p-input', 'textarea': 'p-textarea', 'switch': 'p-switch', 'slider': 'p-slider',
  'progress': 'p-progress', 'checkbox': 'p-checkbox', 'radio': 'p-radio', 'picker': 'p-picker',
  'picker-view': 'p-picker', 'form': 'p-form', 'label': 'p-label',
  'scroll-view': 'p-scroll-view', 'swiper': 'p-swipter', 'video': 'p-media', 'canvas': 'p-canvas',
  'map': 'p-map', 'camera': 'p-camera', 'web-view': 'p-webview', 'ad': 'p-ad',
  'rich-text': 'p-rich-text', 'view': 'p-view', 'movable-view': 'p-draggable',
  'movable-area': 'p-draggable', 'virtual-list': 'p-virtual-list', 'page-container': 'p-page-container',
  'share-element': 'p-transition', 'keyboard-accessory': 'p-keyboard-accessory',
  'match-media': 'p-adaptive', 'cover-view': 'p-view', 'cover-image': 'p-image',
  // ★语义纠偏（2026-09-14，对齐 SSOT packages/component-ir/src/audit.ts）：
  //   官方 <navigator> 是**声明式导航链接**（跳转 url/open-type/delta…），对应框架 engineering.router-link
  //   = `p-router-link`（E18），**不是** p-nav（shell.nav 导航栏）；官方 <navigation-bar>（导航条）
  //   才是 shell.nav → `p-nav-bar`（自绘）。此前 navigator→p-nav 属映射错误。
  'navigator': 'p-router-link', 'navigation-bar': 'p-nav-bar',
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

/** ★按官方组件限定的语义别名（优先于全局表）——用于「同名但语义不同」的归一，避免污染全局。
 *   例：官方 <canvas type="2d|webgl"> 指**渲染上下文类型**，框架已归一为 `engine`（含 skia）；
 *   而全局 `type` 在 button/scroll-view 等是**视觉/渲染模式**，不能一刀切 → 只能按 tag 限定。 */
const SEMANTIC_ALIAS_BY_TAG = {
  canvas: { type: ['engine'] },
  'rich-text': { nodes: ['source'] },
  // 官方 movable-view 的 `scale` 是**布尔开关**（是否支持双指缩放），而同一组件另有 `scale-min/max/value`
  //   三个**数值**缩放属性——若沿用裸名 `scale` 作布尔，与数值族混读易错（`scale="1"` 到底是倍数还是开关？）。
  //   框架归一为 `scaleEnabled`（语义更纯：缩放能力开关），数值族保持官方名。
  'movable-view': { scale: ['scaleEnabled'] },
}
/**
 * ★有意不沿用（G-31 铁律）：官方存在但**不应上升为框架语义**的平台私有形态/历史包袱。
 *   命中者不计入覆盖缺口，但必须在下方给出**理由**（反黑盒：不静默忽略）。
 *   判定依据：docs/proteus-end-alignment-plan/README.md「禁止将平台私有形态原样固化成框架语义」。
 */
const INTENTIONAL_SKIP = {
  // 官方 <switch type="switch|checkbox">：以「开关还是复选框」二选一方式切换形态——微信历史包袱
  //   （checkbox 形态与 p-checkbox 语义重复且外观是独立的小方框）。Proteus 改为 `shape: round|square`
  //   ——「圆角 / 方角**开关**」，语义更纯粹（都是开关，只是圆角不同），且不引入第二个 checkbox 形态。
  switch: { type: '平台历史包袱（checkbox 形态）→ 框架改用 shape=round|square（圆角/方角开关）' },
  // 官方 <cover-view scroll-top>：Skyline 同层渲染后 cover-view 已由通用 <view> 覆盖（SSOT audit.ts
  //   「layout.box（Skyline 同层渲染后 view 即可覆盖）」）。scroll-top 是 cover-view **私有**滚动同步属性，
  //   依赖被覆盖的原生组件上下文，不上升为通用容器 p-view 的语义（否则端私有属性泄漏）。
  'cover-view': { 'scroll-top': 'cover-view 私有滚动同步；Skyline 后由通用 view 覆盖，不上升为 p-view 语义' },
}

const norm = (s) => s.replace(/[-:]/g, '').toLowerCase() // open-type ↔ openType；bind:xxx
/** 官方属性名在框架 props 里是否有等价（含按 tag 限定 + 全局语义别名） */
function hasEquiv(officialName, propSet, tag) {
  if (propSet.has(norm(officialName))) return true
  const alts = [...(SEMANTIC_ALIAS_BY_TAG[tag]?.[officialName] ?? []), ...(SEMANTIC_ALIAS[officialName] ?? [])]
  return alts.some((a) => propSet.has(norm(a)))
}
const rows = []
for (const [tag, attrs] of Object.entries(ATTRS)) {
  const dir = ALIAS[tag] ?? `p-${tag}`
  const props = propsOf(dir)
  if (props === null) { rows.push({ tag, dir, status: 'no-component', total: attrs.length, covered: 0, missing: attrs.map(a => a.name) }); continue }
  const propSet = new Set(props.map(norm))
  // ★事件不计入属性覆盖（框架用 @event 语义）：按**类型**过滤 `type: 'eventhandle'`，
  //   而非仅按 `bind:`/`catch:` 前缀——官方无值事件（如 button.createliveactivity、
  //   movable-view.htouchmove/vtouchmove）名字不带前缀，仅看前缀会误算为属性缺口。
  //   ★worklet 回调同理（`worklet:onscrollstart` / type 'worklet'|'callback'）：是**事件回调**而非可声明属性。
  const attrOnly = attrs.filter(a =>
    a.type !== 'eventhandle' && a.type !== 'worklet' && a.type !== 'callback' &&
    !/^(bind|catch|worklet)[:-]/.test(a.name))
  // ★有意不沿用：从缺口统计中剔除（但登记表须有理由，见 INTENTIONAL_SKIP）
  const skipped = INTENTIONAL_SKIP[tag] ?? {}
  const counted = attrOnly.filter(a => !(a.name in skipped))
  const missing = counted.filter(a => !hasEquiv(a.name, propSet, tag)).map(a => a.name)
  rows.push({ tag, dir, status: 'ok', total: counted.length, covered: counted.length - missing.length, missing, skipped: Object.keys(skipped) })
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
if (update) {
  const next = {
    ...ratchet,
    attrCovered: grandCov,
    attrTotal: grandTotal,
    coveredMin: grandCov,
  }
  fs.writeFileSync(RATCHET_PATH, JSON.stringify(next, null, 1) + '\n')
  console.log(`\n✍ 棘轮水位已更新：${grandCov}/${grandTotal} → ${path.relative(ROOT, RATCHET_PATH)}`)
} else if (minVal !== null) {
  const pct = grandCov / grandTotal
  const belowPct = minVal <= 1 && pct < minVal
  const belowAbs = minVal > 1 && grandCov < minVal
  if (belowPct || belowAbs) {
    console.error(`\n❌ 属性覆盖未达棘轮阈值：${grandCov}/${grandTotal} = ${(pct * 100).toFixed(0)}%（要求 ${minVal <= 1 ? (minVal * 100) + '%' : minVal}）`)
    process.exit(1)
  }
  console.log(`\n✅ 属性覆盖达棘轮阈值（${grandCov}/${grandTotal}，底线 ${minVal}）`)
}
