#!/usr/bin/env node
// scripts/gen-css-capability-alignment.mjs —— ★★★CSS 能力对齐清单生成器（三端模型 · 2026-10-04 重构）
//
// 【回答什么】把「每个 CSS 能力在 **Web / Skyline / App 三端** 到底支不支持、App 端可扩展性多大」
//   从散文断言变成**机器可读清单**（JSON + MD），每条判定带证据来源。
//
// 【为什么是"三端"（本轮重构的核心，取代旧"五端 / web·skyline·webview·app 四列"）】
//   App 端已是**自研自绘 Rust 引擎**（一套，覆盖 iOS/Android/鸿蒙 三具体平台）——CSS 面由**我们**
//   定义、可扩展。旧的 iOS=UIStackView / Android=ConstraintLayout / 鸿蒙=Row 三列是"非自绘时代的
//   原生组件映射"，在自绘模型下已失效 ⇒ 合并为一个 **App** 端。
//   WebView 列亦并入 Skyline（它是 Skyline 的渲染模式对照，不是独立端）。
//   ⇒ 三端 = **Web（浏览器 CSS，超集）· Skyline（微信容器，唯一刚性外部约束）· App（自研引擎，可扩展）**。
//
// 【App 列回答两件事】
//   ① 现状（today）：supported / folded-only / engine-only / absent —— 来自**代码事实**
//      （编译器 packages/compiler/src/vapor/template.ts 折叠面 + 引擎 LStyle + 宿主自绘）；
//   ② 可扩展档位（tier / strategy）：加它要多大成本（L0–L5，按《Proteus CSS Profile 规格》§3）。
//
// 【数据来源（SSOT）】
//   · Web 列      —— Playwright `CSS.supports()` 实测（源工件 web-supports.json）
//   · Skyline 列  —— 官方《Skyline WXSS 样式支持与差异》解析（源工件 skyline-wxss-official.json）
//   · App 列      —— 人工维护源工件 app-profile-features.json（现状核对代码事实 + tier 人工标注）
//   · 编译器折叠面 —— 从编译器源码提取（LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS）作为**交叉校验**
//
// 【设计（离线生成 + 源工件）】生成器本体**不联网**：读源工件 → 产物。刷新源工件用 `--collect`
//   （联网：抓官方文档 / 跑 Playwright / 解析设备产物）；日常门禁用 `--check`（离线）防漂移。
//
// 用法：
//   node scripts/gen-css-capability-alignment.mjs             # 离线生成
//   node scripts/gen-css-capability-alignment.mjs --check      # 漂移门禁（CI/verify 链）
//   node scripts/gen-css-capability-alignment.mjs --collect     # 刷新源工件（联网 + Playwright）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GEN_DIR = path.join(ROOT, 'docs', 'generated')
const SRC_DIR = path.join(GEN_DIR, 'css-capability-sources')
const OUT_JSON = path.join(GEN_DIR, 'css-capability-alignment.json')
const OUT_MD = path.join(GEN_DIR, 'css-capability-alignment.md')
const COMPILER_SRC = path.join(ROOT, 'packages', 'compiler', 'src', 'vapor', 'template.ts')
const SPike_DIR = path.join(ROOT, 'spike', 'vc0-skyline-geom', 'results')
const OFFICIAL_URL = 'https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/wxss.html'

const CHECK = process.argv.includes('--check')
const COLLECT = process.argv.includes('--collect')

/* ────────────────────────── ① 编译器折叠面：从源码提取（交叉校验 SSOT） ────────────────────────── */

