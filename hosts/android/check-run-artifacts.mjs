#!/usr/bin/env node
// hosts/android/check-run-artifacts.mjs —— ★跑后产物自检（**一次运行是否可信**）
//
// 【为什么需要（2026-09-29 用户反馈）】
//   「每次都是测试完才发现自己的测试装置有问题」——人工翻产物很慢，且容易漏。
//   静态契约（check-artifact-contract.mjs）只能保证"流程会产出这些文件"，
//   不能保证"**这一次**的产物是有效数据"（帧数为 0、p50 为 0、缺文件、数值离谱…）。
//   ⇒ 本脚本在验收末尾自动跑：对 run 目录做**有效性断言**，当场给出"这次能不能用"。
//
// 【判据】（任一硬伤 → exit 1）
//   H1 缺关键产物（对比契约里"必须有"的那几个）
//   H2 帧数异常（gfxinfo 全为 0 / 个位数）——典型原因：屏幕灭、app 未渲染
//   H3 p50 解析可疑（p50=0 但 frames>0 —— 这正是 2026-09-29 修掉的解析 bug 的特征）
//   H4 滚动对照缺任一侧（原生对照没跑出来）
//   W  软警告：Janky 比例异常高（>50%，提示可能撞上双峰/后台干扰）
//
// 用法：node hosts/android/check-run-artifacts.mjs <run目录> [--json]
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const dir = args.find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('用法：node check-run-artifacts.mjs <run目录>')
  process.exit(2)
}

const hard = []   // 硬伤
const warn = []   // 软警告

const readIf = (f) => {
  const p = path.join(dir, f)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

// ── H1：关键产物是否齐全 ───────────────────────────────────────────────────
//   只列「汇总/报告会读」的那些（其余是能力覆盖项，缺了不致命）
const REQUIRED_REAL = [
  'layout-report.txt',
  'layout-bench.json',
  'layout-compare-native.json',
  'layout-conformance.json',
  'raw.txt',
]
for (const f of REQUIRED_REAL) {
  if (!fs.existsSync(path.join(dir, f))) hard.push(`H1 缺关键产物：${f}`)
}
// 内存对照：两条通路各自的自包含窗口报告（二者缺一 ⇒ 倍率算不出）
for (const f of ['layout-proteus-only.json', 'layout-native-only.json']) {
  if (!fs.existsSync(path.join(dir, f))) warn.push(`W 缺 ${f}（内存对照可能不完整）`)
}

// ── H2/H3：gfxinfo 帧数与 p50 ──────────────────────────────────────────────
//   解析与 acceptance.sh 的 gfx_parse **同一字段口径**（$4/$3/$3）
const parseGfx = (txt) => {
  const out = { frames: 0, janky: 0, p50: 0 }
  const mF = txt.match(/Total frames rendered:\s*(\d+)/)
  const mJ = txt.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/)
  const mP = txt.match(/50th percentile:\s*(\d+)ms/)
  if (mF) out.frames = Number(mF[1])
  if (mJ) { out.janky = Number(mJ[1]); out.jankyPct = Number(mJ[2]) }
  if (mP) out.p50 = Number(mP[1])
  return out
}
const gfxFiles = fs.readdirSync(dir).filter((f) => /^gfxinfo.*\.txt$/.test(f))
if (gfxFiles.length === 0) {
  hard.push('H2 没有任何 gfxinfo 产物（帧率/掉帧全部无从判定）')
} else {
  for (const f of gfxFiles) {
    const g = parseGfx(fs.readFileSync(path.join(dir, f), 'utf8'))
    if (g.frames === 0) hard.push(`H2 ${f}：帧数 0（app 未渲染？屏幕是否点亮？）`)
    else if (g.frames < 60) hard.push(`H2 ${f}：帧数仅 ${g.frames}（<60）——典型是屏幕灭/未触发滚动`)
    if (g.frames > 0 && g.p50 === 0) {
      hard.push(`H3 ${f}：p50=0 但 frames=${g.frames} ——解析可疑（2026-09-29 修过的字段错位特征）`)
    }
    if (g.jankyPct !== undefined && g.jankyPct > 50) {
      warn.push(`W ${f}：Janky ${g.jankyPct}% 偏高（可能是双峰高态/后台干扰，建议看逐轮分布）`)
    }
  }
}

