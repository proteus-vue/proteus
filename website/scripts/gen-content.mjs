// website/scripts/gen-content.mjs
// ★#390ii 组件/能力参考文档生成器（内容即数据——SSOT = 框架源码，产物勿手改）
//   ① website/content/components/*.md —— 59 个 p-* 组件：props/emits（解析 defineProps/defineEmits + JSDoc）
//      + 语义映射（component-ir TAG_SEMANTIC_MAP）+ 小程序等价（MP_MAPPING_MATRIX）
//   ② website/content/capabilities/*.md —— 50 个能力原语（PRIMITIVE_CATALOG kind=capability）
//      + 签名/返回类型（packages/api/src/capability.ts CapabilityHooks 接口 JSDoc）
//   幂等：重复运行输出一致（无时间戳）。用法：node website/scripts/gen-content.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMP_DIR = path.join(ROOT, 'src', 'components')
const OUT_COMP = path.join(ROOT, 'website', 'content', 'components')
const OUT_CAP = path.join(ROOT, 'website', 'content', 'capabilities')

// —— component-ir SSOT（tsx 直接 import TS 源） ——
async function loadIr() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'packages', 'component-ir', 'src', 'index.ts')).href)
  return mod
}

// —— 端注册表 SSOT（W-7 L-B：兼容进度表的端列/状态 = website/src/ends.ts） ——
async function loadEnds() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'website', 'src', 'ends.ts')).href)
  return mod.ENDS
}

const STATUS_MARK = { '✅ 已落地': '✅', '🟡 部分落地': '🟡', '📋 规划已入库': '📋', '⬜ 未开始': '⬜' }
const MP_STATUS_LABEL = { ok: 'L1 原语', compat: 'L2 兼容层', private: '平台私有', missing: '缺失' }

// ★能力侧栏分组：50 能力按 9 类归组（生成器侧分类表，与组件 EXTRA_KIND「分类先行」同模式）
const CAP_CATEGORY = {
  fetch: '网络与通信', websocket: '网络与通信', 'socket-task': '网络与通信', upload: '网络与通信', download: '网络与通信', 'data-channel': '网络与通信', bluetooth: '网络与通信', nfc: '网络与通信',
  device: '设备与系统', screen: '设备与系统', battery: '设备与系统', orientation: '设备与系统', brightness: '设备与系统', sensor: '设备与系统', vibrate: '设备与系统', network: '设备与系统', keyboard: '设备与系统', clipboard: '设备与系统',
  storage: '存储与文件', cookie: '存储与文件', 'file-system': '存储与文件', archive: '存储与文件',
  location: '位置与地图', map: '位置与地图',
  camera: '媒体与扫码', microphone: '媒体与扫码', live: '媒体与扫码', 'qr-code': '媒体与扫码',
  login: '账号与支付', auth: '账号与支付', biometric: '账号与支付', 'face-id': '账号与支付', permission: '账号与支付', payment: '账号与支付', 'in-app-purchase': '账号与支付',
  notification: '通知与分享', share: '通知与分享', shortcut: '通知与分享', sms: '通知与分享', contact: '通知与分享', 'phone-call': '通知与分享', calendar: '通知与分享',
  'app-lifecycle': '应用与生命周期', 'page-lifecycle': '应用与生命周期', background: '应用与生命周期', 'mini-program': '应用与生命周期', embedded: '应用与生命周期', extension: '应用与生命周期',
  analytics: '可观测与调试', log: '可观测与调试',
}
const CAP_CAT_ORDER = ['网络与通信', '设备与系统', '存储与文件', '位置与地图', '媒体与扫码', '账号与支付', '通知与分享', '应用与生命周期', '可观测与调试', '其他']

// 兼容进度表（uni-app 式全端对照）：端列/状态来自 ENDS 注册表，说明 = 引擎（注册表） + 逐项注记
function compatSection(rows, footer) {
  const lines = []
  lines.push('## 兼容进度')
  lines.push('')
  lines.push('| 端 | 兼容 | 说明 |')
  lines.push('|---|---|---|')
  for (const r of rows) lines.push(`| ${r.name} | ${r.status} | ${r.note} |`)
  lines.push('')
  lines.push(footer)
  lines.push('')
  return lines
}

