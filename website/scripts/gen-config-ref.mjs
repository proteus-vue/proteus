// website/scripts/gen-config-ref.mjs —— ★配置参考页生成器（从类型 SSOT 生成逐字段参考，决策 #641/#642/#646）
//
// 【为什么需要（用户 2026-10-08）】「文档细粒度不够，很多字段没有单独详细说明，也没做锚点导航，不符合大厂标准」。
//   ⇒ 生成一页**逐字段参考**：每个字段一个标题（docs 引擎按标题生成锚点 → 右侧 TOC / 可跳转 / 可搜索），
//   字段说明取自类型上的 JSDoc（**单一事实来源**）。
//
// 【SSOT = packages/types/src 的多个类型文件】结构（字段名 / 可选 / 类型）+ 说明（JSDoc）全部来自类型源码——
//   用 **TypeScript 编译器 API** 解析（比正则稳：正确处理嵌套对象类型、多行 JSDoc、联合类型）。
//   · config.ts（ProteusConfig + 目标端接口 + 权限/特性条目）
//   · router-config.ts（RouterSection 等——router 字段的类型，跨文件引用）
//   · compiler-types.ts（TransformRuleOverrides——targets.mp.rules 的类型）
//   ★被引用的具名接口**一律展开为嵌套条目**（如 `RouterSection` → `router.routesOutput`；`Array<X>` → `X.<entry>.`），
//     否则读者只看到类型名、看不到子字段（用户点名「RouterSection 没有说明」）。
//
// 【大厂形态（#646 细节完善）】每字段：类型 / 必填 / 说明 + **可跳转超链（See also）** + 组级 runnable 示例；
//   说明缺失即留空（不编造）。字段增删改 → 重跑本生成器即同步（`--check` 防漂移，CI 红）。
//
// 【双语】结构骨架 zh/en 同源推导（heading/代码围栏计数一致——check:en-drift 门禁）；文案来自
//   `gen-config-ref-en.mjs`（数据模块，与 gen-primitives-en 同法）。未登记的 EN 字段回落中文（但会去 ★）。
//
// 用法：node scripts/gen-config-ref.mjs [--check]（--check 漂移检测：不一致 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { PAGE_EN, SECTION_EN, FIELD_EN, SEE_ALSO, EXAMPLE } from './gen-config-ref-en.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '..')
const OUT = path.join(ROOT, 'content', 'reference', 'config.md')
const OUT_EN = path.join(ROOT, 'en', 'reference', 'config.md')
const check = process.argv.includes('--check')

const requireFromRepo = createRequire(path.join(REPO, 'package.json'))
const ts = requireFromRepo('typescript')

/** 解析源：多个类型文件（跨文件引用如 RouterSection / TransformRuleOverrides 才解析得到） */
const SOURCE_FILES = [
  'packages/types/src/config.ts',
  'packages/types/src/router-config.ts',
  'packages/types/src/compiler-types.ts',
]

