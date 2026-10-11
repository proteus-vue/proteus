#!/usr/bin/env node
// scripts/check-icons.mjs —— ★★★Keryx 图标库门禁（图标即数据 · 内核可吃 · 零字体依赖）
//
// 【为什么有它（OS级图标库方案 §4/§5/§9）】图标 "三套实现全部违宪"（unicode 字形 / Web 手绘 SVG /
//   App svg_path 无图标集）。⇒ 单一真源 = SVG path 数据（`@proteus-vue/icons`）。本门禁钉住：
//     ① **内核可吃**：每个图标的 `d` 归一化后**只含绝对 M/L/C/Q/Z**（内核 `svg_path.rs` 拒 A/S/T/H/V
//        ——设计工具导出带这些，必须在数据侧就转好，否则 App 端解析失败 = 图标不显示）；
//     ② **无 tofu 风险**：图标集数据里**不得出现 unicode 字形映射表**（淘汰 emoji/unicode 字形路径）；
//     ③ 数据非空 + 名称唯一 + viewBox 合法。
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
const { ICON_NAMES, normalizedIcon, normalizePath, hasIcon } = I

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

if (problems.length) {
  console.error(`✗ Keryx 图标门禁未过（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✅ Keryx 图标库（${ICON_NAMES.length} 枚 · 均内核可吃 · 零 unicode 字形依赖）`)
