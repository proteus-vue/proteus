#!/usr/bin/env node
// scripts/check-ios-source-lists.mjs —— ★★★iOS 两份源码清单必须同集（决策 #1073）
//
// 【它防什么（本轮真机实测抓出的静默失效）】
//   iOS 宿主源码清单**维护在两处**：
//     · `hosts/ios/check-selfdraw-compile.sh` —— **静态类型检查**（HOST_SRCS 数组）
//     · `hosts/ios/run-selfdraw.sh`           —— **真机构建**（swiftc 命令行参数）
//   两处独立维护 ⇒ 只加一处时：
//     · 只加 check 侧 ⇒ 静态绿、真机 `cannot find 'X' in scope`（本仓 #1067 就踩过：`device-capability.swift`；
//       #1069 又踩一次：`keyboard-watch.swift`）
//     · 只加 run 侧 ⇒ 真机能编但静态类型检查覆盖不到（更隐蔽）
//   ★同族教训：**门禁的覆盖面必须跟着"实际形态"走**——这里实际形态是"两份手写清单"，
//     那就必须有一条判据盯住它们一致，而不是靠改代码时记得两边都改。
//
// 【另一个判据：行尾不得出现双反斜杠】
//   实测事故（#1073）：用脚本往 `run-selfdraw.sh` 的续行清单里插文件名时，行尾被写成 `\\`（两个反斜杠）。
//   bash 把它解析成"转义反斜杠 + 命令结束" ⇒ **后续所有源码文件都不参与编译**，
//   而 `bash -n` 语法检查**照样通过**（语法没错，只是语义变了）⇒ 报一堆"找不到符号"的假错误，
//   真因（文件根本没进编译）完全不可见。
//   ⇒ 静态判据：清单续行一律以**单个** `\` 结尾。
//
// 用法：node scripts/check-ios-source-lists.mjs
// 退出码：0 通过 / 1 命中
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN = path.join(ROOT, 'hosts/ios/run-selfdraw.sh')
const CHECK = path.join(ROOT, 'hosts/ios/check-selfdraw-compile.sh')

let failed = false
const fail = (m) => { console.error(`✗ ${m}`); failed = true }

/** 从文本里抽 `ProteusHost/{runtime,dev,shell}/*.swift`（两处写法不同：数组元素 vs 命令行实参） */
function swiftSources(text) {
  const out = new Set()
  for (const m of text.matchAll(/ProteusHost\/(?:runtime|dev|shell)\/[A-Za-z0-9_-]+\.swift/g)) out.add(m[0])
  return out
}

if (!fs.existsSync(RUN) || !fs.existsSync(CHECK)) {
  fail(`缺 iOS 清单脚本：${path.relative(ROOT, RUN)} / ${path.relative(ROOT, CHECK)}`)
} else {
  const runSrc = fs.readFileSync(RUN, 'utf8')
  const checkSrc = fs.readFileSync(CHECK, 'utf8')

  // ── ① 两份清单必须同集 ──
  const run = swiftSources(runSrc)
  const check = swiftSources(checkSrc)
  // check 侧可能包含只用于类型检查、故意不进真机构建的场景（当前：dev/l4-scene.swift）
  // ★这是**具名例外**：新增例外必须写在这里并给理由（否则视为漂移）。
  const CHECK_ONLY_ALLOWED = new Set(['ProteusHost/dev/l4-scene.swift'])
  const onlyRun = [...run].filter((f) => !check.has(f))
  const onlyCheck = [...check].filter((f) => !run.has(f) && !CHECK_ONLY_ALLOWED.has(f))

  if (onlyRun.length) {
    fail(`这些源码只在 \`run-selfdraw.sh\`（真机构建）里、不在 \`check-selfdraw-compile.sh\`（静态检查）里：${onlyRun.join(', ')}`)
  }
  if (onlyCheck.length) {
    fail(`这些源码只在 \`check-selfdraw-compile.sh\` 里、不在真机构建里：${onlyCheck.join(', ')}（真机会 \`cannot find ... in scope\`）`)
  }
  if (!onlyRun.length && !onlyCheck.length) {
    console.log(`  ✓ 两份源码清单同集（${run.size} 个文件；具名例外 ${CHECK_ONLY_ALLOWED.size} 个）`)
  }

  // ── ② 清单续行不得以双反斜杠结尾 ──
  for (const [file, src] of [[RUN, runSrc], [CHECK, checkSrc]]) {
    const bad = []
    src.split('\n').forEach((line, i) => {
      if (/\\\\\s*$/.test(line) && /ProteusHost\/|ABI_LIB|LIB"?\s*\\/.test(line)) bad.push(i + 1)
    })
    if (bad.length) {
      fail(`\`${path.relative(ROOT, file)}\` 第 ${bad.join(', ')} 行以**双反斜杠**结尾——bash 会当作"转义反斜杠 + 命令结束" ⇒ 后续文件全部不参与编译（\`bash -n\` 查不出来）`)
    }
  }
  if (!failed) console.log('  ✓ 清单续行均为单个反斜杠')
}

if (failed) {
  console.error('\n✗ iOS 源码清单不一致（静态检查与真机构建会验不同的东西）')
  console.error('  修法：两处一起改（新增文件同时进 HOST_SRCS 与 run-selfdraw.sh 的 swiftc 实参）')
  process.exit(1)
}
console.log('✅ iOS 源码清单一致（静态检查 ⇄ 真机构建 同集 · 续行形态正确）')