/* ── ① 解析类型源（TypeScript 编译器 API → 接口 → 字段[名/可选/类型/JSDoc/嵌套]） ── */
function parseConfigInterfaces() {
  const interfaces = {}

  // ★读「紧邻其上的整段注释原文」——**不用** ts.getJSDocCommentsAndTags（它把 `@media`/`@keyframes`/`@xml/...`
  //   当作 JSDoc 标签，注释会在这些 `@` 处被**截断**，实测把 audit 的说明砍成半句）。原文读取后剥注释壳。
  const jsDocText = (node, sf) => {
    const full = sf.getFullText()
    let end = node.getFullStart()
    // 跳过 node 与注释之间的空白
    while (end < node.getStart(sf) && /\s/.test(full[end])) end++
    const lead = full.slice(node.getFullStart(), node.getStart(sf))
    const m = lead.match(/\/\*\*([\s\S]*?)\*\/\s*$/)
    if (!m) return ''
    return m[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
      .filter((l) => l && !/^packages\//.test(l) && !/^[=—\-·\s]+$/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^★\s*/, '')
      .trim()
  }

  const parseMembers = (members, sf) => {
    const fields = []
    for (const m of members) {
      if (!ts.isPropertySignature(m) || !m.name) continue
      const name = m.name.getText(sf)
      const optional = !!m.questionToken
      // ★类型文本：剥掉内联 JSDoc 注释（对象字面量里的 /** … */ 会污染显示，如 usedScene 的 inline 类型）
      const typeText = (m.type ? m.type.getText(sf) : 'any').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
      const doc = jsDocText(m, sf)
      let nested = null
      let arrayElem = false
      if (m.type && ts.isTypeLiteralNode(m.type)) {
        nested = parseMembers(m.type.members, sf)
      } else {
        // ★内联数组元素类型字面量（`Array<{ … }>` = TypeReferenceNode；`{…}[]` = ArrayTypeNode）——
        //   非此分支则其子字段**永不展开**（如 `tabBar.list` 的 name/text/icon 此前缺失）。
        let elem = null
        if (ts.isArrayTypeNode(m.type) && ts.isTypeLiteralNode(m.type.elementType)) elem = m.type.elementType
        else if (
          ts.isTypeReferenceNode(m.type) &&
          m.type.typeName?.getText(sf) === 'Array' &&
          m.type.typeArguments?.length === 1 &&
          ts.isTypeLiteralNode(m.type.typeArguments[0])
        ) elem = m.type.typeArguments[0]
        if (elem) {
          nested = parseMembers(elem.members, sf)
          arrayElem = true
        }
      }
      fields.push({ name, optional, type: typeText, doc, nested, arrayElem })
    }
    return fields
  }

  for (const rel of SOURCE_FILES) {
    const file = path.join(REPO, rel)
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf-8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st)) interfaces[st.name.text] = { doc: jsDocText(st, sf), fields: parseMembers(st.members, sf) }
    }
  }
  return interfaces
}

/* ── ② 页面分区（逻辑分组 → 接口 + 字段路径前缀） ── */
const SECTIONS = [
  { key: 'top', zh: '顶层字段（跨端共享）', en: 'Top-level fields (cross-target shared)', iface: 'ProteusConfig', prefix: '' },
  { key: 'web', zh: '目标端 · Web', en: 'Target · Web', iface: 'WebTargetConfig', prefix: 'targets.web.' },
  { key: 'mp', zh: '目标端 · 小程序 mp', en: 'Target · Mini Program (mp)', iface: 'MpTargetConfig', prefix: 'targets.mp.' },
  { key: 'ios', zh: '目标端 · iOS', en: 'Target · iOS', iface: 'IosTargetConfig', prefix: 'targets.ios.' },
  { key: 'android', zh: '目标端 · Android', en: 'Target · Android', iface: 'AndroidTargetConfig', prefix: 'targets.android.' },
  { key: 'harmony', zh: '目标端 · 鸿蒙', en: 'Target · HarmonyOS', iface: 'HarmonyTargetConfig', prefix: 'targets.harmony.' },
  { key: 'app', zh: '共享身份 app', en: 'Shared identity · app', iface: 'AppIdentityConfig', prefix: 'app.' },
]

/**
 * ★需要展开为嵌套条目的具名接口（引用的对象/数组元素类型）——不在此列则只显示类型名。
 *   注意：**已有独立分区的接口**（AppIdentityConfig / ProteusTargets / 各 TargetConfig）不列入
 *   （否则与下方小节重复）；`RouteMeta` 字段极多，暂不展开（留待需要时补）。
 */
