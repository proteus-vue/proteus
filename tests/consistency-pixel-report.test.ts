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
  encodePng, decodePng, isConsistencyReport, formatReport, cropImage, alignTranslation, anchorNormalize,
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

  it('⑦-ROI ★观测区域：排除设备 chrome（样本量只计区域 + region 坐标含偏移 + 越界即红）', () => {
    // 场景：整屏图里有一块"状态栏时钟"（左上）与一块"应用内容"（右下）——
    // 时钟每张都不同（系统性假差异），内容完全相同 ⇒ 无 ROI 判 changed，有 ROI 判 identical
    const a = makeImage(200, 300, [20, 20, 28], { x: 8, y: 8, w: 60, h: 20, color: [180, 180, 180] })
    const b = makeImage(200, 300, [20, 20, 28], { x: 8, y: 8, w: 60, h: 20, color: [200, 200, 200] })
    const btn = (img: RgbaImage, color: [number, number, number]) => {
      for (let y = 120; y < 160; y++) for (let x = 40; x < 120; x++) {
        const i = (y * 200 + x) * 4
        img.rgba[i] = color[0]; img.rgba[i + 1] = color[1]; img.rgba[i + 2] = color[2]
      }
    }
    btn(a, [47, 111, 237]); btn(b, [47, 111, 237])
    expect(pixelObservation(a, b).verdict, '无 ROI：时钟噪声 ⇒ changed').toBe('changed')
    const roi = { x: 0, y: 100, w: 200, h: 100 }
    const obs = pixelObservation(a, b, { roi })
    expect(obs.verdict, '有 ROI（只比内容区）⇒ identical').toBe('identical')
    expect(obs.sampleCount, '样本量只计 ROI 面积').toBe(200 * 100)
    expect(obs.roi, 'ROI 随报告回传（可复现）').toEqual(roi)
    // region 坐标须含 ROI 偏移（消费方看整屏坐标，不是裁剪后坐标）
    const shifted = pixelObservation(a, makeImage(200, 300, [20, 20, 28], { x: 8, y: 8, w: 60, h: 20, color: [200, 200, 200] }), { roi })
    expect(shifted.verdict).toBe('changed')
    const r0 = shifted.regions[0]!
    expect(r0.y, 'region y 应含 ROI 偏移（≥100）').toBeGreaterThanOrEqual(100)
    // 越界 ROI：必须报错（静默截断会让"观测区写错"变成看不出的小区域观测）
    expect(() => cropImage(a, { x: 0, y: 0, w: 260, h: 100 })).toThrow(/越界/)
    expect(() => cropImage(a, { x: -1, y: 0, w: 10, h: 10 })).toThrow(/越界/)
    // cropImage 基本正确性：裁出区域尺寸与像素内容
    const c = cropImage(a, { x: 40, y: 120, w: 80, h: 40 })
    expect([c.width, c.height]).toEqual([80, 40])
    expect(c.rgba[0], '裁剪区首像素应为按钮蓝').toBe(47)
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

describe('VC7 · 平移对齐（跨运行时截图的坐标系原点差）', () => {
  /** 带明显结构的图：24×24 色块（可由基准图**整体平移**得到——测平移的唯一变量） */
  function shiftedBlock(w: number, h: number, shiftX: number, shiftY: number): RgbaImage {
    const rgba = new Uint8Array(w * h * 4)
    const x0 = 20 + shiftX
    const y0 = 20 + shiftY
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const inside = x >= x0 && x < x0 + 24 && y >= y0 && y < y0 + 24
        rgba[i] = inside ? 47 : 20
        rgba[i + 1] = inside ? 111 : 20
        rgba[i + 2] = inside ? 237 : 28
        rgba[i + 3] = 255
      }
    }
    return { width: w, height: h, rgba }
  }

  it('▲1 纯整数平移（b 内容右移 3 / 上移 2）⇒ 拟合精确命中、残差归零；报告回传拟合值', () => {
    const a = shiftedBlock(64, 64, 0, 0)
    const b = shiftedBlock(64, 64, 3, -2)
    const fit = alignTranslation(a, b, { max: 5 })
    // 符号约定（**实测标定**，不是推演）：dx = −(b 内容相对 a 的 x 位移)
    expect(fit.dx).toBe(-3)
    expect(fit.dy).toBe(2)
    expect(fit.diffPixels, '对齐后残差应归零（纯平移）。这里归不了零 ⇒ 拟合或采样映射有 bug').toBe(0)
    expect(fit.diffPixelsRaw, '未对齐时有大量差异（= 平移解释掉的量）').toBeGreaterThan(0)
    expect(fit.max).toBe(5)
    // 经 pixelObservation：translation 随报告回传 + 报告 diff 与拟合值**逐位相等**（口径唯一）
    const obs = pixelObservation(a, b, { alignTranslation: 5 })
    expect(obs.translation).toEqual(fit)
    expect(obs.diffPixels).toBe(fit.diffPixels)
    expect(obs.verdict, '对齐后不应判 changed').not.toBe('changed')
    // ★诚实边界（机器证据）：**不对齐**时同一对图有大量差异——平移对齐会"吸收"真实位移，
    //   "位置是否正确"必须由 L2 几何数值比对承担（见 alignTranslation 注释）
    expect(pixelObservation(a, b).diffPixels).toBeGreaterThan(fit.diffPixels)
  })

  it('▲2 确定性：同输入 ⇒ 同拟合（枚举顺序不影响结果）', () => {
    const a = shiftedBlock(64, 64, 0, 0)
    const b = shiftedBlock(64, 64, -2, 4)
    const f1 = alignTranslation(a, b, { max: 5 })
    const f2 = alignTranslation(a, b, { max: 5 })
    expect(f1).toEqual(f2)
    // 反向平移的符号应对称（左移 2 / 下移 4 ⇒ dx=2 / dy=−4）
    expect([f1.dx, f1.dy, f1.diffPixels]).toEqual([2, -4, 0])
  })

  it('▲3 对照组：无平移 ⇒ (0,0) 且 raw == 对齐后 == 0（不引入假拟合）', () => {
    const img = shiftedBlock(64, 64, 0, 0)
    const fit = alignTranslation(img, img, { max: 4 })
    expect([fit.dx, fit.dy, fit.diffPixels, fit.diffPixelsRaw]).toEqual([0, 0, 0, 0])
  })

  it('▲4 半径上限：位移超出 max ⇒ 搜索不越界（结果仍在 ±max 内且残差可见）', () => {
    const a = shiftedBlock(64, 64, 0, 0)
    const b = shiftedBlock(64, 64, 8, 0)
    const fit = alignTranslation(a, b, { max: 3 })
    expect(Math.abs(fit.dx)).toBeLessThanOrEqual(3)
    expect(Math.abs(fit.dy)).toBeLessThanOrEqual(3)
    expect(fit.diffPixels, '3px 不足以对齐 8px 位移 ⇒ 残差必须可见（不是"对不齐也报 0"）').toBeGreaterThan(0)
  })
})

