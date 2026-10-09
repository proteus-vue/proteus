#!/usr/bin/env node
// scripts/check-host-invoke-contract.mjs —— ★★★B2（G4）：宿主 `proteusHost.invoke` **方法契约**门禁
//
// 【它防什么】`screen.*` + 能力族方法名此前**手抄**在各端宿主里⇒漂移（实测：iOS 漏 webassembly.*、
//   鸿蒙缺整个能力族）。本门禁据**代码事实**：① 各端声明的方法 ⊆ 契约（未知方法 ⇒ 红，防拼写/私增）；
//   ② `screen.*` 三端**完全一致**（M5 执行器协议）；③ 各端能力覆盖率**如实报告**（缺失列出，不静默）。
//
// 契约 SSOT：packages/render-backend/src/host-invoke-contract.ts（编译到 dist）。
// 用法：node scripts/check-host-invoke-contract.mjs
// 退出码：0 通过（含"如实报告缺失但不致命"）/ 1 违反（未知方法 / screen 不一致）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p) => path.relative(ROOT, p)
const problems = []
const notes = []

// ① 契约（dist）
const dist = path.join(ROOT, 'packages/render-backend/dist/host-invoke-contract.js')
if (!fs.existsSync(dist)) {
  console.error(`✗ 缺 ${rel(dist)} —— 先跑 pnpm build-packages（本门禁读编译后契约）`)
  process.exit(1)
}
const { HOST_CAPABILITY_METHODS, HOST_SCREEN_METHODS, HOST_METHOD_OPTIONAL } = await import(pathToFileURL(dist).href)
const contract = new Set([...HOST_CAPABILITY_METHODS, ...HOST_SCREEN_METHODS])

/** 从源码抽取 `case "xxx":`（Java/Swift）。 */
function extractCases(file) {
  const out = []
  for (const m of fs.readFileSync(path.join(ROOT, file), 'utf-8').matchAll(/case\s+"([^"]+)"/g)) out.push(m[1])
  return out
}
/** 从源码抽取 `method == "xxx"`（C++）。 */
function extractMethodEq(file) {
  const out = []
  for (const m of fs.readFileSync(path.join(ROOT, file), 'utf-8').matchAll(/method\s*==\s*"([^"]+)"/g)) out.push(m[1])
  return out
}

const ENDS = {
  android: {
    screen: extractCases('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ScreenHost.java'),
    capability: extractCases('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostCapabilities.java'),
  },
  ios: {
    screen: extractCases('hosts/ios/ProteusHost/runtime/screen-host.swift'),
    capability: extractCases('hosts/ios/ProteusHost/runtime/host-capabilities.swift'),
  },
  harmony: {
    // ★决策 #725：鸿蒙 `screen.*`（一处 `method == "..."` 分发）已按**中性名下沉**到 runtime HAR
    //   （`host_app_runtime_impl.h`，由 proteus_host.cpp 导出 hostAppBoot/Drive/Render）——壳不再依赖 dev。
    //   能力族鸿蒙仍未接线（覆盖率如实为 0），故 capability 从同一头抽（当前为空，如实报告）。
    screen: extractMethodEq('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h').filter((m) => m.startsWith('screen.')),
    capability: extractMethodEq('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h').filter((m) => !m.startsWith('screen.')),
  },
}

for (const [end, sets] of Object.entries(ENDS)) {
  const all = [...sets.screen, ...sets.capability]
  // ① ⊆ 契约（未知 ⇒ 红）
  for (const meth of all) if (!contract.has(meth)) problems.push(`${end}: 未知方法「${meth}」（不在 host-invoke-contract）`)
  // ② screen.* 三端一致
  const screenSet = new Set(sets.screen)
  const missingScreen = HOST_SCREEN_METHODS.filter((m) => !screenSet.has(m))
  if (missingScreen.length) problems.push(`${end}: screen.* 缺 ${missingScreen.join(' / ')}（三端必须一致）`)
  // ③ 能力覆盖率（如实报告，缺失 = 非致命；已声明合法省略的端扣除）
  const optional = new Set(HOST_METHOD_OPTIONAL[end] ?? [])
  const capSet = new Set(sets.capability)
  const missingCap = HOST_CAPABILITY_METHODS.filter((m) => !capSet.has(m) && !optional.has(m))
  const covered = HOST_CAPABILITY_METHODS.filter((m) => capSet.has(m)).length
  if (missingCap.length) {
    notes.push(`${end}: 能力覆盖 ${covered}/${HOST_CAPABILITY_METHODS.length}（缺 ${missingCap.length}：${missingCap.slice(0, 6).join(', ')}${missingCap.length > 6 ? ', …' : ''}）`)
  }
}

console.log('宿主 invoke 方法契约门禁（screen.* 一致 + 能力 ⊆ 契约 + 覆盖率如实）')
for (const n of notes) console.log(`  ▸ ${n}`)
if (problems.length) {
  console.error(`\n❌ 违反（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ 各端方法 ⊆ 契约 · screen.* 三端一致（能力覆盖缺项已如实列出，非静默）')
