#!/usr/bin/env node
// scripts/check-screen-mount-helpers.mjs —— ★★★屏切换通路（`screen.mount`）纯函数门禁（#1144）
//
// 【为什么需要】
//   2026-10-20 真内核取证（`proteus_layout_create` 原话）：
//     `请求解析失败：invalid type: string "env:--pf-vh", expected f32`
//   ⇒ 鸿蒙 executor 屏内容建树失败、`exec_content_nodes` 从入库基线 114 掉到 **0**（且长期静默：
//     `check-app-screen-content` 那条设备腿只在**产物存在**时判，缺读数不报红）。
//   根因两条，都是"同一语义两通路"：
//     ① `screen.mount` 与 `AppScreenCommands` 是**两条建内核请求的通路**，env 替换只在前者实现了；
//     ② 合成根重映射的 needle 写的是 `"parentId": null`（带空格），而 `JSON.stringify` 产出**紧凑串**
//        ⇒ 从未命中（内容根一直悬空在合成根之外）。
//   ★首版修复还带一个 off-by-2（`at + 12` 越过冒号）——**三种输入实测全不生效**，只看 diff 看不出来。
//   ⇒ 本门禁**真跑这两个纯函数**（不是 grep 调用点），夹具用**紧凑 JSON**（真实产出形态）。
//
// 【两道判据】
//   ① 行为：编译并运行 `hosts/harmony/tools/ScreenMountHelpers.cpp`（14 条用例，任一失败 exit 1）
//   ② 防漂移：runner 里两段函数体必须与 `proteus_host_helpers.h` **逐字节一致**
//      （函数零 OHOS 依赖才敢这么搬；不比对的话 runner 会测一个"早已改掉的旧副本"而长期假绿）
//
// 【诚实边界】验证的是**字符串处理语义**；OHOS 侧编译由 `check:harmony-host-compile` 兜住，
//   端到端建树由 `check:app-screen-content` 的鸿蒙设备腿（`exec_content_nodes>0`）兜住。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEADER = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host_helpers.h')
const RUNNER = path.join(ROOT, 'hosts/harmony/tools/ScreenMountHelpers.cpp')

const problems = []
const say = (m) => console.log(m)

if (!fs.existsSync(HEADER)) problems.push(`缺源文件：${path.relative(ROOT, HEADER)}`)
if (!fs.existsSync(RUNNER)) problems.push(`缺自检 runner：${path.relative(ROOT, RUNNER)}`)

/* ── ② 防漂移：逐字节比对函数体 ── */
if (problems.length === 0) {
  const header = fs.readFileSync(HEADER, 'utf-8')
  const runner = fs.readFileSync(RUNNER, 'utf-8')
  const markers = [
    'retargetFirstNullParent',
    'evalEnvToken',
    'substituteEnvTokens',
    // ★evalEnvToken 有重载风险：头部只有一份实现，取第一个 `static inline double evalEnvToken`
  ]
  for (const fn of markers) {
    const sig = fn === 'evalEnvToken' ? `static inline double ${fn}(` : `static inline void ${fn}(`
    const pick = (src) => {
      const start = src.indexOf(sig)
      if (start < 0) return null
      const end = src.indexOf('\n}\n', start)
      return end < 0 ? null : src.slice(start, end + 3)
    }
    const a = pick(header)
    const b = pick(runner)
    if (a == null) problems.push(`${path.basename(HEADER)} 里找不到 ${fn}（判据要跟实现走，改名后须同步本门禁）`)
    else if (b == null) problems.push(`${path.basename(RUNNER)} 里找不到 ${fn} 的副本`)
    else if (a !== b) {
      problems.push(
        `${fn} 在 runner 与源文件里**不一致**（runner 会测一个过时副本 ⇒ 长期假绿）。` +
          `\n     源文件：${path.relative(ROOT, HEADER)}` +
          `\n     runner：${path.relative(ROOT, RUNNER)}` +
          `\n     修法：把源文件里的函数体**逐字节**复制进 runner 的 BEGIN/END 标记区间。`
      )
    }
  }
}

/* ── ① 行为：编译 + 运行 ── */
if (problems.length === 0) {
  const cxx = spawnSync('clang++', ['--version'], { encoding: 'utf-8' }).status === 0 ? 'clang++' : 'c++'
  const probe = spawnSync(cxx, ['--version'], { encoding: 'utf-8' })
  if (probe.status !== 0) {
    problems.push(`缺 C++ 编译器（clang++/c++）——本门禁需要它编译纯函数自检（本机必有；缺失属环境缺陷）`)
  } else {
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'screen-mount-helpers-')), 'smh')
    const cc = spawnSync(cxx, ['-std=c++17', '-O1', '-o', bin, RUNNER], { encoding: 'utf-8' })
    if (cc.status !== 0) {
      problems.push(`自检 runner 编译失败（源码级缺陷）：\n${(cc.stderr || cc.stdout || '').trim()}`)
    } else {
      let out = ''
      let code = 0
      try {
        out = execFileSync(bin, { encoding: 'utf-8' })
      } catch (e) {
        out = `${e.stdout ?? ''}${e.stderr ?? ''}`
        code = typeof e.status === 'number' ? e.status : 1
      }
      for (const line of out.trim().split('\n')) say(`  ${line}`)
      if (code !== 0) problems.push('屏切换通路纯函数自检有失败用例（见上方 ✗ 行）')
      // ★"条数对齐"是独立判据：防运行器解析失败后只跑 0 条却"没报错"（静默空跑 = 假绿）
      const pass = (out.match(/^ {2}✓ /gm) || []).length
      if (code === 0 && pass < 14) problems.push(`只跑了 ${pass} 条用例（应 ≥ 14）——空跑视同未验证`)
    }
  }
}

if (problems.length > 0) {
  console.error('\n✗ 屏切换通路纯函数门禁未过：')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
say('\n✅ 屏切换通路纯函数门禁通过（env 替换 + 合成根重映射，含防漂移比对）')
