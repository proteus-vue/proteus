#!/usr/bin/env node
// scripts/gen-end-support-matrix.mjs —— VC1 · 端支持度矩阵生成器
//
// 【这一件回答什么（卡片 VC1-a/b/c）】把「CSS Profile 的每个属性在各端到底支不支持」
//   从**散文断言**变成**机器可读矩阵**（JSON + MD），且每条判定带**证据来源**：
//     · Web 列      —— Playwright `CSS.supports()` 实测（本机 Chromium）
//     · Skyline 列  —— 官方《Skyline WXSS 样式支持与差异》解析（+ 选择器/局限实测佐证）
//     · WebView 列  —— wechatide 装置 `fields({computedStyle})` 实测（spike/vc0-skyline-geom）
//
// 【设计（为什么是"离线生成 + 源工件"）】
//   生成器本体**不联网**：读取三份**源工件**（带 provenance：URL/日期/采集方式）→ 产出矩阵。
//   刷新源工件用 `--collect`（联网：抓官方文档 / 跑 Playwright / 解析设备产物），
//   日常门禁用 `--check`（离线）：生成物与源不一致 ⇒ exit 1（与 gen-docs 同款漂移门禁）。
//
// 【单一事实源】属性清单**从编译器源码提取**（`packages/compiler/src/vapor/template.ts` 的
//   LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS）——编译器认什么，矩阵就覆盖什么；
//   编译器加字段 ⇒ 提取结果变 ⇒ 生成物变 ⇒ `--check` 抓住（不让矩阵落后于编译器）。
//
// 用法：
//   node scripts/gen-end-support-matrix.mjs             # 离线生成（读源工件 → 写矩阵）
//   node scripts/gen-end-support-matrix.mjs --check     # 漂移门禁（CI/verify 链）
//   node scripts/gen-end-support-matrix.mjs --collect    # 刷新源工件（联网 + Playwright）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GEN_DIR = path.join(ROOT, 'docs', 'generated')
const SRC_DIR = path.join(GEN_DIR, 'end-support-sources')
const OUT_JSON = path.join(GEN_DIR, 'end-support-matrix.json')
const OUT_MD = path.join(GEN_DIR, 'end-support-matrix.md')
const COMPILER_SRC = path.join(ROOT, 'packages', 'compiler', 'src', 'vapor', 'template.ts')
const SPike_DIR = path.join(ROOT, 'spike', 'vc0-skyline-geom', 'results')
const OFFICIAL_URL = 'https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/wxss.html'

const CHECK = process.argv.includes('--check')
const COLLECT = process.argv.includes('--collect')

/* ────────────────────────── ① 属性清单：从编译器源码提取（SSOT） ────────────────────────── */

