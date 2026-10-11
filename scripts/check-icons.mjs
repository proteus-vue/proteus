#!/usr/bin/env node
// scripts/check-icons.mjs —— ★★★Keryx 图标库门禁（图标即数据 · 内核可吃 · 零字体依赖 · 对齐 OS 级规范）
//
// 【为什么有它（OS级图标库方案 §4/§5/§6/§9）】图标 "三套实现全部违宪"（unicode 字形 / Web 手绘 SVG /
//   App svg_path 无图标集）。⇒ 单一真源 = SVG path 数据（`@proteus-vue/icons`）。本门禁钉住：
//     ① **内核可吃**：每个图标的 `d` 归一化后**只含绝对 M/L/C/Q/Z**（内核 `svg_path.rs` 拒 A/S/T/H/V）；
//     ①b **归一化幂等**（转换器无有损）；
//     ② **无 tofu 风险**：数据里不得出现 unicode 字形映射；
//     ③ 未知名显式占位（不静默）；
//     ④ **命名 kebab-case**（§6：`arrow-left` 非 `arrowLeft`）——别名表不受此限；
//     ⑤ **类别 ∈ 规范清单**（§6：action/communication/media/status/file/navigation/form）；
//     ⑥ **零重复主名路径**（同名路径只允许一枚主名，其余走别名）；
//     ⑦ **别名自洽**（别名→存在的主名；别名键不得与主名撞车）；
//     ⑧ **零字面 hex 颜色**（§6：颜色只允许 token/currentColor）。
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
const { ICON_SET, ICON_NAMES, ICON_ALIASES, ICON_CATEGORIES, normalizedIcon, normalizePath, hasIcon, resolveIconName } = I

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

if (!ICON_NAMES || ICON_NAMES.length < 1) problems.push('图标集为空')

// 判据 ①：每个图标归一化后仅绝对 M/L/C/Q/Z（内核可吃）
for (const name of ICON_NAMES) {
  const d = normalizedIcon(name).d
  if (!d || !d.trim()) { problems.push(`图标 ${name} 路径为空`); continue }
  if (/[AaSsTtHhVv]/.test(d)) problems.push(`图标 ${name} 归一化后仍含 A/S/T/H/V（内核 svg_path 拒绝）：${d.slice(0, 50)}…`)
  if (!/^M\s/.test(d.trim())) problems.push(`图标 ${name} 归一化后不以 M 起（非法路径）`)
}
// 判据 ①b：归一化幂等（再归一化不变——防转换器有损）
for (const name of ICON_NAMES) {
  const d1 = normalizedIcon(name).d
  const d2 = normalizePath(d1)
  if (d1 !== d2) problems.push(`图标 ${name} 归一化非幂等（有损）：${d1.slice(0, 40)} → ${d2.slice(0, 40)}`)
}

// 判据 ②：数据源码不出现 unicode 字形映射（淘汰路径）
const setSrc = fs.readFileSync(path.join(ROOT, 'packages/icons/src/set.ts'), 'utf-8')
const emojiLike = setSrc.match(/:\s*'[^\x00-\x7F]+'/g)
if (emojiLike && emojiLike.length) {
  problems.push(`图标集源码出现非 ASCII 字形字面量（应为 SVG path，非 unicode 字形）：${emojiLike.slice(0, 6).join(' ')}`)
}

// 判据 ③：未知名显式占位（不静默）
if (hasIcon('__definitely_not_an_icon__')) problems.push('未知名判定异常（hasIcon 对未知名返回 true）')

// 判据 ④：主名 kebab-case（§6 命名规范）
for (const name of ICON_NAMES) {
  if (!KEBAB.test(name)) problems.push(`主名 "${name}" 非 kebab-case（§6 命名规范：应如 arrow-left，非 arrowLeft）`)
}

// 判据 ⑤：类别 ∈ 规范清单（§6）
const CATS = Array.isArray(ICON_CATEGORIES) ? ICON_CATEGORIES : []
if (!CATS.length) problems.push('ICON_CATEGORIES 为空（无法校验类别）')
for (const name of ICON_NAMES) {
  const cat = ICON_SET[name].category
  if (!cat) problems.push(`图标 ${name} 缺类别（§6 要求每枚登记类别）`)
  else if (CATS.length && !CATS.includes(cat)) problems.push(`图标 ${name} 类别 "${cat}" 不在规范清单 [${CATS.join(', ')}]`)
}

// 判据 ⑥：零重复主名路径（同名路径只允许一枚主名）
const byPath = new Map()
for (const name of ICON_NAMES) {
  const d = ICON_SET[name].d
  if (!byPath.has(d)) byPath.set(d, [])
  byPath.get(d).push(name)
}
for (const [, group] of byPath) {
  if (group.length > 1) problems.push(`重复主名路径（应合并为别名）：${group.join(' / ')}`)
}

// 判据 ⑦：别名自洽（别名指向存在的主名；别名键不得与主名撞车）
for (const [alias, target] of Object.entries(ICON_ALIASES ?? {})) {
  if (Object.prototype.hasOwnProperty.call(ICON_SET, alias)) problems.push(`别名 "${alias}" 与主名撞车（键不得同时是主名）`)
  if (!Object.prototype.hasOwnProperty.call(ICON_SET, target)) problems.push(`别名 "${alias}" → "${target}" 目标不存在`)
  else if (resolveIconName(alias) !== target) problems.push(`别名 "${alias}" 解析结果异常（应 → ${target}，实得 ${resolveIconName(alias)}）`)
}

// 判据 ⑧：数据源码零字面 hex 颜色（§6：颜色只允许 token/currentColor）
const stripped = setSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const hexHits = stripped.match(/#[0-9a-fA-F]{3,8}\b/g)
if (hexHits && hexHits.length) problems.push(`图标集源码出现字面 hex 颜色（§6：只允许 token/currentColor）：${hexHits.slice(0, 6).join(' ')}`)

if (problems.length) {
  console.error(`✗ Keryx 图标门禁未过（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
const aliasN = Object.keys(ICON_ALIASES ?? {}).length
console.log(`✅ Keryx 图标库（${ICON_NAMES.length} 主名 + ${aliasN} 别名 · 均内核可吃 · kebab 命名 · 类别合规 · 零重复 · 零 hex · 零 unicode 字形）`)
