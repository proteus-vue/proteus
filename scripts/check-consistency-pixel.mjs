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
      if (arr.length < 2) continue
      const [a, b] = arr
      const imgA = await decodePng(new Uint8Array(fs.readFileSync(a.file)))
      const imgB = await decodePng(new Uint8Array(fs.readFileSync(b.file)))
      pairs.push({ id: `${base}:${a.end}-vs-${b.end}`, a: path.relative(ROOT, a.file), b: path.relative(ROOT, b.file), observation: pixelObservation(imgA, imgB) })
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
