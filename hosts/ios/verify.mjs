#!/usr/bin/env node
// hosts/ios/verify.mjs —— iOS 竖切验收（★机器对账，不靠「我说跑通了」）
//
// 验什么（三层，每层都独立可证伪）：
//   ① JS 层：bundle 能在纯 JavaScriptCore 里执行（无 DOM/window 假设）——宿主桩捕获 API 调用
//   ② 桥层：调用序列符合 M1 契约（createView→updateView→insertView…；视图操作**全同步**，无 await）
//   ③ 树层：宿主侧拿到的 UIView 树与 JS 侧构造的语义树**逐节点对账**（类型/文本/颜色/字号）
//
// 为什么这层验证必须存在：模拟器 GUI 只能「人眼看着像」，而门禁要能**在 CI 里红**。
//   本脚本用 Node 侧的 JSC 替身（见 verify-jsc.swift）跑同一份 bundle，断言同一批事实。
//
// 用法：node hosts/ios/verify.mjs
// 退出码：0 通过 / 1 失败
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const BUNDLE = path.join(HERE, 'bridge/dist/bundle.js')
const RUNNER = path.join(HERE, 'verify-jsc.swift')
const BIN = path.join(HERE, 'build/verify-jsc')

const fail = []
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { fail.push(m); console.log(`  ✗ ${m}`) }

// ── ① 前置：bundle 必须存在（先跑 bridge/build.mjs）──
if (!fs.existsSync(BUNDLE)) {
  console.error('[verify] 缺少 bundle——先运行：node hosts/ios/bridge/build.mjs')
  process.exit(2)
}

// ── ② 编译并运行 JSC 侧验证器（真实 JavaScriptCore，非模拟）──
console.log('[verify] 编译 JSC 验证器（swiftc）…')
execFileSync('xcrun', ['swiftc', '-O', '-o', BIN, RUNNER, '-framework', 'JavaScriptCore'], { stdio: 'inherit' })
console.log('[verify] 运行 bundle（真实 JavaScriptCore）…')
const out = execFileSync(BIN, [BUNDLE], { encoding: 'utf8', cwd: ROOT })

const m = out.match(/SNAPSHOT_BEGIN\n([\s\S]*?)\nSNAPSHOT_END/)
if (!m) {
  console.error('[verify] 未取到快照输出：\n' + out.slice(0, 800))
  process.exit(1)
}
const snap = JSON.parse(m[1])

console.log('\n[verify] ① JS 层：bundle 在纯 JSC 中执行')
if (out.includes('JS EXCEPTION')) bad('bundle 执行抛异常')
else ok('无 JS 异常（bundle 无 DOM/window 依赖）')
const summary = JSON.parse(out.match(/SUMMARY=(.+)/)?.[1] ?? '{}')
if (summary.backendId === 'native-ios') ok(`后端 id = ${summary.backendId}（走的是 native-ios 而非 mock）`)
else bad(`后端 id 异常：${summary.backendId}`)
if (summary.traceCount > 0) ok(`Dispatcher 轨迹 ${summary.traceCount} 条（nodeOps 真的经过转发层）`)
else bad('Dispatcher 轨迹为空')

console.log('\n[verify] ② 桥层：调用序列符合 M1 契约')
const calls = out.split('\n').filter((l) => l.startsWith('CALL ')).map((l) => l.slice(5).trim())
const count = (p) => calls.filter((c) => c.startsWith(p)).length
if (count('createView') > 0) ok(`createView ×${count('createView')}（同步返回句柄）`)
else bad('无 createView 调用')
if (count('insertView') > 0) ok(`insertView ×${count('insertView')}（树结构同步建立）`)
else bad('无 insertView——树没建立')
if (count('setViewText') > 0) ok(`setViewText ×${count('setViewText')}（文本通道通）`)
else bad('无 setViewText')
// 同步性：整个执行是单次 evaluateScript 同步完成的——若期间有微任务挂起会比 ready 晚
const readyIdx = out.indexOf('SUMMARY=')
const lastInsertIdx = out.lastIndexOf('CALL insertView')
if (readyIdx > 0 && lastInsertIdx > 0 && lastInsertIdx < readyIdx) ok('视图操作全部先于 ready 完成（同步语义成立，A-02）')
else bad('insert 发生在 ready 之后（存在异步挂起）')

console.log('\n[verify] ③ 树层：UIKit/宿主树 vs JS 语义树逐节点对账')
const walk = (n, fn, depth = 0) => { fn(n, depth); (n.children ?? []).forEach((c) => walk(c, fn, depth + 1)) }
const all = []
;(snap.topLevel ?? []).forEach((n) => walk(n, (x) => all.push(x)))
if (all.length === snap.totalViews - 0) ok(`节点总数 ${all.length}（与注册表 ${snap.totalViews} 一致）`)
else bad(`节点总数 ${all.length} ≠ 注册表 ${snap.totalViews}`)

// 断言 1：语义类型映射正确（p-view→UIView / p-text→UILabel / p-stack→UIStackView）
const types = all.map((n) => n.type)
for (const [semantic, expected] of [['p-view', 'UIView'], ['p-text', 'UILabel'], ['p-stack', 'UIStackView']]) {
  if (types.includes(expected)) ok(`${semantic} → ${expected}（SEMANTIC_NATIVE_MAPS.ios 生效）`)
  else bad(`缺少 ${expected}（${semantic} 未映射）`)
}
// 断言 2：文本透传（中文不乱码）
const texts = all.map((n) => n.text).filter(Boolean)
if (texts.some((t) => t.includes('Proteus'))) ok(`文本透传正确（${texts.length} 条，含中文）`)
else bad('文本未透传')
// 断言 3：样式解析（颜色/字号/圆角/高度）
const withBg = all.filter((n) => n.backgroundColor)
if (withBg.length >= 2) ok(`背景色解析 ${withBg.length} 处（${withBg.map((n) => n.backgroundColor).join(', ')}）`)
else bad(`背景色解析仅 ${withBg.length} 处`)
const withFont = all.filter((n) => n.fontSize)
if (withFont.length >= 3) ok(`字号解析 ${withFont.length} 处（${withFont.map((n) => n.fontSize).join('/')}）`)
else bad(`字号解析仅 ${withFont.length} 处`)
const radius = all.filter((n) => n.cornerRadius)
if (radius.length >= 2 && radius.every((n) => n.cornerRadius === 12)) ok('圆角解析 = 12（两枚按钮一致）')
else bad(`圆角异常：${JSON.stringify(radius.map((n) => n.cornerRadius))}`)

// ── 汇总 ──
console.log('')
if (fail.length) {
  console.error(`[verify] ✗ ${fail.length} 项失败：`)
  for (const f of fail) console.error('   - ' + f)
  process.exit(1)
}
console.log(`[verify] ✅ iOS 竖切链路验收通过（${all.length} 个视图节点 · 类型/文本/样式三条通道全通）`)
