// tests/style-safety-b3.test.ts
// ★G-31 style-safety B3：编译期推导（05 §2 可达值集 + §5 常量折叠 + 覆盖率）
import { describe, expect, it } from 'vitest'
import { deriveReachableValues, extractScriptConstants, analyzeStyleBindings } from '../packages/compiler/src/style-safety/index'

describe('deriveReachableValues（05 §2 可达值集推导）', () => {
  it('Literal → 完全静态', () => {
    expect(deriveReachableValues('100', {})).toEqual({ values: [100], isFullyStatic: true, dynamicSources: [] })
    expect(deriveReachableValues("'50px'", {})).toEqual({ values: ['50px'], isFullyStatic: true, dynamicSources: [] })
    expect(deriveReachableValues('true', {})).toEqual({ values: [true], isFullyStatic: true, dynamicSources: [] })
  })

  it('Identifier → 常量表折叠静态 / 未知名动态', () => {
    expect(deriveReachableValues('baseWidth', { baseWidth: 100 })).toEqual({ values: [100], isFullyStatic: true, dynamicSources: [] })
    const dyn = deriveReachableValues('apiData.width', {})
    expect(dyn.isFullyStatic).toBe(false)
    expect(dyn.dynamicSources).toContain('apiData.width')
  })

  it('ConditionalExpression → 两侧值 union（05 §2）', () => {
    const r = deriveReachableValues("isLarge ? '100px' : '50px'", {})
    expect(r.isFullyStatic).toBe(true)
    expect(r.values).toEqual(['100px', '50px'])
    // 含动态条件侧 → 仍静态（条件不影响值集，值集来自两侧）
    expect(deriveReachableValues('cond ? 1 : 2', {}).values).toEqual([1, 2])
  })

  it('BinaryExpression → 静态操作数折叠（05 §5 常量折叠）', () => {
    expect(deriveReachableValues('baseWidth * 2 + offset', { baseWidth: 100, offset: 10 })).toEqual({ values: [210], isFullyStatic: true, dynamicSources: [] })
    expect(deriveReachableValues('100 + 20', {})).toEqual({ values: [120], isFullyStatic: true, dynamicSources: [] })
    // 含动态操作数 → 动态
    expect(deriveReachableValues("apiData.width + 'px'", {}).isFullyStatic).toBe(false)
  })

  it('复杂调用/未知 → 动态（无法推导 ≠ 不安全，退化为运行时校验）', () => {
    expect(deriveReachableValues('Math.random()', {}).isFullyStatic).toBe(false)
    expect(deriveReachableValues('', {}).isFullyStatic).toBe(false)
  })
})

describe('extractScriptConstants（05 §5 常量表）', () => {
  it('顶层 const 字面量 → 常量表', () => {
    const c = extractScriptConstants('const baseWidth = 100\nconst offset = 10\nconst title = "hello"\nconst arr = [1, 2]\nconst obj = { a: 1 }')
    expect(c.baseWidth).toBe(100)
    expect(c.offset).toBe(10)
    expect(c.title).toBe('hello')
    expect(Array.isArray(c.arr)).toBe(true)
  })

  it('运行时值/嵌套缩进跳过', () => {
    const c = extractScriptConstants('const w = ref(100)\n  const indented = 1\nconst f = () => 1\nimport { x } from "y"')
    expect(c.w).toBeUndefined()
    expect(c.indented).toBeUndefined()
    expect(c.f).toBeUndefined()
  })
})

describe('analyzeStyleBindings（B3 主入口：白名单 + 分类 + 覆盖率）', () => {
  it('静态字面量全部合法 → 覆盖率 1.0 + 零违规', () => {
    const r = analyzeStyleBindings('<view :style="{ width: 100, opacity: 0.5, color: \'#fff\' }" />', {})
    expect(r.violations).toHaveLength(0)
    expect(r.stats.coverage).toBe(1)
  })

  it('常量折叠：script 顶层 const → 静态（覆盖率提升）', () => {
    const r = analyzeStyleBindings('<view :style="{ width: baseWidth * 2 }" />', { baseWidth: 100 })
    expect(r.violations).toHaveLength(0)
    expect(r.stats.staticChecked).toBe(1)
    expect(r.stats.dynamic).toBe(0)
  })

  it('动态源 + 静态混合 → 覆盖率 < 1', () => {
    const r = analyzeStyleBindings('<view :style="{ width: apiData.width, opacity: 0.5 }" />', {})
    expect(r.stats.staticChecked).toBe(1) // opacity
    expect(r.stats.dynamic).toBe(1) // apiData.width
    expect(r.stats.coverage).toBe(0.5)
  })

  it('违规分类：STS001/STS003/STS004/STS002 + CSS 变量放行', () => {
    const r = analyzeStyleBindings(
      `<view :style="{ boxShadow: '0 2px', 'backdrop-filter': 'blur(10px)', display: 'inline-flex', opacity: 2, '--barrier-opacity': v }" />`,
      {},
    )
    const codes = r.violations.map((v) => v.code)
    expect(codes).toContain('STS001') // boxShadow
    expect(codes).toContain('STS003') // backdrop-filter
    expect(codes).toContain('STS004') // display
    expect(codes).toContain('STS002') // opacity: 2
    expect(codes.filter((c) => c === 'STS006')).toHaveLength(0) // CSS 变量放行非动态源
  })

  it(':style="styleObj" 动态源 → STS006 提示（不阻断）', () => {
    const r = analyzeStyleBindings('<view :style="styleObj" />', {})
    expect(r.violations.map((v) => v.code)).toEqual(['STS006'])
    expect(r.stats.dynamic).toBe(1)
  })
})
