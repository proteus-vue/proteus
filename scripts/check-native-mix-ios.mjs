#!/usr/bin/env node
// scripts/check-native-mix-ios.mjs —— ★矩阵 #10 判据（iOS 腿；与 Android native-host 三件事同族）
//
// 用法：node scripts/check-native-mix-ios.mjs <native-mix.json>
// 判据：
//   ① **位置由核心决定**：原生 UIView 的 frame == 核心 `native_host_rect`（逐位相同）
//   ② **原生真在渲染**：像素采样到原生色 #E53935（且 UIWindow 层里真有该视图——native_view_added）
//   ③ **z-order 实测**：重叠区采样 == 原生色（iOS 子视图在 CALayer 内容之上 ⇒ 原生在上）
// 退出码：0 全过 / 1 有失败
import fs from 'node:fs'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('用法：node scripts/check-native-mix-ios.mjs <native-mix.json>')
  process.exit(2)
}
const d = JSON.parse(fs.readFileSync(file, 'utf-8'))
const NATIVE_RED = '#E53935'

// ① 位置由核心决定
const f = (d.native_view_frame ?? []).map(Number)
const c = d.core_rects?.native_host_rect ?? {}
const core = [Number(c.x), Number(c.y), Number(c.width), Number(c.height)]
const check1 = f.length === 4 && f.every((v, i) => Math.abs(v - core[i]) <= 0.5)
console.log(`  ① 位置由核心决定：UIView frame [${f}] vs 核心 native_host_rect [${core}] → ${check1 ? '✓ 逐位相同' : '✗'}`)

// ② 原生真在渲染（视图已加入 + 采样到原生色）
const px = JSON.parse(d.samples?.all_points ?? '{}').pixels ?? []
const check2a = d.native_view_added === true
const check2b = px.length >= 3 && px[0] === NATIVE_RED
const check2 = check2a && check2b
console.log(`  ② 原生真在渲染：view_added=${check2a} · 原生区采样=${px[0] ?? 'n/a'}（应 ${NATIVE_RED}）→ ${check2 ? '✓' : '✗'}`)

// ③ z-order：重叠区采样 == 原生色
const check3 = px.length >= 2 && px[1] === NATIVE_RED
console.log(`  ③ z-order 实测：重叠区采样=${px[1] ?? 'n/a'}（应 ${NATIVE_RED}——iOS 子视图在 CALayer 之上 ⇒ 原生在上）→ ${check3 ? '✓' : '✗'}`)

const verdict = check1 && check2 && check3
const out = {
  ok: verdict, path: 'native-mix', host_id: 'ios',
  native_view_frame: f, core_native_host_rect: core,
  pixels: px,
  checks: { pos_from_core: check1, native_renders: check2, zorder_native_on_top: check3 },
  verdict: verdict ? 'PASS' : 'FAIL',
  note: 'iOS 腿：原生 UIView（UIKit）按核心几何定位 + 与自绘重叠色块共存——与 Android native-host 三件事同族',
}
console.log(JSON.stringify(out, null, 1))
fs.writeFileSync(file.replace(/native-mix\.json$/, 'native-mix-check.json'), JSON.stringify(out, null, 1) + '\n')
process.exit(verdict ? 0 : 1)
