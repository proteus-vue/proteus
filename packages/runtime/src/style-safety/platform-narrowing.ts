// packages/runtime/src/style-safety/platform-narrowing.ts
// G-31 style-safety B2：逐平台类型收窄（04-type-system.md §3）
// 同一 Length 各端原生参数类型不同——JSI 调用前按平台拦截/转换：
//   iOS 负数（CGFloat）/ Android NaN（TypedValue）/ 鸿蒙超限（Constraint）/ Skyline 非有限数 / Web 最宽松
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

import type { AllowedStyleProp, StylePropKind } from './whitelist'
import { ALLOWED_STYLE_PROPS } from './whitelist'

export type StylePlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

export interface NarrowResult {
  valid: boolean
  /** 收窄后的原生值（未收窄则原样） */
  value: unknown
  reason?: string
}

/** 各端 Length 规则（04 §3 PlatformLengthRules） */
export interface PlatformLengthRules {
  platform: StylePlatform
  nativeType: string
  /** 负值拦截（iOS CGFloat / 鸿蒙 Constraint） */
  rejectNegative: boolean
  /** 非有限数拦截（Android TypedValue / Skyline） */
  rejectNaN: boolean
  /** 'auto' 是否合法（iOS 无 auto；Android → WRAP_CONTENT） */
  allowAuto: boolean
  /** 是否做数值转换（B2 标记；真机单位换算 B4） */
  convert?: 'wrap-content'
}

export const PLATFORM_LENGTH_RULES: Record<StylePlatform, PlatformLengthRules> = {
  ios: { platform: 'ios', nativeType: 'CGFloat', rejectNegative: true, rejectNaN: true, allowAuto: false },
  android: { platform: 'android', nativeType: 'TypedValue', rejectNegative: false, rejectNaN: true, allowAuto: true, convert: 'wrap-content' },
  harmony: { platform: 'harmony', nativeType: 'Length', rejectNegative: true, rejectNaN: true, allowAuto: false },
  skyline: { platform: 'skyline', nativeType: 'Number', rejectNegative: false, rejectNaN: true, allowAuto: false },
  web: { platform: 'web', nativeType: 'CSSLength', rejectNegative: false, rejectNaN: false, allowAuto: true },
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? Number.NaN : n
  }
  return Number.NaN
}

/** Length 归一：字符串（px/rem/%/auto）或数值 → 原生值；按平台规则拦截（04 §3） */
function narrowLength(v: unknown, platform: StylePlatform): NarrowResult {
  const rules = PLATFORM_LENGTH_RULES[platform]
  if (typeof v === 'string' && v.trim() === 'auto') {
    if (!rules.allowAuto) return { valid: false, value: v, reason: `${rules.nativeType} 不支持 auto（iOS/鸿蒙尺寸无 auto 语义）` }
    if (rules.convert === 'wrap-content') return { valid: true, value: 'wrap-content' } // Android WRAP_CONTENT
    return { valid: true, value: 'auto' }
  }
  const num = toNumber(v)
  if (rules.rejectNaN && !Number.isFinite(num)) {
    return { valid: false, value: v, reason: `${rules.nativeType} 不可为 NaN/Infinity（Android TypedValue / Skyline 渲染异常）` }
  }
  if (rules.rejectNegative && typeof v === 'number' && v < 0) {
    return { valid: false, value: v, reason: `${rules.nativeType} 不能为负（iOS/鸿蒙布局异常）` }
  }
  // 字符串 → 数值归一（B1 行为）；web 保留原字符串（CSSLength 原生语义）
  if (typeof v === 'string' && platform !== 'web') return { valid: true, value: num }
  return { valid: true, value: v }
}

/** Opacity：平台无关（守卫已校验 0-1） */
function narrowOpacity(v: unknown): NarrowResult {
  if (typeof v !== 'number') return { valid: false, value: v, reason: 'Opacity 需为数值' }
  return { valid: true, value: v }
}

/** Integer：平台无关（zIndex 等） */
function narrowInteger(v: unknown): NarrowResult {
  if (typeof v !== 'number' || !Number.isInteger(v)) return { valid: false, value: v, reason: 'Integer 需为整数' }
  return { valid: true, value: v }
}

/** Transform：skyline rotate/skew 受限（CSS 矩阵：同层渲染不支持）→ B2 拦截，走原生动画 API */
function narrowTransform(v: unknown, platform: StylePlatform): NarrowResult {
  if (typeof v !== 'string') return { valid: false, value: v, reason: 'Transform 需为字符串' }
  if (platform === 'skyline' && /(rotate|skew)/i.test(v)) {
    return { valid: false, value: v, reason: 'Skyline 同层渲染不支持 rotate/skew（走原生动画 API）' }
  }
  return { valid: true, value: v }
}

/**
 * 属性 → 白名单档位（★走函数返回，**不做控制流窄化**）：
 *   直接 `const kind: StylePropKind = TABLE[prop]` 会被 TS 按**初始化器类型**（表内当前出现的值联合）
 *   窄化——`Integer` 等档位在当前表里无属性挂载（zIndex 已转 FORBIDDEN）就会被 switch 判为
 *   "不可比较"（TS2678 实测）。档位是**声明契约**（`StylePropLevel`），守卫函数保留、
 *   档位回来时本文件无需改动。
 */
function kindOf(prop: string): StylePropKind {
  return ALLOWED_STYLE_PROPS[prop as AllowedStyleProp]
}

/** 逐平台收窄（04 §3）：按白名单类型 + 平台规则归一/拦截 */
export function narrowValue(prop: string, value: unknown, platform: StylePlatform): NarrowResult {
  const kind = kindOf(prop)
  switch (kind) {
    case 'Length':
      return narrowLength(value, platform)
    case 'Opacity':
      return narrowOpacity(value)
    case 'Integer':
      return narrowInteger(value)
    case 'FlexAlign':
    case 'FlexJustify':
    case 'FlexNumber':
    case 'TextAlign':
    // ★★★G-61 后批（2026-10-05）：white-space 平台无关（关键字枚举）——
    //   不加这条会落 default ⇒ 动态值被误判"属性不可用"（新级别引入的真缺口）。
    case 'TextWrap':
    // ★★★逐边 border 批（2026-10-05）：边框线型（solid/dashed/dotted/none）平台无关。
    case 'BorderStyle':
    // ★★★overflow-x 项（2026-10-06）：溢出关键字枚举平台无关（单轴归一在编译期/内核完成）。
    case 'Overflow':
    case 'Color':
      return { valid: true, value }
    case 'Transform':
      return narrowTransform(value, platform)
    case 'TransformOrigin':
      return { valid: true, value }
    default:
      // SEMANTIC_ONLY / FORBIDDEN 在 validateProp 白名单阶段已被拦截，到不了这里
      return { valid: false, value, reason: '属性不可用（语义组件/禁止）' }
  }
}
