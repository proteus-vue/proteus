// packages/glass/src/degrade.ts
// ★G-07（proteus-glass-plan 08-degradation + 03-capability-matrix）：三级降级（设备级/版本级/性能级）纯决策
//   「任何情况不崩溃、不白屏」——能力不足一律降 solid（或 flat），绝不渲染黑块
//   历史：resolveGlassLevel 与 glassStyleFor 从 src/components/pg-glass/index.vue 内联表提取为 SSOT（B1 收口）
import type { GlassLevel, ResolvedGlass } from './types'
import { GLASS_CAPABILITY, isNativePlatform, platformSupportsSystemMaterial } from './platforms'
import type { GlassPlatform } from './platforms'

export type { GlassPlatform } from './platforms'

export interface GlassEnv {
  /** 目标平台（缺省 web） */
  platform?: GlassPlatform
  /** backdrop-filter 运行时探测：true 支持 / false 不支持 / undefined 未知（按支持） */
  backdropFilter?: boolean
  /** prefers-reduced-transparency（无障碍优先：降低透明度偏好 → 直接 solid） */
  reducedTransparency?: boolean
  /** 设备性能档（low = 低端机 → 只上 L1，关闭 L2 重层） */
  tier?: 'low' | 'mid' | 'high'
  /** 强制降级（调试 `?glass=force-solid`） */
  forceSolid?: boolean
  /** 系统材质是否可用（iOS 26+/鸿蒙 NEXT——真机能力，框架默认 false） */
  systemMaterial?: boolean
}

/**
 * 解析可达层级（铁律：降级不崩溃）。
 * 顺序：强制/无障碍/无 backdrop-filter → solid；低端 → l1；
 *       原生 + 系统材质 + 平台支持 L3 → l3；其余 → 平台封顶（web/skyline=l2, 其余=l1）。
 */
export function resolveGlassLevel(env: GlassEnv = {}): GlassLevel {
  if (env.forceSolid) return 'solid'
  if (env.reducedTransparency) return 'solid'
  if (env.backdropFilter === false) return 'solid'
  if (env.tier === 'low') return 'l1'
  const platform = env.platform ?? 'web'
  if (env.systemMaterial && isNativePlatform(platform) && platformSupportsSystemMaterial(platform)) return 'l3'
  const gate = GLASS_CAPABILITY[platform]
  return gate ? gate.ceiling : 'l1'
}

/** 输出样式对象（camelCase，供 Vue `:style`；对齐 07-mapping-web-skyline） */
export function glassStyleFor(resolved: ResolvedGlass, level: GlassLevel): Record<string, string | undefined> {
  if (level === 'solid') {
    return { background: resolved.solid, borderRadius: px(resolved.radiusPx) }
  }
  if (level === 'flat') {
    return { background: 'transparent', borderRadius: px(resolved.radiusPx) }
  }
  const blur = `${resolved.blurPx}px`
  return {
    backdropFilter: `blur(${blur})`,
    WebkitBackdropFilter: `blur(${blur})`,
    background: resolved.tint,
    borderRadius: px(resolved.radiusPx),
  }
}

/** 输出 class 列表（语义类，供各端 CSS 命中——对齐 07 产物契约 pg-glass--<preset>/--<intensity>） */
export function glassClassList(resolved: ResolvedGlass, level: GlassLevel): string[] {
  const classes = ['pg-glass', `pg-glass--${resolved.preset}`, `pg-glass--${resolved.intensity}`, `pg-glass--${level}`]
  if (resolved.border) classes.push('pg-glass--border', `pg-glass--border-${resolved.borderSide}`)
  if (level === 'solid') classes.push('pg-glass--solid')
  if (level === 'flat') classes.push('pg-glass--flat')
  return classes
}

/** 噪点/高光层是否渲染（仅非降级态） */
export function showsDecoration(level: GlassLevel): boolean {
  return level === 'l1' || level === 'l2' || level === 'l3'
}

function px(v: number): string | undefined {
  return v > 0 ? `${v}px` : undefined
}
