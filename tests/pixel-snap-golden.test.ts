// tests/pixel-snap-golden.test.ts
// ★★卡 I2（舍入时机统一）· TS 侧契约测试 —— 与 Rust `packages/layout-core-rust/src/snap.rs` 配对
//
// 【这份测试在防什么（本仓纪律：跨端契约必须有机器判据）】
//   坐标吸附在**两处**实现：本侧 `pixel-snap.ts`（f64）与 Rust `snap.rs`（f32）。
//   若只测"自己算自己对"，一端改了 half 口径（如 `floor(v+0.5)` → 原生 `round`）另一端不会红，
//   **真机上才差 1px**（且只在负半值出现，极难复现）。
//   ⇒ golden（`packages/layout-core-rust/tests/golden/pixel-snap.json`）由
//     `scripts/gen-pixel-snap-golden.mjs` 生成；两侧各自对同一组输入求值并比对。
//
// 【三段判据】
//   ① 严格段（scalars / boxes）：TS(f64) 与 Rust(f32) 求值必须**一致** ⇒ 本侧直接等于 golden
//   ② 精度边界段（precisionDivergence）：两侧**已知且已分析**的差异（f32 解析/加法舍入）
//      ⇒ 断言本侧等于记录的 tsOut，且与 f32Out 确实不同（防"哪天悄悄统一了却没人更新文档"）
//   ③ 策略锚点：half 值口径 / 边缘吸附（非逐字段 round）/ 三列均分守恒 / 共享边对齐
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapCoord, snapRect } from '../packages/layout-core/src/pixel-snap'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = path.resolve(HERE, '../packages/layout-core-rust/tests/golden/pixel-snap.json')

interface GoldenShape {
  scalars: Array<{ in: number; out: number }>
  boxes: Array<{ in: { x: number; y: number; width: number; height: number }; out: { x: number; y: number; width: number; height: number } }>
  precisionDivergence: {
    scalars: Array<{ in: number; tsOut: number; f32Out: number }>
    boxes: Array<{ in: { x: number; y: number; width: number; height: number }; tsOut: Record<string, number>; f32Out: Record<string, number> }>
  }
}

const golden: GoldenShape = JSON.parse(fs.readFileSync(GOLDEN, 'utf-8'))
/** f32 求值（模拟 Rust 侧：中间结果经 Math.fround 落回 f32） */
const snapCoordF32 = (v: number) => Math.floor(Math.fround(Math.fround(v) + 0.5))

describe('★卡 I2 · 坐标吸附（跨语言 golden）', () => {
  it('golden 结构完整（防被删空后恒绿）', () => {
    expect(golden.scalars.length + golden.boxes.length).toBeGreaterThanOrEqual(20)
    expect(golden.precisionDivergence.scalars.length + golden.precisionDivergence.boxes.length).toBeGreaterThan(0)
  })

  it('严格段：标量吸附与 golden 逐位一致', () => {
    for (const s of golden.scalars) {
      expect(snapCoord(s.in), `标量 ${s.in}`).toBe(s.out)
    }
  })

  it('严格段：盒吸附与 golden 逐字段一致', () => {
    for (const b of golden.boxes) {
      const { x, y, width, height } = b.in
      expect(snapRect(x, y, width, height), `盒 ${JSON.stringify(b.in)}`).toEqual(b.out)
    }
  })

  it('★精度边界段：TS 侧等于记录的 tsOut，且与 f32Out 确实不同', () => {
    for (const s of golden.precisionDivergence.scalars) {
      expect(snapCoord(s.in), `标量 ${s.in}（TS 侧）`).toBe(s.tsOut)
      expect(snapCoordF32(s.in), `标量 ${s.in}（f32 侧）`).toBe(s.f32Out)
      expect(s.tsOut, `标量 ${s.in} 两侧应确实不同`).not.toBe(s.f32Out)
    }
    for (const b of golden.precisionDivergence.boxes) {
      const { x, y, width, height } = b.in
      const got = snapRect(x, y, width, height)
      expect(got.x).toBe(b.tsOut.x)
      expect(got.y).toBe(b.tsOut.y)
      expect(got.width).toBe(b.tsOut.width)
      expect(got.height).toBe(b.tsOut.height)
      const differs = (['x', 'y', 'width', 'height'] as const).some((k) => b.tsOut[k] !== b.f32Out[k])
      expect(differs, `盒 ${JSON.stringify(b.in)} 两侧应至少一项不同`).toBe(true)
    }
  })
})

