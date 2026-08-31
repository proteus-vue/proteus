// tests/style-safety.test.ts
// ★G-31 style-safety B1：validateStyle 运行时 Validator（06 §2）+ ALLOWED_STYLE_PROPS 白名单（03 §1）
import { describe, expect, it } from 'vitest'
import {
  validateStyle,
  validateProp,
  isValidStyleProp,
  ALLOWED_STYLE_PROPS,
  FALLBACK_DEFAULTS,
} from '../packages/runtime/src/style-safety/index'

describe('ALLOWED_STYLE_PROPS 白名单（03 §1）', () => {
  it('✅ 直映射属性存在（Length/Color/Opacity 类型）', () => {
    expect(ALLOWED_STYLE_PROPS.width).toBe('Length')
    expect(ALLOWED_STYLE_PROPS.opacity).toBe('Opacity')
    expect(ALLOWED_STYLE_PROPS.color).toBe('Color')
    expect(ALLOWED_STYLE_PROPS.justifyContent).toBe('FlexJustify')
  })

  it('🔶 语义组件属性标记 SEMANTIC_ONLY', () => {
    expect(ALLOWED_STYLE_PROPS.backdropFilter).toBe('SEMANTIC_ONLY')
    expect(ALLOWED_STYLE_PROPS.filter).toBe('SEMANTIC_ONLY')
  })

  it('❌ 禁止属性标记 FORBIDDEN', () => {
    expect(ALLOWED_STYLE_PROPS.display).toBe('FORBIDDEN')
    expect(ALLOWED_STYLE_PROPS.float).toBe('FORBIDDEN')
    expect(ALLOWED_STYLE_PROPS.clear).toBe('FORBIDDEN')
    expect(ALLOWED_STYLE_PROPS.verticalAlign).toBe('FORBIDDEN')
  })
})

describe('validateProp（06 §2：①白名单 ②类型守卫 ③平台收窄）', () => {
  it('未知属性 → STS001 语义', () => {
    const r = validateProp('boxShadow', '0 2px', 'web')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('STS001')
  })

  it('FORBIDDEN 属性 → STS004 语义', () => {
    const r = validateProp('display', 'inline-flex', 'web')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('STS004')
  })

  it('SEMANTIC_ONLY 属性 → STS003 语义', () => {
    const r = validateProp('backdropFilter', 'blur(10px)', 'web')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('STS003')
  })

  it('类型守卫：width 负字符串 / opacity 越界 → 非法', () => {
    expect(validateProp('width', 'abc', 'web').valid).toBe(false)
    expect(validateProp('opacity', 1.5, 'web').valid).toBe(false)
    expect(validateProp('opacity', 0.5, 'web').valid).toBe(true)
    expect(validateProp('width', 100, 'web').valid).toBe(true)
    expect(validateProp('width', '20px', 'web').valid).toBe(true)
  })

  it('收窄：非 web 端 Length 字符串 → 数值；web 保留原值（04 §3 最宽容）', () => {
    const r = validateProp('width', '20px', 'web')
    expect(r.valid).toBe(true)
    expect(r.value).toBe('20px') // web CSSLength 原生语义
    const sky = validateProp('width', '20px', 'skyline')
    expect(sky.value).toBe(20) // 非 web 归一为数值
  })

  it('zIndex 必须整数', () => {
    expect(validateProp('zIndex', 10, 'web').valid).toBe(true)
    expect(validateProp('zIndex', 10.5, 'web').valid).toBe(false)
  })
})

describe('validateStyle（06 §2 核心：白名单 + 类型守卫 + 降级）', () => {
  it('合法 style 原样通过（Length 归一）', () => {
    const out = validateStyle({ width: 100, opacity: 0.5, color: '#ff0000' }, 'web')
    expect(out).toEqual({ width: 100, opacity: 0.5, color: '#ff0000' })
  })

  it('非法值 → 降级默认值 + 拒绝列表上报', () => {
    const rejected: string[] = []
    const out = validateStyle({ width: 'abc', opacity: 2, float: 'left', unknownProp: 1 }, 'web', {
      silent: true,
      onReject: (rs) => rejected.push(...rs.map((r) => r.prop)),
    })
    expect(rejected).toContain('width')
    expect(rejected).toContain('float')
    expect(rejected).toContain('unknownProp')
    // 降级默认值（06 §5）：width→0、opacity→1
    expect(out.width).toBe(0)
    expect(out.opacity).toBe(1)
    // 禁止项被丢弃（无默认值）
    expect(out.float).toBeUndefined()
  })

  it('降级默认值表存在（06 §5 常量）', () => {
    expect(FALLBACK_DEFAULTS.width).toBe(0)
    expect(FALLBACK_DEFAULTS.opacity).toBe(1)
    expect(FALLBACK_DEFAULTS.color).toBe('inherit')
    expect(FALLBACK_DEFAULTS.borderRadius).toBe(0)
  })

  it('isValidStyleProp 便捷断言', () => {
    expect(isValidStyleProp('width', 20, 'web')).toBe(true)
    expect(isValidStyleProp('backdropFilter', 'blur(2px)', 'web')).toBe(false)
  })
})
