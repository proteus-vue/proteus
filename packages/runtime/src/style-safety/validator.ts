// packages/runtime/src/style-safety/validator.ts
// G-31 style-safety B1：validateStyle 运行时 Style Validator（06-runtime-validator.md §2 实现）
// 最后一道闸门：只拦截编译期无法推导的动态值；属性白名单 + 值类型守卫 + 逐平台收窄 + 降级
// ★MP 产物 ES5 安全：禁 ?. ?? 展开 解构（决策 #32/#36）

import { ALLOWED_STYLE_PROPS, FALLBACK_DEFAULTS, PROP_TYPES } from './whitelist'
import type { StylePropKind } from './whitelist'
import { narrowValue } from './platform-narrowing'
import type { StylePlatform } from './platform-narrowing'

export interface StyleRejection {
  prop: string
  value: unknown
  reason: string
}

export interface ValidateStyleOptions {
  /** 生产模式：静默丢弃 + 可选上报钩子（06 §5 降级策略） */
  silent?: boolean
  onReject?: (rejections: StyleRejection[]) => void
}

/** validateStyle：style 对象 → 已校验/降级的 style（06 §2 核心实现） */
export function validateStyle(
  style: Record<string, unknown>,
  platform: StylePlatform,
  options: ValidateStyleOptions = {},
): Record<string, unknown> {
  const validated: Record<string, unknown> = {}
  const rejections: StyleRejection[] = []
  const silent = options.silent === true

  for (const prop of Object.keys(style)) {
    const value = style[prop]
    const result = validateProp(prop, value, platform)
    if (result.valid) {
      validated[prop] = result.value
      continue
    }
    rejections.push({ prop, value, reason: result.reason })
    // 降级默认值（06 §5：width/height→0、opacity→1、color→inherit、borderRadius→0）
    const fallback = FALLBACK_DEFAULTS[prop]
    if (fallback !== undefined) validated[prop] = fallback
  }

  if (rejections.length > 0) {
    if (!silent) {
      // 开发模式 warn（06 §2）；生产 debug 走上报钩子
      console.warn(`[Proteus StyleSafety] ${rejections.length} 条样式被拒绝:`)
      for (const r of rejections) console.warn(`  ${r.prop}: ${String(r.value)} → ${r.reason}`)
    }
    if (typeof options.onReject === 'function') options.onReject(rejections)
  }

  return validated
}

export interface PropValidationResult {
  valid: boolean
  value: unknown
  reason: string
}

/** 单属性校验（06 §2 validateProp：①白名单 ②类型守卫 ③平台收窄） */
export function validateProp(prop: string, value: unknown, platform: StylePlatform): PropValidationResult {
  // ① 白名单检查
  const kind = ALLOWED_STYLE_PROPS[prop as keyof typeof ALLOWED_STYLE_PROPS] as StylePropKind | undefined
  if (kind === undefined) return { valid: false, value, reason: `属性 ${prop} 不在白名单（STS001）` }
  if (kind === 'FORBIDDEN') return { valid: false, value, reason: `${prop} 已禁用（STS004）` }
  if (kind === 'SEMANTIC_ONLY') return { valid: false, value, reason: `${prop} 必须用语义组件（STS003）` }

  // ② 类型守卫
  const guard = PROP_TYPES[kind]
  if (typeof guard === 'function' && !guard(value)) {
    return { valid: false, value, reason: `${prop} 值类型非法: ${String(value)}（STS002）` }
  }

  // ③ 逐平台收窄
  const narrowed = narrowValue(prop, value, platform)
  return { valid: narrowed.valid, value: narrowed.value, reason: narrowed.reason ?? '' }
}

/** 便捷：单值是否可通过（测试/编译期静态检查复用） */
export function isValidStyleProp(prop: string, value: unknown, platform: StylePlatform = 'web'): boolean {
  return validateProp(prop, value, platform).valid
}