describe('VC7 · 锚定归一（五端同坐标系比较的前提）', () => {
  /** 合成"端截图"：任意画布上的锚块（蓝 130×78 直角色块）+ 一个内容块（暗灰，检验相对位置） */
  function endShot(w: number, h: number, blockAt: { x: number; y: number }, blockW = 130, blockH = 78): RgbaImage {
    const rgba = new Uint8Array(w * h * 4)
    const bg = [20, 20, 28]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255
      }
    }
    const paint = (x0: number, y0: number, pw: number, ph: number, c: [number, number, number]) => {
      for (let y = y0; y < y0 + ph && y < h; y++) {
        for (let x = x0; x < x0 + pw && x < w; x++) {
          if (x < 0 || y < 0) continue
          const i = (y * w + x) * 4
          rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255
        }
      }
    }
    paint(blockAt.x, blockAt.y, blockW, blockH, [47, 111, 237])                        // 锚块
    paint(blockAt.x, blockAt.y + Math.round(blockH * 1.3), Math.round(blockW * 0.8), Math.round(blockH * 0.6), [42, 63, 102]) // 内容块
    return { width: w, height: h, rgba }
  }
  const SPEC = { probe: [47, 111, 237] as [number, number, number], outSize: { w: 640, h: 560 }, blockTarget: { x: 30, y: 30, w: 160 } }

  it('▲1 归一后锚块精确落在目标矩形（位置 + 尺寸两个自由度都被吸收）', () => {
    const src = endShot(640, 1386, { x: 27, y: 199 })
    const r = anchorNormalize(src, SPEC)
    expect([r.img.width, r.img.height]).toEqual([640, 560])
    expect([r.block.x, r.block.y]).toEqual([27, 199])
    // 归一后锚块应在 (30,30) 附近、宽 ≈160（±2 像素——整数化 + 重采样误差）
    // （用像素扫描独立复验，而不是相信函数自身的数学）
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    for (let y = 0; y < r.img.height; y++) {
      for (let x = 0; x < r.img.width; x++) {
        const i = (y * r.img.width + x) * 4
        if (Math.abs(r.img.rgba[i]! - 47) <= 12 && Math.abs(r.img.rgba[i + 1]! - 111) <= 12 && Math.abs(r.img.rgba[i + 2]! - 237) <= 12) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
        }
      }
    }
    expect(Math.abs(x0 - 30), `锚块 x=${x0} 应 ≈30`).toBeLessThanOrEqual(2)
    expect(Math.abs(y0 - 30), `锚块 y=${y0} 应 ≈30`).toBeLessThanOrEqual(2)
    expect(Math.abs((x1 - x0 + 1) - 160), `锚块宽=${x1 - x0 + 1} 应 ≈160`).toBeLessThanOrEqual(3)
  })

  it('▲2 整数平移不变性：内容整体平移整数像素 ⇒ 归一输出**逐字节相同**（字节确定性）', () => {
    const a = anchorNormalize(endShot(640, 1386, { x: 27, y: 199 }), SPEC)
    // ★锚点必须离右侧 ≥ 窗口宽（520 源像素——夹具留足边距是这个函数的前置约束，越界会抛错）
    const b = anchorNormalize(endShot(640, 1386, { x: 100, y: 500 }), SPEC)
    expect(Array.from(b.img.rgba)).toEqual(Array.from(a.img.rgba))
  })

  it('▲3 缩放不变性：同一夹具以 1.5× 渲染（源像素尺寸不同）⇒ 归一输出一致', () => {
    const a = anchorNormalize(endShot(640, 1386, { x: 27, y: 199 }), SPEC)
    // 1.5×：锚块 195×117；内容块同步放大（1.3 间距与 0.8/0.6 比例经 round 近似——允许少量差异）
    const b = anchorNormalize(endShot(960, 2079, { x: 40, y: 298 }, 195, 117), SPEC)
    expect([b.img.width, b.img.height]).toEqual([640, 560])
    expect(b.scale, '缩放系数应约 160/195').toBeCloseTo(160 / 195, 3)
    // 内容块中心的大片上色区域应近乎重合（比较两图内容块中心 20×20 的均值）
    let sum = 0, cnt = 0
    for (let y = 90; y < 130; y++) {
      for (let x = 40; x < 120; x++) {
        const ia = (y * a.img.width + x) * 4
        const ib = (y * b.img.width + x) * 4
        if (Math.abs(a.img.rgba[ia]! - 42) <= 12 && Math.abs(b.img.rgba[ib]! - 42) <= 12) cnt++
        sum++
      }
    }
    expect(cnt / sum, '缩放后内容块应大面积重合（≥80%）').toBeGreaterThan(0.8)
  })

  it('▲4 无锚 / 窗口越界 ⇒ 抛错（不静默产出错图）', () => {
    const noAnchor = { width: 100, height: 100, rgba: new Uint8Array(100 * 100 * 4) }
    expect(() => anchorNormalize(noAnchor, SPEC)).toThrow(/未找到锚点色/)
    // 锚块贴边 ⇒ 归一窗口（左/上各留 30/s ≈14px）越界
    const edge = endShot(200, 200, { x: 2, y: 2 })
    expect(() => anchorNormalize(edge, SPEC)).toThrow(/越界/)
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