describe('★卡 I2 · 策略锚点（不依赖 golden 的独立断言）', () => {
  it('half 值口径 = floor(v+0.5)：-0.5→0、-1.5→-1（★不是 Rust round 的 -1 / -2）', () => {
    expect(snapCoord(0.5)).toBe(1)
    expect(snapCoord(1.5)).toBe(2)
    expect(snapCoord(-0.5)).toBe(0)
    expect(snapCoord(-1.5)).toBe(-1)
    // ★对照（本卡真正的跨语言陷阱）：Rust `f32::round` 是**半值远离零**
    //   （(-1.5).round() = -2、(-2.5).round() = -3），与 floor(v+0.5) 在**每个负半值**上都不同。
    //   若哪侧"顺手改回原生舍入"，三端就在负坐标（负 margin / 视口外元素）上差 1px。
    const rustHalfAwayFromZero = (v: number) => Math.sign(v) * Math.floor(Math.abs(v) + 0.5)
    expect(snapCoord(-1.5)).not.toBe(rustHalfAwayFromZero(-1.5))
    expect(snapCoord(-2.5)).not.toBe(rustHalfAwayFromZero(-2.5))
    // ★JS Math.round 只在 -0.5 上与 floor(v+0.5) 有别（-0 vs 0；坐标上不可观测）——
    //   真正的风险是上面那条（Rust），这里同时钉住两者以免误改。
    expect(Object.is(Math.round(-0.5), -0)).toBe(true)
    expect(Object.is(snapCoord(-0.5), 0)).toBe(true)
  })

  it('★边缘吸附（不是逐字段 round）：宽度取边缘差，不保证等于 snap(w)', () => {
    const s = snapRect(10.5, 0, 33.5, 7.75)
    expect(s.x).toBe(11)
    expect(s.width).toBe(33) // 右缘 44 − 左缘 11；而 snap(33.5) 会是 34
    expect(s.width).not.toBe(snapCoord(33.5))
  })

  it('★★鸿蒙三列反例：均分不丢 1px（卡 I2 的原始触发场景）', () => {
    // 逐字段四舍五入的错法：33+33+33 = 99 ⇒ 末尾 1px 缝
    expect(snapCoord(100 / 3) * 3).toBe(99)
    // 边缘吸附：边 [0, 33.333, 66.666, 100] → [0, 33, 67, 100]
    const e = [0, 100 / 3, (100 / 3) * 2, 100].map(snapCoord)
    expect(e).toEqual([0, 33, 67, 100])
    const widths = [e[1]! - e[0]!, e[2]! - e[1]!, e[3]! - e[2]!]
    expect(widths).toEqual([33, 34, 33])
    expect(widths.reduce((a, b) => a + b, 0), '吸附后总宽必须守恒').toBe(100)
  })

  it('共享边对齐：父子同一条边吸到同一整数（否则出现 1px 缝）', () => {
    const parent = snapRect(0.3, 0, 10.4, 10)
    const child = snapRect(5.25, 0, 5.45, 10)
    expect(parent.x + parent.width).toBe(11)
    expect(child.x + child.width).toBe(11)
  })

  it('幂等 + 整数直通（多次导出不漂移；全整数树读数不变）', () => {
    const once = snapRect(10.5, -3.25, 33.5, 7.75)
    expect(snapRect(once.x, once.y, once.width, once.height)).toEqual(once)
    expect(snapRect(12, 200, 600, 40)).toEqual({ x: 12, y: 200, width: 600, height: 40 })
  })

  it('零/负尺寸被夹到 0（吸附只取整，不产生负宽高）', () => {
    expect(snapRect(0, 0, 0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(snapRect(0, 0, -5, -3)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
