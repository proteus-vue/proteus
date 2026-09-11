// packages/glass/src/capability.ts
// ★G-07（proteus-glass-plan 03-capability-matrix）：玻璃能力描述符（平台 × 可达层级）+ 版本门槛
//   静态可分析：编译期即可判定「该平台最高到 L1（无系统材质）」→ 提示降级预期（不黑盒）
//   门槛数据唯一事实源在 platforms.ts（与 degrade 决策共享）
//   注：此描述符为玻璃能力自述（轻量），不注册进 @proteus-vue/capabilities 的 adapter 体系（避免过度耦合）
import type { GlassLevel } from './types'
import { GLASS_CAPABILITY } from './platforms'
import type { GlassPlatform, GlassPlatformGate } from './platforms'

export { GLASS_CAPABILITY } from './platforms'
export type { GlassPlatform, GlassPlatformGate } from './platforms'

/** L1 基础玻璃必达端（铁律 1） */
export const GLASS_L1_MANDATORY: GlassPlatform[] = ['ios', 'harmony', 'android', 'web', 'skyline']

/**
 * 断言某平台可达层级（编译期/工具消费）。
 * @returns 该平台最高可达层级（考虑版本门槛；无 backdrop-filter 支持 → solid 由运行时决定）
 */
export function glassCeilingFor(platform: GlassPlatform, opts: { systemMaterial?: boolean } = {}): GlassLevel {
  const gate: GlassPlatformGate | undefined = GLASS_CAPABILITY[platform]
  if (!gate) return 'l1'
  if (gate.l3 && opts.systemMaterial) return 'l3'
  return gate.ceiling
}

/** 降级链（08-degradation：L3 → L1 → solid → flat 的退化顺序；审计/文档展示用） */
export const GLASS_DEGRADE_CHAIN: GlassLevel[] = ['l3', 'l2', 'l1', 'solid', 'flat']
