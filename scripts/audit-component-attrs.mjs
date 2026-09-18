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
  'scroll-view': 'p-scroll-view', 'video': 'p-media', 'canvas': 'p-canvas',
  'map': 'p-map', 'camera': 'p-camera', 'web-view': 'p-webview', 'ad': 'p-ad',
  'rich-text': 'p-rich-text', 'view': 'p-view', 'movable-view': 'p-draggable',
  'movable-area': 'p-draggable', 'virtual-list': 'p-virtual-list', 'page-container': 'p-page-container',
  'keyboard-accessory': 'p-keyboard-accessory',
  'share-element': 'p-share-element',
  'match-media': 'p-adaptive', 'cover-view': 'p-view', 'cover-image': 'p-image',
  // ★2026-09-18 移除两处错误映射（批次外收口实测）：
  //   ① `'swiper': 'p-swipter'`——**拼写错误**（"swipter"），且 p-swiper 并不存在：
  //      官方 <swiper> 已被 `layout.stack` 的 snap/loop 语义**消灭为属性**（矩阵 audit.ts 同款判定），
  //      故 swiper 本就属「无对应框架组件」，无需别名。旧错拼映射让该行静默落到 no-component，掩盖了真实原因。
  //   ② `'share-element': 'p-transition'`——**语义错误**：官方 <share-element> 是**页面间共享元素转场**
  //      （key/transform/shuttle-on-push|pop…），而 `p-transition` 是 engineering.transition
  //      （Vue `<transition>` 包装：name/mode/duration/visible）——两者语义不同。框架的共享元素承接是
  //      `p-share-element`（**L2 规划中，尚未实现**，见矩阵 audit.ts「p-share-element（L2 规划）」planned:true）。
  //      旧映射把 share-element 的 8 个属性错记到 p-transition 名下 → 制造 7 项**永远填不满的假缺口**
  //      （唯一"命中"的 duration 纯属命名巧合）。移除后 share-element 如实归入「无对应组件」。
  // ★语义纠偏（2026-09-14，对齐 SSOT packages/component-ir/src/audit.ts）：
  //   官方 <navigator> 是**声明式导航链接**（跳转 url/open-type/delta…），对应框架 engineering.router-link
  //   = `p-router-link`（E18），**不是** p-nav（shell.nav 导航栏）；官方 <navigation-bar>（导航条）
  //   才是 shell.nav → `p-nav-bar`（自绘）。此前 navigator→p-nav 属映射错误。
  'navigator': 'p-router-link', 'navigation-bar': 'p-nav-bar',
}

// props 抽取与组件枚举下沉到共享工具（与 audit-degradation.mjs 同口径，避免两份正则漂移）
const { propsOf, listComponentDirs } = await import('./lib/component-props.mjs')

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
  // ★share-element 的两处改名（02-ir-prop-binding「保留字冲突 → 加前缀或改写」）：
  //   官方 `key` 在 Vue 中是 vnode diff 保留属性（组件收不到）→ shuttleKey；
  //   官方 `transform`（boolean「是否动画」）与 <view> 的 CSS transform 字符串属性类型冲突 → animate。
  'share-element': { key: ['shuttleKey'], transform: ['animate'] },
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
  // ★官方 <match-media> 的**视口媒体查询**属性（2026-09-18 批次外收口判定）：
  //   官方 match-media 是「**视口**条件下的条件渲染」组件（min-width/max-width/width/min-height/
  //   max-height/height/orientation 描述的是**视口**尺寸与屏幕方向）。
  //   框架的语义承接是 `p-adaptive` / `p-zone`（矩阵 audit.ts：「容器断点替代」）——即用
  //   **容器断点**（`modes: 'sheet(0,600)|dialog(600,840)|popover(840,∞)'`，容器宽度驱动形态切换）
  //   替代**视口查询**（语义升级：组件自适应所在容器而非整个视口，同构于 CSS container queries 替代 media queries）。
  //   故官方这批**视口度量属性**不上升为框架语义——它们描述的正是被替代掉的旧机制。
  //   判定依据同 cover-view 先例（G-31：不把被替代的平台机制原样固化成框架语义）。
  //   ★诚实边界：框架目前确实**没有**「按视口条件条件渲染」的等价物；若将来需要，应新增独立语义
  //   （如 `layout.viewport-query`）而非把它们挂到 p-adaptive 上。
  'match-media': {
    'min-width': '视口查询 → 容器断点语义升级（p-adaptive modes）；视口度量不上升为框架属性',
    'max-width': '同上（视口度量 → 容器断点）',
    width: '同上（视口度量 → 容器断点）',
    'min-height': '同上（视口度量 → 容器断点）',
    'max-height': '同上（视口度量 → 容器断点）',
    height: '同上（视口度量 → 容器断点）',
    orientation: '同上（屏幕方向 → 容器形态由断点决定；方向由各端窗口系统处理）',
  },
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
