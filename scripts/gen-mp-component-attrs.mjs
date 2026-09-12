// scripts/gen-mp-component-attrs.mjs —— 官方组件**属性级**清单（权威标尺下沉）
//   背景：miniprogram-official-spec.json 只到「组件名级」（84 个名字）→ 无法回答
//   「我们的 p-button 覆盖了官方 button 的哪些属性」。本脚本从官方组件文档页抓属性表，
//   产出 docs/generated/miniprogram-component-attrs.json（组件 → [{name,type,desc}]）。
//   用法：node scripts/gen-mp-component-attrs.mjs [--limit N] [--only tag1,tag2]
//   注：官方页需网络；离线时保留已存快照中已抓到的部分（不删旧）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = path.join(ROOT, 'docs/generated/miniprogram-official-spec.json')
const OUT = path.join(ROOT, 'docs/generated/miniprogram-component-attrs.json')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',') : null

const components = JSON.parse(fs.readFileSync(SPEC, 'utf8')).components
const targets = only ?? components

/** 从官方组件文档 HTML 抽属性行（跳过合法值子表：children-table 行内层不再匹配顶层 td 模式） */
function extractAttrs(html) {
  const out = []
  const seen = new Set()
  // ★两种官方表结构都要兼容：
  //   ① 带展开子表（button/input/textarea）：<tr class="have-children-tr"><td><i ..></i></td><td>name</td>...
  //   ② 普通表（switch/slider/progress…）：<tr><td>name</td><td>type</td>...
  //   统一：按 <tr> 拆行 → 取该行所有 <td> 文本 → 若形如 [name, type, default, 必填(是|否), desc, ...] 即属性行。
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    )
    // 去空单元格（展开按钮 <i> 那格）
    const cells = tds.filter((t) => t !== '')
    if (cells.length < 3) continue
    const name = cells[0]
    // 属性名：小写字母/数字/连字符（含 bind:/catch: 事件，如 bind:message）
    if (!/^[a-z][a-z0-9:-]*$/.test(name)) continue
    // ★动态定位「必填」列（官方表列数不一：有的含「默认值」列，有的不含 → 不能假定位置）
    const reqIdx = cells.findIndex((c) => c === '是' || c === '否')
    if (reqIdx < 1) continue
    const type = cells[1] || ''
    const desc = (cells[reqIdx + 1] ?? '').slice(0, 120)
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, type, required: cells[reqIdx] === '是', desc })
  }
  return out
}

const result = {}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).components ?? {} : {}
let ok = 0, fail = 0

for (const tag of targets) {
  try {
    const res = await fetch(`https://developers.weixin.qq.com/miniprogram/dev/component/${tag}.html`, {
      headers: { 'user-agent': 'Mozilla/5.0 (proteus-spec-gen)' },
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const attrs = extractAttrs(await res.text())
    if (attrs.length) { result[tag] = attrs; ok++ }
    else if (prev[tag]) result[tag] = prev[tag]
    console.log(`  ${tag}: ${attrs.length} 属性`)
  } catch (e) {
    fail++
    if (prev[tag]) result[tag] = prev[tag]
    console.warn(`  ${tag}: 抓取失败（${e.message}）`)
  }
}
// 保留未在本次 targets 内、但快照已有的组件
for (const [tag, attrs] of Object.entries(prev)) if (!(tag in result)) result[tag] = attrs

const sorted = {}
for (const k of Object.keys(result).sort()) sorted[k] = result[k]
fs.writeFileSync(OUT, JSON.stringify({
  _comment: '微信小程序官方组件**属性级**清单快照——由 scripts/gen-mp-component-attrs.mjs 从官方文档抓取，勿手改。',
  source: 'https://developers.weixin.qq.com/miniprogram/dev/component/<tag>.html',
  componentCount: Object.keys(sorted).length,
  attrTotal: Object.values(sorted).reduce((n, a) => n + a.length, 0),
  components: sorted,
}, null, 1) + '\n')
console.log(`\n[gen-mp-component-attrs] ${Object.keys(sorted).length} 组件 / ${Object.values(sorted).reduce((n,a)=>n+a.length,0)} 属性（本次 ok ${ok} / fail ${fail}）→ ${path.relative(ROOT, OUT)}`)