/** 提取数组字面量 `const NAME = [ ... ] as const`（容错：跨行、含注释行） */
function extractArrayLiteral(src, constName) {
  const re = new RegExp(`(?:export\\s+)?const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`)
  const m = re.exec(src)
  if (!m) return null
  const inner = m[1].replace(/\/\/[^\n]*/g, '')
  return [...inner.matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** 提取集合字面量 `const NAME = new Set([ ... ])`（容错：跨行、含注释行） */
function extractSetLiteral(src, constName) {
  const re = new RegExp(`(?:export\\s+)?const ${constName}\\s*=\\s*new Set(?:<[^>]*>)?\\(\\[([\\s\\S]*?)\\]\\)`)
  const m = re.exec(src)
  if (!m) return null
  const inner = m[1].replace(/\/\/[^\n]*/g, '')
  return [...inner.matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function compilerPropSets() {
  const src = fs.readFileSync(COMPILER_SRC, 'utf-8')
  // 属性清单从**导出的数组常量**提取（APP_*=SSOT；Set 由其构造——见 template.ts 头注）
  const layout = extractArrayLiteral(src, 'APP_LAYOUT_FIELDS')
  const paint = extractArrayLiteral(src, 'APP_PAINT_FIELDS')
  const declAttrs = extractSetLiteral(src, 'PAINT_DECL_ATTRS')
  if (!layout || !paint || !declAttrs) {
    console.error('[gen-css-capability-alignment] ✗ 无法从编译器源码提取属性集（template.ts 结构变了？）')
    process.exit(2)
  }
  return { layout, paint, declAttrs }
}

/** camelCase → kebab-case（CSS 名） */
const kebabOf = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
/** 编译器字段 → CSS 名（个别需映射；其余走 kebab 规则）。margin/padding 取四边族**代表**键（Web 实测键）。 */
const CSS_ALIAS = {
  margin: 'margin-top', padding: 'padding-top', backgroundColor: 'background-color', borderRadius: 'border-radius',
  borderColor: 'border-color', borderWidth: 'border-width', fontSize: 'font-size',
  // ★★★grid-area 项（2026-10-08）：编译器字段 gridArea（命名区/线号放置）对应 CSS 能力 grid-area
  gridArea: 'grid-area',
  // ★★★line-clamp 项（2026-10-08）：编译器字段 lineClamp 由 -webkit-line-clamp 折叠而来（WebKit 事实标准名）
  lineClamp: '-webkit-line-clamp',
}
const cssNameOfField = (f) => CSS_ALIAS[f] ?? kebabOf(f)

/* ────────────────────────── ② 源工件读取 / 采集 ────────────────────────── */

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
}
function loadSrc(name) {
  const f = path.join(SRC_DIR, name)
  if (!fs.existsSync(f)) {
    console.error(`[gen-css-capability-alignment] ✗ 缺源工件 ${path.relative(ROOT, f)}——先跑 --collect`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(f, 'utf-8'))
}

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
  const sections = []
  {
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<table[\s\S]*?<\/table>/g
    let cur = ''
    for (const m of html.matchAll(re)) {
      if (m[0].startsWith('<h2')) { cur = m[1].replace(/<[^>]+>/g, '').trim(); continue }
      sections.push({ section: cur, table: parseTable(m[0]) })
    }
  }
  const configs = sections.filter((x) => /^#\s*开启/.test(x.section)).map((x) => ({ section: x.section.replace(/^#\s*/, '').trim(), versions: x.table }))
  const out = {
    provenance: { kind: 'official-doc', url: OFFICIAL_URL, fetchedAt: new Date().toISOString().slice(0, 10), htmlSha: sha256(html) },
    modules: tables[0], selectors: tables[1], properties: tables[2], types: tables[3], configs,
  }
  fs.mkdirSync(SRC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SRC_DIR, 'skyline-wxss-official.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`[collect] 官方文档：属性 ${out.properties.length} 行 · 选择器 ${out.selectors.length} 行 · 开关 ${configs.length}`)
}

async function collectWebSupports(propSets) {
  const { chromium } = await import('playwright').catch(() => ({ chromium: null }))
  if (!chromium) {
    console.error('[collect] ✗ 未安装 playwright（devDeps 应有；npm i 后重试）')
    process.exit(2)
  }
  const cssNames = [
    ...propSets.layout.map(cssNameOfField), ...propSets.paint.map(cssNameOfField),
    'transform', 'transform-origin', 'box-sizing', 'z-index', 'visibility', 'line-height', 'letter-spacing',
    'white-space', 'text-overflow', 'word-break', 'word-spacing', 'font-style', 'font-family', 'text-decoration',
    'box-shadow', 'filter', 'backdrop-filter', 'will-change', 'align-content', 'flex-wrap', 'order',
    'border-style', 'border-color', 'right', 'bottom', 'grid', 'grid-template-columns', 'animation-name', 'transition-property',
  ]
  const uniq = [...new Set(cssNames)]
  const b = await chromium.launch({ headless: true })
  const page = await b.newPage()
  await page.setContent('<div id=x></div>')
  const out = { provenance: { kind: 'playwright-css-supports', engine: 'chromium', collectedAt: new Date().toISOString().slice(0, 10), browserVersion: b.version() }, properties: {}, selectors: {}, values: {} }
  // 双判定：recognized = CSS.supports(name,'inherit')；valueProbe 只在显式值表里给（见旧版注释的假阴性教训）
  const valueProbe = {
    display: 'flex', position: 'relative', overflow: 'hidden', 'border-radius': '10px', gap: '5px',
    transform: 'translateX(10px)', 'z-index': '1', opacity: '0.5', 'background-color': '#fff', color: '#000',
    'font-weight': '700', 'font-size': '16px', width: '10px', height: '10px', 'min-width': '10px', 'max-width': '10px',
    'min-height': '10px', 'max-height': '10px', margin: '10px', padding: '10px', 'margin-top': '10px', 'padding-top': '10px',
    'border-width': '1px', 'border-color': '#000', 'border-style': 'solid', 'box-sizing': 'border-box',
    'flex-direction': 'row', 'justify-content': 'center', 'align-items': 'center', 'align-self': 'center',
    'flex-grow': '1', 'flex-shrink': '0', 'flex-basis': '10px', visibility: 'hidden', top: '1px', left: '1px',
    right: '1px', bottom: '1px', 'line-height': '1.5', 'letter-spacing': '1px', 'text-align': 'center',
    'font-family': 'system-ui', 'white-space': 'nowrap', 'text-overflow': 'ellipsis', 'box-shadow': '0 0 2px #000',
    filter: 'blur(2px)', 'backdrop-filter': 'blur(2px)', 'align-content': 'center', 'flex-wrap': 'wrap',
    order: '1', 'grid-template-columns': '1fr 1fr', 'transform-origin': 'center',
  }
  for (const name of uniq) {
    const rec = await page.evaluate((n) => { try { return CSS.supports(n, 'inherit') } catch { return false } }, name)
    const pv = valueProbe[name]
    let valOk = null
    if (pv !== undefined) valOk = await page.evaluate(([n, v]) => { try { return CSS.supports(n, v) } catch { return false } }, [name, pv])
    out.properties[name] = { recognized: !!rec, valueProbe: pv ?? null, valueOk: valOk, supported: !!rec && valOk !== false }
  }
  const selChecks = { class: '.a', id: '#a', tag: 'div', attr: '[data-x]', descendant: '.a .b', child: '.a > .b', sibling: '.a + .b', wildcard: '*' }
  for (const [k, sel] of Object.entries(selChecks)) {
    const ok = await page.evaluate((s) => { try { document.querySelector(s); return true } catch { return false } }, sel)
    out.selectors[k] = { supported: !!ok, selector: sel }
  }
  await b.close()
  fs.mkdirSync(SRC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SRC_DIR, 'web-supports.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`[collect] Web（Chromium ${out.provenance.browserVersion}）：属性 ${Object.keys(out.properties).length} 条`)
}

/** WebView 实测（Skyline 渲染模式对照——不再是独立列，作为 Skyline 段的结构性证据，保留可刷新） */
function collectWebviewComputed() {
  const f = path.join(SPike_DIR, 'computed-webview.txt')
  if (!fs.existsSync(f)) {
    console.error(`[collect] ✗ 缺 ${path.relative(ROOT, f)}——先跑 spike/vc0-skyline-geom 装置`)
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
  console.log(`[collect] WebView 实测（Skyline 渲染模式对照）：${rows.length} 条`)
}

/* ────────────────────────── ③ 生成清单 ────────────────────────── */

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

/** 从官方属性表派生编译期边界规则（纯枚举 formats 才当白名单——含占位符视为开放，宁漏勿误） */
function deriveBoundaryRules(official) {
  const rules = []
  for (const row of official.properties.slice(1)) {
    const [name, formats, , remark] = row
    if (!name || !formats) continue
    if (formats.includes('<') || formats.includes('*') || formats.includes('…')) continue
    const accept = formats.split('/').map((x) => x.trim()).filter(Boolean)
    if (accept.length < 2) continue
    let suggestion = ''
    const m = /不支持([^；;。]+)/.exec(remark || '')
    if (m) suggestion = `${m[1].trim()}（官方备注）——改用 ${accept.slice(0, 3).join(' / ')} 或被支持的语义组件`
    else suggestion = `改用该端接受的取值：${accept.slice(0, 4).join(' / ')}`
    rules.push({ id: `CSS-PB-${name}`, prop: name, accept, suggestion, source: 'Skyline WXSS 支持与差异（官方文档 formats 列）' })
  }
  return rules
}

function buildAlignment() {
  const propSets = compilerPropSets()
  const official = loadSrc('skyline-wxss-official.json')
  const web = loadSrc('web-supports.json')
  const webview = loadSrc('webview-computed.json')
  const appProfile = loadSrc('app-profile-features.json')

  const skyProps = skylinePropsOf(official)

  // ★交叉校验：编译器折叠面（LAYOUT_FIELDS / PAINT_FIELDS 的 css 名）必须被 curated 的 probe 覆盖
  //   ⇒ 防止「编译器加了字段、清单没跟上」的静默漂移（与旧版 extractSetLiteral 同纪律）。
  const probedCss = new Set()
  for (const feat of appProfile.features) for (const p of feat.probe ?? []) probedCss.add(p)
  const missing = []
  // css 名 → 编译器字段（供消费者按"是否编译器属性"过滤；一个 CSS 能力可能折多个字段，故用数组）
  const cssToCompilerFields = new Map()
  for (const f of [...propSets.layout, ...propSets.paint]) {
    const css = cssNameOfField(f)
    if (!cssToCompilerFields.has(css)) cssToCompilerFields.set(css, [])
    cssToCompilerFields.get(css).push(f)
  }
  for (const f of [...propSets.layout, ...propSets.paint]) {
    const css = cssNameOfField(f)
    if (!probedCss.has(css)) missing.push(`${f}（${css}）`)
  }
  const rows = []
  const tierOf = (webOk, skyOk, appToday) => {
    const appOk = appToday === 'supported' || appToday === 'folded-only' || appToday === 'engine-only'
    if (!webOk && !skyOk && !appOk) return 'unsupported'
    if (webOk && skyOk && appToday === 'supported') return 'universal'
    return 'conditional'
  }
  for (const feat of appProfile.features) {
    const probes = feat.probe ?? []
    const webVals = probes.map((p) => (web.properties[p] ? (web.properties[p].supported ? 'supported' : 'unsupported') : 'not-measured'))
    const skyVals = probes.map((p) => (skyProps[p] ? 'supported' : 'not-listed'))
    const agg = (vals, neg) => {
      if (vals.length === 0) return '—'
      const ok = vals.filter((v) => v === 'supported').length
      if (ok === vals.length) return 'supported'
      if (ok === 0) return vals.every((v) => v === neg) ? neg : vals[0]
      return 'partial'
    }
    const webAgg = agg(webVals, 'not-measured')
    const skyAgg = agg(skyVals, 'not-listed')
    // compilerFields：该 CSS 能力对应的编译器折叠字段（M1 等"属性字段"口径的过滤依据）
    const compilerFields = [...new Set(probes.flatMap((p) => cssToCompilerFields.get(p) ?? []))]
    rows.push({
      id: feat.id,
      css: feat.css,
      category: feat.category,
      compilerFields,
      web: webAgg,
      skyline: skyAgg,
      app: feat.today,
      tier: feat.tier,
      strategy: feat.strategy,
      note: feat.note ?? '',
      supportTier: tierOf(webAgg === 'supported', skyAgg === 'supported', feat.today),
    })
  }

  // 引擎扩展通道（非 CSS 属性——独立区，不混入 CSS 能力矩阵）
  const engineChannels = propSets.declAttrs.map((f) => ({
    field: f,
    attr: f === 'fillGradient' ? 'fill-gradient' : f === 'fillGradientTo' ? 'fill-gradient-to' : f === 'clipPath' ? 'clip-path' : f === 'svgPath' ? 'svg-path' : f === 'svgPathTo' ? 'svg-path-to' : f,
    note: '引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射',
  }))

  const structural = {
    skylineComputedStyle: { value: 'unsupported', evidence: 'spike/vc0-skyline-geom 实测：fields({computedStyle}) 在 Skyline 下返回 {}（静默丢弃）；WebView 同装置可用' },
    skylineSelectorIdClass: { value: 'supported', evidence: 'VC0 实测：#id ✓ / .class ✓' },
    skylineSelectorAttrTag: { value: 'unsupported', evidence: 'VC0 实测：属性选择器 [data-*] 与 tag 选择器恒返 null（官方选择器表亦标 ×）' },
    skylineInlineStyleOnly: { value: 'note', evidence: '装置事实：小程序不能 JS 写节点内联样式——样式变更须经 setData/绑定' },
    skylineDefaults: { value: 'differ', evidence: '官方表：display 默认 flex、flex-direction 默认 column、box-sizing 默认 border-box（可经配置改 block/content-box）；与 Web/App 均不同' },
    webviewRenderingContrast: { value: 'note', evidence: `WebView 渲染模式对照实测 ${(webview.rows || []).length} 条（源：${webview.provenance?.raw ?? 'webview-computed.json'}）——WebView 是 Skyline 的渲染模式对照，非独立端，不再单列` },
    appSelfDrawnEngine: { value: 'note', evidence: 'App = 自研自绘 Rust 引擎（一套覆盖 iOS/Android/鸿蒙）；CSS 面由项目定义、可扩展（见 app-profile-features.json 的 tier/strategy）' },
  }

  const partial = rows.filter((r) => r.supportTier === 'conditional').map((r) => ({ css: r.css, id: r.id, ends: { web: r.web, skyline: r.skyline, app: r.app }, why: r.note }))
  const profile = {
    model: 'three-end',
    ends: appProfile.model.ends,
    endsNote: appProfile.model.note,
    todayValues: appProfile.model.todayValues,
    tiers: appProfile.model.tiers,
    noteOnTier: appProfile.model.noteOnTier,
    superappGoal: appProfile.model.superappGoal,
    auditNote: appProfile.model.auditNote,
    relationNote: '支持度维度（web/skyline/app 现状）与成本分级（L0–L5）是**正交**维度：成本分级决定"怎么实现/贵不贵"，支持度决定"哪端能不能用、App 加它多贵"。App 端为自研引擎 ⇒ 候选特性带 tier 即为"可扩展档位"。',
    tierRule: 'universal = web∧skyline∧app 现状全 supported；unsupported = 三端皆不可用；其余 = conditional',
    partialSupport: partial,
    skylineAlignSwitches: official.configs,
  }

  return {
    version: 2,
    profile,
    generatedNote: '自动生成，勿手改——见 scripts/gen-css-capability-alignment.mjs（--check 为漂移门禁）',
    sources: { web: web.provenance, skyline: official.provenance, appProfile: appProfile.provenance },
    compilerProps: { layout: propSets.layout, paint: propSets.paint, declAttrs: propSets.declAttrs },
    structural,
    engineChannels,
    rows,
    _missingCompilerCoverage: missing, // 供 --check 自检（应为空）
  }
}

function toMarkdown(m) {
  const L = []
  L.push('# CSS 能力对齐清单（三端：Web / Skyline / App）')
  L.push('')
  L.push('> ★自动生成（`node scripts/gen-css-capability-alignment.mjs`），勿手改。漂移门禁：`--check`。')
  L.push('> **三端模型**：Web（浏览器 CSS，超集）· Skyline（微信容器，唯一刚性外部约束）· **App（自研自绘 Rust 引擎，一套，面由我们定义、可扩展）**。')
  L.push('> 旧「五端」的 iOS/Android/鸿蒙 三列是**非自绘时代的原生组件映射**，在自绘模型下已失效 ⇒ 合并为 App。')
  L.push('')
  L.push('## 端模型与证据来源')
  L.push('')
  L.push(`- **端**：${m.profile.ends.join(' / ')}`)
  L.push(`- ${m.profile.endsNote}`)
  L.push('')
  L.push('| 列 | 采集方式 | 来源 | 采集日 |')
  L.push('|---|---|---|---|')
  L.push(`| Web | Chromium CSS.supports（Playwright ${m.sources.web.browserVersion ?? ''}） | 本机实测 | ${m.sources.web.collectedAt} |`)
  L.push(`| Skyline | 官方《Skyline WXSS 样式支持与差异》解析 | ${m.sources.skyline.url} · sha ${m.sources.skyline.htmlSha} | ${m.sources.skyline.fetchedAt} |`)
  L.push(`| App 现状 | 代码事实核对（编译器折叠面 + 引擎 LStyle + 宿主自绘） | \`${path.relative(ROOT, path.join(SRC_DIR, 'app-profile-features.json'))}\`（人工维护） | ${m.sources.appProfile.collectedAt} |`)
  L.push('')
  L.push('## App 端「现状」取值口径')
  L.push('')
  L.push('| 取值 | 含义 |')
  L.push('|---|---|')
  for (const [k, v] of Object.entries(m.profile.todayValues)) L.push(`| \`${k}\` | ${v} |`)
  L.push('')
  L.push('## App 可扩展档位（L0–L5 成本分级）')
  L.push('')
  L.push('| 档位 | 含义 |')
  L.push('|---|---|')
  for (const [k, v] of Object.entries(m.profile.tiers)) L.push(`| ${k} | ${v} |`)
  L.push('')
  L.push(`> ${m.profile.noteOnTier}`)
  L.push('')
  if (m.profile.auditNote) {
    L.push('## 多端一致性审计（批 14 · 对齐 CSS 标准）')
    L.push('')
    L.push(`> ${m.profile.auditNote}`)
    L.push('')
  }
  if (m.profile.superappGoal) {
    L.push('## 超级应用能力清单（★优先口径：不按 demo 使用频次）')
    L.push('')
    L.push(`> ${m.profile.superappGoal.note}`)
    L.push('')
    L.push('| 超级应用能力 | 用途 | 现状 |')
    L.push('|---|---|---|')
    for (const c of m.profile.superappGoal.checklist) L.push(`| ${c.capability} | ${c.why} | ${c.status} |`)
    L.push('')
  }
  L.push('## CSS 能力矩阵')
  L.push('')
  L.push('| 类别 | CSS | Web | Skyline | App 现状 | App 可扩展 | 策略 | 对齐 | 说明 |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of m.rows) {
    L.push(`| ${r.category} | \`${r.css}\` | ${r.web} | ${r.skyline} | ${r.app} | ${r.tier} | ${r.strategy} | ${r.supportTier} | ${(r.note || '—').replace(/\|/g, '\\|')} |`)
  }
  L.push('')
  L.push('> 表中**带编译器字段**的行（对应 `packages/compiler/src/vapor/template.ts` 的 LAYOUT/PAINT_FIELDS）是')
  L.push('> 「编译器属性」口径（M1 一致性覆盖率的分母来源）；其余行是选择器 / @rule / 引擎通道等**非属性字段**能力。')
  L.push('')
  L.push('### 「仅部分端支持」差集（conditional —— 归 L3「有条件可用」/ 需 opt-in）')
  L.push('')
  if (m.profile.partialSupport.length === 0) {
    L.push('（无）')
  } else {
    L.push('| CSS | Web | Skyline | App | 受限原因 |')
    L.push('|---|---|---|---|---|')
    for (const p of m.profile.partialSupport) {
      L.push(`| \`${p.css}\` | ${p.ends.web} | ${p.ends.skyline} | ${p.ends.app} | ${(p.why || '—').replace(/\|/g, '\\|').slice(0, 90)} |`)
    }
  }
  L.push('')
  L.push('## 官方 Skyline 对齐开关')
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
  for (const [k, v] of Object.entries(m.structural)) L.push(`| ${k} | ${v.value} | ${v.evidence} |`)
  L.push('')
  L.push('## 引擎扩展通道（非 CSS 属性——独立于上表）')
  L.push('')
  L.push('| 编译器字段 | 声明属性 | 说明 |')
  L.push('|---|---|---|')
  for (const c of m.engineChannels) L.push(`| \`${c.field}\` | \`${c.attr}\` | ${c.note} |`)
  L.push('')
  L.push('> 判定口径：Web=`CSS.supports` 实测；Skyline=官方表**收录**（未收录≠确认不支持，需实测补证）；')
  L.push('> App 现状=代码事实（compile 折叠面 ∩ 引擎 ∩ 宿主）；App 可扩展=tier（人工按 Profile §3，非实测毫秒）。')
  L.push('> 属性清单与编译器单一事实源交叉校验：`packages/compiler/src/vapor/template.ts` 的 LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS。')
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
    console.log('[collect] ✅ 源工件已刷新（App 现状源 app-profile-features.json 为人工维护，不自动采集）')
    return
  }
  const m = buildAlignment()
  const json = JSON.stringify(m, null, 2) + '\n'
  const md = toMarkdown(m)
  const officialForRules = loadSrc('skyline-wxss-official.json')
  const boundaryRules = deriveBoundaryRules(officialForRules)
  const boundaryTs = [
    '// GENERATED - do not edit（scripts/gen-css-capability-alignment.mjs 从官方文档派生）',
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
      console.log(`  gen-css-capability-alignment --check → ${path.relative(ROOT, file)}${ok ? ' ✅ 一致' : ' ❌ 漂移'}`)
      if (!ok) drift++
    }
    const n = m.rows.length
    const webMeasured = m.rows.filter((r) => r.web === 'supported' || r.web === 'partial').length
    const skyListed = m.rows.filter((r) => r.skyline === 'supported' || r.skyline === 'partial').length
    const appKnown = m.rows.filter((r) => r.app === 'supported').length
    console.log(`  ▸ 行 ${n}（web 实测 ${webMeasured} · skyline 收录 ${skyListed} · app 全通 ${appKnown}）`)
    if (n < 10 || webMeasured === 0 || skyListed === 0 || appKnown === 0) {
      console.error(`  ✗ 清单自检失败（行 ${n}；web ${webMeasured} · skyline ${skyListed} · app ${appKnown}——空绿防护）`)
      drift++
    }
    if (m._missingCompilerCoverage.length > 0) {
      console.error(`  ✗ 编译器折叠面有 ${m._missingCompilerCoverage.length} 个字段未被清单覆盖（curated 源未同步）：${m._missingCompilerCoverage.join(', ')}`)
      drift++
    }
    if (drift) process.exit(1)
    console.log('✅ CSS 能力对齐清单与源一致')
    return
  }

  fs.mkdirSync(GEN_DIR, { recursive: true })
  fs.writeFileSync(OUT_JSON, json)
  fs.writeFileSync(OUT_MD, md)
  fs.mkdirSync(path.dirname(BOUNDARY_TS), { recursive: true })
  fs.writeFileSync(BOUNDARY_TS, boundaryTs)
  console.log(`[gen-css-capability-alignment] ✅ ${path.relative(ROOT, OUT_JSON)}（${m.rows.length} 行）`)
  console.log(`[gen-css-capability-alignment] ✅ ${path.relative(ROOT, OUT_MD)}`)
  console.log(`[gen-css-capability-alignment] ✅ ${path.relative(ROOT, BOUNDARY_TS)}（${boundaryRules.length} 条边界规则）`)
  if (m._missingCompilerCoverage.length > 0) {
    console.warn(`[gen-css-capability-alignment] ⚠ 编译器字段未被清单覆盖：${m._missingCompilerCoverage.join(', ')}`)
  }
}

main().catch((e) => {
  console.error('[gen-css-capability-alignment] ✗', e?.message ?? e)
  process.exit(2)
})