const EXPANDABLE = new Set([
  // router 段（跨文件：router-config.ts）
  'RouterSection',
  'SubPackageDecl',
  'CustomRouteConfig',
  // 顶层（config.ts）
  'AuditConfig',
  'GatesConfig',
  // rules（跨文件：compiler-types.ts）
  'TransformRuleOverrides',
  // 权限/特性条目（config.ts）
  'AndroidPermission',
  'AndroidUsesFeature',
  'HarmonyPermission',
])

/** 从字段类型文本里挑出「可展开的具名接口」引用（成员类型展开用） */
function helperRefsOf(typeText) {
  const out = []
  for (const m of typeText.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (EXPANDABLE.has(m[0])) out.push(m[0])
  }
  return out
}

/** 是否为数组类型（决定展开路径用 `<entry>.` 还是直接 `.`） */
function isArrayType(typeText) {
  return /\bArray</.test(typeText) || /\[\]/.test(typeText)
}

/** 相关链接查找：先精确，再逐级去掉末尾段（子字段继承组级 See also） */
function seeAlsoFor(full) {
  if (SEE_ALSO[full]) return SEE_ALSO[full]
  const segs = full.split('.')
  for (let i = segs.length - 1; i > 0; i--) {
    const key = segs.slice(0, i).join('.')
    if (SEE_ALSO[key]) return SEE_ALSO[key]
  }
  return null
}

/* ── ③ 渲染 ── */
/** ★-段落实例（渲染期记录；`--check` 有则报红——防「空了好大一部分」回归） */
const BLANK_FIELDS = { zh: [], en: [] }

function renderField(lines, field, prefix, lang, interfaces, depth = 0) {
  const full = prefix + field.name
  const colon = lang === 'zh' ? '：' : ': '
  const opt = field.optional ? (lang === 'zh' ? '否' : 'No') : lang === 'zh' ? '是' : 'Yes'
  const typeLabel = lang === 'zh' ? '类型' : 'Type'
  const reqLabel = lang === 'zh' ? '必填' : 'Required'
  const seeLabel = lang === 'zh' ? '相关' : 'See also'
  lines.push(`### \`${full}\``)
  lines.push('')
  lines.push(`- **${typeLabel}**${colon}\`${field.type}\``)
  lines.push(`- **${reqLabel}**${colon}${opt}`)
  lines.push('')
  let doc = (lang === 'en' ? FIELD_EN[full] : undefined) ?? field.doc
  if (lang === 'en' && doc) doc = doc.replace(/★/g, '').replace(/\s+/g, ' ').trim() // EN：去 ★ 标记
  if (doc) lines.push(doc, '')
  else if (!field.nested && !helperRefsOf(field.type).some((r) => interfaces?.[r]) && !EXAMPLE[full]) {
    // ★「空段落」防线（用户 2026-10-08「app 和下面的类型说明空了好大一部分」）：既无说明、也无子字段/示例的叶子
    //   → 记录（--check 时报红）——保证每个字段至少有一句含义（大厂参考页无空白条目）。
    BLANK_FIELDS[lang].push(full)
  }
  // ★组级 runnable 示例（大厂参考页常见：一个可复制片段）
  const example = EXAMPLE[full]
  if (example) {
    lines.push('```ts')
    lines.push(lang === 'en' ? (example.en ?? example.zh) : example.zh)
    lines.push('```')
    lines.push('')
  }
  // ★相关超链（See also）——真实站内页（受 check:doc-links 门禁）。
  //   仅在「本字段有专属链接」或「顶层组字段（depth 0，继承组链接）」时输出，避免每个叶子重复刷屏。
  const links = SEE_ALSO[full] ?? (depth === 0 ? seeAlsoFor(full) : null)
  if (links && links.length) {
    const rendered = links.map((l) => `[${lang === 'en' ? (l.en ?? l.zh) : l.zh}](${l.url})`)
    lines.push(`- **${seeLabel}**${colon}${rendered.join(' · ')}`)
    lines.push('')
  }
  if (field.nested) {
    // 内联数组元素类型（Array<{…}>）用 `<entry>.` 语义；普通对象类型用 `.`
    const sep = field.arrayElem ? '.<entry>.' : '.'
    for (const sub of field.nested) renderField(lines, sub, full + sep, lang, interfaces, depth + 1)
  }
  // ★引用的具名接口 → 展开为嵌套条目（数组类型用 `<entry>.` 语义，对象类型直接 `.`）。
  //   深度上限放宽到 3：`router`(0) 的 `RouterSection` 成员(2) 还要再展开 `SubPackageDecl`(3)。
  if (depth < 3 && interfaces) {
    for (const ref of helperRefsOf(field.type)) {
      const helper = interfaces[ref]
      if (!helper) continue
      const sub = isArrayType(field.type) ? `${full}.<entry>.` : `${full}.`
      for (const f of helper.fields) renderField(lines, f, sub, lang, interfaces, depth + 2)
    }
  }
}