/** 提取 `const NAME = new Set([...])` 的字面量内容（容错：跨行、含注释行） */
function extractSetLiteral(src, constName) {
  const re = new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`)
  const m = re.exec(src)
  if (!m) return null
  const inner = m[1].replace(/\/\/[^\n]*/g, '') // 去行注释
  return [...inner.matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function extractRecordKeys(src, constName) {
  const re = new RegExp(`const ${constName}: Record<string, string> = \\{([\\s\\S]*?)\\n\\}`)
  const m = re.exec(src)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'\s*:/g)].map((x) => x[1])
}

function compilerPropSets() {
  const src = fs.readFileSync(COMPILER_SRC, 'utf-8')
  const layout = extractSetLiteral(src, 'LAYOUT_FIELDS')
  const paint = extractSetLiteral(src, 'PAINT_FIELDS')
  const declAttrs = extractSetLiteral(src, 'PAINT_DECL_ATTRS')
  if (!layout || !paint || !declAttrs) {
    console.error('[gen-end-support-matrix] ✗ 无法从编译器源码提取属性集（template.ts 结构变了？）')
    process.exit(2)
  }
  return { layout, paint, declAttrs }
}

/** camelCase → kebab-case（CSS 名） */
const kebabOf = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** 编译器字段 → CSS 属性名（个别需要映射；其余走 kebab 规则） */
const CSS_ALIAS = {
  margin: 'margin-top', // 四边族取代表（细节见 remark）
  padding: 'padding-top',
  backgroundColor: 'background-color',
  borderRadius: 'border-radius',
  borderColor: 'border-color',
  borderWidth: 'border-width',
  fontSize: 'font-size',
  // 绘制声明属性不是 CSS 属性（引擎扩展通道），不映射
}

/* ────────────────────────── ② 源工件读取/采集 ────────────────────────── */

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/** 抓官方 Skyline WXSS 文档 → 解析「属性支持 / 选择器支持 / 类型支持 / 模块支持」四表 */
async function collectOfficialSkyline() {
  const res = await fetch(OFFICIAL_URL)
  const html = await res.text()
  const parseTable = (t) => {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
      [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
        c[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim(),
      ),
    ).filter((r) => r.length > 0)
    return rows
  }
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => parseTable(m[0]))
  if (tables.length < 4) throw new Error(`官方文档结构异常：仅 ${tables.length} 个表`)
  // ★开关版本表：按 h2 章节名归属（5 个「开启…」章节各带一张「平台|最低版本」表；缺表章节如实记 null）
  const sections = []
  {
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<table[\s\S]*?<\/table>/g
    let cur = ''
    for (const m of html.matchAll(re)) {
      if (m[0].startsWith('<h2')) { cur = m[1].replace(/<[^>]+>/g, '').trim(); continue }
      sections.push({ section: cur, table: parseTable(m[0]) })
    }
  }
  const configs = sections
    .filter((x) => /^#\s*开启/.test(x.section))
    .map((x) => ({ section: x.section.replace(/^#\s*/, '').trim(), versions: x.table }))
  const out = {
    provenance: { kind: 'official-doc', url: OFFICIAL_URL, fetchedAt: new Date().toISOString().slice(0, 10), htmlSha: sha256(html) },
    modules: tables[0],
    selectors: tables[1],
    properties: tables[2],
    types: tables[3],
    configs, // 各「开启…」开关的最小版本表（含 section 归属）
  }
  fs.mkdirSync(SRC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SRC_DIR, 'skyline-wxss-official.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`[collect] 官方文档：模块 ${out.modules.length} 行 · 选择器 ${out.selectors.length} 行 · 属性 ${out.properties.length} 行 · 类型 ${out.types.length} 行`)
}

/** 跑 Playwright：对属性集逐条 CSS.supports + 选择器/值域抽查 */
async function collectWebSupports(propSets) {
  const { chromium } = await import('playwright').catch(() => ({ chromium: null }))
  if (!chromium) {
    console.error('[collect] ✗ 未安装 playwright（devDeps 应有；npm i 后重试）')
    process.exit(2)
  }
  const cssNames = [
    ...propSets.layout.map((f) => CSS_ALIAS[f] ?? kebabOf(f)),
    ...propSets.paint.map((f) => CSS_ALIAS[f] ?? kebabOf(f)),
    'transform', 'transform-origin', 'box-sizing', 'z-index', 'visibility', 'line-height', 'letter-spacing',
    'white-space', 'text-overflow', 'word-break', 'word-spacing', 'font-style', 'font-family', 'text-decoration',
    'box-shadow', 'filter', 'backdrop-filter', 'will-change', 'align-content', 'flex-wrap', 'order', 'min-width',
    'max-width', 'min-height', 'max-height', 'padding-left', 'padding-top', 'padding-right', 'padding-bottom',
    'margin-left', 'margin-top', 'margin-right', 'margin-bottom', 'border-style', 'border-color', 'right', 'bottom',
    'grid', 'grid-template-columns', 'animation-name', 'transition-property',
  ]
  const uniq = [...new Set(cssNames)]
  const b = await chromium.launch({ headless: true })
  const page = await b.newPage()
  await page.setContent('<div id=x></div>')
  const out = { provenance: { kind: 'playwright-css-supports', engine: 'chromium', collectedAt: new Date().toISOString().slice(0, 10), browserVersion: b.version() }, properties: {}, selectors: {}, values: {} }
  // 属性探测：**双判定**（recognized = CSS.supports(name,'inherit') ⇒ 属性名被引擎认识；
  //   valueProbe = 用显式值表的代表值探测）。
  //   【为什么不能只用一个猜测值（首版实测抓出的假阴性）】模糊猜测把 `border-color` 猜成
  //   `10px`、`opacity` 猜成 `10px` ⇒ 两者都被判 unsupported（假阴性——它们其实是标准属性）。
  //   ⇒ recognized 用 `inherit`（对所有已知属性恒合法），valueProbe 只在显式值表里给。
  const valueProbe = {
    display: 'flex', position: 'relative', overflow: 'hidden', 'border-radius': '10px', gap: '5px',
    transform: 'translateX(10px)', 'z-index': '1', opacity: '0.5', 'background-color': '#fff',
    color: '#000', 'font-weight': '700', 'font-size': '16px', width: '10px', height: '10px',
    'min-width': '10px', 'max-width': '10px', 'min-height': '10px', 'max-height': '10px',
    margin: '10px', padding: '10px', 'margin-top': '10px', 'padding-top': '10px',
    'border-width': '1px', 'border-color': '#000', 'border-style': 'solid', 'box-sizing': 'border-box',
    'flex-direction': 'row', 'justify-content': 'center', 'align-items': 'center', 'align-self': 'center',
    'flex-grow': '1', 'flex-shrink': '0', 'flex-basis': '10px', visibility: 'hidden',
    top: '1px', left: '1px', right: '1px', bottom: '1px', 'line-height': '1.5', 'letter-spacing': '1px',
    'text-align': 'center', 'font-family': 'system-ui', 'font-style': 'italic', 'word-break': 'break-all',
    'word-spacing': '1px', 'white-space': 'nowrap', 'text-overflow': 'ellipsis', 'box-shadow': '0 0 2px #000',
    filter: 'blur(2px)', 'backdrop-filter': 'blur(2px)', 'will-change': 'transform',
    'transition-property': 'all', 'animation-name': 'none', 'align-content': 'center', 'flex-wrap': 'wrap',
    order: '1', 'grid-template-columns': '1fr 1fr', 'transform-origin': 'center',
    'text-decoration': 'underline', 'background-image': 'none', 'background-size': 'cover',
    'background-position': 'center', 'background-repeat': 'no-repeat',
  }
  for (const name of uniq) {
    const rec = await page.evaluate((n) => { try { return CSS.supports(n, 'inherit') } catch { return false } }, name)
    const pv = valueProbe[name]
    let valOk = null
    if (pv !== undefined) {
      valOk = await page.evaluate(([n, v]) => { try { return CSS.supports(n, v) } catch { return false } }, [name, pv])
    }
    out.properties[name] = { recognized: !!rec, valueProbe: pv ?? null, valueOk: valOk, supported: !!rec && valOk !== false }
  }
  // 选择器：Web 支持全集（对照文档声明；实测只做抽查）
  const selChecks = { class: '.a', id: '#a', tag: 'div', attr: '[data-x]', descendant: '.a .b', child: '.a > .b', sibling: '.a + .b', wildcard: '*' }
  for (const [k, sel] of Object.entries(selChecks)) {
    const ok = await page.evaluate((s) => {
      try { document.querySelector(s); return true } catch { return false }
    }, sel)
    out.selectors[k] = { supported: !!ok, selector: sel }
  }
  await b.close()
  fs.mkdirSync(SRC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SRC_DIR, 'web-supports.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`[collect] Web（Chromium ${out.provenance.browserVersion}）：属性 ${Object.keys(out.properties).length} 条 · 选择器 ${Object.keys(out.selectors).length} 条`)
}

/** 解析设备装置产物：webview-computed.txt（WebView 列的实测源） */
function collectWebviewComputed() {
  const f = path.join(SPike_DIR, 'computed-webview.txt')
  if (!fs.existsSync(f)) {
    console.error(`[collect] ✗ 缺 ${path.relative(ROOT, f)}——先跑 spike/vc0-skyline-geom 装置（见 docs/Proteus_Skyline几何API结论报告.md §7）`)
    process.exit(2)
  }
  const s = fs.readFileSync(f, 'utf-8')
  const d = JSON.parse(s.slice(s.indexOf('{')))
  const data = JSON.parse(d.result.result.result)
  const rows = (data.rows || []).map((r) => ({ prop: r.prop, wrote: r.wrote, read: r.read, verdict: r.verdict }))
  const out = {
    provenance: {
      kind: 'wechatide-computedStyle',
      tool: 'wechatide automation_evaluate + fields({computedStyle})',
      page: data.label || 'pages/webview-geom/index',
      collectedAt: new Date().toISOString().slice(0, 10),
      raw: 'spike/vc0-skyline-geom/results/computed-webview.txt',
    },
    rows,
  }
  fs.mkdirSync(SRC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SRC_DIR, 'webview-computed.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`[collect] WebView 实测：${rows.length} 条（supported ${rows.filter((r) => r.verdict === 'supported').length}）`)
}

/* ────────────────────────── ③ 生成矩阵 ────────────────────────── */

function loadSrc(name) {
  const f = path.join(SRC_DIR, name)
  if (!fs.existsSync(f)) {
    console.error(`[gen-end-support-matrix] ✗ 缺源工件 ${path.relative(ROOT, f)}——先跑 --collect`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(f, 'utf-8'))
}

/** 官方 Skyline 属性表 → { cssName: { formats, default, remark } } */
function skylinePropsOf(official) {
  const m = {}
  for (const row of official.properties.slice(1)) {
    const [name, formats, def, remark] = row
    if (!name) continue
    m[name] = { formats: formats ?? '', default: def ?? '', remark: remark ?? '' }
  }
  return m
}

/** 官方 Skyline 选择器表 → { key: supported }（✓ / × / 部分） */
function skylineSelectorsOf(official) {
  const map = { 通配选择器: 'wildcard', 元素选择器: 'tag', 类选择器: 'class', ID选择器: 'id' }
  const out = {}
  for (const row of official.selectors.slice(1)) {
    const [label, example, support, remark] = row
    const key = map[label?.replace(/\s/g, '')] ?? label
    out[key] = { supported: support === '✓', raw: support, example: example ?? '', remark: remark ?? '' }
    // 其它选择器行（后代/子/兄弟/属性/伪类…）按原名收录
    if (!map[label?.replace(/\s/g, '')]) out[label] = { supported: support === '✓', raw: support, example: example ?? '', remark: remark ?? '' }
  }
  return out
}

/**
 * ★VC2-b：从官方属性表**派生**编译期边界规则（纯枚举 formats 才能当白名单——含 `<占位符>`
 * 的属性视为开放值域，不判：宁漏勿误）。
 * @returns [{ id, prop, accept: string[], suggestion, source }]
 */
function deriveBoundaryRules(official) {
  const rules = []
  for (const row of official.properties.slice(1)) {
    const [name, formats, , remark] = row
    if (!name || !formats) continue
    if (formats.includes('<') || formats.includes('*') || formats.includes('…')) continue
    const accept = formats.split('/').map((x) => x.trim()).filter(Boolean)
    if (accept.length < 2) continue // 单值格式不是枚举（如 auto）——不当白名单
    // 建议：优先从 remark 抓「不支持 X」的修法提示；否则给通用提示（改首个列挙值/语义组件）
    let suggestion = ''
    const m = /不支持([^；;。]+)/.exec(remark || '')
    if (m) suggestion = `${m[1].trim()}（官方备注）——改用 ${accept.slice(0, 3).join(' / ')} 或被支持的语义组件`
    else suggestion = `改用该端接受的取值：${accept.slice(0, 4).join(' / ')}`
    rules.push({ id: `CSS-PB-${name}`, prop: name, accept, suggestion, source: 'Skyline WXSS 支持与差异（官方文档 formats 列）' })
  }
  return rules
}

function buildMatrix() {
  const propSets = compilerPropSets()
  const official = loadSrc('skyline-wxss-official.json')
  const web = loadSrc('web-supports.json')
  const webview = loadSrc('webview-computed.json')

  const skyProps = skylinePropsOf(official)
  const skySelectors = skylineSelectorsOf(official)
  const webviewByProp = {}
  for (const r of webview.rows) {
    // 同属性多条（display 两条）：以任一 supported 即 supported；否则取最后一条
    const cur = webviewByProp[r.prop]
    if (!cur || (r.verdict === 'supported' && cur.verdict !== 'supported')) webviewByProp[r.prop] = r
  }

  const rows = []
  const seen = new Set()
  // ★VC2-a：端支持度维度（每行三个事实 + 一个合成档位）
  //   · ends：web / skyline / webview / app 四端逐端判定（app 端以"编译器是否把该字段送进内核"为准
  //     ——编译器认的字段 App 端必达，见 template.ts 的 LAYOUT_FIELDS/PAINT_FIELDS 消费链）
  //   · tier（分级规则，与 Profile L0–L5 的关系见 §profile）：
  //       universal   —— 四端全支持（L0–L2 准入条件）
  //       conditional —— 至少一端受限（formats 收窄/未收录/未实测）⇒ 归 L3「有条件可用」：需显式 opt-in
  //       unsupported —— 全部端不可用 ⇒ L5（L5 还含语义性禁止项，如动态选择器——本表只管"引擎支持度"）
  const tierOf = (w, sk, wv, skFormats, skRemark) => {
    const webOk = w ? w.supported : false
    const skOk = !!sk
    const wvOk = wv ? wv.verdict === 'supported' : false
    // Skyline 受限信号：未收录 OR formats 里出现「不支持」字样 OR remark 里明确不支持
    const skLimited = !skOk || /不支持/.test(skRemark ?? '') || /不支持/.test(skFormats ?? '')
    if (!webOk && !skOk && !wvOk) return 'unsupported'
    if (webOk && skOk && !skLimited && wvOk) return 'universal'
    return 'conditional'
  }
  const add = (kind, field) => {
    if (seen.has(field)) return
    seen.add(field)
    const css = CSS_ALIAS[field] ?? kebabOf(field)
    const w = web.properties[css]
    const s = skyProps[css]
    const v = webviewByProp[css]
    const ends = {
      web: w ? (w.supported ? 'supported' : 'unsupported') : 'not-measured',
      skyline: s ? 'supported' : 'not-listed',
      webview: v ? v.verdict : 'not-measured',
      app: 'supported', // 编译器认 = App 链路可达（LAYOUT_FIELDS/PAINT_FIELDS 即消费面）
    }
    rows.push({
      kind, // layout | paint
      field, // 编译器字段名
      css,
      ...ends,
      supportTier: tierOf(w, s, v, s?.formats ?? '', s?.remark ?? ''),
      skylineFormats: s?.formats ?? '',
      skylineDefault: s?.default ?? '',
      skylineRemark: s?.remark ?? '',
      webviewRead: v?.read ?? null,
    })
  }
  for (const f of propSets.layout) add('layout', f)
  for (const f of propSets.paint) add('paint', f)
  // ★绘制声明属性（fill-gradient/clip-path/glow/mask/svg-path）**不是 CSS 属性**——
  //   它们是本引擎的扩展通道（JSON 属性载体）。放进独立的 engineChannels 区，
  //   不混入 CSS 支持度矩阵（混入会污染"CSS 属性支持"的语义——首版已犯，本条修正）。
  const engineChannels = propSets.declAttrs.map((f) => ({
    field: f,
    attr: f === 'fillGradient' ? 'fill-gradient' : f === 'fillGradientTo' ? 'fill-gradient-to' : f === 'clipPath' ? 'clip-path' : f === 'svgPath' ? 'svg-path' : f === 'svgPathTo' ? 'svg-path-to' : f,
    note: '引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射，属 VC4 一致性校验范围',
  }))

  const structural = {
    // 结构性事实（不是逐属性判定，而是"端能力"判定）——证据：VC0 实测 + 官方文档
    skylineComputedStyle: {
      value: 'unsupported',
      evidence: 'spike/vc0-skyline-geom 实测：`fields({computedStyle})` 在 Skyline 下返回 {}（静默丢弃）；WebView 同装置可用（30/30）',
    },
    skylineSelectorIdClass: { value: 'supported', evidence: 'VC0 实测：#id ✓ / .class ✓（页面与组件作用域均通过）' },
    skylineSelectorAttrTag: {
      value: 'unsupported',
      evidence: 'VC0 实测：属性选择器 [data-*] 与 tag 选择器恒返 null（官方选择器表亦标 ×）；绕过=静态 id',
    },
    skylineInlineStyleOnly: {
      value: 'note',
      evidence: '装置事实：小程序不能 JS 写节点内联样式——样式变更必须经 setData/绑定（影响一致性校验的实现形态）',
    },
    skylineDefaults: {
      value: 'differ',
      evidence: '官方表：display 默认 flex、flex-direction 默认 column、box-sizing 默认 border-box（可经配置改 block/content-box）；与 WebView/Web 均不同',
    },
  }

  // ★VC2-a：profile 块——端支持度维度 + 与 L0–L5 的关系 + 「仅部分端支持」差集 + 官方开关清单
  const partial = rows.filter((r) => r.supportTier === 'conditional').map((r) => ({
    css: r.css,
    field: r.field,
    ends: { web: r.web, skyline: r.skyline, webview: r.webview, app: r.app },
    why: r.skylineRemark || r.skylineFormats || '',
  }))
  const profile = {
    relationToL0L5: [
      '支持度维度（本块）与成本分级（L0–L5）是两个**正交**维度：成本分级决定"怎么实现/贵不贵"，支持度决定"哪端能不能用"。',
      '准入规则（VC2-a 定案）：tier=universal ⇒ 可进 L0–L2；tier=conditional ⇒ 最高归 L3（"有条件可用"——需在 proteus.config 或组件级显式 opt-in，与 L3 既有"默认关闭"语义合并）；tier=unsupported ⇒ L5（编译期报错）。',
      'L5 同时保留既有语义性禁止项（运行时动态选择器/运行时插样式表等）——那些不属"引擎支持度"，本表不覆盖。',
      'Skyline 未收录（not-listed）按 conditional 保守处理：未收录 ≠ 确认不支持，需真机实测后升级（诚实边界）。',
    ],
    tierRule: 'universal = web∧skyline∧webview∧app 全支持且官方 formats/remark 无限制；unsupported = 全端不可用；其余 = conditional',
    partialSupport: partial,
    skylineAlignSwitches: official.configs, // 5 个官方对齐开关 + 各端最低版本（VC2-c 消费）
  }

  return {
    version: 1,
    profile,
    generatedNote: '自动生成，勿手改——见 scripts/gen-end-support-matrix.mjs（--check 为漂移门禁）',
    sources: {
      web: web.provenance,
      skyline: official.provenance,
      webview: webview.provenance,
    },
    compilerProps: { layout: propSets.layout, paint: propSets.paint, declAttrs: propSets.declAttrs },
    structural,
    engineChannels,
    rows,
  }
}

function toMarkdown(m) {
  const L = []
  L.push('# 端支持度矩阵（CSS Profile 属性 × Web / Skyline / WebView）')
  L.push('')
  L.push('> ★自动生成（`node scripts/gen-end-support-matrix.mjs`），勿手改。漂移门禁：`--check`。')
  L.push('> 任务卡：`docs/Proteus_一致性校验任务卡清单.md` VC1-a / VC1-b / VC1-c。')
  L.push('')
  L.push('## 证据来源（provenance）')
  L.push('')
  L.push(`| 列 | 采集方式 | 来源 | 采集日 |`)
  L.push('|---|---|---|---|')
  L.push(`| Web | Chromium CSS.supports（Playwright ${m.sources.web.browserVersion ?? ''}） | 本机实测 | ${m.sources.web.collectedAt} |`)
  L.push(`| Skyline | 官方《Skyline WXSS 样式支持与差异》解析 | ${m.sources.skyline.url} · sha ${m.sources.skyline.htmlSha} | ${m.sources.skyline.fetchedAt} |`)
  L.push(`| WebView | wechatide \`fields({computedStyle})\` 实测 | ${m.sources.webview.raw ?? ''} | ${m.sources.webview.collectedAt} |`)
  L.push('')
  L.push('## Profile 端支持度维度（VC2-a）')
  L.push('')
  for (const r of m.profile.relationToL0L5) L.push(`- ${r}`)
  L.push('')
  L.push(`> 判定规则：${m.profile.tierRule}`)
  L.push('')
  L.push('### 「仅部分端支持」差集（conditional —— 需显式 opt-in / 归 L3）')
  L.push('')
  if (m.profile.partialSupport.length === 0) {
    L.push('（无——编译器当前字段集全部 universal）')
  } else {
    L.push('| CSS | 编译器字段 | Web | Skyline | WebView | App | 受限原因 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const p of m.profile.partialSupport) {
      L.push(`| \`${p.css}\` | \`${p.field}\` | ${p.ends.web} | ${p.ends.skyline} | ${p.ends.webview} | ${p.ends.app} | ${(p.why || '—').replace(/\|/g, '\\|').slice(0, 80)} |`)
    }
  }
  L.push('')
  L.push('### 官方 Skyline 对齐开关（VC2-c 消费）')
  L.push('')
  L.push('| 开关 | 平台/基础库最低版本 |')
  L.push('|---|---|')
  for (const c of m.profile.skylineAlignSwitches) {
    const vers = (c.versions || []).slice(1).map((v) => `${v[0]} ${v[1]}`).join(' · ')
    L.push(`| ${c.section} | ${vers || '—'} |`)
  }
  L.push('')
  L.push('## 结构性事实（端能力差异）')
  L.push('')
  L.push('| 事实 | 判定 | 证据 |')
  L.push('|---|---|---|')
  for (const [k, v] of Object.entries(m.structural)) {
    L.push(`| ${k} | ${v.value} | ${v.evidence} |`)
  }
  L.push('')
  L.push('## 属性矩阵（编译器认的字段 = 覆盖范围）')
  L.push('')
  L.push('| 类别 | 编译器字段 | CSS | 档位 | Web | Skyline | Skyline 支持格式 | Skyline 默认 | WebView |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of m.rows) {
    L.push(`| ${r.kind} | \`${r.field}\` | \`${r.css}\` | ${r.supportTier} | ${r.web} | ${r.skyline} | ${(r.skylineFormats || '—').replace(/\|/g, '\\|').slice(0, 60)} | ${(r.skylineDefault || '—').slice(0, 24)} | ${r.webview} |`)
  }
  L.push('')
  L.push('## 引擎扩展通道（非 CSS 属性——独立于上表）')
  L.push('')
  L.push('| 编译器字段 | 声明属性 | 说明 |')
  L.push('|---|---|---|')
  for (const c of m.engineChannels) {
    L.push(`| \`${c.field}\` | \`${c.attr}\` | ${c.note} |`)
  }
  L.push('')
  L.push('> 判定口径：Web=`CSS.supports` 实测；Skyline=官方表**收录**（未收录≠确认不支持——需实测补证）；')
  L.push('> WebView=实测读回值判定（supported=声明被采纳；absent=取不到）。`not-measured` 为待补项（诚实标注）。')
  L.push('> 属性清单与编译器单一事实源同步：`packages/compiler/src/vapor/template.ts` 的 LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS。')
  L.push('')
  return L.join('\n')
}

