#!/usr/bin/env node
// website/scripts/gen-consistency-data.mjs —— ★CS6：一致性标准页的**数据同源生成器**
//
// 【为什么需要（官网既有纪律：每个数字都可追溯，不手抄）】一致性页要展示 M1–M4、允许差异清单、
//   三端像素对照——这些全部是**机器产物**（docs/generated/*.json + allow-differences.json）。
//   若页面里手写数字，产物一动页面就"说谎"（且没有任何门禁会提醒）。
//   ⇒ 与 gen-content/gen-reference 同一模式：**SSOT = docs/generated JSON**，
//     本脚本产出 `website/src/data/consistency-page.ts`（生成物，勿手改）+ 把三张 L4 截图
//     复制到 `website/public/consistency/`；`--check` 供 CI 防漂移。
//
// 用法：node website/scripts/gen-consistency-data.mjs          # 生成
//       node website/scripts/gen-consistency-data.mjs --check  # 门禁（漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ★SFC 展示图生成用（与 check-consistency-sfc.mjs 同一归一函数——展示与判据同源）
import { decodePng, encodePng, anchorNormalize, convertToSrgb } from '../../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const METRICS = path.join(ROOT, 'docs/generated/consistency-metrics.json')
const PIXEL = path.join(ROOT, 'docs/generated/consistency-pixel-report.json')
/** ★SFC 压力夹具报告（一份源码多端渲染——与 -pixel 是两件事，见 check-consistency-sfc.mjs 头注） */
const SFC = path.join(ROOT, 'docs/generated/consistency-sfc-report.json')
const ALLOW = path.join(ROOT, 'docs/allow-differences.json')
const SHOT_DIR = path.join(ROOT, 'docs/generated/consistency-samples/pixels')
const SFC_SHOT_DIR = path.join(ROOT, 'docs/generated/consistency-samples/sfc')
const OUT_TS = path.join(ROOT, 'website/src/data/consistency-page.ts')
const OUT_PUBLIC = path.join(ROOT, 'website/public/consistency')

const CHECK = process.argv.includes('--check')

/**
 * 截图清单（端 → 源文件名 + **public 目标名** + 展示名）——新增端时只改这一处。
 *
 * ★为什么 public 目标名要用连字符（本批实测踩出的坑）：框架有**平台变体静态资源**机制
 *   （`packages/compiler/src/platform-variant.ts`）——`foo.web.png` ⇒ 构建产物改名 `foo.png`、
 *   `foo.skyline.png` ⇒ 视为 mp 变体、**web 构建时整个排除**。源文件名 `.skyline/.webview/.web`
 *   是 L4 配对约定（`<case>.<end>.png`，check-consistency-pixel 的配对正则读它），不能动；
 *   但 public 副本必须避开变体后缀 ⇒ 连字符名（`asSuffix` 对含 `-` 的段直接返回 undefined，
 *   天然不参与变体映射——实测验证过 5 个候选名）。
 */
const SHOTS = [
  { end: 'skyline', file: 'l4.skyline.png', pub: 'l4-skyline.png', label: '微信 Skyline' },
  { end: 'webview', file: 'l4.webview.png', pub: 'l4-webview.png', label: '微信 WebView' },
  { end: 'web', file: 'l4.web.png', pub: 'l4-web.png', label: '浏览器 Web' },
  // ★五端拉齐（2026-10-02）：Android 真机 + iOS 模拟器（同一夹具，各端系统管线自绘）
  { end: 'android', file: 'l4.android.png', pub: 'l4-android.png', label: 'Android（真机）' },
  { end: 'ios', file: 'l4.ios.png', pub: 'l4-ios.png', label: 'iOS（模拟器）' },
  // ★六端（同日）：iOS **真机**（iPhone 12）——真机/模拟器同平台对照（0.29% = 设备级差异底噪）
  { end: 'ios-device', file: 'l4.ios-device.png', pub: 'l4-ios-device.png', label: 'iOS（真机）' },
]

/**
 * ★★★SFC 压力夹具截图（2026-10-02）——与上面 L4 的差别：这些是**同一个 .vue 文件**
 *   （examples/pages/consistency-stress.vue）经三条编译/实例化链渲染的结果。
 *   public 名同样避开平台变体后缀（`mp.skyline` 里的 `.skyline` 会被当 mp 变体 ⇒ 换连字符）。
 */
const SFC_SHOTS = [
  { end: 'web', file: 'sfc.web.png', pub: 'sfc-web.png', label: '浏览器 Web（SFC 编译产物）' },
  { end: 'mp.skyline', file: 'sfc.mp.skyline.png', pub: 'sfc-mp-skyline.png', label: '微信 Skyline（SFC 编译产物）' },
  { end: 'android', file: 'sfc.android.png', pub: 'sfc-android.png', label: 'Android 真机（Vapor 实例化）' },
  { end: 'ios', file: 'sfc.ios.png', pub: 'sfc-ios.png', label: 'iOS 模拟器（Vapor 实例化）' },
  // ★2026-10-02 补：iOS **真机**（用户指出的缺口——模拟器与真机同平台但证据等级不同）
  { end: 'ios-device', file: 'sfc.ios-device.png', pub: 'sfc-ios-device.png', label: 'iOS 真机（Vapor 实例化）' },
]

