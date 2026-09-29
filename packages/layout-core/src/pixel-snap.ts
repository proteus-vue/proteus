// packages/layout-core/src/pixel-snap.ts
// ★★卡 I2（舍入时机统一）：**内核唯一的坐标吸附实现** —— 2026-09-29
//
// 【硬性规则（卡 I2 原文）】内核产出指令时完成舍入，**平台层不得再舍入**。
//   风险（卡原文）：各平台层各自舍入 → 三端策略不同 → golden test 全绿但三端差 1px。
//   触发场景（卡原文）：鸿蒙强制整数像素，`flex:1/3` 三列时 0.333 被舍为 0.33，
//   累计误差导致第三列错位。
//
// ── 策略：**边缘吸附**（edge snapping），不是逐字段四舍五入 ────────────────────
//
//   snap(v) = floor(v + 0.5)                      ← 定义即公式（不是"round half up"的散文）
//   盒 (x, y, w, h) →  L = snap(x) · T = snap(y)
//                      R = snap(x + w) · B = snap(y + h)
//                      x' = L · y' = T · w' = max(0, R − L) · h' = max(0, B − T)
//
//   ★为什么必须吸附**边缘**（而不是 round(x) / round(w) 各自来）：
//     「相邻元素共用同一条边」——同一条浮点边值经同一纯函数吸附 ⇒ 两侧必得**同一整数**
//     ⇒ 无 1px 缝隙、无重叠，且 flex 均分总和守恒。
//     【本卡的反例（鸿蒙三列场景）】宽 100 均分三列（33.333×3）：
//       · 逐字段四舍五入：33+33+33 = **99** ⇒ 末尾 1px 缝（或第三列错位）
//       · 边缘吸附：边 [0, 33.333, 66.666, 100] → [0, 33, 67, 100]
//                   ⇒ 宽 33 / 34 / 33，**和 = 100** ✓（见 tests/layout-core-pixel-snap.test.ts）
//   ★推论（诚实记录）：w' 由边缘差决定，**不保证**等于 snap(w)
//     （例：x=10.5, w=33.5 ⇒ x'=11, w'=44−11=**33**）——这正是"吸附边缘"与"吸附尺寸"的区别，
//      标准实现（浏览器 LayoutUnit 快照 / RN 边缘对齐）取前者。
//
//   ★half 值口径：用 `floor(v + 0.5)`，**不用** `Math.round`、也不用 Rust `f32::round`：
//     · `Math.round(-0.5)` = -0（规范行为），`f32::round(-0.5)` = -1（半值远离零）
//       ⇒ 两语言在负数上语义不同，直接用会**跨语言差 1px**
//     · 本公式两语言**同式**（TS f64 / Rust f32 各自求值）⇒ 逐位可对齐（见 golden）
//
// ── 坐标单位与边界 ──────────────────────────────────────────────────────────
//   · 吸附目标是**整数逻辑像素**（= 指令坐标系单位 = 宿主 viewport 单位）。
//     物理像素对齐由平台按密度缩放（整数 × 整数密度仍是整数）——不在本层职责。
//   · 吸附发生在**导出/发射边界**（`emitRenderCmds` 发射时 / Rust FFI 导出时）；
//     求解器内部（flex 解算 / 增量重排）保持**亚像素精度** —— 不为吸附牺牲布局精度，
//     也让既有 browser-layout conformance（容差 0.5dp）口径不变。
//   · 诚实边界：TS 用 f64、Rust 用 f32；真实值恰好落在 `x.5 ± 1ulp` 时两端**可能**差 1px
//     （未构造此类用例；0.5 可被两精度精确表示 ⇒ golden 的半值用例两端必然一致）。
//
// 【本文件是唯一实现——新增第二份"平台侧吸附"会被 `pnpm check:host-rounding` 拦下】

/**
 * 唯一的坐标吸附函数（策略定义见文件头）。
 *
 * @param v 逻辑像素坐标（可为负——负 margin / 视口外元素）
 * @returns 整数逻辑像素（`floor(v + 0.5)`；`-0.5 → 0`、`-1.5 → -1`，两语言同式）
 */
export function snapCoord(v: number): number {
  return Math.floor(v + 0.5)
}

/** 吸附后的盒（整数逻辑像素） */
export interface SnappedRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 按**边缘**吸附一个盒（策略见文件头：L/R 各自吸附，尺寸取差）。
 * 尺寸下限 0（吸附只做取整，不产生负宽高）。
 */
export function snapRect(x: number, y: number, width: number, height: number): SnappedRect {
  const l = snapCoord(x)
  const t = snapCoord(y)
  const r = snapCoord(x + width)
  const b = snapCoord(y + height)
  return { x: l, y: t, width: Math.max(0, r - l), height: Math.max(0, b - t) }
}
