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

// —— ① 组件页 ——
function genComponents(ir) {
  fs.mkdirSync(OUT_COMP, { recursive: true })
  const dirs = fs.readdirSync(COMP_DIR).filter((d) => fs.statSync(path.join(COMP_DIR, d)).isDirectory() && d.startsWith('p-'))
  const semanticMap = ir.TAG_SEMANTIC_MAP ?? ir.SEMANTIC_TAG_MAP ?? {}
  const mpComp = (ir.MP_MAPPING_MATRIX ?? []).filter((i) => i.group === 'component')
  let ok = 0
  const indexRows = []
  for (const dir of dirs) {
    const vueFile = path.join(COMP_DIR, dir, 'index.vue')
    if (!fs.existsSync(vueFile)) continue
    const src = fs.readFileSync(vueFile, 'utf8')
    const props = parseProps(extractCall(src, 'defineProps') ?? '')
    const emits = parseEmits(src)
    const semantic = semanticMap[dir] ?? '—'
    const mpRow = mpComp.find((i) => i.proteus === dir)
    const mpEquiv = mpRow ? `${mpRow.mp}（${mpRow.status}）` : '—'
    const lines = []
    lines.push('---')
    lines.push(`title: ${dir}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${dir}`)
    lines.push('')
    lines.push('> 语义组件（Layer 0）——编译期映射到各端原生控件，业务零平台分支。')
    lines.push('')
    lines.push('| 语义 | 小程序等价 |')
    lines.push('|---|---|')
    lines.push(`| \`${semantic}\` | ${mpEquiv} |`)
    lines.push('')
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
    indexRows.push({ dir, props: props.length, emits: emits.length })
    ok++
  }
  // 总览页
  const idx = []
  idx.push('---')
  idx.push('title: 组件总览')
  idx.push('---')
  idx.push('')
  idx.push('# 组件总览')
  idx.push('')
  idx.push(`> ${ok} 个语义组件——props/events 由源码 SSOT 生成（\`website/scripts/gen-content.mjs\`），与框架实现实时一致。`)
  idx.push('')
  idx.push('| 组件 | Props | Events |')
  idx.push('|---|---|---|')
  for (const r of indexRows.sort((a, b) => a.dir.localeCompare(b.dir))) idx.push(`| [${r.dir}](/docs/component/${r.dir}) | ${r.props} | ${r.emits} |`)
  idx.push('')
  fs.writeFileSync(path.join(OUT_COMP, '00-components-overview.md'), idx.join('\n'))
  return ok
}

// —— ② 能力页 ——
function genCapabilities(ir) {
  fs.mkdirSync(OUT_CAP, { recursive: true })
  const caps = ir.PRIMITIVE_CATALOG.filter((p) => p.kind === 'capability')
  const apiSrc = fs.readFileSync(path.join(ROOT, 'packages', 'api', 'src', 'capability.ts'), 'utf8')
  const iface = apiSrc.slice(apiSrc.indexOf('export interface CapabilityHooks'))
  const hookDocs = {}
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n\s*(use[A-Z]\w*|set[A-Z]\w*)\(/g
  let m
  while ((m = re.exec(iface))) hookDocs[m[2]] = m[1].trim()
  let ok = 0
  for (const c of caps) {
    const hook = c.api.replace('()', '')
    const doc = hookDocs[hook] ?? ''
    const sigM = iface.match(new RegExp(`${hook}\\([^)]*\\):\\s*[^\\n]+`))
    const lines = []
    lines.push('---')
    lines.push(`title: ${hook}（${c.semantic}）`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${hook}`)
    lines.push('')
    lines.push(`> 能力原语 ${c.id} · \`${c.semantic}\` · 返回 \`${(c.props ?? [])[0] ?? 'Result<T>'}\` · 状态 ${c.status === 'implemented' ? '✅ 已实现' : '📋 规划中'}`)
    lines.push('')
    if (doc) {
      lines.push(doc)
      lines.push('')
    }
    lines.push('## 签名')
    lines.push('')
    lines.push('```ts')
    lines.push(sigM ? sigM[0] : `${c.api} → ${c.props?.[0] ?? 'Result<T>'}`)
    lines.push('```')
    lines.push('')
    lines.push('## 平台等价')
    lines.push('')
    lines.push('| 端 | 等价物 |')
    lines.push('|---|---|')
    lines.push(`| 小程序 | ${c.mpEquiv} |`)
    lines.push(`| Web | 平台桥（wx 缺席时 webBridge 实现；不支持 → \`Err('${c.semantic}.unsupported')\`） |`)
    lines.push('')
    lines.push('> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。')
    lines.push('')
    lines.push('<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->')
    fs.writeFileSync(path.join(OUT_CAP, `${c.semantic.replace('capability.', '')}.md`), lines.join('\n'))
    ok++
  }
  const idx = []
  idx.push('---')
  idx.push('title: 能力总览')
  idx.push('---')
  idx.push('')
  idx.push('# 能力总览')
  idx.push('')
  idx.push(`> ${caps.length} 个能力原语——SSOT = \`PRIMITIVE_CATALOG\`（capability kind），签名取自 \`CapabilityHooks\` 接口。✅ ${caps.filter((c) => c.status === 'implemented').length} · 📋 ${caps.filter((c) => c.status !== 'implemented').length}`)
  idx.push('')
  idx.push('| # | 能力 | API | 返回 | 小程序等价 | 状态 |')
  idx.push('|---|---|---|---|---|---|')
  for (const c of caps) {
    const slug = c.semantic.replace('capability.', '')
    idx.push(`| ${c.id} | [${c.semantic}](/docs/capability/${slug}) | \`${c.api}\` | \`${(c.props ?? [])[0] ?? '—'}\` | ${c.mpEquiv} | ${c.status === 'implemented' ? '✅' : '📋'} |`)
  }
  idx.push('')
  fs.writeFileSync(path.join(OUT_CAP, '00-capabilities-overview.md'), idx.join('\n'))
  return ok
}

// —— main ——
const ir = await loadIr()
const nComp = genComponents(ir)
const nCap = genCapabilities(ir)
console.log(`generated: components ${nComp} · capabilities ${nCap}`)
