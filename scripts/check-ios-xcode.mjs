#!/usr/bin/env node
// scripts/check-ios-xcode.mjs —— ★★★#1179：**iOS 工具链解析门禁**（一条命令给出能力答案）
//
// 【为什么需要这个脚本（不是"为了门禁而门禁"）】
//   2026-10-22 我又一次按默认路径找 Xcode：手写
//   `export DEVELOPER_DIR=/Volumes/data1/applications/Xcode.app/...`（那是 **14.2，无 devicectl**）
//   ⇒ `xcrun devicectl list devices` 报 "unable to find utility"
//   ⇒ 我据此对用户说「本机 Xcode 没有 devicectl ⇒ 真机路线不可用」。
//   **而设备一直连着（iPhone 12 · available (paired)），26.5 一直装在
//   /Volumes/data1/work/office-applications/Xcode.app**。
//   ★这条教训 AGENTS.md 的《纪律：先取证，再断言》表格里**早就写着**（"误判本机无可用 Xcode
//     ≈1 小时绕路 · 只查 /Applications 与 mdfind 首个结果"），我仍然重犯
//   ⇒ 说明**写在文档里的经验拦不住，必须做成一条能跑的命令**。
//
// 【本门禁判什么】
//   ① 本机若存在「真机能力完备」（iOS SDK + devicectl）的 Xcode，`lib/xcode-env.sh`
//      必须选中它——否则真机部署会静默不可用（现象是"看着有 Xcode 但装不了机"）。
//   ② `lib/xcode-env.sh` 的候选清单必须覆盖**非默认安装位**（不能只认 `/Applications`）。
//   ③ `hosts/ios/**` 里不得有脚本**绕过解析器**手写单一 Xcode 路径。
//      ★豁免：解析器自身（它就是干这事的）+ 注释行。
//
// 【诚实边界】
//   · 本脚本只判"解析结果与候选覆盖"，**不判**签名/描述文件是否可用（那是 `signing.sh status`）。
//   · 端口/设备状态不在本脚本范围内（设备用 `xcrun devicectl list devices`）。
//
// 用法：node scripts/check-ios-xcode.mjs [--verbose]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBOSE = process.argv.includes('--verbose')

const sh = (cmd, args, env) => {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      }).trim(),
    }
  } catch (e) {
    return { ok: false, out: '', err: String(e.stderr || e.message || '') }
  }
}

// ── ① 让解析器自己回答"它选中了谁" ──────────────────────────────
const resolved = sh('bash', [
  '-c',
  `source "${path.join(ROOT, 'hosts/ios/lib/xcode-env.sh')}" >/dev/null 2>&1; echo "$DEVELOPER_DIR"`,
])

if (!resolved.ok || !resolved.out) {
  console.error('[check-ios-xcode] ✗ lib/xcode-env.sh 没能解析出任何 Xcode')
  console.error('  排查：xcode-select -p · 是否有 Xcode 装在非默认位置')
  console.error(`  可显式指定：PROTEUS_DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer pnpm check:ios-xcode`)
  process.exit(1)
}

const picked = resolved.out
const pickedVersion = sh(path.join(picked, 'usr/bin/xcodebuild'), ['-version'])
const pickedHasDevicectl = fs.existsSync(path.join(picked, 'usr/bin/devicectl'))