// 解析 api.ts 内 wxBridge/webBridge 实现的方法名集合（能力页 Web 列 ✅/⚠️ 的 SSOT——未实现 → Err 显式降级）
function extractFnKeys(src, fnName) {
  const start = src.indexOf(`function ${fnName}`)
  if (start < 0) return []
  const rest = src.slice(start)
  const endM = rest.search(/^}/m)
  const body = endM >= 0 ? rest.slice(0, endM) : rest
  return [...body.matchAll(/^ {4}([a-zA-Z]+):/gm)].map((x) => x[1])
}

// —— defineProps 块提取（平衡花括号/括号/字符串） ——
function extractCall(src, fnName) {
  const idx = src.indexOf(`${fnName}(`)
  if (idx < 0) return null
  const start = src.indexOf('{', idx)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue }
        if (src[i] === quote) break
      }
      continue
    }
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

// 顶层键分割：在块内按逗号切割（深度 0 时的逗号为界，跳过字符串/嵌套）
function splitTopLevel(block) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch
      i++
      for (; i < block.length; i++) {
        if (block[i] === '\\') { i++; continue }
        if (block[i] === q) break
      }
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(block.slice(start, i))
      start = i + 1
    }
  }
  const tail = block.slice(start)
  if (tail.trim()) parts.push(tail)
  return parts
}

function parseValue(seg) {
  return seg.trim().replace(/,\s*$/, '').replace(/\s+/g, ' ')
}

// 解析 props：/** jsdoc */ name: { … } 逐项——顶层键分割后逐键解析 type/default/required
function parseProps(block) {
  const out = []
  if (!block) return out
  // 条目正则：JSDoc 可选（无注释的 prop doc = —）
  const re = /(?:\/\*\*([\s\S]*?)\*\/\s*)?([A-Za-z_$][\w$]*)\s*:\s*\{/g
  const entries = []
  let m
  while ((m = re.exec(block))) entries.push({ doc: (m[1] ?? '').trim(), name: m[2], braceStart: m.index + m[0].length - 1, docStart: m.index })
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k]
    const bodyEnd = k + 1 < entries.length ? entries[k + 1].docStart : block.length
    // 剥尾部：prop 自身「}」/ 项间逗号 / 外层「}」/「}）」——反复剥离直到尾部是内容字符
    let body = block.slice(e.braceStart, bodyEnd).replace(/^\{/, '')
    while (/[}\)\s,]+$/.test(body)) body = body.replace(/[}\)\s,]+$/, '')
    body += '\n'
    const keys = { type: '—', default: undefined, required: false }
    for (const part of splitTopLevel(body)) {
      const tm = part.match(/^\s*type:\s*([\s\S]+)$/)
      const dm = part.match(/^\s*default:\s*([\s\S]+)$/)
      const rm = part.match(/^\s*required:\s*([\s\S]+)$/)
      if (tm) keys.type = parseValue(tm[1])
      if (dm) keys.default = parseValue(dm[1])
      if (rm) keys.required = rm[1].trim() === 'true'
    }
    out.push({ name: e.name, doc: (e.doc || '').split('\n')[0] || '—', type: keys.type, default: keys.default, required: keys.required })
  }
  return out
}