// ── H4：滚动对照必须两侧都有 ───────────────────────────────────────────────
const coreRounds = gfxFiles.filter((f) => /^gfxinfo-scroll-core-r\d/.test(f)).length
const natRounds = gfxFiles.filter((f) => /^gfxinfo-scroll-native-r\d/.test(f)).length
if (coreRounds === 0 || natRounds === 0) {
  hard.push(`H4 滚动 A/B 逐轮产物不全（Proteus ${coreRounds} 轮 / 原生 ${natRounds} 轮）——对照无法复算`)
} else if (coreRounds !== natRounds) {
  hard.push(`H4 滚动 A/B 轮数不对称（Proteus ${coreRounds} / 原生 ${natRounds}）——中位口径不可比`)
}
if (!fs.existsSync(path.join(dir, 'scroll-ab.txt'))) {
  warn.push('W 缺 scroll-ab.txt（滚动中位结论的可复算产物）')
}
// 原生滚动对照的统计 JSON（内容须是 4000 行滚动，不是截图场景）
const natJson = readIf('layout-scroll-native.json')
if (natJson) {
  try {
    const j = JSON.parse(natJson)
    if (j.path !== 'scroll-native') {
      warn.push(`W layout-scroll-native.json 的 path="${j.path}"（期望 scroll-native）——可能被别的场景覆盖`)
    }
  } catch { warn.push('W layout-scroll-native.json 解析失败') }
} else {
  warn.push('W 缺 layout-scroll-native.json（原生滚动统计）')
}

// ── 核心数值合理性 ─────────────────────────────────────────────────────────
const cmp = readIf('layout-compare-native.json')
if (cmp) {
  try {
    const j = JSON.parse(cmp)
    const p = j.proteus || {}
    const n = j.native || {}
    if (!(p.rust_layout_ms > 0)) warn.push('W proteus.rust_layout_ms 非正数')
    if (!(n.draw_ms > 0)) warn.push('W native.draw_ms 非正数（对照可能没真跑）')
    const painted = p.painted_pixels_sampled
    if (painted !== undefined && painted < 100) {
      warn.push(`W proteus 绘制像素采样仅 ${painted}（可能没画出东西，"快"是假象）`)
    }
  } catch { warn.push('W layout-compare-native.json 解析失败') }
}

// ── ★★对标公平性门禁（2026-09-29：实测发现"两边画的东西不同"就在眼前）──────────
//   背景：`Cmd` 曾没有字号字段 ⇒ Proteus 用 textPaint 默认 12px，而原生 8sp = 24px（本机 480dpi）
//   ⇒ 字形面积差 4×，且**对我们有利**。此类缺陷不会报错、不会变红，只会让对比失真。
//   ⇒ 判据：两侧实际生效字号必须一致（容差 1px）；不一致 ⇒ **硬伤**（本次数据不可用于对标）。
{
  const pj = readIf('layout-app-4050.json')
  const nj = readIf('layout-app-4050-native.json')
  if (pj && nj) {
    try {
      const p = JSON.parse(pj), n = JSON.parse(nj)
      const pt = p.text_px_effective, nt = n.text_px_effective
      if (pt === undefined || nt === undefined) {
        warn.push('W 对标缺 text_px_effective 审计字段（无法机器核验"两侧字号一致"）')
      } else if (Math.abs(pt - nt) > 1) {
        hard.push(`H5 对标不公平：两侧绘制字号不一致（Proteus ${pt}px vs 原生 ${nt}px）` +
          '——字形面积比 ' + ((nt / pt) ** 2).toFixed(2) + '×，对比失真（此类缺陷静默且可能对我们有利）')
      } else {
        console.log(`  ℹ 对标公平性：两侧字号一致（${pt}px vs ${nt}px）`)
      }
    } catch { warn.push('W 对标报告解析失败（公平性无法核验）') }
  }
}

const out = { dir, hard, warn, ok: hard.length === 0 }
if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log('跑后产物自检（本次运行是否可信）')
  console.log(`  目录：${dir}`)
  console.log(`  样本：${gfxFiles.length} 份 gfxinfo · A/B ${coreRounds}/${natRounds} 轮`)
  for (const h of hard) console.log(`  ❌ ${h}`)
  for (const w of warn) console.log(`  ⚠ ${w}`)
  console.log(
    hard.length
      ? '\n✗ 本次运行**不可用**（见上 ❌）——修掉后重跑，不要把这份数据当结论'
      : warn.length
        ? '\n✅ 关键产物齐备（有警告项，按需核对）'
        : '\n✅ 本次运行可信（产物齐备、数值合理）',
  )
}
process.exit(hard.length ? 1 : 0)
