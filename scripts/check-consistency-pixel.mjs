#!/usr/bin/env node
// scripts/check-consistency-pixel.mjs —— ★VC7：L4 像素观察（**非门禁**）+ 噪声基线 schema
//
// 【🔴 本脚本的退出码语义（与其它 check:* 不同——必须读写清楚）】
//   · 噪声基线 **schema 违规** ⇒ exit 2（配置错误，必须修）
//   · **观测结论**（identical/noise-level/changed）**从不**导致非零退出 —— L4 非门禁
//     （卡片硬性："明确声明不追求零噪声，仅作兜底"；标准 §8.1 同款）。
//   ⇒ CI 上这个脚本是"**观察步骤**"，失败报告进 summary，不阻断流水线。
//
// 【它产出什么】`docs/generated/consistency-pixel-report.json`（样本量汇总 + 逐对观测 +
//   已知噪声命中）——供官网指标页（标准 §12.4）与人工走查消费。
//
// 【样本量为什么必须记（卡片原文）】用于验证"L1–L3 过滤后 L4 样本下降一个数量级"的假设。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pixelObservation, buildPixelReport, matchPixelNoise, validatePixelNoiseBaseline, encodePng, decodePng,
  anchorNormalize, convertToSrgb, cropImage,
} from '../packages/consistency/dist/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'docs/consistency-pixel-noise.json')
const OUT = path.join(ROOT, 'docs/generated/consistency-pixel-report.json')
const CHECK = process.argv.includes('--check')

// ① 噪声基线 schema（存在才校验——缺省即"无已知噪声"，合法）
let baseline = { note: '（空基线：尚无人工确认的已知噪声）', entries: [] }
let schemaErrs = []
if (fs.existsSync(BASELINE)) {
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))
    schemaErrs = validatePixelNoiseBaseline(baseline)
  } catch (e) {
    schemaErrs = [`噪声基线解析失败：${e.message}`]
  }
}
if (schemaErrs.length > 0) {
  console.error('[consistency-pixel] ✗ 噪声基线 schema 违规：')
  for (const e of schemaErrs) console.error('  - ' + e)
  process.exit(2)
}

// ② 观测样本：**用真实截图**（存在则用；否则用合成夹具——装置自身可跑，不依赖外部产物）
//   ★真截图的来源：各端随 L4 走查产出（Playwright screenshot / wechatide simulator_screenshot）
//   的入库位置 `docs/generated/consistency-samples/pixels/`。
const SAMPLES_DIR = path.join(ROOT, 'docs/generated/consistency-samples/pixels')

/**
 * ★★五端统一坐标系（锚定归一）——**本批把 L4 从三端拉齐到五端的关键机制**。
 *
 * 【为什么不再用固定 ROI + alignTranslation（三端时代的做法）】各端截图分辨率/DPR 天然互不可比：
 *   小程序模拟器 640×1386（≈1.625×）· Web @DPR2 780×1688 · Android 真机 1080×2400 ·
 *   iOS 模拟器 @3x 1206×2622——而且**设备 chrome 各不相同**（Android 有 ActionBar、iOS 有灵动岛）。
 *   固定像素 ROI 在五端上必然错位。⇒ 改为**按夹具锚块（蓝块）归一到公共坐标系**：
 *   锚块同时给出位置（吸收设备坐标系原点差）与尺寸（吸收 DPR/缩放差）——一个函数覆盖两个自由度。
 *   `anchorNormalize` 输出的每端图都是 640×560、内容起点一致、含两级伪影过滤（1px 左缘 + 圆角角块）。
 *
 * 【实测验证】五端锚块：130×78（小程序）/ 160×96（Web）/ 240×144（Android）/ 240×142（iOS）
 *   ⇒ scale 分别 1.231 / 1.000 / 0.667 / 0.667（**与各端物理倍率完全吻合**）。
 *
 * 【色彩空间】Android 真机截图内嵌 Display P3 ICC ⇒ 比较前转 sRGB（`convertToSrgb`）。
 *   实测：声明 #2f6fed 在 P3 里是 (64,110,229)，转换后回到 (46,111,237)——标准 §13#6 的真数据。
 */
