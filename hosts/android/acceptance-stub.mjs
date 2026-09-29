#!/usr/bin/env node
// hosts/android/acceptance-stub.mjs —— ★验收脚本的**设备无关自测**（桩测）
//
// 【为什么必须有（2026-09-29 用户原话）】
//   「**每次都是测试完才发现自己的测试装置有问题**，时间全浪费在测试装置的反复修改上面了。」
//   实测账：当天 acceptance.sh 改了 8 轮，为验证**我自己的脚本改动**跑了 7 次真机全流程
//   （每次 4–6 分钟）——那 40 分钟里绝大多数不是在测框架，是在测这个脚本。
//
//   根因：**脚本本身没有任何不接设备的测试**。于是每个 bash 逻辑 bug
//   （`declare -A` 在 bash 3.2 崩、删文件写在广播之后、变量展开、阶段标签错位）
//   都只能用一次真机全流程去发现——这是结构性缺陷，"下次注意"解决不了。
//
//   本文件把「改脚本 ⇒ 直接跑真机」这条路堵死：
//     · 真机验收启动前校验**指纹**（脚本/宿主源码 vs 上次桩测通过时）——不一致就拒绝启动（`--check-fresh`）
//     · 用**假 adb** 跑完整流程（约 1 分钟，零设备），断言：
//         ① 退出码 0 且无 shell 级错误（unbound variable / command not found / syntax error）
//         ② **命令顺序**（删旧报告必须在广播**之前**——曾经写反，会误删本次产物）
//         ③ 产物齐备（run 目录关键报告 + A/B 逐轮 gfxinfo + scroll-ab.txt）
//         ④ 跑后自检（check-run-artifacts）判"可信"
//         ⑤ bash 3.2 不兼容构造（CI 是 bash 5，抓不到运行时，故显式静态扫）
//
// 用法：
//   node hosts/android/acceptance-stub.mjs               # 跑桩测（通过则写指纹标记）
//   node hosts/android/acceptance-stub.mjs --check-fresh  # 只校验指纹（真机验收前置）
//   node hosts/android/acceptance-stub.mjs --fingerprint  # 打印当前指纹
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const MARKER = path.join(HERE, '.acceptance-stub-ok')
const JAVA_DIR = path.join(HERE, 'app/src/main/java/dev/proteus/layoutcore')
const PKG = 'dev.proteus.layoutcore'
const RESULTS = path.join(HERE, 'results/acceptance')

