#!/usr/bin/env node
// scripts/check-invoke-wire-parity.mjs —— ★★★跨语言二进制线格式的**逐字节等价门禁**（2026-10-13 · #903）
//
// 【为什么需要（这不是"多一个测试"，是结构性防线的落点）】
//   invoke 通道的线格式必须在 **TS / Java / Swift / ArkTS** 各写一份编解码器——这是跨语言通道的
//   物理现实（没有三端共享运行时）。本仓纪律 **#22：第 N 份手写副本 = 下一个静默缺陷**。
//   ⇒ 手写副本**不可怕**，没有对拍才可怕。本门禁给"手写"配上机器判据：
//     ① Node 侧用 **SSOT**（`packages/api/src/invoke-wire.ts`）产出黄金向量（含往返期望值）；
//     ② 各端用**自己的编译器**编译该端唯一实现（Java 纯 JDK / Swift 纯 Foundation ⇒ 都不需要
//        真机、模拟器、SDK）；**各端**跑自检运行器，逐条比对往返字节 + 坏帧必须被拒；
//     ③ 任何一条不等价 ⇒ 本门禁**红**。
//
// 【★失败的典型原因与修法（写在这里，因为红的时候人最需要这句话）】
//   原因几乎总是"某端改了线格式但没同步"：字段顺序 / 长度前缀单位（字节 vs 字符）/ 端序 /
//   "缺省值是否写 TLV"的判据（TS `!== undefined` ⇔ Java `!= null` ⇔ Swift `!= nil`，而**不是** `!= 0`）。
//   修法：**以 TS 为唯一真源**改原生实现；不要反过来改黄金向量（向量由 TS 现算，改它等于改判据）。
//
// 【★扩展纪律（#903 头注承诺的 ROUNDS 扩展位）】新增一端时**追加一个 ROUND**，
//   **不要**新开一个门禁脚本（否则"三端一致"这条性质会被拆成三个各自为政的判据）。
//   已接：TS（生成侧）+ Java（Android 宿主）+ Swift（iOS 宿主）+ ArkTS（鸿蒙 JS 侧）+ C++（鸿蒙宿主侧）。
//   ★ArkTS 轮的诚实边界：ArkTS 无独立 CLI 编译器 ⇒ 该轮用 tsx 执行**同一份源码**验字节语义，
//     能否被 ArkTS 编译由 `hosts/harmony/build-host-app.sh` 兜住（不把"tsx 跑过"说成"ArkTS 编译器验过"）。
//
// 【★诚实边界 / 为什么 Swift 腿缺失时是"响亮跳过"而不是红】本门禁被登记为**仅本地**
//   （CI 是 ubuntu-latest，无 Swift 工具链）。Swift 工具链只存在于 macOS —— 在非 macOS 上，
//   Swift 源码本来就不会被任何东西编译，此时判红只会制造**假红**（"验了但验的不是事实"）。
//   故：Java（JDK 是普适工具链）缺失 ⇒ **红**；Swift 缺失 ⇒ 一行 `⚠ …腿未验证` 响亮跳过。
//   ★防假绿的独立判据：**至少有一端真的跑过**（不能"两端都跳过"却报绿）+ 每端"条数必须与向量相等"
//   （防运行器解析失败后只跑 0 条却"没报错"）。
//
// 用法：node scripts/check-invoke-wire-parity.mjs
// 退出码：0 通过 / 1 不等价或环境缺失
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOLDEN_GEN = path.join(ROOT, 'scripts/invoke-wire-golden.ts')

/* ── 各端源文件（★路径写死是刻意的：改位置必须同步本门禁，避免"移了文件门禁悄悄不跑"） ── */
const JAVA_SRC = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java')
const JAVA_RUNNER = path.join(ROOT, 'hosts/android/tools/InvokeWireParity.java')
const PKG_DIR = 'dev/proteus/layoutcore'
const MAIN_CLASS = 'dev.proteus.layoutcore.InvokeWireParity'
const ARKTS_SRC = path.join(ROOT, 'hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts')
const ARKTS_RUNNER = path.join(ROOT, 'hosts/harmony/tools/InvokeWireParity.ts')
const INVOKE_WIRE_CPP_H = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h')
const CPP_RUNNER = path.join(ROOT, 'hosts/harmony/tools/InvokeWireParity.cpp')
const SWIFT_SRC = path.join(ROOT, 'hosts/ios/ProteusHost/runtime/InvokeWire.swift')
const SWIFT_RUNNER = path.join(ROOT, 'hosts/ios/tools/InvokeWireParity.swift')

let failed = false
const say = (m) => console.log(m)
const die = (m) => { console.error(`✗ ${m}`); failed = true }

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return { code: r.status === null ? 127 : r.status, out: (r.stdout || '') + (r.stderr || '') }
}