// ── ② 枚举本机所有 Xcode，找出"真机能力完备"的候选 ──────────────
const candidates = []
const addCand = (appPath) => {
  const dev = path.join(appPath, 'Contents/Developer')
  if (!fs.existsSync(dev)) return
  if (candidates.some((c) => c.dev === dev)) return
  const ver = sh(path.join(dev, 'usr/bin/xcodebuild'), ['-version'])
  const sdk = sh('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { DEVELOPER_DIR: dev })
  candidates.push({
    dev,
    version: ver.ok ? ver.out.split('\n')[0] : '?',
    hasSdk: sdk.ok && !!sdk.out,
    hasDevicectl: fs.existsSync(path.join(dev, 'usr/bin/devicectl')),
  })
}

// mdfind（Spotlight 可用时最全）+ 常见安装位兜底（★mdfind 可能被索引关闭，不能只靠它）
const md = sh('mdfind', ["kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'"])
if (md.ok) for (const l of md.out.split('\n').filter(Boolean)) addCand(l)

const glue = [process.env.DEVELOPER_DIR, sh('xcode-select', ['-p']).out].filter(Boolean)
for (const d of glue) {
  // 允许直接给 Contents/Developer
  addCand(d.endsWith('/Contents/Developer') ? d.replace(/\/Contents\/Developer$/, '') : d)
}

// ★★关键：非默认卷上的安装位（正是本机踩坑的地方——只查 /Applications 会让解析器"看似成功"）
const globDirs = [
  '/Applications',
  path.join(process.env.HOME || '', 'Applications'),
  '/Volumes/data1/work/office-applications',
  '/Volumes/data1/applications',
]
// 兜底再扫所有 /Volumes/*/ 下一层的 Xcode.app（换机/换卷时不用改本脚本）
const volumesDir = '/Volumes'
if (fs.existsSync(volumesDir)) {
  for (const v of fs.readdirSync(volumesDir)) {
    for (const sub of ['', 'Applications', 'applications', 'work/office-applications']) {
      globDirs.push(path.join(volumesDir, v, sub))
    }
  }
}
for (const d of globDirs) {
  if (d.endsWith('Xcode.app')) { addCand(d); continue }
  let entries = []
  try { entries = fs.readdirSync(d) } catch { continue }
  for (const e of entries) if (/^Xcode.*\.app$/.test(e)) addCand(path.join(d, e))
}

const capable = candidates.filter((c) => c.hasSdk && c.hasDevicectl)

if (VERBOSE || candidates.length > 1) {
  console.log(`[check-ios-xcode] 本机候选（${candidates.length} 个）：`)
  for (const c of candidates) {
    const mark = c.dev === picked ? ' ← 已选中' : ''
    console.log(
      `  · ${c.version}  SDK=${c.hasSdk ? '✓' : '✗'}  devicectl=${c.hasDevicectl ? '✓' : '✗'}  ${c.dev}${mark}`,
    )
  }
}

// ── 判据 ①：有能力完备的 Xcode 就必须选中它 ──────────────────────
const problems = []
if (capable.length > 0 && !pickedHasDevicectl) {
  problems.push(
    `解析器选中了「无 devicectl」的 Xcode（${pickedVersion.ok ? pickedVersion.out.split('\n')[0] : '?'}），` +
      `而本机存在真机能力完备的版本：\n` +
      capable.map((c) => `      ${c.version} → ${c.dev}`).join('\n') +
      `\n      ⇒ 真机部署会静默不可用（"看着有 Xcode 但装不了机"）。`,
  )
}

// ── 判据 ②：候选覆盖必须包含非默认安装位 ─────────────────────────
const envSh = fs.readFileSync(path.join(ROOT, 'hosts/ios/lib/xcode-env.sh'), 'utf8')
const coversNonDefault =
  /mdfind/.test(envSh) || /\/Volumes/.test(envSh) || /office-applications/.test(envSh)
if (!coversNonDefault) {
  problems.push(
    'lib/xcode-env.sh 的候选清单只认默认安装位（无 mdfind / 无 /Volumes 兜底）' +
      ' ⇒ 换机或非默认卷上会解析失败。',
  )
}

// ── 判据 ③：hosts/ios/** 不得绕过解析器手写单一 Xcode 路径 ────────
const offenders = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'results' && e.name !== 'build') walk(p); continue }
    if (!/\.(sh|mjs)$/.test(e.name)) continue
    // 解析器自身 + 本门禁自身豁免
    if (p.endsWith('hosts/ios/lib/xcode-env.sh')) continue
    if (p.endsWith('scripts/check-ios-xcode.mjs')) continue
    const src = fs.readFileSync(p, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return // 注释里提到路径不算违规
      // 手写 DEVELOPER_DIR=<绝对路径> 且不来自变量
      if (/DEVELOPER_DIR=["']?\/(Applications|Volumes)\//.test(line)) {
        offenders.push(`${path.relative(ROOT, p)}:${i + 1}  ${line.trim()}`)
      }
      // xcode-select -p 直接当 DEVDIR 用（绕过后备候选）
      if (/DEVDIR=["']?\$\(xcode-select -p\)/.test(line)) {
        offenders.push(`${path.relative(ROOT, p)}:${i + 1}  ${line.trim()}`)
      }
    })
  }
}
walk(path.join(ROOT, 'hosts/ios'))
if (offenders.length) {
  problems.push(
    'hosts/ios 下有脚本绕过解析器手写 Xcode 路径（应 source lib/xcode-env.sh）：\n' +
      offenders.map((o) => `      ${o}`).join('\n'),
  )
}

// ── 结论 ────────────────────────────────────────────────────────
const pickedLabel = pickedVersion.ok ? pickedVersion.out.split('\n')[0] : '?'
console.log(
  `\n[check-ios-xcode] 选中：${pickedLabel} · devicectl=${pickedHasDevicectl ? '✓' : '✗'} · ${picked}`,
)
if (pickedHasDevicectl) {
  const dev = sh('xcrun', ['devicectl', 'list', 'devices'], { DEVELOPER_DIR: picked })
  if (dev.ok) {
    const lines = dev.out.split('\n').filter((l) => /\bavailable\b|\bunavailable\b|paired/.test(l))
    console.log(`  设备：${lines.length ? lines.length + ' 台已配对（xcrun devicectl list devices 看详情）' : '无已配对设备'}`)
  }
}

if (problems.length) {
  console.error('\n✗ iOS 工具链解析不自洽：')
  for (const p of problems) console.error('  · ' + p)
  console.error(
    '\n  ★纪律：需要 iOS 真机能力时，**一律先跑本命令取路径**，' +
      '不要手写 /Applications 或任何具体安装位——本机 Xcode 在非默认卷上。',
  )
  process.exit(1)
}

console.log('\n✅ iOS 工具链解析自洽（能力完备的 Xcode 会被优先选中；非默认安装位已覆盖）')