function readJson(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`[consistency-data] ✗ 缺 ${what}：${path.relative(ROOT, p)}`)
    console.error('  （先生成对应机器产物：pnpm gen:consistency-metrics / pnpm gen:consistency-pixel）')
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const metrics = readJson(METRICS, 'M1–M4 指标')
const pixel = readJson(PIXEL, 'L4 像素观察报告')
const allow = readJson(ALLOW, '允许差异清单')

/* ── ① 组装数据（全部来自机器产物；无任何手写数字） ── */
const byLayer = metrics.M1.byLayer
/** M4 算子按层聚合（injected = expected=true 的算子数；captured = 其中 caught 的） */
const opLayers = {}
for (const op of metrics.M4.operators) {
  const l = (opLayers[op.layer] ??= { layer: op.layer, injected: 0, captured: 0, operators: [] })
  if (op.expected) {
    l.injected++
    if (op.caught) l.captured++
  }
  l.operators.push({ id: op.id, caught: op.caught, expected: op.expected, note: op.note })
}
const layerOrder = ['L1', 'L2', 'L3', 'L2.5', 'L2.6', 'L4']
const m4Layers = layerOrder.filter((l) => opLayers[l]).map((l) => opLayers[l])

/** 真截图对（只取 L4 夹具；合成夹具是装置自检，不进对外页） */
const realPairs = pixel.pairs.filter((p) => p.id.startsWith('l4:')).map((p) => ({
  id: p.id,
  mode: p.mode ?? null,
  a: p.a.split('/').pop(),
  b: p.b.split('/').pop(),
  verdict: p.observation.verdict,
  diffPixels: p.observation.diffPixels,
  sampleCount: p.observation.sampleCount,
  diffRatio: p.observation.diffRatio,
  hashDistance: p.observation.hashDistance,
  translation: p.observation.translation ?? null,
  knownNoise: p.knownNoise?.id ?? null,
  // ★锚定归一记录（源尺寸/色彩空间/锚块/缩放）——"各端怎么归到统一坐标系"的可复现证据
  norm: p.norm
    ? {
        outSize: p.norm.outSize,
        a: { srcSize: p.norm.a.srcSize, colorSpace: p.norm.a.colorSpace, block: p.norm.a.block, scale: p.norm.a.scale },
        b: { srcSize: p.norm.b.srcSize, colorSpace: p.norm.b.colorSpace, block: p.norm.b.block, scale: p.norm.b.scale },
      }
    : null,
}))
/** 各端归一记录（按端名索引——页面展示"每端源分辨率 → 归一缩放"） */
const endNorm = {}
for (const p of pixel.pairs.filter((x) => x.id.startsWith('l4:') && x.norm)) {
  for (const side of ['a', 'b']) {
    const n = p.norm[side]
    // 从文件名取端名（l4.<end>.png）
    const f = (side === 'a' ? p.a : p.b).split('/').pop()
    const m = /^l4\.([a-z0-9-]+)\.png$/.exec(f)
    if (m && !endNorm[m[1]]) endNorm[m[1]] = { srcSize: n.srcSize, colorSpace: n.colorSpace, block: n.block, scale: n.scale }
  }
}

// ★SFC 压力夹具报告（存在才并入——装置未跑过时页面优雅降级，不阻断）
let sfc = null
try {
  sfc = JSON.parse(fs.readFileSync(SFC, 'utf-8'))
} catch {
  console.warn('[consistency-data] ⚠ 缺 SFC 报告（docs/generated/consistency-sfc-report.json）——页面将不显示 SFC 压测区')
}
const sfcPairs = (sfc?.pairs ?? []).map((p) => ({
  id: p.id,
  mode: p.mode ?? null,
  verdict: p.observation.verdict,
  diffPixels: p.observation.diffPixels,
  sampleCount: p.observation.sampleCount,
  diffRatio: p.observation.diffRatio,
  hashDistance: p.observation.hashDistance,
}))
const sfcEnds = (sfc?.ends ?? []).map((e) => ({ end: e.end, label: e.label, file: e.file, scale: e.norm?.scale ?? null, srcSize: e.norm?.srcSize ?? null }))

