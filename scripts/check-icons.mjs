#!/usr/bin/env node
// scripts/check-icons.mjs —— ★★★Keryx 图标库门禁（图标即数据 · 内核可吃 · 零字体依赖 · OS 级规范）
//
// 【为什么有它（OS级图标库方案 §4/§5/§6/§9）】图标 "三套实现全部违宪"（unicode 字形 / Web 手绘 SVG /
//   App svg_path 无图标集）。⇒ 单一真源 = SVG path 数据（`@proteus-vue/icons`）。本门禁钉住数据法则：
//     ① **内核可吃**：`d` 归一化后**只含绝对 M/L/C/Q/Z**（内核 `svg_path.rs` 拒 A/S/T/H/V）；
//     ①b **归一化幂等**（转换器无有损）；
//     ② **无 tofu**：数据源码里不得出现 unicode 字形映射；
//     ③ 未知名显式占位（不静默）；
//     ④ **命名 kebab-case**（§6：`arrow-back` 非 `arrowBack`）——别名表不受此限；
//     ⑤ **类别 ∈ 规范清单**（§6：action/communication/media/status/file/navigation/form）；
//     ⑥ **零重复主名路径**（同名路径只允许一枚主名，其余走别名）；
//     ⑦ **别名自洽**（别名→存在的主名；别名键不得与主名撞车）；
//     ⑧ **零字面 hex 颜色**（§6：颜色只允许 token/currentColor）；
//     ⑨ **viewBox 统一** `0 0 24 24`（§6 网格）；
//     ⑩ ★**坐标域 ∈ [0,24]**（生成器须把上游网格缩放到 24——App 内核/宿主不读 viewBox，未缩放将跨端失配）；
//     ⑪ **filled 变体**亦内核可吃 + 坐标域内（双体系）。
//
// 用法：node scripts/check-icons.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

const distEntry = path.join(ROOT, 'packages/icons/dist/index.js')
if (!fs.existsSync(distEntry)) {
  console.error('✗ 缺 packages/icons/dist —— 先跑 node scripts/build-packages.mjs')
  process.exit(1)
}
const I = await import(pathToFileURL(distEntry).href)
const { ICON_SET, ICON_NAMES, ICON_ALIASES, ICON_CATEGORIES, normalizedIcon, normalizePath, hasIcon, resolveIconName, iconByName } = I

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const COORD = /-?\d+\.?\d*/g
const coordRange = (d) => {
  const ns = (d.match(COORD) || []).map(Number)
  return { min: Math.min(...ns), max: Math.max(...ns) }
}

if (!ICON_NAMES || ICON_NAMES.length < 1) problems.push('图标集为空')

// 判据 ①：每个图标归一化后仅绝对 M/L/C/Q/Z（内核可吃）+ ⑨ viewBox 统一 + ⑩ 坐标域
for (const name of ICON_NAMES) {
  const def = ICON_SET[name]
  const d = normalizedIcon(name).d
  if (!d || !d.trim()) { problems.push(`图标 ${name} 路径为空`); continue }
  if (/[AaSsTtHhVv]/.test(d)) problems.push(`图标 ${name} 归一化后仍含 A/S/T/H/V（内核 svg_path 拒绝）：${d.slice(0, 50)}…`)
  if (!/^M\s/.test(d.trim())) problems.push(`图标 ${name} 归一化后不以 M 起（非法路径）`)
  if ((def.viewBox ?? '0 0 24 24') !== '0 0 24 24') problems.push(`图标 ${name} viewBox 非 0 0 24 24：${def.viewBox}`)
  const r = coordRange(d)
  if (r.min < -0.5 || r.max > 24.5) problems.push(`图标 ${name} 坐标越出 [0,24] 网格（min=${r.min} max=${r.max}）——生成器未把上游网格缩放对齐？`)
}
// 判据 ①b：归一化幂等
for (const name of ICON_NAMES) {
  const d1 = normalizedIcon(name).d
  if (normalizePath(d1) !== d1) problems.push(`图标 ${name} 归一化非幂等（有损）`)
}

