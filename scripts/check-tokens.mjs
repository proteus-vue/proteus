#!/usr/bin/env node
// scripts/check-tokens.mjs —— ★★★Proteus UI 宪法门禁（token 单一真源 + 对比度审计）
//
// 【为什么有它（OS级组件库方案 §4 OS-1「设计语言成法」+ §5 宪法层）】`--sa-*` 视觉 token 曾只活在
//   **工程样式表**（`superapp/styles/global.css`）⇒ 不是框架律法 ⇒ 任意工程可绕过、任意裸值可注入、
//   改值可能**静默跌出 WCAG AA**（文档声称不是机器判据）。⇒ `@proteus-vue/tokens` 上移为**唯一真源**，
//   本门禁钉住两件事：
//     ① **无双写漂移**：工程样式表的 `--sa-*` / `--p-*` 值与 tokens 包**逐项一致**（含深色覆盖）；
//     ② **AA 不跌**：浅/深两套的关键对比对全过 WCAG（改值当场可判，不再靠注释声称）。
//
// 用法：node scripts/check-tokens.mjs
// 退出码：0 通过 / 1 违反
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

// ① 载入 tokens 包（dist；缺 ⇒ 先构建）
const distEntry = path.join(ROOT, 'packages/tokens/dist/index.js')
if (!fs.existsSync(distEntry)) {
  console.error('✗ 缺 packages/tokens/dist —— 先跑 node scripts/build-packages.mjs')
  process.exit(1)
}
const T = await import(pathToFileURL(distEntry).href)
const { SA_TOKENS, darkOverrides, extractTokenDecls, auditTokenContrast } = T

// ② 解析工程样式表（真源须与之一致）
const CSS = path.join(ROOT, 'superapp/styles/global.css')
const css = fs.readFileSync(CSS, 'utf-8')
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1)
const darkStart = css.indexOf(':root.sa-dark')
const darkBlock = darkStart >= 0 ? css.slice(darkStart, css.indexOf('}', darkStart)) + 1 : ''
const light = extractTokenDecls(lightBlock)
const dark = extractTokenDecls(darkBlock)

// 判据 ①a：tokens 包每个 token 必须在 CSS 里有且值一致
for (const [k, v] of Object.entries(SA_TOKENS)) {
  if (!(k in light)) { problems.push(`CSS 缺 token：${k}（tokens 包有、global.css 无）`); continue }
  if (light[k] !== v.value) problems.push(`token 值漂移：${k} | 包=${v.value} | CSS=${light[k]}`)
}
// 判据 ①b：CSS 里不能有 tokens 包未登记的 --sa-*/--p-*（防"工程绕过宪法私增"）
for (const k of Object.keys(light)) {
  if (!(k in SA_TOKENS)) problems.push(`CSS 私增 token（未登记进宪法）：${k} = ${light[k]}`)
}
// 判据 ①c：深色覆盖一致
for (const [k, v] of Object.entries(darkOverrides())) {
  if (k in dark && dark[k] !== v) problems.push(`深色 token 漂移：${k} | 包=${v} | CSS=${dark[k]}`)
}

// 判据 ②：WCAG 对比度（浅 + 深）
const violations = auditTokenContrast()
for (const v of violations) problems.push(`对比度不达 AA：${v.mode} ${v.pair} = ${v.ratio} < ${v.min}（${v.note}）`)

if (problems.length) {
  console.error(`✗ 宪法门禁未过（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✅ Proteus UI 宪法（${Object.keys(SA_TOKENS).length} token · 单源一致 · 浅/深 AA 全过）`)
