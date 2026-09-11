// packages/glass/src/platforms.ts
// ★G-07（proteus-glass-plan 03-capability-matrix）：平台能力门槛表——degrade/capability 共享的唯一事实源
//   （避免 degrade ↔ capability 循环依赖：门槛数据下沉本模块）
import type { GlassLevel } from './types'

/** 目标平台（能力矩阵行） */
export type GlassPlatform = 'web' | 'skyline' | 'ios' | 'harmony' | 'android'

export interface GlassPlatformGate {
  /** 最低支持版本（低于则 solid） */
  min: string
  /** L3 系统材质门槛（null = 不支持 L3） */
  l3: string | null
  /** 无系统材质时的最高层级封顶 */
  ceiling: GlassLevel
}

/** 平台能力矩阵（03-capability-matrix 版本门槛表编码） */
export const GLASS_CAPABILITY: Record<GlassPlatform, GlassPlatformGate> = {
  ios: { min: '13', l3: '26', ceiling: 'l2' },
  harmony: { min: 'API 9', l3: 'NEXT', ceiling: 'l2' },
  android: { min: 'API 31', l3: null, ceiling: 'l2' },
  web: { min: '*', l3: null, ceiling: 'l2' },
  skyline: { min: '2.0', l3: null, ceiling: 'l2' },
}

/** 该平台是否支持 L3 系统材质（仅 iOS 26+ / 鸿蒙 NEXT） */
export function platformSupportsSystemMaterial(platform: GlassPlatform): boolean {
  const gate = GLASS_CAPABILITY[platform]
  return Boolean(gate && gate.l3)
}

/** 是否原生端（非 web/skyline——用于 L3 判定） */
export function isNativePlatform(platform: GlassPlatform): boolean {
  return platform === 'ios' || platform === 'harmony' || platform === 'android'
}
