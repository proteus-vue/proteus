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
const SWIFT_FILE = path.join(ROOT, 'hosts/ios/ProteusHost/selfdraw-scene.swift')
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

function main() {
  const ts = fs.readFileSync(TS_FILE, 'utf-8')
  const swift = fs.readFileSync(SWIFT_FILE, 'utf-8')
  const js = jsMethods(ts)
  const proto = protoMethods(swift)
  const impl = bridgeMethods(swift)

  const missingInProto = js.filter((x) => !proto.includes(x))
  const missingImpl = proto.filter((x) => !impl.includes(x))

  if (VERBOSE) {
    console.log(`[ios-wiring] JS 侧 ${js.length} · 协议 ${proto.length} · Bridge 实现 ${impl.length}`)
  }
  let failed = false
  if (missingInProto.length > 0) {
    console.error(
      `[ios-wiring] ✗ JS 调了但 **JSExport 协议未声明**（运行时 TypeError，且若无相位包裹会静默变绿）：\n` +
        missingInProto.map((m) => `    · ${m}  ← 加进 hosts/ios/ProteusHost/selfdraw-scene.swift 的 @objc protocol SelfDrawExports`).join('\n'),
    )
    failed = true
  }
  if (missingImpl.length > 0) {
    console.error(
      `[ios-wiring] ✗ 协议声明了但 Bridge 未实现（编译会红，防回归）：\n` +
        missingImpl.map((m) => `    · ${m}`).join('\n'),
    )
    failed = true
  }
  if (failed) process.exit(1)
  console.log(`[ios-wiring] ✅ 三处一致（JS ${js.length} 方法全部在协议里、协议全部有实现）`)
}

main()
