#!/usr/bin/env node
// scripts/check-env-vars.mjs —— ★★★框架内置 CSS 环境变量（--pf-*）门禁（决策 #593）
//
// 【它防什么】内置环境变量是**四端契约**（契约 SSOT + 生成器 + 三端宿主采集/解析 + Web 基础样式）——
//   任一端漏了（或新增变量未四同步）⇒ 该端静默为 0（"看起来对、其实差"）。本门禁据**代码事实**核对：
//   ① 契约闭集合法（`--pf-*` 前缀 / 语义齐备）；
//   ② 编译器**两路径**都发射 env 引用（App 折叠 `template.ts` + CSE `compute.ts`）；
//   ③ 三端宿主都**采集/解析**（Android / iOS / 鸿蒙）；
//   ④ Web 基础样式定义 `--pf-*`（:root）；
//   ⑤ 一致性三端 applier 都认 env 变体（app/skyline/web）。
//
// 用法：node scripts/check-env-vars.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const rel = (p) => path.relative(ROOT, p)

// ① 契约闭集
const { ENV_VARS, isEnvVarName } = await import(
  pathToFileURL(path.join(ROOT, 'packages/contracts/dist/env-vars.js')).href
)
const names = Object.keys(ENV_VARS)
if (names.length < 8) problems.push(`契约 ENV_VARS 过少（${names.length} 项）——疑未同步`)
for (const n of names) {
  if (!n.startsWith('--pf-')) problems.push(`契约变量名非 --pf-* 前缀：${n}`)
  const s = ENV_VARS[n]
  if (!s || !s.desc || !['A', 'B', 'C'].includes(s.group)) problems.push(`契约变量缺语义/分组：${n}`)
}
if (!isEnvVarName('--pf-inset-top')) problems.push('isEnvVarName 判 --pf-inset-top 为假')

// ②④⑤ 源码事实：文件存在 + 关键标记
const need = [
  ['packages/compiler/src/vapor/template.ts', 'envLengthToken', '编译器 App 折叠未发射 env 引用'],
  ['packages/compiler/src/cse/compute.ts', 'envRefOf', 'CSE 未发射 env 引用'],
  ['packages/consistency/src/appliers/app.ts', "kind === 'env'", 'App applier 未认 env 变体'],
  ['packages/consistency/src/appliers/skyline.ts', "kind === 'env'", 'Skyline applier 未认 env 变体'],
  ['packages/consistency/src/appliers/web.ts', "kind === 'env'", 'Web applier 未认 env 变体'],
  ['hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java', 'resolveEnvToken', 'Android 宿主未解析 env token'],
  ['hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java', 'collectEnvVars', 'Android 未采集 insets'],
  ['hosts/ios/ProteusHost/runtime/selfdraw-scene.swift', 'resolveEnvToken', 'iOS 宿主未解析 env token'],
  ['hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host_helpers.h', 'substituteEnvTokens', '鸿蒙未替换 env token'],
  ['hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets', 'getWindowAvoidArea', '鸿蒙未采集 avoidArea'],
  ['packages/built-in-components/src/style.css', '--pf-inset-top', 'Web 基础样式未定义 --pf-*'],
  ['packages/fluid/src/env-vars.ts', 'readEnvVars', 'MP 运行期读数未提供'],
]
for (const [f, marker, why] of need) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) { problems.push(`${why}（缺文件 ${f}）`); continue }
  if (!fs.readFileSync(p, 'utf-8').includes(marker)) problems.push(`${why}（${f} 无 "${marker}"）`)
}

if (problems.length) {
  console.error(`❌ 内置环境变量门禁未过（${problems.length} 项）：`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`✅ 内置环境变量四同步（契约 ${names.length} 项 · 编译器两路径 · 一致性三端 · 三端宿主 · Web 基础样式 · MP 读数）`)
