#!/usr/bin/env node
// scripts/check-ios-export-wiring.mjs —— ★门禁：**iOS JSExport 接线一致性**
//
// 【为什么需要（2026-09-30 真机两次踩同一坑）】自绘宿主的 JS↔原生通道由三处**必须同时**成立：
//   ① JS 侧 `interface SelfDrawNative`（TS 里声明可调什么）
//   ② Swift `@objc protocol SelfDrawExports: JSExport`（**只有协议里的方法才会被暴露给 JS**）
//   ③ `SelfDrawBridge` 实现（真正的方法体）
//   缺 ② 时现象是：JS 调用抛 `xxx is not a function` —— 而该相位若没有统一异常捕获，
//   **读数只是"为空"、整套判据只因"该组跳过"而变绿**（静默失败的最坏形态：做错了伪装成没做）。
//   本仓已连踩两次（`layerZProbe`；此前 `animPlatform` 同类），⇒ 与「三条红线要工具层管」同源：
//   靠"记得同步三处"是记不住的。
//
// 【判据】
//   A. JS 侧调用的每个方法都必须在 **Swift 协议**里声明（缺 ⇒ TypeError）；
//   B. 协议里的每个方法都必须在 **Bridge 类**里有实现（缺 ⇒ 编译期其实会红，但保留判据防回归）；
//   C. Bridge 实现的公开方法不必都在协议里（内部辅助方法合法）——不判。
//
// 用法：node scripts/check-ios-export-wiring.mjs [--verbose]
// 退出码：0 一致 / 1 有缺口
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const TS_FILE = path.join(ROOT, 'hosts/ios/bridge/entry-selfdraw.ts')
const SWIFT_FILE = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift')
// ★★第二条腿（2026-09-30 续，iOS 对齐轮）：**宿主运行时桥**也是一对（JS↔JSExport），
//   同受"接线不靠记忆"纪律管——本轮加 `invoke` 若漏进协议，现象同样是运行时 TypeError
//   且被 catch 吞成静默（与自绘桥同类形态）。⇒ 第二对：
const HR_TS_FILE = path.join(ROOT, 'hosts/shared/bridge/entry-host-runtime.ts')
const HR_SWIFT_FILE = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/host-runtime-bridge.swift')
const VERBOSE = process.argv.includes('--verbose')

