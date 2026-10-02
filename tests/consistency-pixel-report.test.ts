// tests/consistency-pixel-report.test.ts
// ★VC7（L4 像素观察）+ VC8-b（失败报告 + AI 自纠闭环）—— 单测
//
// 【本档要证明的三件事】
//   ① L4 用**感知算法**（pHash）而非纯逐像素——且**如实记录样本量**（卡片硬性要求）；
//   ② L4 的**诚实边界**：1/255 级小面积颜色偏移它抓不到（感知哈希的定义性质）——
//      这正是"L4 非门禁"的原因（该场景由 L3 数值比对负责，见 consistency-compare 的必过项）；
//   ③ **AI 可自纠闭环**：比对失败 → 结构化报告（含 expected/suggestion）→ 应用 autoFixes
//      → 复比通过（闭环成立 = 报告信息足以定位并修正）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pixelObservation, pHash, hammingDistance, buildPixelReport, matchPixelNoise, validatePixelNoiseBaseline,
  encodePng, decodePng, isConsistencyReport, formatReport,
  compareGeometry, buildGeometryReport, applyAutoFixToGeometry, compareStyle, buildStyleReport, resolveTolerance,
} from '@proteus-vue/consistency'
import type { RgbaImage, GeometrySnapshot, PixelNoiseBaseline } from '@proteus-vue/consistency'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projTolerance = resolveTolerance(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/consistency-tolerance.json'), 'utf-8')))

/** 夹具：宽 w 高 h 的纯色底 + 可选左上小方块（按钮） */
function makeImage(w: number, h: number, bg: [number, number, number], btn?: { x: number; y: number; w: number; h: number; color: [number, number, number] }): RgbaImage {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inBtn = btn && x >= btn.x && x < btn.x + btn.w && y >= btn.y && y < btn.y + btn.h
      const c = inBtn ? btn!.color : bg
      rgba[i] = c[0]
      rgba[i + 1] = c[1]
      rgba[i + 2] = c[2]
      rgba[i + 3] = 255
    }
  }
  return { width: w, height: h, rgba }
}

