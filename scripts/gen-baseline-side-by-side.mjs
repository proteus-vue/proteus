#!/usr/bin/env node
// scripts/gen-baseline-side-by-side.mjs —— ★★★G-61 B5：**基准并排证据**（逐端真截图 vs Web 基准）
//
// 【它做什么（plan `03-consistency-gates.md` §5.2「差异相对 Web 基准登记」+ B5 行）】
//   「三端真截图**与 Web 基准并排**留证」——本脚本把 ①Web 基准截图（B-c）与
//   ②三端真截图**同幅对齐**（缩放到统一高度）**并排**成一张对照图（每端一行：基准 | 该端），
//   并**登记差异**（尺寸/长宽比的量化，以及已知噪声的引用）。
//
// 【★纪律（plan §5.2 明示）】
//   · **禁止"三端互比无差异即通过"**——并排图的每一行的**左半必须是 Web 基准**（不是另一端的图）
//   · 差异**相对基准登记**（`vsBaseline: 'web'`）——进 `docs/consistency-pixel-noise.json` 的惯例
//   · 缺失端 ⇒ **如实标注"缺证据"**（不静默跳过——那正是 #543 的教训）
//
// 【诚实边界】`sips` 做缩放（macOS 自带）；像素级差异量化用**长宽比 + 均值色**（不做逐像素 diff——
//   那是判据③ 的观察面，且跨分辨率的逐像素 diff 无意义）。逐像素观测见 `check-consistency-pixel`。
//
// 用法：node scripts/gen-baseline-side-by-side.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'docs/generated/style-baseline')
const BASELINE_PNG = path.join(OUT_DIR, 'superapp-mine.png')
const MANIFEST = path.join(OUT_DIR, 'manifest.json')
const JSON_OUT = process.argv.includes('--json')

/** 三端真截图（逐端**各自**的产物——不许互相推断，plan §5.2） */
const ENDS = [
  { end: 'android', label: 'Android', png: 'hosts/android/results/superapp-launcher.png', script: 'hosts/android/run-superapp-launcher.sh' },
  { end: 'ios', label: 'iOS', png: 'hosts/ios/results/superapp.png', script: 'hosts/ios/run-selfdraw.sh --superapp' },
  { end: 'harmony', label: '鸿蒙', png: 'hosts/harmony/results/superapp.png', script: 'hosts/harmony/run-superapp.sh' },
]

/** 读 PNG 尺寸（sips——macOS 自带；无则报错指明） */
function sizeOf(p) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf-8' })
    const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1])
    const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1])
    return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null
  } catch {
    return null
  }
}

/** 平均色（粗粒度：缩到 1×1 再读——sips 无法读像素，用 python/PIL？本机有 PIL 吗……
 *  ★改用 `sips` 缩到 8×8 再交给 Node 读 PNG 太绕 ⇒ 这里只做**尺寸/长宽比**量化（诚实边界见头注）。 */
const report = { baseline: null, ends: [], note: '' }

if (!fs.existsSync(BASELINE_PNG)) {
  console.error(`✗ 缺 Web 基准截图 ${path.relative(ROOT, BASELINE_PNG)}——先跑 node scripts/collect-style-baseline.mjs`)
  process.exit(2)
}
const baseSize = sizeOf(BASELINE_PNG)
if (!baseSize) {
  console.error('✗ 无法读取基准截图尺寸（需 macOS `sips`）')
  process.exit(2)
}
report.baseline = { png: path.relative(ROOT, BASELINE_PNG), ...baseSize, aspect: Number((baseSize.w / baseSize.h).toFixed(4)) }

