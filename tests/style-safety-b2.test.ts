// tests/style-safety-b2.test.ts
// ★G-31 style-safety B2：值类型系统（04 §1-§2 命名守卫）+ 逐平台收窄（04 §3 拦截矩阵）
import { describe, expect, it } from 'vitest'
import {
  isLength,
  isColor,
  isOpacity,
  isInteger,
  isFlexNumber,
  narrowValue,
  PLATFORM_LENGTH_RULES,
  validateProp,
} from '../packages/runtime/src/style-safety/index'

describe('命名类型守卫（04 §2）', () => {
  it('isLength：数值 / 带单位字符串 / auto', () => {
    expect(isLength(100)).toBe(true)
    expect(isLength('100px')).toBe(true)
    expect(isLength('1.5rem')).toBe(true)
    expect(isLength('50%')).toBe(true)
    expect(isLength('auto')).toBe(true)
    expect(isLength('abc')).toBe(false)
    expect(isLength(NaN)).toBe(false)
  })

  it('isColor：hex / rgba / var(--token)', () => {
    expect(isColor('#ff0000')).toBe(true)
    expect(isColor('#ff000080')).toBe(true)
    expect(isColor('rgba(0,0,0,0.5)')).toBe(true)
    expect(isColor('var(--color-primary)')).toBe(true)
    expect(isColor('red')).toBe(false) // 命名色不在白名单（矩阵约束）
  })

  it('isOpacity / isInteger / isFlexNumber', () => {
    expect(isOpacity(0.5)).toBe(true)
    expect(isOpacity(1.5)).toBe(false)
    expect(isInteger(10)).toBe(true)
    expect(isInteger(10.5)).toBe(false)
    expect(isFlexNumber('auto')).toBe(true)
    expect(isFlexNumber(2)).toBe(true)
  })
})

describe('逐平台收窄矩阵（04 §3）', () => {
  it('iOS：负数拦截（CGFloat 布局异常）', () => {
    expect(narrowValue('width', -10, 'ios').valid).toBe(false)
    expect(narrowValue('width', 100, 'ios').valid).toBe(true)
    expect(narrowValue('width', 'auto', 'ios').valid).toBe(false) // iOS 无 auto
  })

  it('Android：NaN/Infinity 拦截（TypedValue）；auto → WRAP_CONTENT', () => {
    expect(narrowValue('width', Number.NaN, 'android').valid).toBe(false)
    expect(narrowValue('width', Number.POSITIVE_INFINITY, 'android').valid).toBe(false)
    const auto = narrowValue('width', 'auto', 'android')
    expect(auto.valid).toBe(true)
    expect(auto.value).toBe('wrap-content')
  })

  it('Skyline：非有限数拦截（WXSS 渲染异常）；rotate/skew 走原生动画 API', () => {
    expect(narrowValue('width', Number.NaN, 'skyline').valid).toBe(false)
    expect(narrowValue('transform', 'rotate(45deg)', 'skyline').valid).toBe(false)
    expect(narrowValue('transform', 'translateX(10px)', 'skyline').valid).toBe(true)
  })

  it('鸿蒙：负数拦截（Constraint 约束失败）', () => {
    expect(narrowValue('height', -5, 'harmony').valid).toBe(false)
    expect(narrowValue('height', 100, 'harmony').valid).toBe(true)
  })

  it('Web：最宽容（CSSLength）', () => {
    expect(narrowValue('width', -10, 'web').valid).toBe(true)
    expect(narrowValue('width', 'auto', 'web').valid).toBe(true)
    expect(narrowValue('width', '100%', 'web').valid).toBe(true)
  })

  it('PLATFORM_LENGTH_RULES 五端注册表完整（04 §3 PlatformLengthRules）', () => {
    expect(Object.keys(PLATFORM_LENGTH_RULES).sort()).toEqual(['android', 'harmony', 'ios', 'skyline', 'web'])
    expect(PLATFORM_LENGTH_RULES.ios.nativeType).toBe('CGFloat')
    expect(PLATFORM_LENGTH_RULES.android.nativeType).toBe('TypedValue')
    expect(PLATFORM_LENGTH_RULES.web.rejectNegative).toBe(false) // web 最宽松
    expect(PLATFORM_LENGTH_RULES.ios.rejectNegative).toBe(true) // iOS 拦负数
  })
})

describe('validateProp 逐平台联动（B1 + B2）', () => {
  it('同一值不同平台结果不同', () => {
    expect(validateProp('width', -10, 'web').valid).toBe(true)
    expect(validateProp('width', -10, 'ios').valid).toBe(false)
  })

  it('String 长度在非 web 端归一为数值', () => {
    const r = validateProp('width', '100px', 'skyline')
    expect(r.valid).toBe(true)
    expect(r.value).toBe(100)
  })
})
