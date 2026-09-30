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
