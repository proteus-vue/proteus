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

// ★`--root <dir>`：让门禁可对**夹具**运行（tests/env-vars-gate.test.ts 的破坏性验证用——
//   注入"删掉 mount 通路调用"的夹具须红）。缺省 = 仓库根（正常用法零影响）。
const _argv = process.argv.slice(2)
const _rootIdx = _argv.indexOf('--root')
const ROOT = _rootIdx >= 0 && _argv[_rootIdx + 1]
  ? path.resolve(_argv[_rootIdx + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  // ★Stage 2（2026-10-09 · 决策 #595）：新增分组 D（视口几何）；★E 组（设备标量 · --pf-hairline）随契约扩集同步
  if (!s || !s.desc || !['A', 'B', 'C', 'D', 'E'].includes(s.group)) problems.push(`契约变量缺语义/分组：${n}`)
}
if (!isEnvVarName('--pf-inset-top')) problems.push('isEnvVarName 判 --pf-inset-top 为假')

// ②④⑤ 源码事实：文件存在 + 关键标记
const need = [
  ['packages/compiler/src/vapor/template.ts', 'envLengthToken', '编译器 App 折叠未发射 env 引用'],
  // ★Stage 2：vw/vh 单位折 --pf-vw/--pf-vh（含缩放；App 端此前整条丢弃 vw/vh）
  ['packages/compiler/src/vapor/template.ts', 'vwVhToken', '编译器未折 vw/vh 单位'],
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
  // ★E 组（设备标量 · --pf-hairline = 1/设备像素比）：四端 + Web 基础样式 + MP 读数**逐处**核对——
  //   任一端漏 ⇒ 该端静默为 0（"看起来对、其实差"，本门禁创立时的原始教训）。
  ['packages/built-in-components/src/style.css', '--pf-hairline', 'Web 基础样式未定义 --pf-hairline'],
  ['packages/fluid/src/env-vars.ts', '--pf-hairline', 'MP 读数未提供 --pf-hairline'],
  ['hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java', '"--pf-hairline"', 'Android 未采集 --pf-hairline'],
  ['hosts/ios/ProteusHost/runtime/selfdraw-scene.swift', '--pf-hairline', 'iOS 未采集 --pf-hairline'],
  ['hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets', '--pf-hairline', '鸿蒙未采集 --pf-hairline'],
  ['packages/fluid/src/env-vars.ts', 'readEnvVars', 'MP 运行期读数未提供'],
]
for (const [f, marker, why] of need) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) { problems.push(`${why}（缺文件 ${f}）`); continue }
  if (!fs.readFileSync(p, 'utf-8').includes(marker)) problems.push(`${why}（${f} 无 "${marker}"）`)
}

// ★★★**调用点**核对（2026-10-09 · 决策 #694 的机器版）——「解析器存在」≠「该通路调用了它」。
//   【为什么单列：上面 need 是**定义/能力存在**级判据，曾整条放行 #694】iOS 的 env 解析器
//   （`selfdraw-scene.swift` 的 `resolveEnvToken`）**一直在**（首屏 `render` 通路调它 ⇒ need 绿），
//   但**屏切换通路** `screen-host.swift` 的 `ScreenHost.mount` **没调** ⇒ 编译产物 `"env:--pf-vh"`
//   字符串直进内核 ⇒ serde `expected f32` ⇒ `proteus_layout_create` 返 0 ⇒ **点卡片不切屏**
//   （真机实测完全静默、零报错）。这是本仓"**同一语义两通路**"复发——门禁判据必须**跟着通路走**：
//   逐条断言**每个会建内核请求的宿主入口**都**显式调用了**解析器（不是"文件里有这个词"）。
//   ★破坏性验证：删掉任一调用 ⇒ 本门禁当场红（见 tests/env-vars-gate.test.ts）。
const needMountPath = [
  // iOS：屏切换通路（`ScreenHost.mount`）建节点前必须解析（`in: &node` 是 inout 调用、区别于定义）
  ['hosts/ios/ProteusHost/runtime/screen-host.swift', 'resolveEnvTokens(in: &node)', 'iOS 屏切换通路（ScreenHost.mount）未调用 env 解析（#694 复发：点卡片不切屏）'],
  // Android：屏切换通路（`ScreenHost`）建节点前必须解析（`envResolver.resolve` 是 mount 循环内的调用）
  ['hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ScreenHost.java', 'envResolver.resolve(', 'Android 屏切换通路（ScreenHost）未调用 env 解析（#677 复发）'],
  // 鸿蒙：屏内容 → 内核树的唯一出口（`AppScreenCommands`）建树前必须替换 token
  ['hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp', 'substituteEnvTokens(nodes, envTable)', '鸿蒙屏内容入口（AppScreenCommands）未替换 env token'],
]
for (const [f, marker, why] of needMountPath) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) { problems.push(`${why}（缺文件 ${f}）`); continue }
  if (!fs.readFileSync(p, 'utf-8').includes(marker)) problems.push(`${why}（${f} 未出现调用 "${marker}"）`)
}

// ★★★B2（G2）：**三端实例的 --pf-* 字面量 ⊆ 契约闭集**——防"各端手拄闭集时拼错/私增未知名"。
//   ★不报"未消费"（契约超集允许某端未用某变量），只报"字面量不在契约里"。
{
  const hostDirs = [
    'hosts/android/app/src/main/java',
    'hosts/ios/ProteusHost',
    'hosts/harmony/host-app/entry/src/main/ets',
    'hosts/harmony/host-app/proteus_render/src',
  ]
  const walk = (dir) => {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) return
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = dir + '/' + ent.name
      if (ent.isDirectory()) walk(rel)
      else if (/\.(java|swift|h|cpp|ets)$/.test(ent.name)) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8')
        for (const m of src.matchAll(/"(--pf-[a-z0-9-]+)"/g)) {
          if (!isEnvVarName(m[1])) problems.push(`宿主 ${rel} 使用了契约外变量名：${m[1]}`)
        }
      }
    }
  }
  for (const d of hostDirs) walk(d)
}

if (problems.length) {
  console.error(`❌ 内置环境变量门禁未过（${problems.length} 项）：`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`✅ 内置环境变量四同步（契约 ${names.length} 项 · 编译器两路径 · 一致性三端 · 三端宿主 · Web 基础样式 · MP 读数）`)
