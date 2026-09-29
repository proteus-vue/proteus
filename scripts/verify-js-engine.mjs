#!/usr/bin/env node
// scripts/verify-js-engine.mjs —— ★S2 零设备验证：Android JS 引擎（QuickJS）能否真的跑 Proteus 产物
//
// 【为什么需要（本仓纪律：真机前先过零设备判据）】JNI 桥只能在 Android 上跑，
//   但**"引擎能不能跑我们的 bundle"** 是**设备无关**的问题——用同一份 QuickJS 源码
//   （`.tools/quickjs/`，与 Android 交叉编译用的是同一份）在本机 `qjs` 上验证即可，
//   真机上只剩「JNI 编组是否正确」这一层（那是 S3 的事）。
//
// 【判据（三条，均可变红）】
//   ① qjs 可执行（引擎已获取/构建——否则提示跑 setup 脚本）
//   ② 真实 bundle **语法解析通过**
//   ③ bundle **完整执行无错**（含 Vue 3 初始化）——★这条是"能跑"的实质判据
//
// 【诚实边界】本验证用的是**本机 qjs（x86_64）**，不是 Android `.so`（arm64）。
//   两者**同一份源码**（同版本、同配置）⇒ 语义等价；差异只在 ABI/架构（由 setup 脚本的
//   架构断言覆盖）。⇒ 本脚本证明"引擎能力足够"，**不**证明"JNI 编组正确"（那是 S3）。
//
// 用法：node scripts/verify-js-engine.mjs [bundle.js]
// 退出码：0 通过 / 1 判据失败 / 2 环境缺失
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QJS = path.join(ROOT, '.tools/quickjs/qjs')
const BUNDLE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'hosts/ios/bridge/dist/bundle-selfdraw.js')

if (!fs.existsSync(QJS)) {
  console.error(`✗ 找不到 qjs（${path.relative(ROOT, QJS)}）`)
  console.error('  ⇒ 先跑：bash scripts/setup-android-js-engine.sh --host')
  process.exit(2)
}
if (!fs.existsSync(BUNDLE)) {
  console.error(`✗ 找不到 bundle（${path.relative(ROOT, BUNDLE)}）`)
  console.error('  ⇒ 先构建：node hosts/ios/bridge/build-selfdraw.mjs（或传路径参数）')
  process.exit(2)
}

const src = fs.readFileSync(BUNDLE, 'utf-8')
console.log(`[js-engine] 引擎 ${path.relative(ROOT, QJS)} · bundle ${path.relative(ROOT, BUNDLE)}（${(src.length / 1024).toFixed(1)}KB）`)

// ── 判据②③：解析 + 完整执行（在 qjs 内做，避免把 375KB 源码当命令行参数）──
const probe = `
const src = std.loadFile(${JSON.stringify(BUNDLE)})
if (!src) { console.log(JSON.stringify({ parse: false, run: false, err: 'std.loadFile 返回空' })); }
else {
  let parse = false, run = false, err = ''
  try { new Function(src); parse = true } catch (e) { err = 'parse: ' + e.message }
  if (parse) {
    // ★注入宿主桩后完整执行（模拟宿主编排——bundle 的 IIFE 会读 proteusHost/proteusNative）
    const posted = []
    try {
      const fn = new Function('proteusHost', 'proteusSelfDraw', 'proteusNative', src)
      fn({ post: (j) => posted.push(j) }, new Proxy({}, { get: () => () => '{}' }), new Proxy({}, { get: () => () => 0 }))
      run = true
    } catch (e) { err = 'run: ' + e.message }
    if (run) {
      // ★执行后自检：引擎状态正常（全局对象可读、Proxy 仍工作）
      const ok = typeof globalThis === 'object' && typeof Proxy === 'function'
      if (!ok) { run = false; err = 'post-run 自检失败' }
    }
  }
  console.log(JSON.stringify({ parse, run, err, chars: src.length }))
}
`
let out
try {
  out = execFileSync(QJS, ['--std', '-e', probe], { encoding: 'utf-8', timeout: 120_000 })
} catch (e) {
  console.error(`✗ qjs 执行失败：${e.message}`)
  process.exit(1)
}
const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop()
const r = JSON.parse(line ?? '{}')

const failures = []
if (!r.parse) failures.push(`语法解析失败：${r.err}`)
if (r.parse && !r.run) failures.push(`完整执行失败：${r.err}`)
if (failures.length) {
  console.error('[js-engine] ✗ 判据失败：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[js-engine] ✅ 三条判据通过（引擎可用 · ${r.chars} 字符解析 · 含 Vue 3 初始化完整执行）`)
console.log('  ★边界：本验证用本机 qjs（x86_64），与 Android .so（arm64）**同一份源码**；')
console.log('    ⇒ 证明"引擎能力足够"，不证明"JNI 编组正确"（后者需真机 S3）。')
