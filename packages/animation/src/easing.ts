// packages/animation/src/easing.ts
// ★★Morpheus —— **手感预设（弹簧）的单一事实来源**
//
// 【为什么独立成文件（2026-09-30 抽出的原因）】
//   声明式编排层（`choreography.ts`）与预设库（`presets.ts`）都要用它。
//   若留在 `presets.ts`，则 `choreography.ts → presets.ts` 与 `presets.ts → choreography.ts`
//   （预设库要重导出 choreograph）会形成**循环依赖**——打包器对循环 import 的处理
//   会让"某一侧拿到 undefined"，是典型的**静默缺陷**。
//   ⇒ 把最底层的常量放进独立模块：依赖图变成 `choreography → easing ← presets`（无环）。
//   ★这正是本仓纪律："唯一实现"要放到**依赖图的最底层**，而不是给两份副本。

import type { SpringConfig } from './types'

/**
 * 弹簧预设（**与内核 `SpringParams::snappy/smooth` 同值**——跨语言契约）
 *
 * ★为什么钉在预设里而不是让开发者调参：手调 damping/stiffness/mass 是四个坑之一（§2）。
 * ★跨语言一致性：内核 `layout-core-rust/src/anim.rs` 的 `SpringParams::snappy()/smooth()`
 *   是**同一组数值**；两侧各有测试钉住（TS 侧 `tests/animation-presets.test.ts`，
 *   Rust 侧 `anim.rs` 单测）。
 */
export const easing = {
  /** 快速、微回弹（对齐 iOS `.snappy`） */
  snappy: { stiffness: 320, damping: 30, mass: 1 } as SpringConfig,
  /** 顺滑、几乎无回弹（对齐 iOS `.smooth`） */
  smooth: { stiffness: 180, damping: 26, mass: 1 } as SpringConfig,
} as const

/**
 * ★★**解析 CSS `cubic-bezier()` 字符串**（2026-10-01 自定义曲线转正的一部分）
 *
 * 让人能**直接从设计稿/浏览器 DevTools 粘贴**缓动值：
 * ```ts
 * { kind: 'translateY', from: -40, to: 0, curveBezier: parseCubicBezier('cubic-bezier(.34,1.56,.64,1)') }
 * ```
 *
 * 规则：接受 `cubic-bezier(a,b,c,d)`（大小写/空白不敏感；数可写 `.5`）或裸 `a,b,c,d`。
 * `x1/x2 ∈ [0,1]`（时间轴单调）；`y1/y2` 任意（回弹）。非法 ⇒ **抛错**（带原文，
 * 这是"粘贴进来的值"——把原文回显出来才好定位；不静默落默认值）。
 */
export function parseCubicBezier(src: string): [number, number, number, number] {
  const m = /cubic-bezier\(\s*([^)]+)\)/i.exec(src)
  const body = m ? m[1]! : src
  const parts = body.split(',').map((x) => Number(x.trim()))
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error(
      `parseCubicBezier: 无法从 "${src}" 解析出 4 个控制点（期望 cubic-bezier(x1,y1,x2,y2)）`,
    )
  }
  const [x1, y1, x2, y2] = parts as [number, number, number, number]
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error(
      `parseCubicBezier: x1/x2 必须在 [0,1]（时间轴单调），收到 "${src}"（x1=${x1}, x2=${x2}）；` +
        'y1/y2 可以任意（> 1 / < 0 是回弹效果）',
    )
  }
  return [x1, y1, x2, y2]
}
