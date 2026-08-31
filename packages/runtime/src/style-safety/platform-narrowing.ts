// packages/runtime/src/style-safety/platform-narrowing.ts
// G-31 style-safety B1：narrowValue 逐平台收窄（06 §2 第 3 步）
// B1 基础收窄：数值/字符串按目标类型归一 + 钳制；五端真机映射（iOS CGFloat / Android TypedValue /
// 鸿蒙 / Skyline）在 B2/B4 细化——本模块保持纯函数 + 平台分支结构，后续按端补充
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

import type { AllowedStyleProp } from './whitelist'
import { ALLOWED_STYLE_PROPS } from './whitelist'

export type StylePlatform = 'web' | 'skyline' | 'ios' | 'android' | 'harmony'

export interface NarrowResult {
  valid: boolean
  /** 收窄后的原生值（未收窄则原样） */
  value: unknown
  reason?: string
}

/** Length 归一：字符串（px/rpx/rem/%）或数值 → 原生数字（B1 统一逻辑单位；端换算 B2） */
function narrowLength(v: unknown): NarrowResult {
  if (typeof v === 'number') return { valid: true, value: v }
  if (typeof v === 'string') {
    const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rpx|rem|%)?$/.exec(v.trim())
    if (!m) return { valid: false, value: v, reason: 'Length 字符串格式非法' }
    return { valid: true, value: parseFloat(m[1]) }
  }
  return { valid: false, value: v, reason: 'Length 需为数值或带单位字符串' }
}

/** Opacity 钳制：0-1 之外非法（守卫已查，此处归一） */
function narrowOpacity(v: unknown): NarrowResult {
  if (typeof v !== 'number') return { valid: false, value: v, reason: 'Opacity 需为数值' }
  return { valid: true, value: v }
}

/** Integer 取整（zIndex 等） */
function narrowInteger(v: unknown): NarrowResult {
  if (typeof v !== 'number' || !Number.isInteger(v)) return { valid: false, value: v, reason: 'Integer 需为整数' }
  return { valid: true, value: v }
}

/** 字符串枚举型（FlexAlign/FlexJustify）：校验通过原样放行 */
function narrowEnum(v: unknown): NarrowResult {
  return { valid: true, value: v }
}

/** Transform：字符串原样（B2 逐端拆 translate/scale/rotate 指令） */
function narrowTransform(v: unknown): NarrowResult {
  return { valid: true, value: v }
}

/** 逐平台收窄（06 §2 第 3 步）：按白名单类型归一值；平台参数预留（B2 端差异分支） */
export function narrowValue(prop: string, value: unknown, _platform: StylePlatform): NarrowResult {
  const kind = ALLOWED_STYLE_PROPS[prop as AllowedStyleProp]
  switch (kind) {
    case 'Length':
      return narrowLength(value)
    case 'Opacity':
      return narrowOpacity(value)
    case 'Integer':
      return narrowInteger(value)
    case 'FlexAlign':
    case 'FlexJustify':
      return narrowEnum(value)
    case 'Transform':
    case 'TransformOrigin':
      return narrowTransform(value)
    case 'Color':
    case 'FlexNumber':
      return { valid: true, value }
    default:
      // SEMANTIC_ONLY / FORBIDDEN 在 validateProp 白名单阶段已被拦截，到不了这里
      return { valid: false, value, reason: '属性不可用（语义组件/禁止）' }
  }
}
