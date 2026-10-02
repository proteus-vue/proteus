#!/usr/bin/env node
// scripts/check-native-mix-harmony.mjs —— ★矩阵 #10 判据（原生组件混用；与 Android native-host 三件事同族）
//
// 用法：node check-native-mix-harmony.mjs <layout.json> <screenshot.png>
// 判据：
//   ① 位置由核心决定：原生组件 bounds（dumpLayout）== 核心几何（设计单位）× 密度 + 页面 Stack 偏移
//   ② 原生真的在渲染：目标区取到原生色（红 #E53935），占该区面积 ≥ 80%
//   ③ z-order 实测：重叠区显示**原生**（自绘蓝被覆盖 —— ArkUI 原生在上）
// 退出码：0 全过 / 1 有失败
import fs from 'node:fs'
import { decodePng, convertToSrgb } from '../packages/consistency/dist/index.js'

const [layoutPath, pngPath] = process.argv.slice(2)
if (!layoutPath || !pngPath) {
  console.error('用法：node check-native-mix-harmony.mjs <layout.json> <screenshot.png>')
  process.exit(2)
}
const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'))

// ── ① 从 dumpLayout 找原生组件 bounds ──
let bounds = null
const walk = (n) => {
  const a = n?.attributes ?? {}
  if (a.id === 'proteus-native-mix') bounds = a.bounds
  for (const c of n?.children ?? []) walk(c)
}
walk(layout)
if (!bounds) {
  console.error('✗ ① 未在 layout 里找到 proteus-native-mix（原生组件没渲染？）')
  process.exit(1)
}
// ★bounds 是**字符串** `'[56,210][336,378]'`（uitest dumpLayout 格式——首版按数组解构
//   ⇒ NaN 比较恒 false，把完全正确的组件判成错位）。解析成 [x0,y0,x1,y1]。
const mB = String(bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
if (!mB) {
  console.error(`✗ ① bounds 格式不认识：${bounds}`)
  process.exit(1)
}
const [x0, y0, x1, y1] = mB.slice(1).map(Number)
// 核心几何（场景探针上报过：锚块 (16,60) 80×48 设计单位；密度 3.5；页面 Stack 从状态栏 168px 起）
const DENSITY = 3.5
const CORE = { x: 16, y: 60, w: 80, h: 48 }
// ★期望 = 核心几何 × 密度（**屏幕绝对坐标**）。页面 Stack 的"状态栏偏移 48vp"已在
//   页面侧补偿（Index.ets 的 NATIVE_MIX_Y_COMP——`position` 相对 Stack，要落屏幕 y 需减去它）。
//   ⇒ 此处**不能再加**偏移（首版加了 ⇒ 期望 y 多 168px，把正确的组件判成错位——判据建错靶第三例）。
const expX0 = Math.round(CORE.x * DENSITY)
const expY0 = Math.round(CORE.y * DENSITY)
const expW = Math.round(CORE.w * DENSITY)
const expH = Math.round(CORE.h * DENSITY)
const tol = 3
const check1 = Math.abs(x0 - expX0) <= tol && Math.abs(y0 - expY0) <= tol
  && Math.abs((x1 - x0) - expW) <= tol && Math.abs((y1 - y0) - expH) <= tol
console.log(`  ① 位置由核心决定：组件 bounds ${bounds} vs 期望 [${expX0},${expY0}][${expX0 + expW},${expY0 + expH}]（核心 (${CORE.x},${CORE.y}) ${CORE.w}×${CORE.h} ×${DENSITY} ）→ ${check1 ? '✓' : '✗'}`)

// ── ②③ 像素：目标区红（原生）占比 + 自绘蓝是否被覆盖 ──
const img = convertToSrgb(await decodePng(new Uint8Array(fs.readFileSync(pngPath))))
const { width: W, rgba } = img
// 采样区：组件内部（留 6px 边避免圆角/描边影响）
const sx0 = x0 + 6, sy0 = y0 + 6, sx1 = x1 - 6, sy1 = y1 - 6
let red = 0, blue = 0, total = 0
for (let y = sy0; y < sy1; y++) {
  for (let x = sx0; x < sx1; x++) {
    const i = (y * W + x) * 4
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    total++
    if (Math.abs(r - 229) < 16 && Math.abs(g - 57) < 16 && Math.abs(b - 53) < 16) red++
    if (Math.abs(r - 47) < 16 && Math.abs(g - 111) < 16 && Math.abs(b - 237) < 16) blue++
  }
}
const redRatio = total ? red / total : 0
const check2 = redRatio >= 0.8
const check3 = blue === 0 && red > 0   // 重叠区无自绘蓝 ⇒ 原生覆盖（原生在上）
console.log(`  ② 原生真的在渲染：红(原生)占目标区 ${(redRatio * 100).toFixed(1)}%（应 ≥80%）→ ${check2 ? '✓' : '✗'}`)
console.log(`  ③ z-order 实测：蓝(自绘)=${blue} 像素（应 0——被原生覆盖）→ ${check3 ? '✓ ArkUI 原生在上' : '✗'}`)

const verdict = check1 && check2 && check3
const report = {
  ok: verdict, path: 'native-mix', host_id: 'harmony',
  note: '鸿蒙腿：ArkUI 原生组件 + Proteus 自绘共存——位置由核心几何决定、原生真渲染、z-order 实测（原生在上）',
  native_bounds: bounds, expected: [expX0, expY0, expX0 + expW, expY0 + expH],
  core_rect: [CORE.x, CORE.y, CORE.w, CORE.h], density: DENSITY,
  red_ratio: Math.round(redRatio * 1000) / 1000, blue_px: blue,
  checks: { pos_from_core: check1, native_renders: check2, zorder_native_on_top: check3 },
  verdict: verdict ? 'PASS' : 'FAIL',
}
fs.writeFileSync(layoutPath.replace(/native-mix-layout\.json$/, 'native-mix.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report, null, 1))
process.exit(verdict ? 0 : 1)
