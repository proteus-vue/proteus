// tests/glass-weave-metric.test.ts
// ★★★决策 #1111：玻璃**织纹（weave）**判据——补上 #1105 缺失的那块能力。
//
// 【为什么需要这个判据（三个决策串起来）】
//   · Android #1013：DIV=2 降采样 → shader 放大时出现「网格状插值织纹」（周期 ≈5-6px），
//     用户肉眼描述"映射感觉有点儿脏" ⇒ 最终改回 DIV=1（全分辨率）。
//   · iOS #1105：想靠降捕获密度省 25%，但画质判据只有「逐点最大通道差」——
//     ★**它结构上测不出织纹**（周期性小偏差被逐点差平均掉）⇒ 默认值保持 2，机会留在桌上。
//   · 本判据 = 空间自相关（与 #1013 定位织纹用的是同一方法），补上那个缺口。
//
// 【本测试守什么】
//   ① **判据有效（最关键）**：对**已知有织纹**的合成图，分数必须显著高于平滑图。
//      —— 没有这条，"真实截图分数低"就可能是"判据失灵"而不是"画质干净"。
//   ② 纯函数正确性：亮度 / 高通 / 自相关在各向同性噪声与纯周期图案上的行为符合预期。
//   ③ 能力边界：判据只回答"有无周期性"，不判"观感合格"。
import { describe, it, expect } from 'vitest'
import {
  luminance,
  highPass,
  autocorr,
  weaveScore,
} from '../scripts/glass-weave-metric.mjs'

/** 造一张 RGBA 图（灰度写进三通道） */
function makeImage(w: number, h: number, fn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))))
      const o = (y * w + x) * 4
      out[o] = out[o + 1] = out[o + 2] = v
      out[o + 3] = 255
    }
  }
  return out
}

/** 用确定性伪随机（避免 flaky） */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('★#1111 织纹判据 · 纯函数', () => {
  it('luminance 用 Rec.601（绿权重最大）', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    const l = luminance(rgba, 3, 1)
    expect(l[0]).toBeCloseTo(0.299 * 255, 3)
    expect(l[1]).toBeCloseTo(0.587 * 255, 3)
    expect(l[2]).toBeCloseTo(0.114 * 255, 3)
  })

  it('highPass：常数图残差恒 0（不把整体明暗当细节）', () => {
    const w = 32, h = 32
    const flat = makeImage(w, h, () => 128)
    const res = highPass(luminance(flat, w, h), w, h)
    for (const v of res) expect(Math.abs(v)).toBeLessThan(1e-9)
  })

  it('highPass：线性斜坡（缓变）残差≈0，只剩边缘效应', () => {
    const w = 64, h = 64
    const ramp = makeImage(w, h, (x) => x * 2) // 水平缓变
    const res = highPass(luminance(ramp, w, h), w, h)
    // 内部区域（避开左右边界）应几乎为 0
    let maxInner = 0
    for (let y = 1; y < h - 1; y++) {
      for (let x = 2; x < w - 2; x++) maxInner = Math.max(maxInner, Math.abs(res[y * w + x]))
    }
    expect(maxInner).toBeLessThan(1e-9)
  })

  it('autocorr：纯周期图案在周期处出峰', () => {
    const w = 128, h = 128
    const fullPeriod = 6
    const halfPeriod = fullPeriod / 2
    // 方波：每 halfPeriod 翻转 ⇒ **完整周期 = fullPeriod**
    //   ★注意 `floor(x/k) % 2` 的周期是 2k（不是 k）——第一版测试期望值写错过一次
    const img = makeImage(w, h, (x) => (Math.floor(x / halfPeriod) % 2 === 0 ? 200 : 60))
    const res = highPass(luminance(img, w, h), w, h)
    const ac = autocorr(res, w, h, { x: 0, y: 0, w, h }, 'h', 12)
    // 完整周期处同相 ≈ 1；半周期处反相 ≈ -1
    expect(ac[fullPeriod]).toBeGreaterThan(0.95)
    expect(ac[halfPeriod]).toBeLessThan(-0.9)
    expect(ac[fullPeriod * 2]).toBeGreaterThan(0.95)
  })
})

describe('★#1111 织纹判据 · **有效性**（判据必须能被证伪）', () => {
  /** 模拟"降采样 → 放大"产生的网格状插值织纹（与 #1013 描述的伪影同形态） */
  function wovenTexture(w: number, h: number, block: number): Uint8Array {
    // 内容：缓变渐变（真实内容）+ 量化到 block 格 → 最近邻放大（织纹来源）
    const small = Math.ceil(w / block)
    const smallH = Math.ceil(h / block)
    const grid = new Float64Array(small * smallH)
    for (let y = 0; y < smallH; y++) {
      for (let x = 0; x < small; x++) {
        // 平滑内容（低频），量化后放大就会在格边出现台阶
        grid[y * small + x] = 100 + 40 * Math.sin(x / 9) + 30 * Math.cos(y / 7)
      }
    }
    return makeImage(w, h, (x, y) => grid[Math.floor(y / block) * small + Math.floor(x / block)])
  }

  function smoothTexture(w: number, h: number): Uint8Array {
    return makeImage(w, h, (x, y) => 100 + 40 * Math.sin(x / 9) + 30 * Math.cos(y / 7))
  }

  it('★已知织纹（block 放大）的分数 **显著高于** 平滑同内容 —— 否则判据无效', () => {
    const w = 240, h = 240
    const region = { x: 20, y: 20, w: 200, h: 200 }

    const smooth = smoothTexture(w, h)
    const sSmooth = weaveScore(highPass(luminance(smooth, w, h), w, h), w, h, region)

    for (const block of [2, 3, 4]) {
      const woven = wovenTexture(w, h, block)
      const sWoven = weaveScore(highPass(luminance(woven, w, h), w, h), w, h, region)
      expect(
        sWoven.score,
        `block=${block} 织纹未被检出（smooth=${sSmooth.score.toFixed(3)} woven=${sWoven.score.toFixed(3)}）`,
      ).toBeGreaterThan(sSmooth.score + 0.15)
    }
  })

  it('★各向同性噪声不应被误判为织纹（它与平滑图分数接近）', () => {
    const w = 240, h = 240
    const region = { x: 20, y: 20, w: 200, h: 200 }
    const rnd = prng(12345)
    const noise = makeImage(w, h, () => 100 + 60 * (rnd() - 0.5))
    const sNoise = weaveScore(highPass(luminance(noise, w, h), w, h), w, h, region)
    const smooth = smoothTexture(w, h)
    const sSmooth = weaveScore(highPass(luminance(smooth, w, h), w, h), w, h, region)
    // 白噪声自相关本应接近 0；比平滑图还低
    expect(sNoise.score).toBeLessThan(sSmooth.score + 0.15)
  })
})

describe('★#1111 织纹判据 · 能力边界', () => {
  it('判据只表达"周期性强度"，不含任何"画质合格"阈值判定', () => {
    // 阈值只用于打印标签，不参与任何自动化结论 ⇒ 防止"分数低 = 画质合格"的误读
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'scripts/glass-weave-metric.mjs'),
      'utf-8',
    ) as string
    expect(src).toMatch(/能力边界/)
    expect(src).toMatch(/不判.{0,10}观感是否合格/)
    // 明确"横向对比"用途
    expect(src).toMatch(/横向对比|同屏同区域/)
  })
})