describe('VC7 · L4 像素观察（非门禁）', () => {
  it('① pHash 确定性：同图 => 同哈希；小改动 => 距离变化', () => {
    const a = makeImage(64, 64, [20, 20, 28], { x: 8, y: 8, w: 20, h: 12, color: [47, 111, 237] })
    const b = makeImage(64, 64, [20, 20, 28], { x: 8, y: 8, w: 20, h: 12, color: [47, 111, 237] })
    expect(pHash(a)).toBe(pHash(b))
    expect(hammingDistance(pHash(a), pHash(b))).toBe(0)
    // 大改动（按钮消失）：距离 > 0
    const c = makeImage(64, 64, [20, 20, 28])
    expect(hammingDistance(pHash(a), pHash(c))).toBeGreaterThan(0)
  })

  it('② identical：完全一致（含样本量记录——卡片硬性要求）', () => {
    const img = makeImage(128, 96, [20, 20, 28])
    const obs = pixelObservation(img, img)
    expect(obs.gate, '必须显式声明非门禁').toBe(false)
    expect(obs.verdict).toBe('identical')
    expect(obs.sampleCount).toBe(128 * 96)
    expect(obs.diffPixels).toBe(0)
  })

  it('③ changed：整块颜色改变（大差异）⇒ 检出 + 区域定位 + 样本量', () => {
    const a = makeImage(200, 160, [20, 20, 28], { x: 40, y: 30, w: 60, h: 40, color: [47, 111, 237] })
    const b = makeImage(200, 160, [20, 20, 28], { x: 40, y: 30, w: 60, h: 40, color: [255, 90, 0] })
    const obs = pixelObservation(a, b)
    expect(obs.verdict).toBe('changed')
    expect(obs.diffPixels).toBe(60 * 40)
    expect(obs.regions.length, '差异区域应被定位').toBeGreaterThan(0)
    // 区域应覆盖按钮位置（x∈[40,100), y∈[30,70)）
    const covers = obs.regions.some((r) => r.x < 100 && r.x + r.w > 40 && r.y < 70 && r.y + r.h > 30)
    expect(covers, '差异区域应覆盖按钮范围').toBe(true)
  })

  it('④ 噪声带：亚阈值抖动（抗锯齿级，≤8/255）⇒ noise-level 而非 changed', () => {
    const a = makeImage(64, 64, [100, 100, 100])
    const b = makeImage(64, 64, [104, 104, 104]) // 差 4 < 阈值 8
    const obs = pixelObservation(a, b)
    expect(obs.verdict, '阈值内抖动不应判 changed').toBe('noise-level')
    expect(obs.diffPixels).toBe(0)
  })

  it('⑤ ★诚实的边界：1/255 小面积颜色偏移 L4 抓不到（这正是它非门禁的原因）', () => {
    // 模拟 §7.4 的"按钮变色"在**像素域**的样子：100×40 的按钮从 #2f6fed → #2e6fed（r -1）
    const a = makeImage(800, 900, [20, 20, 28], { x: 100, y: 100, w: 100, h: 40, color: [47, 111, 237] })
    const b = makeImage(800, 900, [20, 20, 28], { x: 100, y: 100, w: 100, h: 40, color: [46, 111, 237] })
    const obs = pixelObservation(a, b)
    expect(obs.hashDistance, '感知哈希对 1/255 微变不敏感（定义性质）').toBe(0)
    expect(obs.verdict, '★L4 判 noise-level——这是**预期行为**，不是缺陷').toBe('noise-level')
    // ★该场景由 L3 数值比对捕获（见 consistency-compare.test.ts 的"按钮变色必过项"）——
    //   本用例是"L4 非门禁"这一决定的**机器证据**：若未来有人把 L4 当门禁，这条会提醒他为什么不行。
  })

  it('⑥ 报告：样本量汇总（"记录每次失败的样本量"是卡片硬性要求）', () => {
    const img = makeImage(64, 64, [20, 20, 28])
    const big = makeImage(64, 64, [200, 0, 0])
    const obsChanged = pixelObservation(img, big)
    const obsSame = pixelObservation(img, img)
    const report = buildPixelReport([
      { id: 'case-changed', a: 'a.png', b: 'b.png', observation: obsChanged },
      { id: 'case-same', a: 'a.png', b: 'a.png', observation: obsSame },
    ])
    expect(report.gate).toBe(false)
    expect(report.totals.sampleCount).toBe(64 * 64 * 2)
    expect(report.totals.changedSamples).toBe(1)
    expect(report.totals.cleanSamples).toBe(1)
    expect(report.totals.diffPixels).toBe(obsChanged.diffPixels)
  })

  it('⑦ 噪声基线：schema 校验（必填/唯一/上限）+ 匹配', () => {
    const good: PixelNoiseBaseline = {
      note: '测试',
      entries: [
        {
          // ★maxHashDistance 按**实测噪声带宽**设（不是凭直觉）：整幅 +4/255 的色差噪声
          //   实测 pHash 距离 14（见 pixel.ts 的 noiseHashDistance 注释）⇒ 噪声条目应覆盖它。
          //   （首版写 2 —— 观测判 noise-level 但基线匹配不上，测试抓出的口径不一致。）
          id: 'N-1', reason: '圆角抗锯齿在两端像素差异（L4 已知噪声）', maxDiffRatio: 0.01, maxHashDistance: 16,
          recordedBy: 'test', recordedAt: '2026-10-02', evidence: { diffPixels: 100, sampleCount: 20000, hashDistance: 1 },
        },
      ],
    }
    expect(validatePixelNoiseBaseline(good)).toEqual([])
    expect(validatePixelNoiseBaseline({ note: '', entries: [{ id: 'x', reason: '', recordedBy: '', recordedAt: '' }] }).length).toBeGreaterThan(0)
    // 上限超出 ⇒ 拒绝（"超过就该查清而不是登记"）
    expect(validatePixelNoiseBaseline({ note: '', entries: [{ ...good.entries[0]!, maxDiffRatio: 0.3 }] }).some((e) => e.includes('maxDiffRatio'))).toBe(true)
    // 匹配：噪声级观测命中
    const a = makeImage(64, 64, [100, 100, 100])
    const b = makeImage(64, 64, [104, 104, 104])
    const obs = pixelObservation(a, b)
    const m = matchPixelNoise(obs, good)
    expect(m.known).toBe(true)
    expect(m.entry?.id).toBe('N-1')
  })
})

