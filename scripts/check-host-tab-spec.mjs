#!/usr/bin/env node
// scripts/check-host-tab-spec.mjs —— ★★★B2（G6）：tab 栏**规格防回归**门禁
//
// 【它防什么（用户 2026-10-08「这类低效率不能反复出现」）】B2·G1 把 tab 栏视觉规格收敛成**共享常量**
//   （`packages/render-backend/src/tab-bar-spec.ts` 的 TAB_BAR_SPEC，随 state.tabSpec 下发），三端宿主**只读规格**。
//   ⇒ 防"某端图省事又把图标/标签/样式**硬编码**回宿主"（那就又漂了）。本门禁据代码事实：
//     ① 三端 tab 栏源码**必须引用**共享规格（`tabSpec`）；
//     ② 三端源码**不得**再出现硬编码的图标/标签映射字面量（`"⌂"`/`"✉"`/`"☺"` / `首页`/`消息`/`我的` 的条件映射）。
//
// 用法：node scripts/check-host-tab-spec.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

/** 三端 tab 栏源码（引用共享规格的必查文件）。 */
const TARGETS = [
  'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java',
  'hosts/ios/ProteusHost/shell/superapp-scene.swift',
  'hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets',
]

/** 硬编码图标映射字面量（引号包裹的 ⌂/✉/☺）——命中即"规格又被写回宿主"。 */
const ICON_LITERAL = /["'](?:⌂|✉|☺)["']/

for (const rel of TARGETS) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) { problems.push(`缺文件：${rel}`); continue }
  const src = fs.readFileSync(p, 'utf-8')
  // ① 必须引用共享规格
  if (!src.includes('tabSpec')) problems.push(`${rel}: 未引用共享 tab 规格（state.tabSpec）——tab 栏应读规格，不硬编码`)
  // ② 不得有硬编码图标映射
  if (ICON_LITERAL.test(src)) problems.push(`${rel}: 出现硬编码图标映射字面量（⌂/✉/☺）——应来自 state.tabSpec.icons`)
  // ③ 不得有硬编码标签映射（三种写法：'首页' 条件映射）
  if (/["']首页["']\s*[,?:]/.test(src) || /(?:===|==)\s*["']首页["']/.test(src)) {
    problems.push(`${rel}: 出现硬编码标签映射（首页）——应来自 state.tabSpec.labels / tabLabels`)
  }
}

if (problems.length) {
  console.error(`✗ tab 栏规格防回归门禁未过（${problems.length}）：`)
  for (const p2 of problems) console.error(`  - ${p2}`)
  process.exit(1)
}
console.log('✅ tab 栏规格防回归（三端读共享规格 · 无硬编码图标/标签映射）')
