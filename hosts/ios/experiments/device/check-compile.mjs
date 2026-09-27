#!/usr/bin/env node
// hosts/ios/experiments/device/check-compile.mjs —— 真机实验「可编译」门禁
//
// 【为什么】真机版代码在**没有设备/没有证书**的环境里无法运行，但**可以编译**。
//   若不检查，它会静静腐化（API 改名、语法过期），等到真机接上才发现跑不了——
//   而那时排错成本高得多（要连设备 + 签名 + 装包）。
//   本门禁只做「两侧都能编译」，是能在任何 macOS+Xcode 机器上跑的最低成本保障。
//
// 用法：node hosts/ios/experiments/device/check-compile.mjs
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TMP = os.tmpdir()
const targets = [
  { name: '模拟器版', file: path.join(HERE, '../Experiments/main.swift'), sdk: 'iphonesimulator', target: 'arm64-apple-ios15.0-simulator' },
  { name: '真机版', file: path.join(HERE, 'main-device.swift'), sdk: 'iphoneos', target: 'arm64-apple-ios15.0' },
]

const fail = []
for (const t of targets) {
  const out = path.join(TMP, `proteus-compile-check-${t.sdk}`)
  try {
    execFileSync('xcrun', ['--sdk', t.sdk, 'swiftc', '-O', '-target', t.target,
      '-framework', 'UIKit', '-framework', 'CoreText', '-parse-as-library',
      '-o', out, t.file], { stdio: 'pipe' })
    console.log(`  ✓ ${t.name} 编译通过`)
  } catch (e) {
    fail.push(`${t.name}: ${String(e.stderr ?? e).split('\n').slice(0, 4).join(' | ')}`)
    console.log(`  ✗ ${t.name} 编译失败`)
  }
}
if (fail.length) {
  console.error('[ios-exp-compile] ✗ 有变体无法编译：')
  for (const f of fail) console.error('   - ' + f)
  process.exit(1)
}
console.log('[ios-exp-compile] ✅ 实验代码两侧（模拟器 / 真机）均可编译')
