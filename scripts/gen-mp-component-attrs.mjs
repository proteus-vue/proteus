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
/** ★属性作用域过滤（2026-09-16 标尺精度修复）——组件自身的属性只位于四类 h2 区块内：
 *   「通用属性 / 属性说明」+ 渲染器特有「Skyline 特有属性 / WebView 特有属性」（三者都是**组件属性**，
 *   只是生效渲染器不同，本项目目标含 Skyline，故全计）。
 *   其余区块是**子对象 schema**，例如 map 的 marker/polyline/polygon/circle/control/position（描述
 *   markers 数组元素的字段）、rich-text 的 node/text（描述 nodes 元素的字段）——它们**不是组件属性**。
 *   此前全页扫描把子对象字段一并计入（map 18 项 / rich-text 4 项）→ 制造虚假缺口，且会诱导把端私有
 *   结构固化成框架语义（违反 G-31 铁律「禁止把平台私有形态上升为框架标准」）。 */
const ATTR_SECTION = /^(通用属性|属性说明|Skyline 特有属性|WebView 特有属性)$/
function attrScopedHtml(html) {
  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
  let scoped = ''
  for (let i = 0; i < heads.length; i++) {
    const title = heads[i][1].replace(/<[^>]+>/g, '').trim().replace(/^#/, '').trim()
    if (!ATTR_SECTION.test(title)) continue
    const start = heads[i].index + heads[i][0].length
    const end = i + 1 < heads.length ? heads[i + 1].index : html.length
    scoped += html.slice(start, end)
  }
  return scoped
}

function extractAttrs(html) {
  const out = []
  const seen = new Set()
  // ★两种官方表结构都要兼容：
  //   ① 带展开子表（button/input/textarea）：<tr class="have-children-tr"><td><i ..></i></td><td>name</td>...
  //   ② 普通表（switch/slider/progress…）：<tr><td>name</td><td>type</td>...
  // 统一：按 <tr> 拆行 → 取该行所有 <td> 文本 → 若形如 [name, type, default, 必填(是|否), desc, ...] 即属性行。
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
    const raw = await res.text()
    // ★区块作用域优先（剔除子对象 schema 表）；若页面无可识别区块（官方改版）→ 回退全页扫描并告警，
    //   避免静默产出空清单（那会让该组件"看起来无属性"→ 缺口消失的假绿）。
    const scoped = attrScopedHtml(raw)
    let attrs = extractAttrs(scoped)
    if (!attrs.length) {
      const fallback = extractAttrs(raw)
      if (fallback.length) {
        console.warn(`  ${tag}: ⚠ 未识别到属性区块，回退全页扫描（${fallback.length} 项）——请核对官方页结构`)
        attrs = fallback
      }
    }
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

// ★--check：漂移检测（不写快照）。抓取全失败（离线）→ exit 0 并明确告警跳过（本门禁依赖官方页，
//   不因断网误红；CI 若需硬校验须保证出网）。有任一组件抓到时才做真实比对。
if (process.argv.includes('--check')) {
  if (ok === 0) {
    console.warn(`\n[gen-mp-component-attrs] ⚠ 无法访问官方文档（ok 0 / fail ${fail}）——已跳过漂移检测（快照未改动）`)
    process.exit(0)
  }
  const diffs = []
  for (const [tag, attrs] of Object.entries(sorted)) {
    const oldNames = (prev[tag] ?? []).map((a) => a.name)
    const newNames = attrs.map((a) => a.name)
    const removed = oldNames.filter((n) => !newNames.includes(n))
    const added = newNames.filter((n) => !oldNames.includes(n))
    if (removed.length || added.length) diffs.push(`${tag}: -[${removed.join(',')}] +[${added.join(',')}]`)
  }
  if (diffs.length) {
    console.error(`\n❌ 标尺快照与官方文档脱节（${diffs.length} 个组件）：\n  ${diffs.join('\n  ')}\n  确认后运行 node scripts/gen-mp-component-attrs.mjs 更新快照，并同步棘轮水位。`)
    process.exit(1)
  }
  console.log(`\n[gen-mp-component-attrs] ✅ 快照与官方一致（${Object.keys(sorted).length} 组件，抽查 ${ok} 个抓取成功）`)
  process.exit(0)
}

fs.writeFileSync(OUT, JSON.stringify({
  _comment: '微信小程序官方组件**属性级**清单快照——由 scripts/gen-mp-component-attrs.mjs 从官方文档抓取，勿手改。',
  source: 'https://developers.weixin.qq.com/miniprogram/dev/component/<tag>.html',
  componentCount: Object.keys(sorted).length,
  attrTotal: Object.values(sorted).reduce((n, a) => n + a.length, 0),
  components: sorted,
}, null, 1) + '\n')
console.log(`\n[gen-mp-component-attrs] ${Object.keys(sorted).length} 组件 / ${Object.values(sorted).reduce((n,a)=>n+a.length,0)} 属性（本次 ok ${ok} / fail ${fail}）→ ${path.relative(ROOT, OUT)}`)