// 判据 ②：数据源码不出现 unicode 字形映射（扫 set.ts + 生成物）
const srcFiles = [path.join(ROOT, 'packages/icons/src/set.ts'), path.join(ROOT, 'packages/icons/src/generated/icons.generated.ts')]
let allSrc = ''
for (const f of srcFiles) if (fs.existsSync(f)) allSrc += '\n' + fs.readFileSync(f, 'utf-8')
const emojiLike = allSrc.match(/(?:d|filled):\s*'[^\x00-\x7F]+'|:\s*'[^\x00-\x7F]+'/g)
if (emojiLike && emojiLike.length) problems.push(`图标数据出现非 ASCII 字形字面量（应为 SVG path）：${emojiLike.slice(0, 6).join(' ')}`)

// 判据 ③：未知名显式占位（不静默）
if (hasIcon('__definitely_not_an_icon__')) problems.push('未知名判定异常（hasIcon 对未知名返回 true）')

// 判据 ④：主名 kebab-case
for (const name of ICON_NAMES) if (!KEBAB.test(name)) problems.push(`主名 "${name}" 非 kebab-case（§6 命名规范）`)

// 判据 ⑤：类别 ∈ 规范清单
for (const name of ICON_NAMES) {
  const cat = ICON_SET[name].category
  if (!cat) problems.push(`图标 ${name} 缺类别（§6 要求每枚登记类别）`)
  else if (!ICON_CATEGORIES.includes(cat)) problems.push(`图标 ${name} 类别 "${cat}" 不在规范清单 [${ICON_CATEGORIES.join(', ')}]`)
}

// 判据 ⑥：零重复主名路径（同路径只允许一枚主名）
const byPath = new Map()
for (const name of ICON_NAMES) {
  const d = ICON_SET[name].d
  if (!byPath.has(d)) byPath.set(d, [])
  byPath.get(d).push(name)
}
for (const [, group] of byPath) if (group.length > 1) problems.push(`重复主名路径（应合并为别名）：${group.join(' / ')}`)

// 判据 ⑦：别名自洽（指向存在的主名；不与主名撞车；resolve 一致）
for (const [alias, target] of Object.entries(ICON_ALIASES ?? {})) {
  if (Object.prototype.hasOwnProperty.call(ICON_SET, alias)) problems.push(`别名 "${alias}" 与主名撞车`)
  if (!Object.prototype.hasOwnProperty.call(ICON_SET, target)) problems.push(`别名 "${alias}" → "${target}" 目标不存在`)
  else if (resolveIconName(alias) !== target) problems.push(`别名 "${alias}" 解析异常（应 → ${target}）`)
}

// 判据 ⑧：零字面 hex 颜色（扫 set.ts + 生成物；剥注释）
const stripped = allSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const hexHits = stripped.match(/#[0-9a-fA-F]{3,8}\b/g)
if (hexHits && hexHits.length) problems.push(`图标数据出现字面 hex 颜色（§6：只允许 token/currentColor）：${hexHits.slice(0, 6).join(' ')}`)

// 判据 ⑪：filled 变体亦内核可吃 + 坐标域内（双体系）
let filledCount = 0
for (const name of ICON_NAMES) {
  const f = ICON_SET[name].filled
  if (!f) continue
  filledCount++
  const nf = normalizePath(f)
  if (/[AaSsTtHhVv]/.test(nf)) problems.push(`图标 ${name} 的 filled 变体含 A/S/T/H/V（内核拒绝）`)
  const r = coordRange(nf)
  if (r.min < -0.5 || r.max > 24.5) problems.push(`图标 ${name} 的 filled 变体坐标越出 [0,24]（min=${r.min} max=${r.max}）`)
}
// 判据 ⑪b：`<name>-filled` 解析 == 该图标的 filled 变体（变体通道自洽）
for (const name of ICON_NAMES) {
  if (!ICON_SET[name].filled) continue
  if (iconByName(`${name}-filled`).d !== ICON_SET[name].filled) problems.push(`图标 ${name} 的 -filled 变体解析错误`)
}

if (problems.length) {
  console.error(`✗ Keryx 图标门禁未过（${problems.length}）：`)
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`)
  if (problems.length > 40) console.error(`  … 还有 ${problems.length - 40} 条`)
  process.exit(1)
}
const aliasN = Object.keys(ICON_ALIASES ?? {}).length
console.log(`✅ Keryx 图标库（${ICON_NAMES.length} 主名 + ${aliasN} 别名 · filled 变体 ${filledCount} · 均内核可吃 · 24 网格 [0,24] · kebab · 类别合规 · 零重复 · 零 hex · 零 unicode 字形）`)
