// packages/slot-runtime/src/anim-curve.ts
// ★★RT0（2026-09-30）—— **动画曲线的 TS 侧镜像**（跨语言契约的 TS 半边）
//
// 【为什么需要这份 TS 实现（而不是只留 Rust 侧）】
//   曲线的数值是**跨端契约**：App（Rust 求值）与 Web/MP（若走 JS 路径）必须给出**同一曲线**，
//   否则同一份 Vue 源码在不同端的动画看起来不一样（本仓最忌讳的"端间静默分叉"）。
//   `tests/anim-curve-golden.test.ts` 用真实求值两侧比对（Rust 侧的期望值来自
//   `cargo run --example rt0_curve_dump`）⇒ 曲线改了但没同步 ⇒ 当场红。
//
// 【诚实边界】两侧都是**采样表 + 线性插值**（Rust 65 点 / TS 这里同构 65 点），
//   不是逐位一致（浮点运算顺序不同）；判据用 1e-5 容差（远小于 1px 的视觉可辨阈值）。
//   ★端点必须**精确** 0 / 1（两侧都钉死——动画起止值不允许有浮点残差）。

/** 曲线 id（与 Rust `anim.rs` 的 `CURVE_*` 一一对应——**跨语言契约，不得改号**） */
export const AnimCurve = {
  LINEAR: 0,
  EASE_OUT_CUBIC: 1,
  EASE_IN_CUBIC: 2,
  EASE_IN_OUT_CUBIC: 3,
  SPRING_APPROX: 4,
} as const
export type AnimCurveId = (typeof AnimCurve)[keyof typeof AnimCurve]

/** 动画属性种类（与 Rust `AnimKind` 一一对应） */
export const AnimKind = {
  TRANSLATE_X: 0,
  TRANSLATE_Y: 1,
  SCALE: 2,
} as const
export type AnimKindId = (typeof AnimKind)[keyof typeof AnimKind]

const TABLE_N = 65

/** 阻尼振荡（spring 近似）——与 Rust `anim.rs::spring_approx` 同式 */
function springApprox(u: number): number {
  return 1 - Math.exp(-6 * u) * Math.cos(10 * u)
}

function buildTable(curve: number): Float64Array {
  const t = new Float64Array(TABLE_N)
  for (let i = 0; i < TABLE_N; i++) {
    const u = i / (TABLE_N - 1)
    t[i] =
      curve === AnimCurve.EASE_OUT_CUBIC
        ? 1 - (1 - u) ** 3
        : curve === AnimCurve.EASE_IN_CUBIC
          ? u ** 3
          : curve === AnimCurve.EASE_IN_OUT_CUBIC
            ? u < 0.5
              ? 4 * u ** 3
              : 1 - (-2 * u + 2) ** 3 / 2
            : curve === AnimCurve.SPRING_APPROX
              ? springApprox(u)
              : u // linear
  }
  // ★端点钉死（与 Rust 侧同策略）
  t[0] = 0
  t[TABLE_N - 1] = 1
  return t
}

const TABLES: Float64Array[] = [
  buildTable(AnimCurve.LINEAR),
  buildTable(AnimCurve.EASE_OUT_CUBIC),
  buildTable(AnimCurve.EASE_IN_CUBIC),
  buildTable(AnimCurve.EASE_IN_OUT_CUBIC),
  buildTable(AnimCurve.SPRING_APPROX),
]

/** 曲线求值（查表 + 线性插值；`u` clamp 到 [0,1]；未知 id 落 linear——不抛） */
export function curveEval(curve: number, u: number): number {
  const row = TABLES[Math.min(Math.max(curve, 0), TABLES.length - 1)]!
  const x = Math.min(Math.max(u, 0), 1) * (TABLE_N - 1)
  const i0 = Math.floor(x)
  const i1 = Math.min(i0 + 1, TABLE_N - 1)
  const frac = x - i0
  return row[i0]! + (row[i1]! - row[i0]!) * frac
}

/** 合成一次动画的当前值（`from + (to-from) * curve(u)`）——与 Rust `AnimEngine::tick` 同式 */
export function animValue(curve: number, from: number, to: number, progress: number): number {
  return from + (to - from) * curveEval(curve, progress)
}