function parseEmits(src) {
  const em = src.match(/defineEmits\((\[[\s\S]*?\]|\{[\s\S]*?\})\)/)
  if (!em) return []
  const names = [...em[1].matchAll(/['"`]([a-zA-Z-]+)['"`]/g)].map((x) => x[1])
  return [...new Set(names)]
}

// ★组件 tab 重构：提取组件源码头部的说明注释（「是做什么的」）
// 形态：<!-- <路径> —— <短描述>（批次）\n<设计注记行> -->
function extractComponentDesc(src) {
  const m = src.match(/^<!--[\s\S]*?-->/)
  if (!m) return { short: '', notes: [] }
  const lines = m[0]
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // 首行：路径 —— 短描述（批次）
  const first = lines[0] ?? ''
  let short = first
  const dash = first.indexOf('——')
  if (dash >= 0) short = first.slice(dash + 2).trim()
  // 剥尾部批次括号（内部里程碑编号不对外）+ 剥首部集数编号（E20 等内部序号，与能力页剥 C\d+ 同理）
  short = short.replace(/（[^）]*）\s*$/, '').trim().replace(/^E\d+\s+/, '')
  const notes = lines.slice(1).filter((l) => !l.startsWith('src/components'))
  return { short, notes }
}

// —— ① 组件页 ——
function genComponents(ir, ends) {
  fs.mkdirSync(OUT_COMP, { recursive: true })
  const dirs = fs.readdirSync(COMP_DIR).filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-'))
  const semanticMap = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
  const mpComp = (ir.MP_MAPPING_MATRIX ?? []).filter((i) => i.group === 'component')
  // ★组件 tab 重构：tag → kind（域分类 SSOT = PRIMITIVE_CATALOG）
  const tagKind = {}
  for (const p of ir.PRIMITIVE_CATALOG) if (p.tag) tagKind[p.tag] = p.kind
  const KIND_DOMAIN = { layout: '布局', ui: '内容与表单', shell: '页面外壳', gesture: '手势', engineering: '工程', capability: '能力入口' }
  // ★catalog 外组件的域兜底（W-7：语义登记待补 TAG_SEMANTIC_MAP，分类先行）
  const EXTRA_KIND = {
    'p-error-boundary': 'ui', 'p-loading': 'ui', 'p-skeleton': 'ui', 'p-mask': 'ui',
    'p-popup': 'shell', 'p-toast': 'ui', 'p-toolbar': 'shell', 'p-zone': 'layout',
    'p-aspect': 'layout', 'p-scale': 'ui', 'p-scroll-view': 'layout', 'p-action-sheet': 'shell',
    'p-drawer': 'shell', 'p-modal': 'shell', 'p-popover': 'shell',
  }
  // ★侧栏/总览分组统一域推导：与单页同构（tagKind → 语义前缀 → EXTRA_KIND 兑底）——
  //   旧总览漏了语义前缀层，p-view/p-button 等有语义的基础组件全掉进「—」无分类组
  const DOMAIN_ORDER = ['布局', '内容与表单', '页面外壳', '手势', '工程', '能力入口', '—']
  const domainOf = {}
  for (const dir of dirs) {
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const semantic = semanticMap[dir] ?? null
    const kind = tagKind[dir] ?? (semantic ? semantic.split('.')[0] : null) ?? EXTRA_KIND[dir] ?? '—'
    domainOf[dir] = KIND_DOMAIN[kind] ?? kind
  }
  // order = 域序 × 1000 + 域内字母序（侧栏组按 min(order) 排序 → 域顺序确定，组内字母序）
  const perDomain = {}
  const orderOf = {}
  for (const dir of Object.keys(domainOf).sort()) {
    perDomain[domainOf[dir]] = (perDomain[domainOf[dir]] ?? 0) + 1
    orderOf[dir] = DOMAIN_ORDER.indexOf(domainOf[dir]) * 1000 + perDomain[domainOf[dir]]
  }
  let ok = 0
  const indexRows = []
  for (const dir of dirs) {
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const src = fs.readFileSync(vueFile, 'utf8')
    const props = parseProps(extractCall(src, 'defineProps') ?? '')
    const emits = parseEmits(src)
    const semantic = semanticMap[dir] ?? null
    const domain = domainOf[dir]
    // ★兼容进度表：MP_MAPPING_MATRIX.proteus 存的是语义名（'layout.box / layout.stack'）而非 p-* 目录名——
    //   旧代码 i.proteus === dir 永不命中（小程序等价列全灭），改语义包含匹配
    const mpMatches = semantic ? mpComp.filter((i) => i.proteus.split(' / ').some((s) => s.includes(semantic))) : []
    const mpLabel = (i) => `\`${i.mp}\`（${MP_STATUS_LABEL[i.status] ?? i.status}）`
    const mpText = mpMatches.slice(0, 4).map(mpLabel).join(' · ') + (mpMatches.length > 4 ? ` 等 ${mpMatches.length} 项` : '')
    const mpEquiv = mpMatches.length ? mpText : '—'
    // ★组件 tab 重构：h1 后输出组件自身说明（源码头注释 SSOT），替换千篇一律的通用语
    const desc = extractComponentDesc(src)
    const lines = []
    lines.push('---')
    lines.push(`title: ${dir}`)
    lines.push(`group: ${domain}`)
    lines.push(`order: ${orderOf[dir]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${dir}`)
    lines.push('')
    lines.push(desc.short || '通用语义组件（Layer 0），编译期映射到各端原生控件，业务零平台分支。')
    lines.push('')
    lines.push(`> 语义组件（Layer 0）· 域 **${domain}** · 编译期映射到各端原生控件，业务零平台分支。`)
    lines.push('')
    lines.push('| 语义 | 域 | 小程序等价 |')
    lines.push('|---|---|---|')
    lines.push(`| ${semantic ?? '—'} | ${domain} | ${mpEquiv} |`)
    lines.push('')
    // ★兼容进度（uni-app 式全端对照）：端列/状态 = ENDS 注册表 SSOT，小程序行注入真实映射
    const compRows = []
    for (const end of ends) {
      let note = ''
      switch (end.id) {
        case 'web': note = '双端同源码编译目标（编译期映射 + 事件归一）'; break
        case 'mp-weixin': note = mpMatches.length ? `原生控件映射 → ${mpText}` : 'Proteus 扩展组件——无小程序对应'; break
        case 'headless': note = 'IR 渲染测试档（工具端）'; break
        case 'flutter': note = 'widget 级映射——组件级未验证'; break
        case 'quick-app': note = '端未开始'; break
        default: note = '端原型映射——组件级接线未开始'
      }
      compRows.push({ name: end.name, status: STATUS_MARK[end.status] ?? '⬜', note: `${end.engine} · ${note}` })
    }
    lines.push(...compatSection(compRows, '> 状态口径：✅ 端已落地·本组件可用；🟡 端原型映射·组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。'))
    if (props.length) {
      lines.push('## Props')
      lines.push('')
      lines.push('| Prop | 说明 | 类型 | 默认值 |')
      lines.push('|---|---|---|---|')
      for (const p of props) {
        lines.push(`| \`${p.name}\` | ${p.doc} | \`${p.type}\` | ${p.default ? `\`${p.default}\`` : p.required ? '**必填**' : '—'} |`)
      }
      lines.push('')
    }
    if (emits.length) {
      lines.push('## Events')
      lines.push('')
      lines.push(emits.map((e) => `\`${e}\``).join(' · '))
      lines.push('')
    }
    // ★组件 tab 重构：源码头注释的设计注记 → 「实现要点」段（无则跳过）
    if (desc.notes.length) {
      lines.push('## 实现要点')
      lines.push('')
      for (const n of desc.notes) lines.push(`- ${n}`)
      lines.push('')
    }
    lines.push('## 用法')
    lines.push('')
    lines.push('```vue')
    lines.push(`<${dir}${props[0] ? ` :${props[0].name}="…"` : ''}>`)
    lines.push(`  <p-text>内容</p-text>`)
    lines.push(`</${dir}>`)
    lines.push('```')
    lines.push('')
    lines.push(`<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：src/components/${dir}/index.vue -->`)
    fs.writeFileSync(path.join(OUT_COMP, `${dir}.md`), lines.join('\n'))
    indexRows.push({ dir, props: props.length, emits: emits.length, domain })
    ok++
  }
  // ★组件 tab 重构：总览按语义域分组（域来自与单页同构的统一推导，「—」组已归位）
  const byDomain = {}
  for (const r of indexRows) (byDomain[r.domain] ??= []).push(r)
  const idx = []
  idx.push('---')
  idx.push('title: 组件总览')
  idx.push('group: 总览')
  idx.push('order: 0')
  idx.push('---')
  idx.push('')
  idx.push('# 组件总览')
  idx.push('')
  idx.push(`> ${ok} 个语义组件（${Object.keys(byDomain).length} 域）——props/events 由源码 SSOT 生成（\`website/scripts/gen-content.mjs\`），与框架实现实时一致。`)
  idx.push('')
  for (const domain of Object.keys(byDomain).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))) {
    idx.push(`## ${domain}（${byDomain[domain].length}）`)
    idx.push('')
    idx.push('| 组件 | Props | Events |')
    idx.push('|---|---|---|')
    for (const r of byDomain[domain].sort((a, b) => a.dir.localeCompare(b.dir))) {
      idx.push(`| [${r.dir}](/docs/component/${r.dir}) | ${r.props} | ${r.emits} |`)
    }
    idx.push('')
  }
  fs.writeFileSync(path.join(OUT_COMP, '00-components-overview.md'), idx.join('\n'))
  return ok
}