/* ★2026-10-17：**优先用仓库自带 JDK**（`.tools/jdk17`）——本机 PATH 里通常没有 javac，
 *   此前门禁因此红（「Unable to locate a Java Runtime」），而工具链其实就在仓库里（hosts 构建脚本也用它）。
 *   只在仓库 JDK 存在时用绝对路径；不存在则仍走 PATH（真缺 JDK ⇒ 依旧按原判据红）。 */
const JDK_BIN = path.join(ROOT, '.tools/jdk17/bin')
const hasRepoJdk = fs.existsSync(path.join(JDK_BIN, 'javac'))
const jdk = (name) => (hasRepoJdk ? path.join(JDK_BIN, name) : name)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iw-parity-'))
const golden = path.join(tmp, 'golden.tsv')

/* ══════════════════════ 各端 round（编译 + 运行） ══════════════════════
 * 每个 round：probe（探编译器）· required（缺工具链时红还是响亮跳过）·
 *             build（编译该端唯一实现，返回一个 exec()）。
 * ★新增端只做两件事：① 写该端唯一编解码器 + 自检运行器；② 在 ROUNDS 里追加一个 round。 */

const ROUNDS = [
  {
    name: 'Java',
    target: 'Android 宿主 `InvokeWire.java`',
    required: true,
    probe: () => run(jdk('javac'), ['-version']),
    versionOf: (out) => (out.match(/javac (\S+)/) || [])[1] || '?',
    missing: (out) => `缺 \`javac\` —— 本门禁需要本机 JDK（纯 JVM 编译 Java 侧编解码器，**不需要** Android SDK/真机）。${out.trim()}`,
    build: () => {
      const srcDir = path.join(tmp, 'src')
      const outDir = path.join(tmp, 'classes')
      fs.mkdirSync(path.join(srcDir, PKG_DIR), { recursive: true })
      fs.mkdirSync(outDir, { recursive: true })
      fs.copyFileSync(JAVA_SRC, path.join(srcDir, PKG_DIR, 'InvokeWire.java'))
      fs.copyFileSync(JAVA_RUNNER, path.join(srcDir, PKG_DIR, 'InvokeWireParity.java'))
      const r = run(jdk('javac'), ['-encoding', 'UTF-8', '-d', outDir,
        path.join(srcDir, PKG_DIR, 'InvokeWire.java'),
        path.join(srcDir, PKG_DIR, 'InvokeWireParity.java')])
      if (r.code !== 0) return { error: `Java 侧编解码器**编译失败**（源码级缺陷，与线格式无关）：\n${r.out.trim()}` }
      return {
        note: 'Java 侧 `InvokeWire` 编译通过（零 android 依赖 ⇒ 无需真机/SDK）',
        exec: () => run(jdk('java'), ['-Dfile.encoding=UTF-8', '-cp', outDir, MAIN_CLASS, golden]),
      }
    },
  },
  {
    name: 'Swift',
    target: 'iOS 宿主 `InvokeWire.swift`',
    required: false, // 非 macOS 无 Swift 工具链 ⇒ 响亮跳过（见文件头「诚实边界」）
    probe: () => run('xcrun', ['-f', 'swiftc']),
    versionOf: () => (run('xcrun', ['swiftc', '--version']).out.match(/Swift version (\S+)/) || [])[1] || '?',
    missing: () => '本机无 Swift 工具链（`xcrun -f swiftc` 不可用；Swift 仅随 macOS/Xcode 提供）',
    build: () => {
      const bin = path.join(tmp, 'iw-parity-swift')
      const r = run('xcrun', ['swiftc', '-O', '-o', bin, SWIFT_SRC, SWIFT_RUNNER])
      if (r.code !== 0) return { error: `Swift 侧编解码器**编译失败**（源码级缺陷，与线格式无关）：\n${r.out.trim()}` }
      return {
        note: 'Swift 侧 `InvokeWire` 编译通过（仅 import Foundation ⇒ 本机 macOS 即可跑）',
        exec: () => run(bin, [golden]),
      }
    },
  },
  {
    name: 'ArkTS',
    target: '鸿蒙宿主 InvokeWire.ts',
    required: true, // tsx 是仓库依赖 ⇒ 缺失属环境缺陷（不是"本机无工具链"的正常状态）
    probe: () => run('npx', ['tsx', '--version']),
    versionOf: (out) => (out.match(/tsx v?(\S+)/) || [])[1] || '?',
    missing: (out) => '缺 `tsx`——本门禁需要它执行 ArkTS 侧的**同一份源码**（ArkTS 无独立 CLI 编译器）。' + out.trim(),
    build: () => {
      // ★先跑一遍再交结果：模块级的语法/导入错误只会在执行时暴露（tsx 不产独立编译产物）。
      const r = run('npx', ['tsx', ARKTS_RUNNER, golden])
      const hasRows = /^ {2}[✓✗] /m.test(r.out)
      if (!hasRows) return { error: 'ArkTS 侧编解码器**执行失败**（源码级缺陷，与线格式无关）：\n' + r.out.trim() }
      return {
        note: 'ArkTS 侧 InvokeWire.ts 跑通（同一份 TS 源码；能否被 ArkTS 编译由 hvigor 构建兜住）',
        exec: () => r,
      }
    },
  },
  {
    name: 'C++',
    target: '鸿蒙宿主 invoke_wire.h',
    required: true, // 本机必有 C++ 工具链（clang++/c++）⇒ 缺失属环境缺陷
    probe: () => {
      const r = run('clang++', ['--version'])
      return r.code === 0 ? r : run('c++', ['--version'])
    },
    versionOf: (out) => (out.match(/(?:clang version|Apple clang version)\s+(\S+)/) || [])[1] || '?',
    missing: (out) => '缺 C++ 编译器（clang++/c++）——本门禁需要它编译宿主侧编解码器。' + out.trim(),
    build: () => {
      const bin = path.join(tmp, 'iw-parity-cpp')
      const cxx = run('clang++', ['--version']).code === 0 ? 'clang++' : 'c++'
      const r = run(cxx, ['-std=c++17', '-O1', `-I${path.dirname(INVOKE_WIRE_CPP_H)}`, '-o', bin, CPP_RUNNER])
      if (r.code !== 0) return { error: 'C++ 侧编解码器**编译失败**（源码级缺陷，与线格式无关）：\n' + r.out.trim() }
      return {
        note: 'C++ 侧 invoke_wire.h 编译通过（零 OHOS 依赖 ⇒ 本机即可跑；OHOS 编译另由 check:harmony-host-compile 兜住）',
        exec: () => run(bin, [golden]),
      }
    },
  },
]