/** 从 TS 的 `interface SelfDrawNative { ... }` 抽方法名 */
function jsMethods(src) {
  const m = src.match(/interface SelfDrawNative \{(.*?)\n\}/s)
  if (!m) throw new Error('未找到 `interface SelfDrawNative`（JS 侧桥接口）')
  return [...new Set([...m[1].matchAll(/^\s*(\w+)\(/gm)].map((x) => x[1]))].sort()
}

/** 从 Swift 的 `@objc protocol SelfDrawExports: JSExport { ... }` 抽方法名 */
function protoMethods(src) {
  const m = src.match(/@objc protocol SelfDrawExports: JSExport \{(.*?)\n\}/s)
  if (!m) throw new Error('未找到 `@objc protocol SelfDrawExports`（JSExport 协议）')
  return [...new Set([...m[1].matchAll(/^\s*func (\w+)\(/gm)].map((x) => x[1]))].sort()
}

/** 从 `final class SelfDrawBridge` 抽实现的方法名 */
function bridgeMethods(src) {
  const start = src.indexOf('final class SelfDrawBridge')
  if (start < 0) throw new Error('未找到 `final class SelfDrawBridge`')
  // 类体到下一个顶层 `final class` 之前（同文件内）
  const rest = src.slice(start)
  const next = rest.indexOf('\nfinal class ', 1)
  const body = next > 0 ? rest.slice(0, next) : rest
  return [...new Set([...body.matchAll(/^\s*(?:@discardableResult\s+)?func (\w+)\(/gm)].map((x) => x[1]))].sort()
}

// ── 第二对：宿主运行时桥（HR） ──

/** JS 侧可选宿主面（`interface HostBridge { ... }`）——抽方法名 */
function hrJsMethods(src) {
  const m = src.match(/interface HostBridge \{(.*?)\n\}/s)
  if (!m) throw new Error('未找到 `interface HostBridge`（宿主运行时 JS 侧桥接口）')
  // 只取方法声明（`name?(args): ret`）——跳注释行
  return [...new Set([...m[1].matchAll(/^\s*(\w+)\??\(/gm)].map((x) => x[1]))].sort()
}

/** Swift 侧 `@objc protocol HostRuntimeExports: JSExport { ... }`——抽方法名 */
function hrProtoMethods(src) {
  const m = src.match(/@objc protocol HostRuntimeExports: JSExport \{(.*?)\n\}/s)
  if (!m) throw new Error('未找到 `@objc protocol HostRuntimeExports`（宿主运行时 JSExport 协议）')
  return [...new Set([...m[1].matchAll(/^\s*func (\w+)\(/gm)].map((x) => x[1]))].sort()
}

/** `final class HostRuntimeBridge` 实现（类体到下一个顶层 final class） */
function hrImplMethods(src) {
  const start = src.indexOf('final class HostRuntimeBridge')
  if (start < 0) throw new Error('未找到 `final class HostRuntimeBridge`')
  const rest = src.slice(start)
  const next = rest.indexOf('\nfinal class ', 1)
  const body = next > 0 ? rest.slice(0, next) : rest
  return [...new Set([...body.matchAll(/^\s*(?:@discardableResult\s+)?func (\w+)\(/gm)].map((x) => x[1]))].sort()
}

/** 检查一对（JS↔协议↔实现）；返回错误消息数组 */
function checkPair(label, js, proto, impl, protoFile, protoName) {
  const errs = []
  const missingInProto = js.filter((x) => !proto.includes(x))
  const missingImpl = proto.filter((x) => !impl.includes(x))
  if (missingInProto.length > 0) {
    errs.push(
      `[ios-wiring] ✗ ${label}：JS 调了但 **JSExport 协议未声明**（运行时 TypeError，且若无相位包裹会静默变绿）：\n` +
        missingInProto.map((m) => `    · ${m}  ← 加进 ${protoFile} 的 @objc protocol ${protoName}`).join('\n'),
    )
  }
  if (missingImpl.length > 0) {
    errs.push(`[ios-wiring] ✗ ${label}：协议声明了但 Bridge 未实现（编译会红，防回归）：\n` +
      missingImpl.map((m) => `    · ${m}`).join('\n'))
  }
  if (VERBOSE) console.log(`[ios-wiring] ${label}：JS ${js.length} · 协议 ${proto.length} · 实现 ${impl.length}`)
  return errs
}

function main() {
  const errs = []
  // ① 自绘桥（原覆盖）
  const ts = fs.readFileSync(TS_FILE, 'utf-8')
  const swift = fs.readFileSync(SWIFT_FILE, 'utf-8')
  errs.push(...checkPair('自绘桥', jsMethods(ts), protoMethods(swift), bridgeMethods(swift),
    'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift', 'SelfDrawExports'))
  // ② 宿主运行时桥（2026-09-30 续）
  const hrTs = fs.readFileSync(HR_TS_FILE, 'utf-8')
  const hrSwift = fs.readFileSync(HR_SWIFT_FILE, 'utf-8')
  errs.push(...checkPair('宿主运行时桥', hrJsMethods(hrTs), hrProtoMethods(hrSwift), hrImplMethods(hrSwift),
    'hosts/ios/ProteusHost/runtime/host-runtime-bridge.swift', 'HostRuntimeExports'))

  if (errs.length > 0) {
    for (const e of errs) console.error(e)
    process.exit(1)
  }
  console.log('[ios-wiring] ✅ 两对桥均一致（自绘桥 + 宿主运行时桥：JS 方法全部在协议里、协议全部有实现）')
}

main()