// —— ② 能力页 ——
function genCapabilities(ir, ends) {
  fs.mkdirSync(OUT_CAP, { recursive: true })
  const caps = ir.PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
  const apiSrc = fs.readFileSync(path.join(ROOT, 'packages', 'api', 'src', 'capability.ts'), 'utf8')
  // ★兼容进度表 SSOT：wxBridge/webBridge 实际实现的方法集（Web 列 ⚠️ = webBridge 未提供 → Err 显式降级）
  const wxKeys = new Set(extractFnKeys(apiSrc, 'wxBridge'))
  const webKeys = new Set(extractFnKeys(apiSrc, 'webBridge'))
  const iface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityHooks'))
  const hookDocs = {}
  // JSDoc 体 tempered 模式：禁止跨 */ 边界（否则从更早的 /** 起配，拼接出跨块垃圾文本——payment 页曾中招）
  const JSDOC = '\\*\\*((?:[^*]|\\*(?!/))*)\\*\\/'
  const re = new RegExp(`${JSDOC}\\s*\\n\\s*(use[A-Z]\\w*|set[A-Z]\\w*)\\(`, 'g')
  let m
  // ★能力页开头说明：接口 JSDoc 多为空，三级兑底——接口 JSDoc → hook 体行注释 → 桥方法 JSDoc（CapabilityBridge 逐方法都有）
  const cleanDoc = (t) => t.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ')
  while ((m = re.exec(iface))) hookDocs[m[2]] = cleanDoc(m[1])
  const hooksBody = apiSrc.slice(apiSrc.indexOf('export function createCapabilityHooks'))
  const reLine = /\/\/\s*(.+?)\s*\n\s*(use[A-Z]\w*|set[A-Z]\w*):/g
  while ((m = reLine.exec(hooksBody))) if (!hookDocs[m[2]]) hookDocs[m[2]] = m[1].trim()
  const bridgeIface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityBridge'), apiSrc.indexOf('export interface CapabilityHooks'))
  const bridgeDocs = {}
  const reBridge = new RegExp(`${JSDOC}\\s*\\n\\s*(\\w+)\\??\\s*\\(`, 'g')
  while ((m = reBridge.exec(bridgeIface))) bridgeDocs[m[2]] = cleanDoc(m[1])
  const keyHits = [...hooksBody.matchAll(/\b(use[A-Z]\w*|set[A-Z]\w*):/g)]
  const hookRefs = {}
  for (let k = 0; k < keyHits.length; k++) {
    const hook = keyHits[k][1]
    const end = k + 1 < keyHits.length ? keyHits[k + 1].index : hooksBody.length
    const refs = [...hooksBody.slice(keyHits[k].index, end).matchAll(/bridge\.(\w+)\(/g)].map((x) => x[1])
    hookRefs[hook] = [...new Set(refs)]
    if (hookDocs[hook]) continue
    const bm = refs[0]
    if (bm && bridgeDocs[bm]) hookDocs[hook] = bridgeDocs[bm].replace(/^C\d+\s+/, '')
  }
  // ★侧栏分组：能力页 frontmatter group/order（order = 类序 × 1000 + 类内 catalog 序）
  const catOf = {}
  for (const c of caps) {
    const slug = c.semantic.replace('capability.', '')
    catOf[c.semantic] = CAP_CATEGORY[slug] ?? '其他'
  }
  const perCat = {}
  const orderOfCap = {}
  for (const c of caps) {
    perCat[catOf[c.semantic]] = (perCat[catOf[c.semantic]] ?? 0) + 1
    orderOfCap[c.semantic] = CAP_CAT_ORDER.indexOf(catOf[c.semantic]) * 1000 + perCat[catOf[c.semantic]]
  }
  let ok = 0
  for (const c of caps) {
    const hook = c.api.replace('()', '')
    const doc = (hookDocs[hook] ?? '').replace(/^C\d+\s+/, '')
    const sigM = iface.match(new RegExp(`${hook}\\([^)]*\\):\\s*[^\\n]+`))
    const lines = []
    lines.push('---')
    lines.push(`title: ${hook}（${c.semantic}）`)
    lines.push(`group: ${catOf[c.semantic]}`)
    lines.push(`order: ${orderOfCap[c.semantic]}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${hook}`)
    lines.push('')
    if (doc) {
      lines.push(doc)
      lines.push('')
    }
    lines.push(`> 能力原语 ${c.id} · \`${c.semantic}\` · 返回 \`${(c.props ?? [])[0] ?? 'Result<T>'}\` · **Hook 已实现**（API 就绪，双端桥见下表）`)
    lines.push('')
    lines.push('## 签名')
    lines.push('')
    lines.push('```ts')
    lines.push(sigM ? sigM[0] : `${c.api} → ${c.props?.[0] ?? 'Result<T>'}`)
    lines.push('```')
    lines.push('')
    // ★兼容进度（uni-app 式全端对照）：端列/状态 = ENDS 注册表；Web 列 ✅/⚠️ 由 webBridge 实际方法集推导
    const refs = hookRefs[hook] ?? []
    const wxMissing = refs.filter((r) => !wxKeys.has(r))
    const webMissing = refs.filter((r) => !webKeys.has(r))
    const capRows = []
    for (const end of ends) {
      let status = STATUS_MARK[end.status] ?? '⬜'
      let note = ''
      switch (end.id) {
        case 'mp-weixin':
          status = wxMissing.length ? '⚠️' : '✅'
          note = wxMissing.length ? `wx 桥未提供 ${wxMissing.join('/')} → Err 显式降级` : `wx 桥 → ${c.mpEquiv}`
          break
        case 'web':
          if (!refs.length) {
            note = 'webBridge 平台桥（wx 缺席时默认注入）'
          } else if (webMissing.length) {
            status = '⚠️'
            note = `webBridge 未提供 ${webMissing.join('/')} → Err 显式降级（平台无直通 API）`
          } else {
            note = 'webBridge 实现（平台 API 直连）'
          }
          break
        case 'headless': note = 'mock 桥注入（测试 / SSR 档）'; break
        case 'flutter': note = '同一 JS 逻辑层——能力桥未接线'; break
        case 'quick-app': note = '端未开始'; break
        default: note = '端原型映射——能力桥未接线'
      }
      capRows.push({ name: end.name, status, note: `${end.engine} · ${note}` })
    }
    lines.push(...compatSection(capRows, '> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。'))
    lines.push('> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。')
    lines.push('')
    lines.push('## 用法')
    lines.push('')
    lines.push('```ts')
    lines.push(`const res = await ${c.api}`)
    lines.push('')
    lines.push('if (res.ok) {')
    lines.push('  console.log(res.data)')
    lines.push("} else if (res.error.code.endsWith('.unsupported')) {")
    lines.push('  // 平台不支持 → 降级路径')
    lines.push('}')
    lines.push('```')
    lines.push('')
    lines.push('<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    fs.writeFileSync(path.join(OUT_CAP, `${c.semantic.replace('capability.', '')}.md`), lines.join('\n'))
    ok++
  }
  const idx = []
  idx.push('---')
  idx.push('title: 能力总览')
  idx.push('group: 总览')
  idx.push('order: 0')
  idx.push('---')
  idx.push('')
  idx.push('# 能力总览')
  idx.push('')
  idx.push(`> ${caps.length} 个能力原语——SSOT = \`PRIMITIVE_CATALOG\`（capability kind）+ \`CapabilityHooks\` 接口。**Hook 全部已实现**（API 就绪，双端桥/降级见各页兼容进度表）`)
  idx.push('')
  // ★能力总览按类别分组（与侧栏分组同构，#403）
  const byCat = {}
  for (const c of caps) (byCat[catOf[c.semantic]] ??= []).push(c)
  for (const cat of Object.keys(byCat).sort((a, b) => CAP_CAT_ORDER.indexOf(a) - CAP_CAT_ORDER.indexOf(b))) {
    idx.push(`## ${cat}（${byCat[cat].length}）`)
    idx.push('')
    idx.push('| # | 能力 | API | 返回 | 小程序等价 |')
    idx.push('|---|---|---|---|---|')
    for (const c of byCat[cat]) {
      const slug = c.semantic.replace('capability.', '')
      idx.push(`| ${c.id} | [${c.semantic}](/docs/capability/${slug}) | \`${c.api}\` | \`${(c.props ?? [])[0] ?? '—'}\` | ${c.mpEquiv} |`)
    }
    idx.push('')
  }
  fs.writeFileSync(path.join(OUT_CAP, '00-capabilities-overview.md'), idx.join('\n'))
  return ok
}

// —— main ——
const ir = await loadIr()
const ends = await loadEnds()
const nComp = genComponents(ir, ends)
const nCap = genCapabilities(ir, ends)
console.log(`generated: components ${nComp} · capabilities ${nCap}`)