const L4_ANCHOR_SPEC = { probe: [47, 111, 237], outSize: { w: 640, h: 560 }, blockTarget: { x: 12, y: 30, w: 160 } }

/**
 * ★blockTarget.x 从 30 收到 12（2026-10-02·用户反馈"安卓看着偏下"顺带曝出）——
 *   观测窗 = 锚块左侧留 `blockTarget.x/scale` 源像素；x=30 时 Android 窗口从源 x=3 起，
 *   把屏幕左缘的**系统悬浮条**（实测 y 580..776 的白色侧栏手柄）包了进来（约 150 行 × 9px 污染）。
 *   x=12 ⇒ Android 窗口从源 x=30 起（悬浮条 x≤22 被排除）；同时覆盖小程序侧 x=0..1 的 1px 伪影。
 *   夹具内容在锚块右侧（x≥48 源像素）⇒ 收窄左margin 零内容损失（五端输出仍有 12px 左留白）。

/**
 * 归一后的**观测窗口**（从锚块顶部起）——锚块上方的区域仍有设备 chrome：
 *   Android 状态栏（时间/信号）就压在锚块上方（实测：y<30 有 328px 差异，颜色是状态栏文字的白）。
 *   ⇒ 只比"锚块顶部以下"的内容（四元素全在此区间）；`cropImage` 的坐标是**归一图口径**。
 */
const L4_NORM_ROI = { x: 2, y: 28, w: 636, h: 530 }

/** 合成夹具：与一致性夹具同构的简版（直角块 + 圆角块的差异来自 AA——L4 的典型场景） */
function synth(size = 64, corner = false, jitter = 0) {
  const rgba = new Uint8Array(size * size * 4)
  const r = 12
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let inside = true
      if (corner && (x < r && y < r) && (x - r) ** 2 + (y - r) ** 2 > r * r) inside = false
      const c = inside ? [47 + jitter, 111, 237] : [20, 20, 28]
      rgba[i] = c[0]
      rgba[i + 1] = c[1]
      rgba[i + 2] = c[2]
      rgba[i + 3] = 255
    }
  }
  return { width: size, height: size, rgba }
}