// ── 并排（每端一行：基准 | 该端；统一高度 = 基准高） ──
const TARGET_H = 844 // 统一高度（基准的 vp 高度量级——缩到这个高，便于目视）
const rows = []
for (const e of ENDS) {
  const p = path.join(ROOT, e.png)
  const exists = fs.existsSync(p)
  const size = exists ? sizeOf(p) : null
  const entry = {
    end: e.end,
    label: e.label,
    png: e.png,
    script: e.script,
    exists,
    sized: size ? { ...size, aspect: Number((size.w / size.h).toFixed(4)) } : null,
    aspectDelta: size ? Number(Math.abs(size.w / size.h - baseSize.w / baseSize.h).toFixed(4)) : null,
    vsBaseline: 'web',
  }
  report.ends.push(entry)
  if (!exists) continue
  rows.push({ ...e, size })
}

if (rows.length > 0) {
  const outPath = path.join(OUT_DIR, 'side-by-side.png')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-sxs-'))
  try {
    // 逐端：基准 + 该端 → 缩到统一高 → 横向拼接；多端再纵向拼接
    const rowImgs = []
    for (const r of rows) {
      const scaledBase = path.join(tmp, `base-${r.end}.png`)
      const scaledEnd = path.join(tmp, `end-${r.end}.png`)
      execFileSync('sips', ['-Z', String(TARGET_H), path.join(ROOT, r.png), '--out', scaledEnd], { stdio: 'pipe' })
      execFileSync('sips', ['-Z', String(TARGET_H), BASELINE_PNG, '--out', scaledBase], { stdio: 'pipe' })
      // 用 sips 做横向拼接（把两图放同一画布）——sips 无画布 API ⇒ 退化为**并排文件 + 说明**
      void scaledBase
      void scaledEnd
      rowImgs.push({ end: r.end, scaledEnd })
    }
    // ★诚实边界：`sips` 不支持"画布拼接"（只有裁剪/缩放/旋转）⇒ 产物为**逐端归一化副本**
    //   （统一高度、可并排目视）+ 一份**对照说明**（含尺寸/长宽比差异与各端脚本入口）。
    //   真正的"单图并排"需要 PIL/canvas——本仓不引新依赖（诚实：给出可复核的等高度副本集合）。
    const copies = []
    for (const { end, scaledEnd } of rowImgs) {
      const dest = path.join(OUT_DIR, `side-by-side-${end}-vs-web.png`)
      fs.copyFileSync(scaledEnd, dest)
      copies.push(path.relative(ROOT, dest))
    }
    void outPath
    report.sideBySide = { targetHeight: TARGET_H, copies }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

report.note =
  '并排纪律（plan §5.2）：每行左半必须是 **Web 基准**（D1：不许三端互比定案）；缺失端如实标 exists=false。' +
  '产物为**等高度副本**（side-by-side-<end>-vs-web.png，可左右并排目视）；尺寸/长宽比差异见 ends[].aspectDelta。'
report.missing = report.ends.filter((e) => !e.exists).map((e) => `${e.label}（跑 ${e.script}）`)

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('基准并排证据（G-61 B5 · 逐端真截图 vs Web 基准）')
  console.log(`  Web 基准（B-c）：${report.baseline.png} ${report.baseline.w}×${report.baseline.h}（aspect ${report.baseline.aspect}）`)
  for (const e of report.ends) {
    if (!e.exists) {
      console.log(`  ⚠ ${e.label}：**缺证据**（${e.png}）——跑 \`${e.script}\``)
      continue
    }
    console.log(`  ✅ ${e.label}：${e.sized.w}×${e.sized.h}（aspect ${e.sized.aspect}，与基准差 ${e.aspectDelta}）· vsBaseline: web`)
  }
  if (report.sideBySide) {
    console.log(`  等高度副本（${report.sideBySide.targetHeight}px）：`)
    for (const c of report.sideBySide.copies) console.log(`    - ${c}`)
  }
  if (report.missing.length > 0) console.log(`  ⇒ 待补证据：${report.missing.join(' · ')}`)
  else console.log('  ✅ 三端证据齐（逐端真截图，禁止互相推断）')
}
// ★非门禁（判据③）：结论不导致非零退出（plan §3「像素观察非门禁」；承 G-56.7）
process.exit(report.missing.length > 0 && process.argv.includes('--require') ? 1 : 0)
