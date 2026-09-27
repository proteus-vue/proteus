#!/usr/bin/env node
// hosts/ios/bench.mjs —— iOS 链路性能基准（★可复跑 + 棘轮门禁）
//
// 【为什么性能也要门禁】性能项没有门禁会**静默回退**：一次「顺手」的重构就能把批处理删掉、
//   把 flatten 关掉，而所有功能测试仍然全绿。本脚本把基线数字变成**上限棘轮**。
//
// 【量什么】（与 docs/proteus-performance-plan/00-baseline-and-roadmap.md 对应）
//   ① 启动：bundle 体积 · 解析+编译耗时（占启动 74%——最大单项）
//   ② 运行时：1000 项列表的跨界调用数与耗时（批处理的靶子）
//
// 【棘轮怎么读】上限写在 RATCHET 里；实测超出即红。**下调**（优化成功）时手动改小，
//   与 check:mp-attrs 的「只增不减」相反——性能棘轮是「只降不升」。
//
// 用法：node hosts/ios/bench.mjs [--update]
// 退出码：0 通过 / 1 超阈值
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const BUNDLE = path.join(HERE, 'bridge/dist/bundle.js')

/** ★上限棘轮（只降不升）——当前值 = 2026-09-29 实测基线 + 余量 */
const RATCHET = {
  bundleKB: 520,        // 实测 451.7
  parseCompileMs: 24,   // 实测 18.01（余量给机器差异）
  callsPer1000Items: 6100, // 实测 6001（批处理落地后应大幅下降 → 届时改小）
}

if (!fs.existsSync(BUNDLE)) {
  console.error('[bench] 缺少 bundle——先运行：node hosts/ios/bridge/build.mjs')
  process.exit(2)
}

const update = process.argv.includes('--update')
const compileIfNeeded = (src, out) => {
  if (!fs.existsSync(out) || fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs) {
    console.log(`[bench] 编译 ${path.basename(src)} …`)
    execFileSync('xcrun', ['swiftc', '-O', '-o', out, src, '-framework', 'JavaScriptCore'], { stdio: 'inherit' })
  }
  return out
}

const bridgeBin = compileIfNeeded(path.join(HERE, 'bench-bridge.swift'), path.join(HERE, 'build/bench-bridge'))
const parseBin = compileIfNeeded(path.join(HERE, 'bench-parse.swift'), path.join(HERE, 'build/bench-parse'))

// ── ① 启动：解析 + 编译 ──
const parseOut = execFileSync(parseBin, [BUNDLE], { encoding: 'utf8', cwd: ROOT })
const bundleKB = Number(parseOut.match(/BUNDLE ([\d.]+) KB/)?.[1] ?? 0)
const firstEval = Number(parseOut.match(/FIRST_EVAL\s+=([\d.]+)/)?.[1] ?? 0)
const repeatEval = Number(parseOut.match(/REPEAT_EVAL =([\d.]+)/)?.[1] ?? 0)
const parseCompile = Math.max(0, firstEval - repeatEval)

console.log('\n[bench] ① 启动成本')
console.log(`  bundle          ${bundleKB.toFixed(1)} KB   (上限 ${RATCHET.bundleKB})`)
console.log(`  首次执行        ${firstEval.toFixed(2)} ms`)
console.log(`  解析+编译       ${parseCompile.toFixed(2)} ms   (上限 ${RATCHET.parseCompileMs})`)
console.log(`  执行(已编译)    ${repeatEval.toFixed(2)} ms`)

// ── ② 运行时：跨界调用数 ──
const benchOut = execFileSync(bridgeBin, [BUNDLE], { encoding: 'utf8', cwd: ROOT })
const line1000 = benchOut.split('\n').find((l) => /^1000\s/.test(l)) ?? ''
const cols = line1000.split('|').map((s) => s.trim())
const calls1000 = Number(cols[1] ?? 0)
const ms1000 = Number(cols[3] ?? 0)

console.log('\n[bench] ② 运行时（1000 项列表）')
console.log(`  跨界调用数      ${calls1000}   (上限 ${RATCHET.callsPer1000Items})`)
console.log(`  桥耗时          ${ms1000.toFixed(2)} ms  (60fps 一帧预算 16.7ms)`)

// ── 棘轮判定 ──
const fail = []
if (bundleKB > RATCHET.bundleKB) fail.push(`bundle ${bundleKB.toFixed(1)}KB > ${RATCHET.bundleKB}KB`)
if (parseCompile > RATCHET.parseCompileMs) fail.push(`解析+编译 ${parseCompile.toFixed(2)}ms > ${RATCHET.parseCompileMs}ms`)
if (calls1000 > RATCHET.callsPer1000Items) fail.push(`1000 项调用数 ${calls1000} > ${RATCHET.callsPer1000Items}`)

console.log('')
if (fail.length) {
  console.error('[bench] ✗ 性能回退：')
  for (const f of fail) console.error('   - ' + f)
  console.error('\n  若为**有意**的取舍（如新增功能带体积），请评估后同步上调 RATCHET 并说明理由。')
  process.exit(1)
}
console.log(`[bench] ✅ 性能基线通过（bundle ${bundleKB.toFixed(1)}KB · 解析编译 ${parseCompile.toFixed(2)}ms · 1000 项 ${calls1000} 次调用）`)
if (update) console.log('[bench] （--update 模式：本次仅记录，未改棘轮——请手动编辑上限值）')