const DATA = {
  generatedFrom: ['docs/generated/consistency-metrics.json', 'docs/generated/consistency-pixel-report.json', 'docs/generated/consistency-sfc-report.json', 'docs/allow-differences.json'],
  m1: {
    value: metrics.M1.value,
    union: metrics.M1.union,
    covered: metrics.M1.covered,
    total: metrics.M1.total,
    byLayer: {
      L1: { covered: byLayer.L1.covered, total: byLayer.L1.total },
      L2: { covered: byLayer.L2.covered, total: byLayer.L2.total },
      L3: { covered: byLayer.L3.covered, total: byLayer.L3.total },
      L2_5: { covered: byLayer.L2_5.covered, total: byLayer.L2_5.total },
      L2_6: { covered: byLayer.L2_6.covered, total: byLayer.L2_6.total },
    },
  },
  m2: {
    value: metrics.M2.value,
    items: (allow.items ?? []).map((i) => ({ id: i.id, category: i.category, title: i.title, reason: i.reason })),
  },
  m3: { gates: metrics.M3.gates, enforcedBy: metrics.M3.enforcedBy },
  m4: {
    value: metrics.M4.value,
    injected: metrics.M4.injected,
    captured: metrics.M4.captured,
    pendingCount: (metrics.M4.pendingOperators ?? []).length,
    layers: m4Layers,
  },
  pixel: {
    gate: false,
    changedSamples: pixel.totals.changedSamples,
    cleanSamples: pixel.totals.cleanSamples,
    knownNoiseSamples: pixel.totals.knownNoiseSamples,
    pairs: realPairs,
    endNorm,
  },
  shots: SHOTS,
  // ★★★SFC 压力夹具（一份源码多端渲染）——装置未跑过时为 null（页面不显示该区）
  sfc: sfc
    ? {
        source: sfc.source ?? 'examples/pages/consistency-stress.vue',
        gate: false,
        endCount: sfcEnds.length,
        pairs: sfcPairs,
        ends: sfcEnds,
        shots: SFC_SHOTS,
      }
    : null,
  debt: metrics.debt?.baselines ?? [],
}

/* ── ② TS 模块（生成物——确定性：无时间戳，同源 ⇒ 同字节） ── */
const ts = `// ⚠️ AUTO-GENERATED by website/scripts/gen-consistency-data.mjs — DO NOT EDIT.
// SSOT：${DATA.generatedFrom.join(' · ')}
// 重新生成：pnpm gen:consistency-data · 防漂移门禁：pnpm check:consistency-data
export const CONSISTENCY_PAGE = ${JSON.stringify(DATA, null, 2)} as const
`

/* ── ③ 截图复制（源名 → public 名见 SHOTS.pub；--check 只比对） ── */
function syncShot(shot, dir = SHOT_DIR) {
  const src = path.join(dir, shot.file)
  const dst = path.join(OUT_PUBLIC, shot.pub)
  if (!fs.existsSync(src)) {
    console.error(`[consistency-data] ✗ 缺截图：${path.relative(ROOT, src)}`)
    process.exit(2)
  }
  // ★SFC 展示图用**原始整屏截图**（不做展示性归一——用户 2026-10-02 明确指出：
  //   "不是归一展示的问题，是本身渲染的就出现了差异，这个必须要查" ⇒ 展示就展示真实渲染结果；
  //   Android 尺寸偏小/MP 白底都已在渲染链路上修好，不需要用归一图掩盖）。
  //   归一图仅用于**像素比较**（check-consistency-sfc.mjs，那是判据不是展示）。
  const buf = fs.readFileSync(src)
  if (CHECK) {
    if (!fs.existsSync(dst) || !buf.equals(fs.readFileSync(dst))) {
      console.error(`[consistency-data] ✗ 截图漂移：${path.relative(ROOT, dst)} 与源不一致（跑 pnpm gen:consistency-data）`)
      process.exit(1)
    }
  } else {
    fs.mkdirSync(OUT_PUBLIC, { recursive: true })
    fs.writeFileSync(dst, buf)
  }
}

if (CHECK) {
  const prev = fs.existsSync(OUT_TS) ? fs.readFileSync(OUT_TS, 'utf-8') : ''
  let ok = prev === ts
  if (!ok) console.error('[consistency-data] ✗ 页面数据漂移：website/src/data/consistency-page.ts 与机器产物不一致（跑 pnpm gen:consistency-data）')
  for (const s of SHOTS) syncShot(s)
  // ★SFC 截图（存在 SFC 报告时才要求——装置未跑过时页面降级，门禁不红）
  if (DATA.sfc) for (const s of DATA.sfc.shots) syncShot(s, SFC_SHOT_DIR)
  if (!ok) process.exit(1)
  console.log(`[consistency-data] ✅ 一致性页数据与机器产物一致（M1–M4 + 清单 ${DATA.m2.value} 条 + 真截图对 ${DATA.pixel.pairs.length} 对）`)
} else {
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true })
  fs.writeFileSync(OUT_TS, ts)
  for (const s of SHOTS) syncShot(s)
  if (DATA.sfc) for (const s of DATA.sfc.shots) syncShot(s, SFC_SHOT_DIR)
  console.log(`[consistency-data] ✅ 生成 website/src/data/consistency-page.ts（${ts.length}B）+ 复制 ${SHOTS.length + (DATA.sfc ? DATA.sfc.shots.length : 0)} 张截图 → website/public/consistency/`)
}