describe('VC7 · PNG 编解码（往返 + 真实字节）', () => {
  it('⑧ 编码 → 解码 往返无损（RGBA 逐字节相同）', async () => {
    const img = makeImage(37, 23, [12, 34, 56], { x: 5, y: 5, w: 9, h: 7, color: [200, 100, 50] })
    const png = encodePng(img)
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    const back = await decodePng(png)
    expect(back.width).toBe(37)
    expect(back.height).toBe(23)
    expect(Array.from(back.rgba)).toEqual(Array.from(img.rgba))
  })

  it('⑨ 解码后可直接进观测（端到端：截图路径的最小闭环）', async () => {
    const a = makeImage(64, 64, [20, 20, 28])
    const b = makeImage(64, 64, [220, 20, 28])
    const obs = pixelObservation(await decodePng(encodePng(a)), await decodePng(encodePng(b)))
    expect(obs.verdict).toBe('changed')
  })

  it('⑩ 不支持形态**明确抛错**（不静默产出错像素）', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow(/不是 PNG/)
  })
})

describe('★VC8-b · 结构化失败报告 + AI 自纠闭环', () => {
  const geoFixture = (dx = 0): GeometrySnapshot => ({
    format: 'proteus-geometry-snapshot', version: 1, end: 'web',
    viewport: { width: 400, height: 600 },
    root: {
      nodeId: 1, path: '', x: 0, y: 0, w: 400, h: 600, depth: 0,
      children: [{ nodeId: 2, path: '0', x: 12 + dx, y: 12, w: 200, h: 60, depth: 1, children: [] }],
    },
  })

  it('⑪ 报告结构：每条含 path/属性/期望/实际/偏差/容差类 + 修复建议（卡片四要素+）', () => {
    const cmp = compareGeometry(geoFixture(), geoFixture(7), { tolerance: projTolerance })
    const rep = buildGeometryReport(cmp, { now: '2026-10-02T00:00:00.000Z' })
    expect(isConsistencyReport(rep)).toBe(true)
    expect(rep.ok).toBe(false)
    const d = rep.diffs[0]!
    expect(d.path).toBe('0')
    expect(d.property).toBe('x')
    expect(d.expected).toBe(12)          // 期望 = 真值侧
    expect(d.actual).toBe(19)
    expect(d.deviation).toBe(7)
    expect(d.toleranceClass).toBe('structure')
    expect(d.suggestion.length).toBeGreaterThan(10)
    // 人类可读渲染
    const text = formatReport(rep)
    expect(text).toContain('修复：')
    expect(text).toContain('path=0')
  })

  it('⑫ 缺失/多余/层级错位**不生成 autoFix**（要改结构，不能自动）', () => {
    const missing = geoFixture()
    missing.root.children = []
    const rep = buildGeometryReport(compareGeometry(geoFixture(), missing, { tolerance: projTolerance }))
    expect(rep.diffs.some((d) => d.kind === 'missing-in-candidate')).toBe(true)
    expect(rep.autoFixes).toEqual([])
  })

  it('⑬ ★闭环：报告 → 应用 autoFixes → 复比通过（AI 自纠闭环成立）', () => {
    const mutated = geoFixture(7)
    const rep = buildGeometryReport(compareGeometry(geoFixture(), mutated, { tolerance: projTolerance }))
    expect(rep.ok).toBe(false)
    expect(rep.autoFixes.length).toBeGreaterThan(0)
    // "AI" 读报告 → 应用修复 → 复比
    const { applied, skipped, next } = applyAutoFixToGeometry(mutated, rep)
    expect(applied).toBe(rep.autoFixes.length)
    expect(skipped).toBe(0)
    const again = compareGeometry(geoFixture(), next, { tolerance: projTolerance })
    expect(again.ok, '应用 autoFixes 后复比必须通过——闭环成立').toBe(true)
  })

  it('⑭ 样式报告：颜色差异给出"查归一化输入"式建议；autoFix 指向真值', () => {
    const base = {
      format: 'proteus-style-snapshot' as const, version: 1 as const, end: 'web' as const,
      nodes: [{ nodeId: 2, path: '0', styles: { backgroundColor: { r: 46, g: 111, b: 237, a: 1 } as const } }],
    }
    const cand = {
      format: 'proteus-style-snapshot' as const, version: 1 as const, end: 'webview' as const,
      nodes: [{ nodeId: 2, path: '0', styles: { backgroundColor: { r: 47, g: 111, b: 237, a: 1 } as const } }],
    }
    const rep = buildStyleReport(compareStyle(base, cand, { tolerance: projTolerance }))
    expect(rep.kind).toBe('style')
    const d = rep.diffs.find((x) => x.property === 'backgroundColor')!
    expect(d.class ?? d.toleranceClass).toBe('color')
    expect(d.expected).toEqual({ r: 46, g: 111, b: 237, a: 1 })
    expect(rep.autoFixes[0]!.to).toEqual({ r: 46, g: 111, b: 237, a: 1 })
  })
})