async function loadPairs() {
  const pairs = []
  // 真实截图对（若入库了）
  if (fs.existsSync(SAMPLES_DIR)) {
    const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.png')).sort()
    const byBase = new Map()
    for (const f of files) {
      // 命名约定：<case>.<end>.png ⇒ 按 case 分组比 end
      const m = /^(.+)\.([a-z0-9-]+)\.png$/.exec(f)
      if (!m) continue
      const [, base, end] = m
      const arr = byBase.get(base) ?? []
      arr.push({ end, file: path.join(SAMPLES_DIR, f) })
      byBase.set(base, arr)
    }
    for (const [base, arr] of byBase) {
      // ★**锚定归一**（每端一次；失败即报错——"某端锚块找不到"必须红，不能静默跳过该端）
      const normalized = []
      for (const e of arr) {
        const raw = await decodePng(new Uint8Array(fs.readFileSync(e.file)))
        const srgb = convertToSrgb(raw)
        const r = anchorNormalize(srgb, L4_ANCHOR_SPEC)
        normalized.push({
          end: e.end,
          file: e.file,
          img: cropImage(r.img, L4_NORM_ROI),
          norm: {
            srcSize: { width: raw.width, height: raw.height },
            colorSpace: raw.colorSpace ?? 'undeclared',
            block: r.block,
            scale: Math.round(r.scale * 1000) / 1000,
          },
        })
      }
      // ★**全配对**（N 端 ⇒ C(N,2) 对）：五端 ⇒ 10 对。首版只取前两个文件 ⇒ 静默少对——不做隐性截断。
      for (let i = 0; i < normalized.length; i++) {
        for (let j = i + 1; j < normalized.length; j++) {
          const A = normalized[i]
          const B = normalized[j]
          // 配对形态（残差天然不可比，必须标注——混读会把"本来就更大"误判成"某端画坏了"）：
          //   · same-runtime：小程序双渲染器（同设备同 OS，不同渲染器）
          //   · same-platform：iOS 真机 ⇄ iOS 模拟器（同 OS，不同设备/GPU——"设备级差异"的度量）
          //   · cross-runtime：其余（跨 OS/引擎）
          const mp = new Set(['skyline', 'webview'])
          const iosFamily = new Set(['ios', 'ios-device'])
          const mode = mp.has(A.end) && mp.has(B.end)
            ? 'same-runtime'
            : iosFamily.has(A.end) && iosFamily.has(B.end)
              ? 'same-platform'
              : 'cross-runtime'
          pairs.push({
            id: `${base}:${A.end}-vs-${B.end}`,
            a: path.relative(ROOT, A.file),
            b: path.relative(ROOT, B.file),
            mode,
            norm: { a: A.norm, b: B.norm, outSize: L4_ANCHOR_SPEC.outSize },
            observation: pixelObservation(A.img, B.img),
          })
        }
      }
    }
  }
  // 合成夹具（**装置自检**：L4 判据本身要能在 CI 上被验证——不依赖设备）
  {
    const base = synth(64, false)
    const same = synth(64, false)
    const jittered = synth(64, false, 4)          // 整幅色差（噪声级）
    const cornered = synth(64, true)              // 圆角差异（AA——L4 典型场景）
    pairs.push({ id: 'synth:identical', a: 'synth/base', b: 'synth/same', observation: pixelObservation(base, same) })
    pairs.push({ id: 'synth:color-jitter', a: 'synth/base', b: 'synth/jitter+4', observation: pixelObservation(base, jittered) })
    pairs.push({ id: 'synth:corner-aa', a: 'synth/square', b: 'synth/rounded', observation: pixelObservation(base, cornered) })
    // 端到端 PNG 往返（解码路径必须在 CI 可跑）
    pairs.push({ id: 'synth:png-roundtrip', a: 'synth/encode', b: 'synth/decode', observation: pixelObservation(await decodePng(encodePng(base)), base) })
  }
  return pairs
}

async function main() {
const pairs = await loadPairs()
// 已知噪声匹配（留痕条目随报告带出）
const withNoise = pairs.map((p) => {
  const m = matchPixelNoise(p.observation, baseline)
  return m.known ? { ...p, knownNoise: m.entry } : p
})
const report = buildPixelReport(withNoise)
const json = JSON.stringify(report, null, 2) + '\n'

if (CHECK) {
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  const ok = prev === json
  console.log(`  consistency-pixel --check → docs/generated/consistency-pixel-report.json${ok ? ' ✅ 一致' : ' ❌ 漂移'}`)
  console.log(
    `  ▸ 观测 ${report.pairs.length} 对（样本 ${report.totals.sampleCount} 像素）：changed ${report.totals.changedSamples} · clean ${report.totals.cleanSamples} · 已知噪声 ${report.totals.knownNoiseSamples}`,
  )
  console.log('  ★L4 非门禁：观测结论不影响退出码（仅报告）')
  if (!ok) process.exit(1)
  console.log('✅ L4 像素观察报告与基线一致（非门禁）')
  return
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
console.log(`[consistency-pixel] ✅ ${path.relative(ROOT, OUT)}（**非门禁**观察报告）`)
console.log(
  `  观测 ${report.pairs.length} 对（样本 ${report.totals.sampleCount} 像素）：changed ${report.totals.changedSamples} · clean ${report.totals.cleanSamples} · 已知噪声 ${report.totals.knownNoiseSamples}`,
)
}

main().catch((e) => {
  console.error('[consistency-pixel] ✗', e?.message ?? e)
  process.exit(2)
})
