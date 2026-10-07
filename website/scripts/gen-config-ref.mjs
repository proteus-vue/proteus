// website/scripts/gen-config-ref.mjs —— ★配置参考页生成器（从类型 SSOT 生成逐字段参考，决策 #641）
//
// 【为什么需要（用户 2026-10-08）】「文档细粒度不够，很多字段配置没有单独详细说明，而且没做锚点导航，
//   不符合大厂标准」。⇒ 生成一页**逐字段参考**：每个字段一个 `###`/`####` 标题（docs 引擎按标题
//   生成锚点 → 右侧 TOC / 可跳转 / 可搜索），字段说明取自类型上的 JSDoc（**单一事实来源**）。
//
// 【SSOT = `packages/types/src/config.ts`】结构（字段名 / 可选 / 类型）+ 说明（JSDoc）全部来自该文件——
//   用 **TypeScript 编译器 API** 解析（比正则稳：正确处理嵌套对象类型、多行 JSDoc、联合类型）。
//   字段增删改 → 重跑本生成器即同步（`--check` 防漂移，CI 红）。
//
// 【双语】结构骨架 zh/en 同源推导（heading/代码围栏计数一致——check:en-drift 门禁）；文案来自
//   `gen-config-ref-en.mjs`（数据模块，与 gen-primitives-en 同法）。未登记的 EN 字段回落中文。
//
// 用法：node scripts/gen-config-ref.mjs [--check]（--check 漂移检测：不一致 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { PAGE_EN, SECTION_EN, FIELD_EN } from './gen-config-ref-en.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '..')
const OUT = path.join(ROOT, 'content', 'reference', 'config.md')
const OUT_EN = path.join(ROOT, 'en', 'reference', 'config.md')
const check = process.argv.includes('--check')

const requireFromRepo = createRequire(path.join(REPO, 'package.json'))
const ts = requireFromRepo('typescript')

/* ── ① 解析 config.ts（TypeScript 编译器 API → 接口 → 字段[名/可选/类型/JSDoc/嵌套]） ── */
function parseConfigInterfaces() {
  const file = path.join(REPO, 'packages', 'types', 'src', 'config.ts')
  const src = fs.readFileSync(file, 'utf-8')
  const sf = ts.createSourceFile('config.ts', src, ts.ScriptTarget.Latest, true)
  const interfaces = {}

  const jsDocText = (node) => {
    const docs = ts.getJSDocCommentsAndTags(node) ?? []
    const parts = []
    for (const d of docs) {
      const c = d.comment
      if (typeof c === 'string') parts.push(c)
      else if (Array.isArray(c)) for (const x of c) parts.push(typeof x === 'string' ? x : (x.text ?? ''))
    }
    return parts.join(' ').replace(/\s+/g, ' ').replace(/^★\s*/, '').trim()
  }

  const parseMembers = (members) => {
    const fields = []
    for (const m of members) {
      if (!ts.isPropertySignature(m) || !m.name) continue
      const name = m.name.getText(sf)
      const optional = !!m.questionToken
      // ★类型文本：剥掉内联 JSDoc 注释（对象字面量里的 /** … */ 会污染显示，如 usedScene 的 inline 类型）
      const typeText = (m.type ? m.type.getText(sf) : 'any').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
      const doc = jsDocText(m)
      let nested = null
      if (m.type && ts.isTypeLiteralNode(m.type)) nested = parseMembers(m.type.members)
      fields.push({ name, optional, type: typeText, doc, nested })
    }
    return fields
  }

  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st)) interfaces[st.name.text] = { doc: jsDocText(st), fields: parseMembers(st.members) }
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

/* ── ③ 渲染 ── */
function renderField(lines, field, prefix, lang, interfaces, depth = 0) {
  const full = prefix + field.name
  const colon = lang === 'zh' ? '：' : ': '
  const opt = field.optional ? (lang === 'zh' ? '否' : 'No') : lang === 'zh' ? '是' : 'Yes'
  const typeLabel = lang === 'zh' ? '类型' : 'Type'
  const reqLabel = lang === 'zh' ? '必填' : 'Required'
  lines.push(`### \`${full}\``)
  lines.push('')
  lines.push(`- **${typeLabel}**${colon}\`${field.type}\``)
  lines.push(`- **${reqLabel}**${colon}${opt}`)
  lines.push('')
  const doc = (lang === 'en' ? FIELD_EN[full] : undefined) ?? field.doc
  if (doc) lines.push(doc, '')
  if (field.nested) {
    for (const sub of field.nested) renderField(lines, sub, full + '.', lang, interfaces, depth + 1)
  }
  // ★引用的辅助接口（如 `Array<string | AndroidPermission>` 里的 AndroidPermission）→ 展开成嵌套条目
  if (depth < 2 && interfaces) {
    for (const ref of helperRefsOf(field.type)) {
      const helper = interfaces[ref]
      if (!helper) continue
      for (const sub of helper.fields) renderField(lines, sub, `${full}.<entry>.`, lang, interfaces, 2)
    }
  }
}

/** 从字段类型文本里挑出「已知辅助接口」引用（成员类型展开用） */
function helperRefsOf(typeText) {
  const out = []
  for (const m of typeText.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (HELPER_INTERFACES.has(m[0])) out.push(m[0])
  }
  return out
}

/** 需要展开的辅助条目接口（非顶层端点，用于方法/权限等数组元素形状） */
const HELPER_INTERFACES = new Set(['AndroidPermission', 'AndroidUsesFeature', 'HarmonyPermission'])

function render(lang, interfaces) {
  const t = lang === 'zh' ? PAGE_EN.zh : PAGE_EN.en
  const lines = []
  lines.push('---')
  lines.push(`title: ${t.title}`)
  lines.push(`order: ${PAGE_EN.order}`)
  lines.push(`group: ${PAGE_EN.group}`)
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
  lines.push(`<!-- generated by website/scripts/gen-config-ref.mjs · SSOT：packages/types/src/config.ts（ProteusConfig + 目标端接口） -->`)
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
      console.error(`DRIFT: ${label} 与源（packages/types/src/config.ts）不一致——运行 pnpm gen:config-ref 并提交`)
    }
  }
  if (drift) process.exit(1)
  console.log(`OK: 配置参考页与类型源一致（${SECTIONS.length} 分区）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.mkdirSync(path.dirname(OUT_EN), { recursive: true })
  fs.writeFileSync(OUT, zh)
  fs.writeFileSync(OUT_EN, en)
  console.log(`generated: content/reference/config.md + en/reference/config.md（${SECTIONS.length} 分区）`)
}