/* ── ① 用 SSOT 产出黄金向量（各端共用同一份） ── */
{
  const r = run('npx', ['tsx', GOLDEN_GEN, golden])
  if (r.code !== 0 || !fs.existsSync(golden)) {
    die(`黄金向量生成失败（tsx）——被生成侧（SSOT）本身就红，先修它：\n${r.out.trim()}`)
    process.exit(1)
  }
  const rows = fs.readFileSync(golden, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  const byKind = rows.reduce((m, l) => { const k = l.split('\t')[1]; m[k] = (m[k] || 0) + 1; return m }, {})
  say(`[check-invoke-wire-parity] 跨语言逐字节等价门禁`)
  say(`  ✓ 黄金向量 ${rows.length} 条（${Object.entries(byKind).map(([k, n]) => `${k}:${n}`).join(' · ')}）`)
  if (rows.length < 15) die(`向量过少（${rows.length}）——对拍覆盖不足，判据会假绿`)
}
const goldenCount = fs.readFileSync(golden, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).length

/* ── ② 逐端编译 + 跑自检（每端都是独立判据；任一端红 ⇒ 整体红） ── */
const ran = []
for (const round of ROUNDS) {
  const probe = round.probe()
  if (probe.code !== 0) {
    if (round.required) {
      die(`[${round.name}] ${round.missing(probe.out)}`)
      continue
    }
    say(`  ⚠ [${round.name}] 腿**未验证**：${round.missing(probe.out)}——（${round.target}）`)
    continue
  }
  const built = round.build()
  if (built.error) { die(`[${round.name}] ${built.error}`); continue }
  say(`  ✓ [${round.name} ${round.versionOf(probe.out)}] ${built.note}`)

  const r = built.exec()
  for (const l of r.out.trim().split('\n')) say(`    ${l.replace(/^\[check-invoke-wire-parity\] /, '')}`)
  const okCount = (r.out.match(/^ {2}✓ /gm) || []).length
  const failCount = (r.out.match(/^ {2}✗ /gm) || []).length
  // ★"条数对齐"是独立判据：防运行器解析失败后**只跑了 0 条**却"没报错"（静默空跑 = 假绿）
  if (okCount !== goldenCount || failCount !== 0) {
    die(`[${round.name}] 条数/结果不符：通过 ${okCount} · 失败 ${failCount}，黄金向量 ${goldenCount} 条`)
  }
  if (r.code !== 0) die(`[${round.name}] 与 TS 侧**逐字节不等价**（详见上方 ✗ 行）`)
  ran.push(round.name)
}

/* ── ③ 独立判据：至少有一端真跑过（否则"全跳过"会被当成通过） ── */
if (ran.length === 0) die('没有任何一端被真正验证（全被跳过）——本门禁等于没跑，按假绿处理')

fs.rmSync(tmp, { recursive: true, force: true })

if (failed) {
  console.error('\n✗ 二进制线格式跨语言不等价（#903 / S2 去 JSON 的契约被破坏）')
  process.exit(1)
}
console.log(`\n✅ 二进制线格式跨语言逐字节等价（TS ⇄ ${ran.join(' ⇄ ')} · ${goldenCount} 条向量）—— #903 契约成立`)
if (ran.length < ROUNDS.length) {
  const skipped = ROUNDS.filter((x) => !ran.includes(x.name)).map((x) => x.name).join(' / ')
  console.log(`ℹ 未验证端：${skipped}（本机无该工具链；已在上面「⚠」行显式标注——**不谎称三端一致**）`)
}