/* ────────────────────────── ④ 主流程 ────────────────────────── */

async function main() {
  if (COLLECT) {
    const propSets = compilerPropSets()
    await collectOfficialSkyline()
    await collectWebSupports(propSets)
    collectWebviewComputed()
    console.log('[collect] ✅ 三份源工件已刷新')
    return
  }
  const matrix = buildMatrix()
  const json = JSON.stringify(matrix, null, 2) + '\n'
  const md = toMarkdown(matrix)
  // ★VC2-b 边界规则产物（css-compat 的编译期校验消费；生成物入库、--check 防漂移）
  const officialForRules = loadSrc('skyline-wxss-official.json')
  const boundaryRules = deriveBoundaryRules(officialForRules)
  const boundaryTs = [
    '// GENERATED - do not edit（scripts/gen-end-support-matrix.mjs 从官方文档派生）',
    '// 来源：《Skyline WXSS 样式支持与差异》属性表的**纯枚举 formats**（含 <占位符> 的不判——宁漏勿误）',
    '',
    'export interface SkylineBoundaryRule {',
    '  /** 规则 id（CSS-PB-<css 属性名>） */',
    '  id: string',
    '  /** CSS 属性名（小写） */',
    '  prop: string',
    '  /** 该端（Skyline）接受的取值白名单（官方 formats 枚举） */',
    '  accept: string[]',
    '  /** 替代建议（官方 remark 派生） */',
    '  suggestion: string',
    '  /** 事实来源（审计用） */',
    '  source: string',
    '}',
    '',
    'export const SKYLINE_BOUNDARY_RULES: SkylineBoundaryRule[] = ' + JSON.stringify(boundaryRules, null, 2),
    '',
  ].join('\n')
  const BOUNDARY_TS = path.join(ROOT, 'packages', 'css-compat', 'src', 'generated', 'skyline-boundary-rules.generated.ts')

  if (CHECK) {
    let drift = 0
    for (const [file, want] of [[OUT_JSON, json], [OUT_MD, md], [BOUNDARY_TS, boundaryTs]]) {
      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
      const ok = prev === want
      console.log(`  gen-end-support-matrix --check → ${path.relative(ROOT, file)}${ok ? ' ✅ 一致' : ' ❌ 漂移'}`)
      if (!ok) drift++
    }
    // 附加语义自检（防"矩阵空绿"）：行数 ≥ 30 且三列都有非 not-measured 条目
    const n = matrix.rows.length
    const webMeasured = matrix.rows.filter((r) => r.web !== 'not-measured').length
    const skyListed = matrix.rows.filter((r) => r.skyline === 'supported').length
    const wvMeasured = matrix.rows.filter((r) => r.webview !== 'not-measured').length
    console.log(`  ▸ 行 ${n}（web 实测 ${webMeasured} · skyline 收录 ${skyListed} · webview 实测 ${wvMeasured}）`)
    // ★自检口径（防"空绿"就该盯**每列是否有实测**，不盯行数——行数由编译器字段集决定，
    //   硬编码阈值会在编译器重构时误报；本仓纪律：判据打在语义上，不打在偶然数字上）
    const cols = [['web', webMeasured], ['skyline', skyListed], ['webview', wvMeasured]]
    const empty = cols.filter(([, v]) => v === 0).map(([k]) => k)
    if (n < 10 || empty.length > 0) {
      console.error(`  ✗ 矩阵自检失败（行 ${n}；空列：${empty.join(',') || '无'}——空绿防护）`)
      drift++
    }
    if (drift) process.exit(1)
    console.log('✅ 端支持度矩阵与源一致')
    return
  }

  fs.mkdirSync(GEN_DIR, { recursive: true })
  fs.writeFileSync(OUT_JSON, json)
  fs.writeFileSync(OUT_MD, md)
  fs.mkdirSync(path.dirname(BOUNDARY_TS), { recursive: true })
  fs.writeFileSync(BOUNDARY_TS, boundaryTs)
  console.log(`[gen-end-support-matrix] ✅ ${path.relative(ROOT, OUT_JSON)}（${matrix.rows.length} 行）`)
  console.log(`[gen-end-support-matrix] ✅ ${path.relative(ROOT, OUT_MD)}`)
  console.log(`[gen-end-support-matrix] ✅ ${path.relative(ROOT, BOUNDARY_TS)}（${boundaryRules.length} 条边界规则）`)
}

main().catch((e) => {
  console.error('[gen-end-support-matrix] ✗', e?.message ?? e)
  process.exit(2)
})