function render(lang, interfaces) {
  const t = lang === 'zh' ? PAGE_EN.zh : PAGE_EN.en
  const colon = lang === 'zh' ? '：' : ': '
  const lines = []
  lines.push('---')
  lines.push(`title: ${t.title}`)
  lines.push(`order: ${PAGE_EN.order}`)
  lines.push(`group: ${lang === 'en' ? (PAGE_EN.groupEn ?? PAGE_EN.group) : PAGE_EN.group}`)
  lines.push('generated: true')
  lines.push('---')
  lines.push('')
  lines.push(`# ${t.title}`)
  lines.push('')
  lines.push(t.lede)
  lines.push('')
  lines.push('```ts')
  lines.push(t.example)
  lines.push('```')
  lines.push('')
  for (const sec of SECTIONS) {
    const iface = interfaces[sec.iface]
    if (!iface || !iface.fields.length) continue
    lines.push(`## ${lang === 'zh' ? sec.zh : (SECTION_EN[sec.key] ?? sec.zh)}`)
    lines.push('')
    if (lang === 'zh' && sec.key === 'top') {
      lines.push('> 目标端是一级键 `targets.{web,mp,ios,android,harmony}`；各端配置见下方对应小节。')
      lines.push('')
    }
    for (const f of iface.fields) renderField(lines, f, sec.prefix, lang, interfaces, 0)
  }
  lines.push(`<!-- generated by website/scripts/gen-config-ref.mjs · SSOT${colon}packages/types/src/{config,router-config,compiler-types}.ts -->`)
  return lines.join('\n')
}

/* ── main ── */
const interfaces = parseConfigInterfaces()
const zh = render('zh', interfaces)
const en = render('en', interfaces)

if (check) {
  let drift = 0
  for (const [p, md, label] of [[OUT, zh, 'content/reference/config.md'], [OUT_EN, en, 'en/reference/config.md']]) {
    const committed = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    if (committed !== md) {
      drift++
      console.error(`DRIFT: ${label} 与类型源不一致——运行 pnpm gen:config-ref 并提交`)
    }
  }
  // ★空段落门禁（防「空了好大一部分」回归）：每个字段至少要有一句说明/子字段/示例
  for (const lang of ['zh', 'en']) {
    if (BLANK_FIELDS[lang].length) {
      drift++
      console.error(`❌ ${lang} 参考页有 ${BLANK_FIELDS[lang].length} 个字段「无任何说明」（补 JSDoc 或 FIELD_EN 后重跑）：${BLANK_FIELDS[lang].join(', ')}`)
    }
  }
  if (drift) process.exit(1)
  console.log(`OK: 配置参考页与类型源一致（${SECTIONS.length} 分区 · 零空字段）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.mkdirSync(path.dirname(OUT_EN), { recursive: true })
  fs.writeFileSync(OUT, zh)
  fs.writeFileSync(OUT_EN, en)
  console.log(`generated: content/reference/config.md + en/reference/config.md（${SECTIONS.length} 分区）`)
}