// ── 指纹：脚本 + 宿主源码 + 分析器 + 产物检查器（任一改动 ⇒ 需重跑桩测）────────
const FP_SOURCES = [
  'acceptance.sh',
  'perfetto-analyze.py',
  'check-artifact-contract.mjs',
  'check-run-artifacts.mjs',
  'build-and-run.sh',
  ...fs.readdirSync(JAVA_DIR).filter((f) => f.endsWith('.java')).map((f) => `app/src/main/java/dev/proteus/layoutcore/${f}`),
]
function fingerprint() {
  const h = crypto.createHash('sha256')
  for (const rel of FP_SOURCES) {
    const p = path.join(HERE, rel)
    h.update(rel).update('\0')
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from(''))
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

const argv = process.argv.slice(2)
if (argv.includes('--fingerprint')) {
  console.log(fingerprint())
  process.exit(0)
}
if (argv.includes('--check-fresh')) {
  const fp = fingerprint()
  const ok = fs.existsSync(MARKER) && fs.readFileSync(MARKER, 'utf8').trim() === fp
  if (!ok) {
    console.error(`✗ 脚本/宿主源码自上次桩测后已修改（当前指纹 ${fp}）`)
    console.error('  ⇒ 先跑设备无关的桩测（约 1 分钟，零设备）：')
    console.error('      node hosts/android/acceptance-stub.mjs')
    console.error('    理由：本仓实测——改脚本后直接跑真机验收，7 次全流程里绝大多数 bug 本可在桩测里发现')
  }
  process.exit(ok ? 0 : 3)
}

// ══════════════════════════════════════════════════════════════════════════
const fails = []
const notes = []
const t0 = Date.now()

// ── ① 静态扫描：bash 3.2 不兼容构造 ────────────────────────────────────────
{
  const raw = fs.readFileSync(path.join(HERE, 'acceptance.sh'), 'utf8')
  // ★先剥注释：本脚本里就有"用 case 而不是 declare -A"这类**解释性注释**——
  //   不剥会把注释本身当违规（实测踩到：门禁的第一次运行就误报了自己）
  const sh = raw
    .split('\n')
    .map((l) => l.replace(/(^|[^\\])#.*$/, '$1'))
    .join('\n')
  const BAD = [
    [/declare\s+-A\b/, 'declare -A（关联数组）——macOS 自带 bash 3.2 不支持，配合 set -u 直接 unbound variable'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^\}/, '${var^^}——bash 4+ 才支持'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*,,}/, '${var,,}——bash 4+ 才支持'],
    [/\bmapfile\b|\breadarray\b/, 'mapfile/readarray——bash 4+ 才支持'],
    [/&>>/, '&>> 重定向——bash 4+ 才支持'],
  ]
  for (const [re, why] of BAD) if (re.test(sh)) fails.push(`E-bash32 静态扫描命中：${why}`)
}

// ── ② 假设备环境 ───────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-stub-'))
const sdk = path.join(tmp, 'sdk')
const devRoot = path.join(tmp, 'device')
const filesDir = path.join(devRoot, 'files')
const snap = path.join(tmp, 'snap')
const LOG = path.join(tmp, 'adb.log')
for (const d of [path.join(sdk, 'platform-tools'), filesDir, snap]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(LOG, '')

// 假设备 gfxinfo（字段口径与真机一致：Total→$4 / Janky→$3 / 50th→$3）
fs.writeFileSync(
  path.join(devRoot, 'gfxinfo.txt'),
  ['Total frames rendered: 1231', 'Janky frames: 2 (0.16%)', 'Janky frames (legacy): 4 (0.33%)',
   '50th percentile: 5ms', '90th percentile: 5ms', '95th percentile: 5ms', '99th percentile: 6ms',
   'Slow UI thread: 0', 'Number Slow issue draw commands: 0', ''].join('\n'),
)

// 每个通路"跑完"应产出的报告（广播时从快照拷进假设备）
const REPORTS = {
  proteus: {
    'layout-report.txt': '=== STUB 验收报告 ===\n（桩测产物，非真机数据）\n',
    'layout-bench.json': { ok: true, node_count: 4051, iterations: 20, median_ms: 25.2, min_ms: 18.5, max_ms: 34.5, measure_calls_first: 0 },
    'layout-compare-native.json': {
      ok: true, elements: 4051,
      proteus: { rust_layout_ms: 47, rust_layout_median_of20_ms: 22.0, canvas_draw_software_ms: 15, canvas_record_displaylist_ms: 5, cmd_count: 2000, painted_pixels_sampled: 14803 },
      native: { create_views_ms: 585, measure_layout_ms: 266, draw_ms: 22, view_count: 4051, painted_pixels_sampled: 12423 },
      same_scope_compare: { phase_layout_ratio: 0.059, phase_draw_ratio_hw: 0.227 },
    },
    'layout-conformance.json': { ok: true, cases: 17, compared_nodes: 67, max_delta_dp: 0.375, tolerance_dp: 0.5, failures: [] },
  },
  'proteus-mem': { 'layout-proteus-only.json': { ok: true, path: 'proteus-mem', pss_delta_kb: 4362, cmd_count: 2000, view_count: 1 } },
  native: { 'layout-native-only.json': { ok: true, path: 'native', pss_delta_kb: 29040, view_count: 4051 } },
  'proteus-noflatten': { 'layout-noflatten.json': { ok: true, path: 'proteus-noflatten', render_node_count: 2000, total_ms: 78 } },
  'flat-redraw': { 'layout-flat-redraw.json': { ok: true, path: 'flat-redraw', elements: 2000, correctness_diff_translate_pixels: 0, correctness_diff_picture_pixels: 0, baseline_replay_per_frame_ms: 2.67, cached_replay_per_frame_ms: 0.045, speedup: 59.4 } },
  recycle: {
    'layout-recycle.json': { ok: true, path: 'recycle', rows: 4000, created: 42, reused: 7926, reuse_ratio: 0.9947 },
    'layout-env.json': { ok: true, path: 'recycle', prime_count: 0, normal_count: 6, tiers: 2, fastest_khz: 2362000, observed_cpus: [0, 1, 4, 5] },
  },
  hit: { 'layout-hit.json': { ok: true, path: 'hit' } },
  scroll: { 'layout-scroll.json': { ok: true, path: 'scroll', rows: 4000, frames_sampled: 599, rn_created: 24, rn_reused: 7955, rn_reuse_ratio: 0.997 } },
  'scroll-core': { 'layout-scroll-core.json': { ok: true, path: 'scroll-core', rows: 4000, frames_sampled: 599, rn_created: 24, rn_reused: 7955, rn_reuse_ratio: 0.997, max_missing_in_visible: 0, skipped_in_acquire: 0 } },
  'scroll-native': { 'layout-scroll-native.json': { ok: true, path: 'scroll-native', rows: 4000, frames_sampled: 599, view_reuse_ratio: 0.997 } },
}
for (const [p, set] of Object.entries(REPORTS)) {
  for (const [name, body] of Object.entries(set)) {
    fs.writeFileSync(path.join(snap, `${p}__${name}`), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
}

// 假 adb：覆盖脚本用到的调用面；未知命令宽容返回 0，但**全部记日志**（供顺序断言）
const STUB = `#!/bin/bash
# 假 adb（acceptance-stub.mjs 生成）
ROOT=${JSON.stringify(devRoot)}
FILES=${JSON.stringify(filesDir)}
SNAP=${JSON.stringify(snap)}
LOG=${JSON.stringify(LOG)}
n=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
n=$((n + 1))
printf '%s|%s\\n' "$n" "$*" >> "$LOG"
map_path() { case "$1" in */sdcard/Android/data/*/files/*) echo "$FILES/\${1##*/files/}" ;; *) echo "" ;; esac; }
cmd="$1"; shift
case "$cmd" in
  get-state) echo device ;;
  install) echo "Success" ;;
  uninstall) echo "Success" ;;
  pull)
    m="$(map_path "$1")"
    [ -n "$m" ] && [ -f "$m" ] && cp "$m" "$2"
    exit 0 ;;
  shell)
    s="$*"
    case "$s" in
      *getprop*ro.product.model*) echo "STUB-DEVICE" ;;
      *"dumpsys power"*) echo "mWakefulness=Awake" ;;
      *"dumpsys battery"*) printf 'level: 100\\nUSB powered: true\\n' ;;
      *"settings get"*) echo 0 ;;
      *"dumpsys gfxinfo"*) cat "$ROOT/gfxinfo.txt" ;;
      *"dumpsys meminfo"*) printf '  TOTAL PSS:   12345            KB\\n' ;;
      *"am broadcast"*)
        p="$(echo "$s" | sed -n 's/.*--es path \\([A-Za-z0-9-]*\\).*/\\1/p')"
        if [ -n "$p" ]; then
          for f in "$SNAP/$p"__*; do
            [ -f "$f" ] || continue
            b="\${f##*/}"; b="\${b#*__}"
            cp "$f" "$FILES/$b"
          done
        fi
        ;;
      *"rm -f "*)
        m="$(map_path "$(echo "$s" | sed -n 's/.*rm -f \\([^ ]*\\).*/\\1/p')")"
        [ -n "$m" ] && rm -f "$m"
        ;;
      *"test -f "*)
        m="$(map_path "$(echo "$s" | sed -n 's/.*test -f \\([^ ]*\\).*/\\1/p')")"
        [ -n "$m" ] && [ -f "$m" ] && exit 0 || exit 1 ;;
      *run-as*) exit 1 ;;
      *thermal*) echo 95000 ;;
      *"/proc/"*) echo 3 ;;
      *perfetto*) touch "$ROOT/trace.pftrace" ;;
      *pidof*) echo 12345 ;;
      *) : ;;
    esac
    exit 0 ;;
  *) exit 0 ;;
esac
`
fs.writeFileSync(path.join(sdk, 'platform-tools', 'adb'), STUB, { mode: 0o755 })

// ── ③ 跑脚本（--quick：覆盖全部控制流分支，但只需 1 轮）──────────────────────
const runDirBefore = new Set(fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS) : [])
const rawPath = path.join(RESULTS, 'raw.txt')
const rawBackup = fs.existsSync(rawPath) ? fs.readFileSync(rawPath) : null

const res = spawnSync('bash', [path.join(HERE, 'acceptance.sh'), '--quick', '--skip-build'], {
  cwd: ROOT,
  encoding: 'utf8',
  // ★桩测自身必须跳过指纹门禁（否则它会被自己挡住：脚本刚改过 ⇒ 指纹必然过期 —— 实测踩到）
  env: { ...process.env, ANDROID_HOME: sdk, SKIP_PREFLIGHT: '1', SKIP_BUILD: '1', SKIP_STUB_GATE: '1' },
  timeout: 300_000,
  maxBuffer: 32 * 1024 * 1024,
})
const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`

const created = fs.readdirSync(RESULTS).filter((d) => !runDirBefore.has(d))
const newRun = created.find((d) => /^\d{8}-\d{6}$/.test(d))

// ── ④ 断言 ─────────────────────────────────────────────────────────────────
if (res.status !== 0) fails.push(`E-exit 脚本退出码 ${res.status}（期望 0）`)
for (const pat of ['unbound variable', 'command not found', 'syntax error']) {
  if (out.includes(pat)) fails.push(`E-shell 输出含 shell 级错误「${pat}」`)
}
if (/自检发现硬伤/.test(out)) fails.push('E-selfcheck 跑后自检判定本次不可信')

{
  const log = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
  const idxRm = log.findIndex((l) => /rm -f .*layout-compare-native\.json/.test(l))
  const idxBc = log.findIndex((l) => /am broadcast .*--es path proteus( |$)/.test(l))
  if (idxRm < 0) fails.push('E-order 日志无"删 layout-compare-native.json"（rm 分支未生效？）')
  else if (idxBc < 0) fails.push('E-order 日志无"广播 path proteus"')
  else if (idxRm > idxBc) fails.push('E-order 删旧报告发生在广播**之后**（会误删本次产物）')
  const ab = log.filter((l) => /am broadcast .*--es path (scroll-core|scroll-native)/.test(l)).length
  if (ab < 2) fails.push(`E-order A/B 广播数 ${ab}（期望 ≥2：scroll-core + scroll-native）`)
}

if (!newRun) {
  fails.push('E-artifact 没有产生 run 目录')
} else {
  const dir = path.join(RESULTS, newRun)
  const must = ['layout-report.txt', 'layout-bench.json', 'layout-compare-native.json', 'layout-conformance.json', 'raw.txt',
    'layout-scroll-core.json', 'layout-scroll-native.json', 'scroll-ab.txt',
    'gfxinfo.txt', 'gfxinfo-scroll-core-r1.txt', 'gfxinfo-scroll-native-r1.txt']
  const missing = must.filter((f) => !fs.existsSync(path.join(dir, f)))
  for (const f of missing) fails.push(`E-artifact run 目录缺 ${f}`)
  const chk = spawnSync('node', [path.join(HERE, 'check-run-artifacts.mjs'), dir], { encoding: 'utf8' })
  if (chk.status !== 0) {
    fails.push(`E-artifact 跑后自检未通过：${(chk.stdout || '').split('\n').filter((l) => l.includes('❌')).join(' / ')}`)
  }
  if (!missing.length) notes.push(`run 目录产物齐备（${must.length} 项）+ 跑后自检 ✅`)
}

// ── ⑤ 还原现场（★必须在断言**之后**：首版在断言前删了 run 目录 ⇒ 全部产物断言误报"缺文件"）──
function restore() {
  if (rawBackup) fs.writeFileSync(rawPath, rawBackup)
  else if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
  for (const d of created) {
    if (/^\d{8}-\d{6}$/.test(d)) fs.rmSync(path.join(RESULTS, d), { recursive: true, force: true })
  }
}

// ── ⑥ 产出 ─────────────────────────────────────────────────────────────────
const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log('验收脚本桩测（设备无关）')
console.log(`  脚本退出码：${res.status} · 耗时：${secs}s`)
for (const n of notes) console.log(`  ℹ ${n}`)
if (fails.length) {
  console.error(`\n❌ ${fails.length} 项未通过：`)
  for (const f of fails) console.error(`  - ${f}`)
  console.error('\n  完整脚本输出末尾 40 行：')
  console.error(out.split('\n').slice(-40).join('\n'))
  restore()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
}
fs.writeFileSync(MARKER, fingerprint() + '\n')
console.log(`\n✅ 桩测通过（指纹 ${fingerprint()} 已记账）——现在可以跑真机验收`)
restore()
fs.rmSync(tmp, { recursive: true, force: true })
