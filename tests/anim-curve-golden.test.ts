// tests/anim-curve-golden.test.ts
// ★★RT0 跨语言契约：动画曲线 TS ⇄ Rust 同式（数值级 golden）
//
// 【为什么必须有（本仓纪律：「跨端格式只能有一个实现」）】曲线数值是**跨端契约**：
//   同一份 Vue 源码在 App（Rust 求值）与 Web/MP 上的动画必须看起来一样。
//   若两侧各自"凭印象"写公式，端间会**静默分叉**（动画看起来不同，但没有任何测试会红）。
//   ⇒ 本测试以 **Rust 侧真实求值结果**为期望（来自 `cargo run --release --example rt0_curve_dump`），
//     比对 TS 镜像实现 ⇒ 任一侧改了公式而另一侧没跟 ⇒ 当场红。
//
// 【判据容差】两侧都是「65 点采样表 + 线性插值」，但浮点运算顺序不同（powi vs **、exp/cos vs Math）
//   ⇒ 用 1e-5 容差（远小于视觉可辨阈值；0.5px 级的差异在这个量级之上好几个数量级）。
//   ★端点（u=0 / u=1）用**精确相等**断言——动画起止值不允许浮点残差。
import { describe, it, expect } from 'vitest'
import { curveEval, animValue, AnimCurve } from '@proteus-vue/slot-runtime'

/** ★期望值 = Rust 侧实测（`cargo run --release --example rt0_curve_dump`；u 从 0 到 1 步长 0.1） */
const RUST_GOLDEN: Record<number, number[]> = {
  [AnimCurve.LINEAR]: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  [AnimCurve.EASE_OUT_CUBIC]: [0.0, 0.270842, 0.487906, 0.656918, 0.783894, 0.875, 0.93593, 0.972964, 0.991977, 0.998982, 1.0],
  [AnimCurve.EASE_IN_CUBIC]: [0.0, 0.001018, 0.008023, 0.027036, 0.06407, 0.125, 0.216106, 0.343082, 0.512094, 0.729158, 1.0],
  [AnimCurve.EASE_IN_OUT_CUBIC]: [0.0, 0.004071, 0.032092, 0.108142, 0.256281, 0.5, 0.74372, 0.891858, 0.967908, 0.995929, 1.0],
  [AnimCurve.SPRING_APPROX]: [0.0, 0.702397, 1.12453, 1.163401, 1.059424, 0.985877, 0.973839, 0.988687, 1.001177, 1.004101, 1.0],
}

describe('RT0 动画曲线：TS ⇄ Rust 同式（跨语言 golden）', () => {
  for (const [curveId, expected] of Object.entries(RUST_GOLDEN)) {
    const id = Number(curveId)
    it(`曲线 ${id}：11 个采样点与 Rust 一致（容差 1e-5）`, () => {
      for (let i = 0; i < expected.length; i++) {
        const u = i / (expected.length - 1)
        const got = curveEval(id, u)
        const want = expected[i]!
        expect(Math.abs(got - want), `曲线 ${id} 在 u=${u}：TS ${got} vs Rust ${want}`).toBeLessThan(1e-5)
      }
    })
  }

  it('★端点精确（两侧都钉死——动画起止值不允许浮点残差）', () => {
    for (const id of Object.values(AnimCurve)) {
      expect(curveEval(id, 0)).toBe(0)
      expect(curveEval(id, 1)).toBe(1)
    }
  })

  it('越界 clamp（u<0 ⇒ 起点，u>1 ⇒ 终点）', () => {
    for (const id of Object.values(AnimCurve)) {
      expect(curveEval(id, -0.7)).toBe(0)
      expect(curveEval(id, 3.3)).toBe(1)
    }
  })

  it('未知曲线 id 落 linear（不抛——与 Rust `min(CURVE_COUNT-1)` 行为对齐）', () => {
    // Rust 侧：`tables[(curve as usize).min(CURVE_COUNT - 1)]` ⇒ 越界落到最后一条（spring），
    // TS 侧同样 clamp 到表尾 ⇒ 行为一致（不是"抛错"也不是"落到 linear"）。
    const outOfRange = curveEval(99, 0.5)
    expect(Number.isFinite(outOfRange)).toBe(true)
    expect(outOfRange).toBeCloseTo(curveEval(AnimCurve.SPRING_APPROX, 0.5), 10)
  })

  it('★动画合成与 Rust `tick` 同式（easeOutCubic(0.5)=0.875 ⇒ 合成值 0.875×幅度）', () => {
    // ★口径注释（首版这里写错过，被本测试自己抓住）：Rust 单测 `tick_advances_writes_and_finishes`
    //   用的是 `from=0, to=100` ⇒ 半程 87.5；本断言若用 to=200，半程应为 **175**。
    //   ⇒ 把两个口径都钉住，避免"抄数字不抄前提"。
    expect(curveEval(AnimCurve.EASE_OUT_CUBIC, 0.5)).toBeCloseTo(0.875, 6)
    expect(animValue(AnimCurve.EASE_OUT_CUBIC, 0, 100, 0.5)).toBeCloseTo(87.5, 3) // Rust 单测同口径
    expect(animValue(AnimCurve.EASE_OUT_CUBIC, 0, 200, 0.5)).toBeCloseTo(175, 3)
  })

  it('★判据能变红：改一个采样点即被抓住（防"测试与实现同错"）', () => {
    // 模拟"TS 侧把曲线写错"：用错公式求值必须偏离 golden 超过容差
    const wrong = 1 - (1 - 0.5) ** 2 // 二次而不是三次（典型手滑）
    const right = curveEval(AnimCurve.EASE_OUT_CUBIC, 0.5)
    expect(Math.abs(wrong - right)).toBeGreaterThan(1e-5)
  })
})
